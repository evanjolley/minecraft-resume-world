import { sign, verify, secretConfigured } from './token.js'
import { randomB64url } from './b64.js'

/*
 * WHO IS ASKING. The one helper the rest of the Worker needs.
 *
 *   import { getVisitor } from './account/session.js'
 *   const visitor = await getVisitor(request, env)
 *   // null, or { id, account, exp }
 *
 * `id` is an opaque string, stable for the life of the visitor: a guest keeps
 * it when they upgrade to an account, and an account carries it to every
 * device it signs in on. So anything keyed by it (AI Evan's per-visitor
 * memory, the saved world) follows the person without a migration step.
 * Treat it as an opaque key. It is not secret, it is not a name, and it must
 * never be shown to the visitor or to the model.
 *
 * Read from `Authorization: Bearer <token>` first, then from the
 * `world_session` cookie. The cookie is HttpOnly and scoped to /api, so a
 * same-origin fetch from the page carries it with no code at the call site;
 * the header is for tools and tests.
 *
 * Returns null when SESSION_SECRET is not configured. Callers must treat null
 * as "anonymous", never as an error worth a 500: the site has to keep working
 * on a deploy with no secrets at all.
 */

export const COOKIE = 'world_session'
const DAY = 24 * 60 * 60 * 1000
export const GUEST_TTL = 365 * DAY
export const ACCOUNT_TTL = 90 * DAY

/* `v_` plus 128 random bits. Short enough to be a WebAuthn user handle (64
 * bytes max) and a Durable Object name, and unguessable. */
export const newVisitorId = () => `v_${randomB64url(16)}`
export const isVisitorId = (s) => typeof s === 'string' && /^v_[A-Za-z0-9_-]{22}$/.test(s)

function readToken(request) {
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim()
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === COOKIE) return v.join('=')
  }
  return null
}

/**
 * @returns {Promise<null | { id: string, account: boolean, exp: number }>}
 */
export async function getVisitor(request, env) {
  if (!secretConfigured(env)) return null
  const token = readToken(request)
  if (!token) return null
  const claims = await verify(token, env.SESSION_SECRET, { purpose: 'session' })
  if (!claims || !isVisitorId(claims.v)) return null
  return { id: claims.v, account: claims.a === 1, exp: claims.exp }
}

/** A fresh session token for this visitor id. */
export function issueSession(env, id, account) {
  return sign({ v: id, a: account ? 1 : 0 }, env.SESSION_SECRET,
    { purpose: 'session', ttlMs: account ? ACCOUNT_TTL : GUEST_TTL })
}

/** Set-Cookie for a token. Secure is fine on http://localhost: browsers
 *  treat localhost as a secure context. */
export function sessionCookie(token, account) {
  const maxAge = Math.floor((account ? ACCOUNT_TTL : GUEST_TTL) / 1000)
  return `${COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
}

export const clearCookie = () =>
  `${COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`

/** Login needs the session secret and somewhere to keep credentials. */
export const loginEnabled = (env) =>
  secretConfigured(env) && !!env?.VISITOR && env?.LOGIN !== 'off'

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
})

/** Response carrying a session: JSON body plus the cookie. */
export async function sessionResponse(env, id, account, extra = {}) {
  const token = await issueSession(env, id, account)
  return json({ visitor: id, account, token, login: loginEnabled(env), ...extra }, 200,
    { 'set-cookie': sessionCookie(token, account) })
}

/**
 * POST /api/session. Idempotent "who am I": a valid token is refreshed (so an
 * active visitor never expires), anything else mints a new guest. Stateless
 * for guests, which is the property that lets 1,000 of them arrive at once
 * without a single storage write.
 */
export async function handleSession(request, env) {
  if (!secretConfigured(env)) return json({ error: 'sessions not configured', login: false }, 503)
  const current = await getVisitor(request, env)
  if (!current) return sessionResponse(env, newVisitorId(), false)
  let nickname = null
  if (current.account && env.VISITOR) {
    nickname = (await visitorStub(env, current.id).getProfile())?.nickname ?? null
  }
  return sessionResponse(env, current.id, current.account, { nickname })
}

/** POST /api/session/logout: back to a NEW guest, cookie replaced. */
export async function handleLogout(request, env) {
  if (!secretConfigured(env)) return json({ error: 'sessions not configured' }, 503)
  return sessionResponse(env, newVisitorId(), false)
}

/**
 * The visitor's Durable Object, one per visitor id, created on first use.
 * Returned as an object whose methods are the store's (see VISITOR_METHODS in
 * worker/world/visitor.js), each a JSON call over the stub's fetch.
 */
export function visitorStub(env, id) {
  const stub = env.VISITOR.get(env.VISITOR.idFromName(id))
  return new Proxy({}, {
    get: (_, method) => (method === 'then' ? undefined : async (...args) => {
      const res = await stub.fetch('https://visitor.internal/rpc', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args }),
      })
      if (!res.ok) throw new Error(`visitor.${String(method)}: ${res.status}`)
      return (await res.json()).result
    }),
  })
}
