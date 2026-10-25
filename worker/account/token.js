import { bytesToB64url, b64urlToBytes, utf8, fromUtf8 } from './b64.js'

/*
 * SIGNED TOKENS: `v1.<payload>.<mac>`, HMAC-SHA256 under env.SESSION_SECRET.
 *
 * One format for two jobs: the visitor session (purpose 'session') and the
 * short-lived passkey challenge (purposes 'reg' and 'auth'). The purpose is
 * inside the signed payload, so a challenge token can never be replayed as a
 * session and vice versa.
 *
 * Rejected: JWT. It is the same three dot-separated parts with an `alg`
 * header a verifier must then refuse to trust, and nothing outside this
 * Worker ever reads these.
 *
 * Rejected: a session table. A token the server can verify without a lookup
 * costs nothing per request, which matters for guests: they are most visitors
 * and they never touch storage at all. The price is that a token cannot be
 * revoked before it expires. That is acceptable for what it guards (a
 * visitor's own block edits and their own conversation memory) and is
 * written up in docs/decisions.md.
 */

const VERSION = 'v1'
/* Below this the secret is guessable, and a guessable secret mints any id. */
const MIN_SECRET_LENGTH = 32

const keyCache = new Map()

async function hmacKey(secret) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) return null
  let key = keyCache.get(secret)
  if (!key) {
    key = await crypto.subtle.importKey('raw', utf8(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    keyCache.set(secret, key)
  }
  return key
}

export const secretConfigured = (env) =>
  typeof env?.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= MIN_SECRET_LENGTH

/**
 * @param {object} claims  anything JSON; `p` (purpose) and `exp` (ms) are added
 * @param {string} secret
 */
export async function sign(claims, secret, { purpose, ttlMs }) {
  const key = await hmacKey(secret)
  if (!key) throw new Error('SESSION_SECRET missing or shorter than 32 characters')
  const body = { ...claims, p: purpose, exp: Date.now() + ttlMs }
  const payload = bytesToB64url(utf8(JSON.stringify(body)))
  const mac = await crypto.subtle.sign('HMAC', key, utf8(`${VERSION}.${payload}`))
  return `${VERSION}.${payload}.${bytesToB64url(mac)}`
}

/**
 * The claims, or null for ANY failure: wrong shape, wrong version, bad MAC,
 * wrong purpose, expired. One answer on purpose, so a caller cannot branch on
 * why and accidentally accept a half-valid token.
 *
 * crypto.subtle.verify compares in constant time, which is why this verifies
 * rather than signing again and comparing strings.
 */
export async function verify(token, secret, { purpose }) {
  try {
    const key = await hmacKey(secret)
    if (!key || typeof token !== 'string' || token.length > 2048) return null
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== VERSION) return null
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(parts[2]),
      utf8(`${parts[0]}.${parts[1]}`))
    if (!ok) return null
    const claims = JSON.parse(fromUtf8(b64urlToBytes(parts[1])))
    if (claims?.p !== purpose) return null
    if (typeof claims.exp !== 'number' || claims.exp <= Date.now()) return null
    return claims
  } catch {
    return null
  }
}
