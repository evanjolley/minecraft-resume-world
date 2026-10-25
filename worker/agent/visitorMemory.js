/*
 * THE VISITOR MEMORY DURABLE OBJECT. One instance per visitor.
 *
 * WHY A DURABLE OBJECT PER VISITOR, and not D1 or KV, at 1,000 concurrent
 * visitors (the long version is docs/decisions.md):
 *
 *   - The access pattern is "one visitor, read everything about them, append
 *     a few rows, every turn". That is exactly one object's worth of state,
 *     and a SQLite-backed object keeps it on the same machine as the code
 *     that reads it: zero network hops for the reads that every turn does.
 *   - 1,000 visitors is 1,000 independent objects with no shared row, table
 *     or primary between them. D1 would funnel every turn of every visitor
 *     through one database's single writer; KV is eventually consistent and
 *     allows one write per key per second, which a tool loop exceeds.
 *   - Single-threaded per visitor, so the turn lease and the token budget are
 *     exact counts rather than per-colo approximations (02-operations.md 3.4).
 *   - Idle objects hibernate and are not billed for duration; the alarm wakes
 *     one up to summarise a finished visit and, 30 days later, to delete it.
 *
 * FETCH-BASED, NOT RPC. RPC methods need `extends DurableObject` from
 * 'cloudflare:workers', and that module does not exist under Node -- where
 * test/55 and the specs for this directory import worker/index.js. A JSON
 * POST per method is a few lines more and keeps every file importable in a
 * plain test.
 */
import { MemoryStore, doSql } from './memory.js'
import { consolidatePending } from './consolidate.js'
import { summariserFor } from './upstream.js'
import { mockSummariser } from './mock.js'

const METHODS = new Set(['begin', 'commit', 'release', 'remember', 'forget', 'snapshot', 'render', 'standing'])

export class VisitorMemory {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.store = new MemoryStore(doSql(state.storage.sql))
  }

  async fetch(request) {
    const method = new URL(request.url).pathname.slice(1)
    if (!METHODS.has(method)) return new Response('no such method', { status: 404 })
    const args = await request.json().catch(() => ({}))
    const now = Date.now()
    let out
    if (method === 'snapshot' || method === 'render') out = this.store[method](now)
    else if (method === 'forget' || method === 'release') out = this.store[method]()
    else out = this.store[method]({ now, ...args })
    if (method === 'commit' || method === 'forget') await this.schedule(now)
    return Response.json(out ?? null)
  }

  /** Wake for the earliest of: summarising an ended visit, or expiring. */
  async schedule(now) {
    const at = this.store.nextAlarm(now)
    if (at) await this.state.storage.setAlarm(at)
    else await this.state.storage.deleteAlarm()
  }

  async alarm() {
    const now = Date.now()
    if (this.store.expire(now)) {
      /* Nothing left; deleteAll also clears the alarm and the object's
       * storage entirely, so an expired visitor costs nothing afterwards. */
      await this.state.storage.deleteAll()
      return
    }
    const summarise = this.env?.AGENT_MOCK_MODEL === '1' ? mockSummariser
      : this.env?.ANTHROPIC_API_KEY ? summariserFor(this.env) : null
    await consolidatePending(this.store, summarise ?? (async () => { throw new Error('no key') }), now)
    await this.schedule(now)
  }
}

/**
 * The Worker's handle on one visitor's object, with the MemoryStore's method
 * names so turn.js cannot tell it from the in-process store tests use.
 */
export function memoryClient(stub) {
  const call = (method) => async (args = {}) => {
    const res = await stub.fetch(`https://memory/${method}`, {
      method: 'POST', body: JSON.stringify(args),
    })
    if (!res.ok) throw new Error(`memory.${method} ${res.status}`)
    return res.json()
  }
  return {
    begin: call('begin'),
    commit: call('commit'),
    release: call('release'),
    remember: call('remember'),
    forget: call('forget'),
    snapshot: call('snapshot'),
    standing: call('standing'),
  }
}
