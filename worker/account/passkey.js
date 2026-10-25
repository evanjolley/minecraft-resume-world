import { sign, verify } from './token.js'
import { randomB64url, bytesToB64url, b64urlToBytes, utf8, fromUtf8 } from './b64.js'
import { verifyRegistration, verifyAssertion } from './webauthn.js'
import {
  getVisitor, sessionResponse, json, loginEnabled, visitorStub, isVisitorId,
} from './session.js'
import { checkNickname } from '../../src/nickname.js'

/*
 * PASSKEY LOGIN. Four endpoints, two ceremonies, no stored challenges.
 *
 *   POST /api/auth/passkey/register/options   (needs a session, guest or account)
 *   POST /api/auth/passkey/register/verify
 *   POST /api/auth/passkey/login/options      (needs nothing)
 *   POST /api/auth/passkey/login/verify
 *
 * The challenge travels as a signed, five-minute token instead of living in
 * storage, so starting a ceremony costs no write and an abandoned one costs
 * nothing at all.
 *
 * REGISTER IS AN UPGRADE. The passkey's user handle is the visitor id the
 * guest already has, so the account IS the guest: same id, same AI Evan
 * memory, same world. Nothing is migrated because nothing moves.
 *
 * LOGIN NEEDS NO INDEX. Passkeys are requested as discoverable
 * (residentKey: 'required'), so the authenticator hands back the user handle
 * on login, the handle is the visitor id, and the visitor id names the
 * Durable Object holding the public key. One lookup, no global table.
 *
 * The relying party id defaults to the request's hostname. That is the part
 * to get right before launch: a passkey is bound to its rp id, so passkeys
 * made on world.<something>.workers.dev will not work on world.evanjolley.com.
 * Set PASSKEY_RP_ID (and PASSKEY_ORIGIN) once the domain is final, or keep
 * LOGIN=off until it is. See docs/decisions.md.
 */

const CHALLENGE_TTL = 5 * 60 * 1000

const rpFor = (request, env) => {
  const url = new URL(request.url)
  return {
    rpId: env.PASSKEY_RP_ID || url.hostname,
    origin: env.PASSKEY_ORIGIN || url.origin,
  }
}

async function body(request) {
  try { return await request.json() } catch { return null }
}

export async function registerOptions(request, env) {
  if (!loginEnabled(env)) return json({ error: 'login is not enabled' }, 503)
  const visitor = await getVisitor(request, env)
  if (!visitor) return json({ error: 'no session' }, 401)
  const { rpId } = rpFor(request, env)
  const challenge = randomB64url(32)
  const challengeToken = await sign({ c: challenge, v: visitor.id }, env.SESSION_SECRET,
    { purpose: 'reg', ttlMs: CHALLENGE_TTL })

  const profile = await visitorStub(env, visitor.id).getProfile()
  const label = profile?.nickname || 'Minecraft visitor'
  return json({
    challengeToken,
    publicKey: {
      challenge,
      rp: { id: rpId, name: "Evan Jolley's world" },
      user: { id: bytesToB64url(utf8(visitor.id)), name: label, displayName: label },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 },
        { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      attestation: 'none',
      timeout: CHALLENGE_TTL,
    },
  })
}

export async function registerVerify(request, env) {
  if (!loginEnabled(env)) return json({ error: 'login is not enabled' }, 503)
  const visitor = await getVisitor(request, env)
  if (!visitor) return json({ error: 'no session' }, 401)
  const req = await body(request)
  const claims = await verify(req?.challengeToken, env.SESSION_SECRET, { purpose: 'reg' })
  // The challenge must have been issued to THIS visitor. Otherwise a stolen
  // challenge token could attach someone's passkey to someone else's id.
  if (!claims || claims.v !== visitor.id) return json({ error: 'challenge expired' }, 400)

  let reg
  try {
    reg = await verifyRegistration(req.credential, { challenge: claims.c, ...rpFor(request, env) })
  } catch (e) {
    return json({ error: `registration rejected: ${e.message}` }, 400)
  }

  const stub = visitorStub(env, visitor.id)
  await stub.addCredential(reg)
  // The nickname the guest was using comes along, if the filter allows it.
  const nick = checkNickname(req?.nickname)
  if (nick.ok) await stub.setNickname(nick.name)
  const profile = await stub.getProfile()
  return sessionResponse(env, visitor.id, true, { nickname: profile?.nickname ?? null })
}

export async function loginOptions(request, env) {
  if (!loginEnabled(env)) return json({ error: 'login is not enabled' }, 503)
  const { rpId } = rpFor(request, env)
  const challenge = randomB64url(32)
  const challengeToken = await sign({ c: challenge }, env.SESSION_SECRET,
    { purpose: 'auth', ttlMs: CHALLENGE_TTL })
  return json({
    challengeToken,
    publicKey: { challenge, rpId, userVerification: 'preferred', timeout: CHALLENGE_TTL,
      allowCredentials: [] },
  })
}

export async function loginVerify(request, env) {
  if (!loginEnabled(env)) return json({ error: 'login is not enabled' }, 503)
  const req = await body(request)
  const claims = await verify(req?.challengeToken, env.SESSION_SECRET, { purpose: 'auth' })
  if (!claims) return json({ error: 'challenge expired' }, 400)

  let visitorId
  try { visitorId = fromUtf8(b64urlToBytes(req?.credential?.response?.userHandle ?? '')) } catch { /* below */ }
  if (!isVisitorId(visitorId)) return json({ error: 'unknown passkey' }, 401)

  const stub = visitorStub(env, visitorId)
  const credId = String(req.credential.rawId ?? req.credential.id ?? '')
  const stored = await stub.getCredential(credId)
  if (!stored) return json({ error: 'unknown passkey' }, 401)

  try {
    const { signCount } = await verifyAssertion(req.credential, stored,
      { challenge: claims.c, ...rpFor(request, env) })
    await stub.setSignCount(credId, signCount)
  } catch (e) {
    return json({ error: `login rejected: ${e.message}` }, 401)
  }
  const profile = await stub.getProfile()
  return sessionResponse(env, visitorId, true, { nickname: profile?.nickname ?? null })
}
