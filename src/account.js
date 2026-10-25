import { checkNickname } from './nickname.js'

/*
 * THE VISITOR'S SIDE OF IDENTITY: who the server thinks you are.
 *
 * Every visitor is a guest the instant the page loads, with no network call
 * in the way: the world boots, you play. In the background this asks the
 * Worker for a session (POST /api/session), which mints a visitor id and
 * signs it. That id is what AI Evan's memory and a saved world are keyed by
 * (worker/account/session.js has the contract).
 *
 * Signing in is optional and is an UPGRADE, not a second identity: the
 * passkey is registered against the id you already have, so your world and
 * your conversation history are simply still yours, now on every device.
 *
 * WHEN THERE IS NO SERVER, nothing breaks. `vite dev` has no Worker, and a
 * deploy without SESSION_SECRET answers 503. Both leave `online` false, the
 * sign-in button hidden, and everything local still working. The API is only
 * called when `enabled` is true: in production builds, or in dev with
 * VITE_WORLD_API=1 (see vite.config.js for the proxy to `wrangler dev`).
 *
 * The session token is kept in localStorage AND set as an HttpOnly cookie by
 * the server. The cookie is what makes same-origin fetches (AI Evan's
 * /api/agent among them) carry identity with no code at the call site; the
 * localStorage copy is what lets this module send it as a header and know
 * who it is before the first response lands.
 */

const TOKEN_KEY = 'world:v1:session'
const ACCOUNT_KEY = 'world:v1:account'

export const apiEnabled = () =>
  !!(import.meta.env?.PROD || import.meta.env?.VITE_WORLD_API === '1')

/* ---- WebAuthn wire format: the server speaks base64url, the browser ArrayBuffers ---- */

const toBytes = (b64url) => {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const toB64url = (buf) => {
  const u8 = new Uint8Array(buf)
  let s = ''
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function serializeCredential(cred) {
  const r = cred.response
  const out = { id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
    response: { clientDataJSON: toB64url(r.clientDataJSON) } }
  if (r.attestationObject) out.response.attestationObject = toB64url(r.attestationObject)
  if (r.authenticatorData) out.response.authenticatorData = toB64url(r.authenticatorData)
  if (r.signature) out.response.signature = toB64url(r.signature)
  if (r.userHandle) out.response.userHandle = toB64url(r.userHandle)
  return out
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.enabled]  call the API at all (default: apiEnabled())
 * @param {Storage} [opts.storage]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createAccount({ enabled = apiEnabled(), storage = globalThis.localStorage,
  fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  const read = (k) => { try { return storage?.getItem(k) ?? null } catch { return null } }
  const write = (k, v) => {
    try { if (v === null) storage?.removeItem(k); else storage?.setItem(k, v) } catch { /* private mode */ }
  }

  const listeners = new Set()
  const remembered = (() => { try { return JSON.parse(read(ACCOUNT_KEY) ?? 'null') } catch { return null } })()
  const state = {
    /** The opaque visitor id, or null until the server has answered once. */
    visitor: remembered?.visitor ?? null,
    /** Signed in with a passkey. Remembered so boot can wait for the server save. */
    account: remembered?.account === true,
    /** The server answered and sessions are configured. */
    online: false,
    /** The server offers sign-in. */
    login: false,
    /** The nickname the server has stored for an account, if any. */
    nickname: null,
  }

  const emit = () => { for (const fn of listeners) fn(state) }

  const adopt = (res) => {
    if (res?.token) write(TOKEN_KEY, res.token)
    state.visitor = res.visitor
    state.account = res.account === true
    state.login = res.login === true
    state.online = true
    if ('nickname' in res) state.nickname = res.nickname ?? null
    write(ACCOUNT_KEY, JSON.stringify({ visitor: state.visitor, account: state.account }))
    emit()
  }

  const headers = () => {
    const token = read(TOKEN_KEY)
    return token ? { authorization: `Bearer ${token}` } : {}
  }

  async function call(path, { method = 'POST', body, keepalive = false } = {}) {
    if (!enabled) throw new Error('offline')
    const res = await fetchImpl(path, {
      method, credentials: 'same-origin', keepalive,
      headers: { ...headers(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    let data = null
    try { data = await res.json() } catch { /* empty */ }
    return { ok: res.ok, status: res.status, data }
  }

  const api = {
    state,
    get enabled() { return enabled },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    /** For other modules' fetches: `fetch(url, { headers: account.authHeaders() })`. */
    authHeaders: headers,
    call,

    /** Ask the server who we are. Never throws; a failure leaves us a local guest. */
    async start() {
      if (!enabled) return state
      try {
        const res = await call('/api/session')
        if (res.ok) adopt(res.data)
        else if (res.status === 503) { state.online = false; emit() }
      } catch { /* offline: still a guest */ }
      return state
    },

    /**
     * Check a nickname and, for an account, store it on the server.
     * @returns {Promise<{ok: boolean, name?: string, error?: string}>}
     */
    async saveNickname(name) {
      const local = checkNickname(name)
      if (!local.ok) return { ok: false, error: local.message }
      if (!enabled || !state.online) return { ok: true, name: local.name }
      try {
        const res = await call('/api/profile', { method: 'PUT', body: { nickname: local.name } })
        if (res.status === 422) return { ok: false, error: res.data?.error ?? 'Not allowed.' }
        if (res.ok && state.account) state.nickname = local.name
      } catch { /* offline: the local check stands */ }
      return { ok: true, name: local.name }
    },

    /** Is a passkey possible in this browser at all? */
    passkeysSupported: () => typeof globalThis.PublicKeyCredential === 'function'
      && !!globalThis.navigator?.credentials?.create,

    /**
     * Upgrade this guest to an account by creating a passkey.
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async register(nickname) {
      try {
        const opts = await call('/api/auth/passkey/register/options')
        if (!opts.ok) return { ok: false, error: opts.data?.error ?? 'Sign-in is not available.' }
        const pk = opts.data.publicKey
        const cred = await navigator.credentials.create({ publicKey: {
          ...pk, challenge: toBytes(pk.challenge), user: { ...pk.user, id: toBytes(pk.user.id) },
        } })
        const res = await call('/api/auth/passkey/register/verify', { body: {
          challengeToken: opts.data.challengeToken, credential: serializeCredential(cred), nickname,
        } })
        if (!res.ok) return { ok: false, error: res.data?.error ?? 'That did not work.' }
        adopt(res.data)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e?.name === 'NotAllowedError' ? 'Cancelled.' : (e?.message ?? 'That did not work.') }
      }
    },

    /**
     * Sign in with an existing passkey.
     * @returns {Promise<{ok: boolean, switched?: boolean, error?: string}>}
     *   `switched` means the passkey belongs to a different visitor id than
     *   this browser had, so the world on screen is not theirs.
     */
    async login() {
      try {
        const before = state.visitor
        const opts = await call('/api/auth/passkey/login/options')
        if (!opts.ok) return { ok: false, error: opts.data?.error ?? 'Sign-in is not available.' }
        const pk = opts.data.publicKey
        const cred = await navigator.credentials.get({ publicKey: {
          ...pk, challenge: toBytes(pk.challenge),
          allowCredentials: (pk.allowCredentials ?? []).map((c) => ({ ...c, id: toBytes(c.id) })),
        } })
        const res = await call('/api/auth/passkey/login/verify', { body: {
          challengeToken: opts.data.challengeToken, credential: serializeCredential(cred),
        } })
        if (!res.ok) return { ok: false, error: res.data?.error ?? 'That passkey was not recognized.' }
        adopt(res.data)
        return { ok: true, switched: before !== state.visitor }
      } catch (e) {
        return { ok: false, error: e?.name === 'NotAllowedError' ? 'Cancelled.' : (e?.message ?? 'That did not work.') }
      }
    },

    /** Sign out: the server hands back a brand new guest. */
    async logout() {
      try {
        const res = await call('/api/session/logout')
        if (res.ok) { adopt(res.data); return { ok: true } }
      } catch { /* below */ }
      write(TOKEN_KEY, null)
      write(ACCOUNT_KEY, null)
      state.account = false
      state.visitor = null
      emit()
      return { ok: true }
    },
  }
  return api
}
