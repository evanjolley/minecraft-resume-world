import { test, expect } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'

import { routeAccount } from '../worker/account/routes.js'
import { getVisitor } from '../worker/account/session.js'
import { sign } from '../worker/account/token.js'
import { bytesToB64url, b64urlToBytes, utf8 } from '../worker/account/b64.js'
import { Visitor } from '../worker/world/visitor.js'
import { invalidSave } from '../worker/world/save.js'
import { checkNickname } from '../src/nickname.js'

/*
 * ACCOUNTS ON THE WORKER: sessions, tampering, nicknames, passkeys, sync.
 *
 * NO BROWSER, like test/55: these are properties of server code. The Durable
 * Object is the real Visitor class, handed node:sqlite where the runtime
 * would hand it ctx.storage.sql, and the passkey is a software authenticator
 * built below from WebCrypto, so the verifier is checked against signatures
 * it did not produce itself.
 *
 * The browser half of login (navigator.credentials against a virtual
 * authenticator, through `wrangler dev`) is test/63-login-e2e.spec.js.
 */

const ORIGIN = 'https://world.example'
const SECRET = 'test-secret-that-is-at-least-32-characters-long'

/* ---- a Durable Object namespace over node:sqlite ---- */

function sqlAdapter() {
  const db = new DatabaseSync(':memory:')
  return {
    exec(query, ...bindings) {
      const stmt = db.prepare(query)
      if (/^\s*select/i.test(query)) {
        const rows = stmt.all(...bindings)
        return { toArray: () => rows, one: () => rows[0] }
      }
      stmt.run(...bindings)
      return { toArray: () => [], one: () => undefined }
    },
  }
}

function fakeNamespace() {
  const objects = new Map()
  return {
    objects,
    idFromName: (name) => name,
    get(id) {
      if (!objects.has(id)) objects.set(id, new Visitor({ storage: { sql: sqlAdapter() } }, {}))
      const obj = objects.get(id)
      return { fetch: (url, init) => obj.fetch(new Request(url, init)) }
    },
  }
}

const makeEnv = (extra = {}) => ({ SESSION_SECRET: SECRET, VISITOR: fakeNamespace(), ...extra })

/* ---- requests ---- */

function req(path, { method = 'POST', token, body, origin } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (origin) headers.origin = origin
  return new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function call(env, path, opts) {
  const res = await routeAccount(req(path, opts), env)
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie') }
}

/* ---- a software passkey authenticator ---- */

function cbor(value) {
  const out = []
  const head = (major, n) => {
    if (n < 24) out.push((major << 5) | n)
    else if (n < 256) out.push((major << 5) | 24, n)
    else out.push((major << 5) | 25, n >> 8, n & 255)
  }
  const enc = (v) => {
    if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v)
    if (typeof v === 'string') { const b = utf8(v); head(3, b.length); out.push(...b); return }
    if (v instanceof Uint8Array) { head(2, v.length); out.push(...v); return }
    if (v instanceof Map) { head(5, v.size); for (const [k, x] of v) { enc(k); enc(x) } return }
    throw new Error('cbor: unsupported')
  }
  enc(value)
  return new Uint8Array(out)
}

const sha256 = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', b))
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) { out.set(p, i); i += p.length }
  return out
}

/* WebCrypto signs ECDSA as r||s; WebAuthn sends DER. */
function rawToDer(raw) {
  const int = (b) => {
    let v = b
    while (v.length > 1 && v[0] === 0 && !(v[1] & 0x80)) v = v.subarray(1)
    if (v[0] & 0x80) v = concat(new Uint8Array([0]), v)
    return concat(new Uint8Array([0x02, v.length]), v)
  }
  const body = concat(int(raw.subarray(0, 32)), int(raw.subarray(32)))
  return concat(new Uint8Array([0x30, body.length]), body)
}

async function createAuthenticator({ rpId = 'world.example', origin = ORIGIN } = {}) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const credId = crypto.getRandomValues(new Uint8Array(16))
  let counter = 0
  let userHandle = null
  const clientData = (type, challenge) => utf8(JSON.stringify({ type, challenge, origin }))
  const flagsCounter = (flags, n) => concat(new Uint8Array([flags]),
    new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]))

  return {
    credId: bytesToB64url(credId),
    set counter(n) { counter = n },
    async create(publicKey) {
      userHandle = b64urlToBytes(publicKey.user.id)
      const cose = new Map([[1, 2], [3, -7], [-1, 1],
        [-2, b64urlToBytes(jwk.x)], [-3, b64urlToBytes(jwk.y)]])
      const authData = concat(await sha256(utf8(rpId)), flagsCounter(0x45, counter),
        new Uint8Array(16), new Uint8Array([0, credId.length]), credId, cbor(cose))
      const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))
      return { id: bytesToB64url(credId), rawId: bytesToB64url(credId), type: 'public-key',
        response: { clientDataJSON: bytesToB64url(clientData('webauthn.create', publicKey.challenge)),
          attestationObject: bytesToB64url(att) } }
    },
    async get(publicKey, { handle = userHandle } = {}) {
      const cd = clientData('webauthn.get', publicKey.challenge)
      const authData = concat(await sha256(utf8(rpId)), flagsCounter(0x05, counter))
      const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
        keys.privateKey, concat(authData, await sha256(cd))))
      return { id: bytesToB64url(credId), rawId: bytesToB64url(credId), type: 'public-key',
        response: { clientDataJSON: bytesToB64url(cd), authenticatorData: bytesToB64url(authData),
          signature: bytesToB64url(rawToDer(sig)), userHandle: bytesToB64url(handle) } }
    },
  }
}

/** Guest session, then register a passkey. Returns the account token. */
async function signUp(env, auth, nickname = 'Casey') {
  const guest = await call(env, '/api/session')
  const opts = await call(env, '/api/auth/passkey/register/options', { token: guest.body.token })
  const credential = await auth.create(opts.body.publicKey)
  const res = await call(env, '/api/auth/passkey/register/verify', { token: guest.body.token,
    body: { challengeToken: opts.body.challengeToken, credential, nickname } })
  return { guest: guest.body, res }
}

async function login(env, auth, getOpts) {
  const opts = await call(env, '/api/auth/passkey/login/options')
  const credential = await auth.get(opts.body.publicKey, getOpts)
  return call(env, '/api/auth/passkey/login/verify',
    { body: { challengeToken: opts.body.challengeToken, credential } })
}

const SAVE = (edits = [[1, 136, 2, 'stone', 'air']], updatedAt = Date.now()) => ({
  v: 1, updatedAt,
  state: { dimension: 'overworld', position: [1.5, 137, 2.5], gamemode: 'adventure', time: 6000,
    inventory: { slots: [{ key: 'dirt', count: 3 }, null], armor: [], offhand: [], selected: 0 } },
  worlds: { overworld: { gen: 'g1-abc', edits } },
})

/* ================================================================== */

test.describe('sessions', () => {
  test('a first visit mints a guest visitor id, and a refresh keeps it', async () => {
    const env = makeEnv()
    const first = await call(env, '/api/session')
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ account: false, login: true })
    expect(first.body.visitor).toMatch(/^v_[A-Za-z0-9_-]{22}$/)
    expect(first.cookie).toContain('HttpOnly')
    expect(first.cookie).toContain('SameSite=Strict')

    const again = await call(env, '/api/session', { token: first.body.token })
    expect(again.body.visitor).toBe(first.body.visitor)
    // A guest costs no storage at all.
    expect(env.VISITOR.objects.size).toBe(0)
  })

  test('getVisitor reads the bearer header and the cookie, and is null without either', async () => {
    const env = makeEnv()
    const { body } = await call(env, '/api/session')
    const byHeader = await getVisitor(req('/api/agent', { token: body.token }), env)
    expect(byHeader).toMatchObject({ id: body.visitor, account: false })
    const byCookie = await getVisitor(new Request(`${ORIGIN}/api/agent`,
      { headers: { cookie: `other=1; world_session=${body.token}` } }), env)
    expect(byCookie?.id).toBe(body.visitor)
    expect(await getVisitor(req('/api/agent'), env)).toBeNull()
  })

  test('a tampered token is rejected, every way it can be tampered with', async () => {
    const env = makeEnv()
    const { body } = await call(env, '/api/session')
    const [v, payload, mac] = body.token.split('.')
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)))

    const forged = (c) => `${v}.${bytesToB64url(utf8(JSON.stringify(c)))}.${mac}`
    const flipped = mac.slice(0, -2) + (mac.at(-2) === 'A' ? 'B' : 'A') + mac.at(-1)
    const cases = {
      'payload upgraded to an account': forged({ ...claims, a: 1 }),
      'payload pointed at another visitor': forged({ ...claims, v: 'v_AAAAAAAAAAAAAAAAAAAAAA' }),
      'expiry pushed out': forged({ ...claims, exp: claims.exp + 1e9 }),
      'signature flipped': `${v}.${payload}.${flipped}`,
      'signature dropped': `${v}.${payload}.`,
      'wrong version': `v2.${payload}.${mac}`,
      'garbage': 'not-a-token',
      'signed with another secret': await sign({ v: claims.v, a: 1 }, 'x'.repeat(40),
        { purpose: 'session', ttlMs: 60_000 }),
      'expired': await sign({ v: claims.v, a: 0 }, SECRET, { purpose: 'session', ttlMs: -1 }),
      'a passkey challenge, not a session': await sign({ v: claims.v, c: 'x' }, SECRET,
        { purpose: 'reg', ttlMs: 60_000 }),
    }
    for (const [name, token] of Object.entries(cases)) {
      expect(await getVisitor(req('/api/agent', { token }), env), name).toBeNull()
    }
    // And a tampered token on /api/session is not refreshed into a valid one
    // for the forged id: it is treated as no token and a NEW guest is minted.
    const res = await call(env, '/api/session', { token: cases['payload upgraded to an account'] })
    expect(res.body.visitor).not.toBe(claims.v)
    expect(res.body.account).toBe(false)
  })

  test('with no SESSION_SECRET nothing breaks: 503, login off, everyone anonymous', async () => {
    const env = makeEnv({ SESSION_SECRET: undefined })
    const res = await call(env, '/api/session')
    expect(res.status).toBe(503)
    expect(res.body.login).toBe(false)
    expect(await getVisitor(req('/api/agent', { token: 'v1.x.y' }), env)).toBeNull()
    const short = makeEnv({ SESSION_SECRET: 'too-short' })
    expect((await call(short, '/api/session')).status).toBe(503)
  })

  test('state-changing routes refuse other origins', async () => {
    const env = makeEnv()
    const res = await call(env, '/api/session', { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect((await call(env, '/api/session', { origin: ORIGIN })).status).toBe(200)
  })
})

test.describe('nicknames', () => {
  test('the filter: shape, Evan, staff and slurs, without eating ordinary names', () => {
    for (const ok of ['Casey', 'Al', 'EvanK', 'Nazir', 'raccoon', 'Peacock', 'x_1', 'Dickens']) {
      expect(checkNickname(ok), ok).toMatchObject({ ok: true })
    }
    const refused = { Evan: 'evan', ev4n: 'evan', Evan_Jolley: 'evan', JOLLEY: 'evan',
      evan123: 'evan', Admin: 'staff', Moderator2: 'staff', '': 'empty', 'a b': 'shape',
      ['x'.repeat(17)]: 'shape', 'h‮ey': 'shape', Hitler99: 'blocked', Steve_1488: 'blocked' }
    for (const [name, reason] of Object.entries(refused)) {
      expect(checkNickname(name), name).toMatchObject({ ok: false, reason })
    }
  })

  test('the server runs the same filter, and stores names only for accounts', async () => {
    const env = makeEnv()
    const { body } = await call(env, '/api/session')
    const bad = await call(env, '/api/profile', { method: 'PUT', token: body.token, body: { nickname: 'Evan' } })
    expect(bad.status).toBe(422)
    expect(bad.body.reason).toBe('evan')
    const good = await call(env, '/api/profile', { method: 'PUT', token: body.token, body: { nickname: 'Casey' } })
    expect(good.body).toMatchObject({ ok: true, nickname: 'Casey', stored: false })
    const anon = await call(env, '/api/profile', { method: 'PUT', body: { nickname: 'Casey' } })
    expect(anon.status).toBe(401)
  })
})

test.describe('passkeys', () => {
  test('registering upgrades the guest in place: same visitor id, now an account', async () => {
    const env = makeEnv()
    const auth = await createAuthenticator()
    const { guest, res } = await signUp(env, auth)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ visitor: guest.visitor, account: true, nickname: 'Casey' })
    expect(await getVisitor(req('/api/x', { token: res.body.token }), env))
      .toMatchObject({ id: guest.visitor, account: true })
  })

  test('signing in on another device finds the same visitor, with no index', async () => {
    const env = makeEnv()
    const auth = await createAuthenticator()
    const { guest } = await signUp(env, auth)
    auth.counter = 1
    const res = await login(env, auth)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ visitor: guest.visitor, account: true, nickname: 'Casey' })
  })

  test('a wrong origin, a replayed counter, a forged signature and a stranger\'s handle all fail', async () => {
    const env = makeEnv()
    const auth = await createAuthenticator()
    const { guest } = await signUp(env, auth)
    auth.counter = 5
    expect((await login(env, auth)).status).toBe(200)

    // The counter must move forward once it has moved at all.
    expect((await login(env, auth)).status).toBe(401)

    // A passkey made for another site.
    const phish = await createAuthenticator({ origin: 'https://world-example.evil' })
    await signUp(env, phish).then(({ res }) => expect(res.status).toBe(400))

    // The right handle with somebody else's key.
    const thief = await createAuthenticator()
    const res = await login(env, thief, { handle: utf8(guest.visitor) })
    expect(res.status).toBe(401)
  })

  test('a registration challenge issued to one visitor cannot be used by another', async () => {
    const env = makeEnv()
    const a = await call(env, '/api/session')
    const b = await call(env, '/api/session')
    const opts = await call(env, '/api/auth/passkey/register/options', { token: a.body.token })
    const credential = await (await createAuthenticator()).create(opts.body.publicKey)
    const res = await call(env, '/api/auth/passkey/register/verify', { token: b.body.token,
      body: { challengeToken: opts.body.challengeToken, credential } })
    expect(res.status).toBe(400)
  })

  test('LOGIN=off hides sign-in without breaking sessions', async () => {
    const env = makeEnv({ LOGIN: 'off' })
    const s = await call(env, '/api/session')
    expect(s.body.login).toBe(false)
    expect((await call(env, '/api/auth/passkey/login/options')).status).toBe(503)
  })
})

test.describe('saved worlds', () => {
  test('guests are refused; accounts round-trip a save', async () => {
    const env = makeEnv()
    const guest = await call(env, '/api/session')
    expect((await call(env, '/api/world', { method: 'GET', token: guest.body.token })).status).toBe(403)

    const { res } = await signUp(env, await createAuthenticator())
    const token = res.body.token
    expect((await call(env, '/api/world', { method: 'GET', token })).body).toEqual({ rev: 0, save: null })

    const save = SAVE()
    const put = await call(env, '/api/world', { method: 'PUT', token, body: { baseRev: 0, save } })
    expect(put.body).toEqual({ ok: true, rev: 1 })
    const got = await call(env, '/api/world', { method: 'GET', token })
    expect(got.body).toEqual({ rev: 1, save })
  })

  test('a stale revision is a 409 carrying the newer save, never an overwrite', async () => {
    const env = makeEnv()
    const { res } = await signUp(env, await createAuthenticator())
    const token = res.body.token
    await call(env, '/api/world', { method: 'PUT', token, body: { baseRev: 0, save: SAVE() } })
    const stale = await call(env, '/api/world', { method: 'PUT', token,
      body: { baseRev: 0, save: SAVE([[9, 9, 9, 'dirt', 'air']]) } })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ conflict: true, rev: 1 })
    expect(stale.body.save.worlds.overworld.edits).toEqual([[1, 136, 2, 'stone', 'air']])
  })

  test('malformed saves are refused before they reach storage', async () => {
    const bad = {
      'no version': { ...SAVE(), v: 2 },
      'numeric block ids': SAVE([[1, 2, 3, 7, 0]]),
      'short edit': SAVE([[1, 2, 'stone', 'air']]),
      'absurd coordinate': SAVE([[1e12, 2, 3, 'stone', 'air']]),
      'stack of 99': { ...SAVE(), state: { inventory: { slots: [{ key: 'dirt', count: 99 }] } } },
    }
    for (const [name, save] of Object.entries(bad)) expect(invalidSave(save), name).not.toBeNull()
    expect(invalidSave(SAVE())).toBeNull()

    const env = makeEnv()
    const { res } = await signUp(env, await createAuthenticator())
    const r = await call(env, '/api/world', { method: 'PUT', token: res.body.token,
      body: { baseRev: 0, save: bad['numeric block ids'] } })
    expect(r.status).toBe(400)
  })
})
