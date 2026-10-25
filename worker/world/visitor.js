import { VisitorStore } from './store.js'

/*
 * The Durable Object shell around VisitorStore (store.js has the design
 * notes). Bound as VISITOR in wrangler.toml with a new_sqlite_classes
 * migration. SQLite, not the legacy KV backend: the backend is fixed when the
 * class is first deployed and cannot be changed later.
 *
 * A PLAIN CLASS WITH fetch(), NOT `extends DurableObject` + native RPC.
 * Native RPC needs `import { DurableObject } from 'cloudflare:workers'`, a
 * module that only exists inside the Workers runtime. worker/index.js
 * re-exports this class, and test/55-ai-evan-brain.spec.js imports
 * worker/index.js in plain node, so that one import would take down a spec
 * that has nothing to do with accounts. A dozen lines of JSON-over-fetch
 * below cost less than that coupling. `visitorStub()` in
 * worker/account/session.js wraps it so call sites still read
 * `await stub.getSave()`.
 */

/* Only these may be called from outside. Everything else on the store is
 * internal. */
export const VISITOR_METHODS = ['getProfile', 'setNickname', 'addCredential', 'getCredential',
  'setSignCount', 'credentialCount', 'getSave', 'putSave']

export class Visitor {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
    this.store = new VisitorStore(ctx.storage.sql)
  }

  async fetch(request) {
    let call
    try { call = await request.json() } catch { return new Response('bad json', { status: 400 }) }
    if (!VISITOR_METHODS.includes(call?.method)) return new Response('no such method', { status: 404 })
    const result = this.store[call.method](...(Array.isArray(call.args) ? call.args : []))
    return new Response(JSON.stringify({ result: result ?? null }),
      { headers: { 'content-type': 'application/json' } })
  }
}
