/*
 * POST /api/evan -- AI Evan with memory.
 *
 * The request is small on purpose:
 *
 *   { visitorId, message: "what they typed" }            a visitor turn
 *   { visitorId, toolResults: [tool_result, ...] }        the browser's tool results
 *   { visitorId, forget: true }                           "forget me", from UI
 *   { visitorId, status: true }                           is Evan here for me
 *   + tools: ["walk_to_plot", ...]                        names the browser can run
 *
 * The reply is a /v1/messages-shaped object, exactly as /api/agent returns,
 * so src/agent.js's loop is unchanged.
 *
 * /api/agent (worker/index.js) is left as it was: stateless, client-held
 * transcript. This route is its replacement once Evan switches the client
 * over, and the two can run side by side until then.
 */
import * as PROMPT from '../prompt.generated.js'
import { createGate } from '../allowlist.js'
import { runTurn } from './turn.js'
import { TOUR_RULES } from './tools.js'
import { CONDUCT_RULES, STANDING } from './conduct.js'
import { MemoryStore } from './memory.js'
import { memoryClient } from './visitorMemory.js'
import { callChat } from './upstream.js'
import { mockUpstream } from './mock.js'
import { getVisitor } from '../account/session.js'

const IS_STUB = PROMPT.IS_STUB === true
const gate = createGate(PROMPT)

/** The cached prefix: the built prompt, then the tour and memory rules, then
 *  when to flag a visitor (conduct.js). */
export const STATIC_SYSTEM = `${PROMPT.SYSTEM_PROMPT}\n\n---\n\n${TOUR_RULES}\n\n---\n\n${CONDUCT_RULES}`

/* Mirrors CAPS in worker/index.js. The turn and token caps live in memory.js
 * now, where they are counted against a record the client cannot edit. */
export const ROUTE_CAPS = { maxUserChars: 1000, maxToolResults: 8 }

/* An opaque id the browser mints (or the ACCOUNTS layer issues). It is a
 * capability: whoever holds it can talk to that visitor's memory, so it must
 * be long and random. 22+ characters of base64url is >128 bits. */
const VISITOR_ID = /^[A-Za-z0-9_-]{22,64}$/

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})
const refuse = (text, status = 200) => json({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }, status)

/**
 * @param {Request} request
 * @param {object} env  { ANTHROPIC_API_KEY, VISITOR_MEMORY, AGENT_LIMIT?, AGENT_MOCK_MODEL? }
 * @param {object} [deps]  test seam: { upstream, memory, chunks, system, now }
 */
export async function handleEvan(request, env = {}, deps = {}) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405)
  const origin = request.headers.get('origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ error: 'cross-origin' }, 403)
  }
  let body
  try { body = await request.json() } catch { return json({ error: 'bad json' }, 400) }

  /*
   * The signed session wins. When the Worker has SESSION_SECRET, the visitor
   * id comes from the HMAC-signed cookie or bearer token (ACCOUNTS,
   * worker/account/session.js), and whatever id the body claims is ignored,
   * so nobody can talk to another visitor's memory by sending their id. The
   * body's id is only used on a deploy with no session secret, where there
   * is nothing better to go on. Account and guest ids share the same memory
   * key, so signing in keeps the conversation.
   */
  const session = await getVisitor(request, env)
  const visitorId = session?.id ?? String(body?.visitorId ?? '')
  if (!VISITOR_ID.test(visitorId)) return json({ error: 'bad visitorId' }, 400)

  /* Build the one new message, and refuse anything else. A `messages` array,
   * a `system` field, a role: all ignored. The transcript is the server's. */
  let delta
  if (typeof body.message === 'string') {
    const msg = body.message.trim()
    if (!msg) return json({ error: 'empty message' }, 400)
    if (msg.length > ROUTE_CAPS.maxUserChars) return refuse('That is a lot of text. Give me the short version?', 413)
    delta = { role: 'user', content: msg }
  } else if (Array.isArray(body.toolResults) && body.toolResults.length) {
    delta = {
      role: 'user',
      content: body.toolResults.slice(0, ROUTE_CAPS.maxToolResults)
        .filter((r) => r && r.type === 'tool_result' && typeof r.tool_use_id === 'string')
        .map((r) => ({ type: 'tool_result', tool_use_id: r.tool_use_id, content: r.content, is_error: !!r.is_error })),
    }
  } else if (body.forget !== true && body.status !== true) {
    return json({ error: 'need message, toolResults, forget or status' }, 400)
  }

  /* Rate limit before anything that costs, keyed on the visitor, not the IP. */
  if (env.AGENT_LIMIT) {
    const { success } = await env.AGENT_LIMIT.limit({ key: visitorId })
    if (!success) return refuse('Give me a second, I am still catching up.', 429)
  }

  const memory = deps.memory
    ?? (env.VISITOR_MEMORY ? memoryClient(env.VISITOR_MEMORY.get(env.VISITOR_MEMORY.idFromName(visitorId))) : null)
  if (!memory) return refuse('My memory is not wired up on this deploy yet.', 503)

  if (body.forget === true) {
    await memory.forget()
    return json({ forgotten: true })
  }

  /*
   * Signed in is a fact about THIS REQUEST, read off the HMAC-signed session
   * and never off the body, so a visitor cannot claim to be a guest to get
   * the guest's time-limited standing. On a deploy with no SESSION_SECRET
   * there are no accounts and everyone is a guest, keyed by the id their
   * browser minted; that is the weakest handle in the system, and the
   * standing is only as sticky as it. Nothing stronger exists without sign-in.
   */
  const account = session?.account === true

  /* The mock is for local development only. A real key always wins, so a
   * stray AGENT_MOCK_MODEL in production cannot replace the real brain. */
  const mock = !env.ANTHROPIC_API_KEY && env.AGENT_MOCK_MODEL === '1'
  const upstream = deps.upstream
    ?? (mock ? mockUpstream : env.ANTHROPIC_API_KEY ? (a) => callChat({ env, ...a }) : null)
  /* Whether a message would reach a model, by the same two refusals below. */
  const wired = !!upstream && !(IS_STUB && !deps.upstream && !mock)

  /*
   * "Is he here for me?" Asked once at boot so a visitor he left does not
   * see him standing there until they say something. Read-only: it does not
   * count as an attempt and does not move a guest's window.
   *
   * `brain: 'none'` is the other half of the boot question: this deploy has
   * no key, or only the stub prompt, so every message would get a 503
   * sentence. src/main.js hears that and runs the offline stub instead.
   */
  if (body.status === true) {
    const st = await memory.standing({ now: deps.now ?? Date.now(), account })
    return json({ evan: st.state === STANDING.left ? STANDING.left : 'present', brain: wired ? 'ready' : 'none' })
  }

  if (!upstream) {
    return refuse('No brain wired up on this deploy yet. Ask the real Evan at evanjjolley@gmail.com.', 503)
  }
  /* Same rule as worker/index.js: a stub prompt never talks to a real model. */
  if (IS_STUB && !deps.upstream && !mock) {
    return refuse('This build went out without my corpus, so I genuinely know nothing. '
      + 'Email the real Evan at evanjjolley@gmail.com.', 503)
  }

  const { status, reply } = await runTurn({
    memory,
    delta,
    clientTools: Array.isArray(body.tools) ? body.tools.map(String).slice(0, 12) : [],
    upstream,
    staticSystem: deps.system ?? STATIC_SYSTEM,
    chunks: deps.chunks ?? PROMPT.CHUNKS ?? [],
    gate: deps.gate ?? gate,
    now: deps.now ?? Date.now(),
    account,
  })
  return json(reply, status)
}

/** For tests: an in-process store with the same surface as memoryClient. */
export function localMemory(sql) {
  return new MemoryStore(sql)
}
