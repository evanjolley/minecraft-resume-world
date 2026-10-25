import { bytesToB64url, b64urlToBytes, fromUtf8, utf8 } from './b64.js'

/*
 * PASSKEYS, VERIFIED WITH WEBCRYPTO AND NOTHING ELSE.
 *
 * Just enough of WebAuthn Level 2 for a site that asks for attestation
 * 'none': it checks that a credential was made for THIS origin and THIS
 * challenge, keeps its public key, and later checks a signature against it.
 * It deliberately does not verify attestation statements (which authenticator
 * model made the key), because nothing here cares, and that is the part of
 * the spec that needs certificate chains.
 *
 * Rejected: @simplewebauthn/server. It is good and it runs on Workers. It is
 * also a dependency tree in a repo where several agents edit package.json at
 * once, for roughly 200 lines that are mostly a CBOR reader. If this ever
 * needs attestation or more algorithms, swap it in: the two exported
 * functions below are the whole interface.
 *
 * Algorithms: ES256 (-7, every platform authenticator), EdDSA (-8, some
 * security keys) and RS256 (-257, Windows Hello).
 */

/* ------------------------------------------------------------------ *
 * CBOR, the subset WebAuthn uses: ints, byte and text strings, arrays, maps.
 * ------------------------------------------------------------------ */

export function decodeCbor(bytes, start = 0) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let pos = start

  const readLength = (info) => {
    if (info < 24) return info
    if (info === 24) return u8[pos++]
    if (info === 25) { const v = view.getUint16(pos); pos += 2; return v }
    if (info === 26) { const v = view.getUint32(pos); pos += 4; return v }
    if (info === 27) {
      const v = Number(view.getBigUint64(pos)); pos += 8
      if (!Number.isSafeInteger(v)) throw new Error('cbor: integer too large')
      return v
    }
    throw new Error('cbor: indefinite lengths are not used by WebAuthn')
  }

  const item = (depth) => {
    if (depth > 16) throw new Error('cbor: nested too deep')
    if (pos >= u8.length) throw new Error('cbor: truncated')
    const head = u8[pos++]
    const major = head >> 5
    const info = head & 31
    if (major === 7) {
      if (info === 20) return false
      if (info === 21) return true
      if (info === 22) return null
      throw new Error('cbor: unsupported simple value')
    }
    const n = readLength(info)
    switch (major) {
      case 0: return n
      case 1: return -1 - n
      case 2: {
        if (pos + n > u8.length) throw new Error('cbor: truncated')
        const out = u8.slice(pos, pos + n); pos += n; return out
      }
      case 3: {
        if (pos + n > u8.length) throw new Error('cbor: truncated')
        const out = fromUtf8(u8.subarray(pos, pos + n)); pos += n; return out
      }
      case 4: { const out = []; for (let i = 0; i < n; i++) out.push(item(depth + 1)); return out }
      case 5: {
        const out = new Map()
        for (let i = 0; i < n; i++) { const k = item(depth + 1); out.set(k, item(depth + 1)) }
        return out
      }
      default: throw new Error('cbor: tags are not used by WebAuthn')
    }
  }

  const value = item(0)
  return { value, end: pos }
}

/* ------------------------------------------------------------------ *
 * Authenticator data
 * ------------------------------------------------------------------ */

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_AT = 0x40

export function parseAuthData(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (u8.length < 37) throw new Error('authData too short')
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const out = {
    rpIdHash: u8.subarray(0, 32),
    flags: u8[32],
    signCount: view.getUint32(33),
  }
  if (out.flags & FLAG_AT) {
    let pos = 37 + 16 // skip aaguid
    const idLen = view.getUint16(pos); pos += 2
    out.credentialId = u8.slice(pos, pos + idLen); pos += idLen
    const { value, end } = decodeCbor(u8, pos)
    out.cosePublicKey = value
    out.attestedEnd = end
  }
  return out
}

/* ------------------------------------------------------------------ *
 * COSE key -> JWK, and signature checking
 * ------------------------------------------------------------------ */

export function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new Error('COSE key is not a map')
  const kty = cose.get(1)
  const alg = cose.get(3)
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256',
      x: bytesToB64url(cose.get(-2)), y: bytesToB64url(cose.get(-3)) } }
  }
  if (kty === 1 && alg === -8 && cose.get(-1) === 6) {
    return { alg: -8, jwk: { kty: 'OKP', crv: 'Ed25519', x: bytesToB64url(cose.get(-2)) } }
  }
  if (kty === 3 && alg === -257) {
    return { alg: -257, jwk: { kty: 'RSA', alg: 'RS256',
      n: bytesToB64url(cose.get(-1)), e: bytesToB64url(cose.get(-2)) } }
  }
  throw new Error(`unsupported credential algorithm ${alg}`)
}

/* ECDSA signatures arrive DER-encoded; WebCrypto wants r||s, 32 bytes each. */
function derToRaw(der) {
  let pos = 2
  if (der[0] !== 0x30) throw new Error('bad DER signature')
  if (der[1] & 0x80) pos = 2 + (der[1] & 0x7f)
  const readInt = () => {
    if (der[pos++] !== 0x02) throw new Error('bad DER integer')
    const len = der[pos++]
    let v = der.subarray(pos, pos + len); pos += len
    while (v.length > 32 && v[0] === 0) v = v.subarray(1)
    if (v.length > 32) throw new Error('bad DER integer length')
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out
  }
  const r = readInt(), s = readInt()
  const raw = new Uint8Array(64); raw.set(r); raw.set(s, 32)
  return raw
}

async function verifySignature({ alg, jwk }, signature, data) {
  if (alg === -7) {
    const key = await crypto.subtle.importKey('jwk', jwk,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(signature), data)
  }
  if (alg === -8) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify'])
    return crypto.subtle.verify({ name: 'Ed25519' }, key, signature, data)
  }
  if (alg === -257) {
    const key = await crypto.subtle.importKey('jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)
  }
  return false
}

const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

function checkClientData(clientDataBytes, { type, challenge, origin }) {
  const cd = JSON.parse(fromUtf8(clientDataBytes))
  if (cd.type !== type) throw new Error('wrong ceremony type')
  if (cd.challenge !== challenge) throw new Error('challenge mismatch')
  if (cd.origin !== origin) throw new Error(`origin mismatch: ${cd.origin}`)
  if (cd.crossOrigin === true) throw new Error('cross-origin ceremony')
}

/* ------------------------------------------------------------------ *
 * The two ceremonies
 * ------------------------------------------------------------------ */

/**
 * navigator.credentials.create() result, as the client serialized it.
 * @returns {Promise<{ credentialId: string, publicKey: {alg, jwk}, signCount: number }>}
 * @throws on anything that is not a valid registration for this site
 */
export async function verifyRegistration(credential, { challenge, origin, rpId }) {
  const clientDataJSON = b64urlToBytes(credential?.response?.clientDataJSON)
  checkClientData(clientDataJSON, { type: 'webauthn.create', challenge, origin })

  const { value: att } = decodeCbor(b64urlToBytes(credential.response.attestationObject))
  if (!(att instanceof Map) || !(att.get('authData') instanceof Uint8Array)) {
    throw new Error('bad attestation object')
  }
  const auth = parseAuthData(att.get('authData'))
  if (!sameBytes(auth.rpIdHash, await sha256(utf8(rpId)))) throw new Error('rpId mismatch')
  if (!(auth.flags & FLAG_UP)) throw new Error('user not present')
  if (!auth.credentialId) throw new Error('no attested credential')

  const credentialId = bytesToB64url(auth.credentialId)
  if (credential.rawId && credential.rawId !== credentialId) throw new Error('credential id mismatch')

  return { credentialId, publicKey: coseToJwk(auth.cosePublicKey), signCount: auth.signCount,
    userVerified: !!(auth.flags & FLAG_UV) }
}

/**
 * navigator.credentials.get() result against a stored credential.
 * @returns {Promise<{ signCount: number }>}
 */
export async function verifyAssertion(credential, stored, { challenge, origin, rpId }) {
  const clientDataJSON = b64urlToBytes(credential?.response?.clientDataJSON)
  checkClientData(clientDataJSON, { type: 'webauthn.get', challenge, origin })

  const authBytes = b64urlToBytes(credential.response.authenticatorData)
  const auth = parseAuthData(authBytes)
  if (!sameBytes(auth.rpIdHash, await sha256(utf8(rpId)))) throw new Error('rpId mismatch')
  if (!(auth.flags & FLAG_UP)) throw new Error('user not present')

  const signed = new Uint8Array(authBytes.length + 32)
  signed.set(authBytes)
  signed.set(await sha256(clientDataJSON), authBytes.length)
  const ok = await verifySignature(stored.publicKey,
    b64urlToBytes(credential.response.signature), signed)
  if (!ok) throw new Error('bad signature')

  /*
   * The signature counter. Synced passkeys (iCloud, Google) always report 0,
   * so only a counter that HAS moved can go backwards, and a backwards one
   * means a cloned authenticator.
   */
  if ((auth.signCount > 0 || stored.signCount > 0) && auth.signCount <= stored.signCount) {
    throw new Error('signature counter went backwards')
  }
  return { signCount: auth.signCount }
}
