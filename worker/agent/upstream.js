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
 * THE CHAT MODEL. Sonnet 5.5: Evan named Opus 5.5 or Sonnet 5.5 for this, and
 * a conversational persona answering questions about a career is the case
 * 02-operations.md section 8 already argued does not need Opus. At $2/$10 per
 * million it is half Opus 5.5's price. Overridable with AGENT_MODEL without
 * a code change.
 *
 * EFFORT LOW, THINKING ADAPTIVE. Latency is the design problem (FUTURE.md
 * section 2: "a character that pauses three seconds before replying reads as
 * broken"), and low effort is the documented setting for chat. Thinking is
 * left adaptive rather than turned off, because the off switch on this model
 * (`between_tools`) is Sonnet-5.5-only and would break the server-side
 * refusal fallback below, which re-runs a declined request on another model.
 */
export const CHAT_MODEL = 'claude-sonnet-5-5'

/* Summaries are one call per ended visit. Same model by default; see
 * docs/decisions.md for the case for Haiku 5.5 here. */
export const MEMORY_MODEL = 'claude-sonnet-5-5'

export const MAX_TOKENS = 800

function headers(env) {
  return {
    'content-type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    /* Server-side refusal fallback: on a policy decline the API re-runs the
     * same request on a fallback model inside the same call, instead of the
     * visitor getting nothing. "default" routes by refusal category. */
    'anthropic-beta': 'server-side-fallback-2026-07-01',
  }
}

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
  return {
    model: env?.AGENT_MODEL || CHAT_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: 'low' },
    fallbacks: 'default',
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
    method: 'POST', headers: headers(args.env), body: JSON.stringify(chatBody(args)),
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
    const res = await fetch(API, {
      method: 'POST',
      headers: headers(env),
      body: JSON.stringify({
        model: env?.MEMORY_MODEL || MEMORY_MODEL,
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
