/*
 * THE MODEL CALLS, for the memory-backed endpoint.
 *
 * Raw fetch to /v1/messages, the same as worker/index.js, for the same
 * reason: the Worker is a few hundred lines with no npm dependencies, and the
 * SDK would be the largest thing in the bundle to make two POSTs. The local
 * interview tool (scripts/interview.mjs) uses the SDK, where none of that
 * applies.
 */

const API = 'https://api.anthropic.com/v1/messages'

/*
 * THE CHAT MODEL. Haiku 5.5: Evan asked for the cheapest model that does the
 * job. At $0.10/$0.50 per million (prompts up to 100K tokens, which every
 * request here is), it is a twentieth of Sonnet 5.5's price, and a persona
 * answering questions about a career is the case 02-operations.md section 8
 * already argued does not need the bigger models. AGENT_MODEL overrides it
 * without a code change, so trying Sonnet 5.5 again is a secret, not a deploy.
 *
 * EFFORT LOW, THINKING ADAPTIVE. Latency is the design problem (FUTURE.md
 * section 2: "a character that pauses three seconds before replying reads as
 * broken"), and low effort is the documented setting for chat. Haiku 5.5
 * thinks adaptively by default at MEDIUM effort, so `low` is set, not
 * assumed. Thinking is left on rather than switched off: on the bigger
 * models an AGENT_MODEL can name, the off switch breaks the refusal fallback.
 *
 * THE CACHE MINIMUM. Haiku 5.5 caches a prefix of 512 tokens or more. The
 * static prefix (tools, the built prompt, TOUR_RULES, CONDUCT_RULES) is well
 * past that: test/55 holds the built prompt alone above ~1,024.
 */
export const CHAT_MODEL = 'claude-haiku-5-5'

/* Summaries are one call per ended visit, filling a JSON schema. Same model:
 * Haiku 5.5 takes structured outputs (output_config.format), and a summary
 * is the extraction work it is built for. */
export const MEMORY_MODEL = 'claude-haiku-5-5'

/*
 * WHO GETS THE REFUSAL FALLBACK. The server-side fallback (a policy decline
 * re-run on another model inside the same call) exists only on these models.
 * Haiku 5.5 has none, and `fallbacks` or its beta header sent to a model
 * without it is a request error, not a no-op. So it is decided per model,
 * and AGENT_MODEL=claude-sonnet-5-5 still gets it.
 */
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1'])
export const hasFallback = (model) => FALLBACK_MODELS.has(model)

export const MAX_TOKENS = 800

function headers(env, model) {
  return {
    'content-type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    /* Server-side refusal fallback: on a policy decline the API re-runs the
     * same request on a fallback model inside the same call, instead of the
     * visitor getting nothing. Only for a model that has it (hasFallback). */
    ...(hasFallback(model) ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
  }
}

const chatModel = (env) => env?.AGENT_MODEL || CHAT_MODEL

/**
 * The chat call.
 *
 * TWO SYSTEM BLOCKS, ONE BREAKPOINT BETWEEN THEM. The first is the built
 * prompt plus the tour rules: identical for every visitor, so with the tools
 * in front of it it is the shared cached prefix (1h TTL, because visitors
 * arrive in clusters when Evan posts a link). The second is this visitor's
 * memory, which differs per visitor and so sits AFTER the breakpoint, where
 * it cannot invalidate anyone else's cache.
 */
export function chatBody({ env, staticSystem, memoryBlock, messages, tools }) {
  const model = chatModel(env)
  return {
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: 'low' },
    /* "default" routes by refusal category, so there is no model list to keep. */
    ...(hasFallback(model) ? { fallbacks: 'default' } : {}),
    system: [
      { type: 'text', text: staticSystem, cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: memoryBlock },
    ],
    messages: withTailBreakpoint(messages),
    tools,
  }
}

/*
 * THE SECOND BREAKPOINT, on the newest message.
 *
 * History is resent every turn, which is the quadratic term in the bill
 * (02-operations.md 3.1). With a breakpoint at the tail, turn n reads turns
 * 1..n-1 from cache at a tenth of the price and only writes what is new, so
 * a 15-turn visit costs roughly linear instead of quadratic. 5-minute TTL:
 * the next turn of the same visit is seconds away, and nobody else can use
 * this visitor's history anyway.
 *
 * A COPY of the last message, marked. The stored transcript is never touched,
 * so the history stays byte-identical turn to turn (a string and a single
 * text block render the same; cache_control does not change the bytes the
 * cache keys on).
 */
function withTailBreakpoint(messages) {
  if (!messages.length) return messages
  const last = messages[messages.length - 1]
  const blocks = typeof last.content === 'string'
    ? [{ type: 'text', text: last.content }]
    : last.content.map((b) => ({ ...b }))
  if (!blocks.length) return messages
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
  return [...messages.slice(0, -1), { ...last, content: blocks }]
}

export async function callChat(args) {
  const res = await fetch(API, {
    method: 'POST', headers: headers(args.env, chatModel(args.env)), body: JSON.stringify(chatBody(args)),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    /* Status and a slice of the error only. Never the request body: it holds
     * a visitor's words, and logging them is a storage decision made by
     * accident (02-operations.md 7.2). */
    console.error('anthropic', res.status, detail.slice(0, 300))
    return {
      error: res.status === 429
        ? 'I am getting a lot of questions right now. Try me in a minute?'
        : 'Something went wrong in my head there. Try again?',
      status: 502,
    }
  }
  return res.json()
}

/** The summariser, for consolidation. Returns the JSON text. */
export function summariserFor(env) {
  return async ({ system, messages, schema }) => {
    const model = env?.MEMORY_MODEL || MEMORY_MODEL
    const res = await fetch(API, {
      method: 'POST',
      headers: headers(env, model),
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        system,
        messages,
      }),
    })
    if (!res.ok) throw new Error(`summarise ${res.status}`)
    const j = await res.json()
    return (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
}
