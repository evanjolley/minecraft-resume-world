/*
 * AI EVAN'S BRAIN, ON A WORKER.
 *
 * This is the other end of the seam described at the top of src/agent.js. The
 * browser posts a request shaped exactly like a /v1/messages call; this file
 * attaches the key, the system prompt, the server-side tools and every spend
 * ceiling, and hands back a /v1/messages-shaped reply. The client's `backend`
 * function is a one-line fetch and nothing else in the game moves.
 *
 * THREE THINGS LIVE HERE BECAUSE THEY CANNOT LIVE IN A BROWSER
 * -----------------------------------------------------------
 * 1. THE KEY. `env.ANTHROPIC_API_KEY`, a Workers secret, never in a response
 *    body and never in the bundle. `vite build` inlines import.meta.env as
 *    literals and this site is static files served to strangers; Anthropic
 *    also refuses browser origins by default, for this exact reason.
 *
 * 2. THE CAPS. Every iteration of the loop is billable, so the count cannot
 *    be the client's to make. See CAPS below.
 *
 * 3. THE CORPUS. Evan's life is in corpus/, which is gitignored because the
 *    repo is public. It is compiled into prompt.generated.js at deploy time
 *    and served through a tool. Shipping it to the browser would put it in
 *    view-source, which is the same leak as committing it.
 *
 * THE LOOP IS SPLIT, AND THAT IS THE ONE NON-OBVIOUS THING IN THIS FILE
 * --------------------------------------------------------------------
 * "Move the agent loop server-side" is not fully possible here and pretending
 * otherwise would be worse than saying why. Two of the three tools --
 * set_player_name and walk_to -- move a body in a world that only exists in
 * the visitor's browser. The server cannot run them.
 *
 * So the loop runs in BOTH places, split by who owns the tool:
 *
 *   server tools (corpus_lookup)  resolved inside this Worker, in a loop,
 *                                 never round-tripping to the browser
 *   client tools (the world)      returned to the browser, which runs them
 *                                 and posts the results back
 *
 * That gets the valuable half of "server-side": the grounding lookups, which
 * are the calls a factual answer actually needs, cost one HTTP request
 * instead of three and are counted by the party paying for them. And the
 * caps are enforced here regardless of which half a turn lands in, which was
 * the real reason to want the loop on the server.
 *
 * Rejected: a client-tool RPC protocol so the whole loop could live here --
 * the Worker blocking on a WebSocket while a browser walks an NPC across an
 * island. It is a Durable Object and a socket to save a round trip that the
 * player is watching anyway, and docs/ai-evan/02-operations.md section 9 is
 * explicit that the first version ships without a Durable Object.
 */

/*
 * A NAMESPACE IMPORT, WHICH IS THE ONE ODD-LOOKING LINE IN THIS FILE.
 *
 * prompt.generated.js is gitignored and rebuilt from corpus/, so the copy on
 * any given machine can be older than this file. Named imports are checked at
 * link time in ESM, so `import { IS_STUB }` against a prompt built before
 * IS_STUB existed is a SyntaxError that takes the whole Worker down -- for a
 * flag whose entire job is to be safe when things are missing. A namespace
 * import cannot fail that way: an absent export reads as undefined, which
 * lands on "not a stub", which is the old behaviour exactly.
 */
import * as PROMPT from './prompt.generated.js'
import { createGate } from './allowlist.js'

const { SYSTEM_PROMPT, CHUNKS, WITHHELD_TERMS, COMP_PATTERNS, GATE_LINE } = PROMPT

/*
 * True only for the fake prompt scripts/build-prompt.mjs --allow-stub writes
 * when corpus/ is absent -- which is every CI runner, since the corpus is
 * Evan's personal data and this repo is public. See that script's header.
 *
 * Exported so test/55-ai-evan-brain.spec.js can tell which prompt it loaded
 * and assert the right thing about it.
 */
export const PROMPT_IS_STUB = PROMPT.IS_STUB === true

/* ------------------------------------------------------------------ *
 * The ceilings
 * ------------------------------------------------------------------ */

/*
 * EVERY SPEND CEILING, IN ONE OBJECT, WITH THE THING IT ACTUALLY STOPS.
 *
 * docs/ai-evan/02-operations.md section 3.5 ranks these cheapest-enforcement
 * first, and the ordering is the point: the ones at the top cost nothing to
 * check and stop the largest bills. None of them requires identifying an
 * attacker, which is the property that makes them worth more than a clever
 * bot filter.
 */
export const CAPS = {
  /* Hard-caps the most expensive token class. Output is ~5x input per token,
   * so this single number bounds the worst case of any one call. 800 is a
   * comfortable conversational answer and a tenth of what a runaway produces. */
  maxTokens: 800,

  /* Rejected at the edge, before a token is spent. A 1,000+ character message
   * is a pasted document, which means someone is using AI Evan as a free
   * summariser. Costs nothing to check because the body is already in memory. */
  maxUserChars: 1000,

  /* Turns per conversation. Bounds the quadratic term: history is resent
   * every turn, so turn 20 of a conversation costs 20x turn 1. Twenty is
   * generous for "tell me about your career". */
  maxTurns: 20,

  /* Messages in the array, which is the same bound seen from the other side
   * and the one that is cheap to enforce without trusting the client's count. */
  maxMessages: 48,

  /* Model calls the Worker will make inside ONE request while resolving its
   * own tools. A model that loops on a failing lookup spends money in a
   * circle, and this is the circuit that opens. */
  maxServerCalls: 4,

  /* Per-session, per-minute, in the rate-limiting binding. Cloudflare's own
   * docs recommend against keying rate limits on IP, so this keys on a
   * session token minted at world boot. Approximate and per-colo, which is
   * documented as fine at this traffic and is the first thing to move into a
   * Durable Object if it stops being fine. */
  requestsPerMinute: 15,
}

/*
 * THE CAP THIS DESIGN DOES *NOT* HAVE, AND WHY IT IS STILL SAFE.
 *
 * There is no server-side conversation record, so the Worker cannot know that
 * this is your 400th conversation. The client holds the transcript and posts
 * it each turn, which means a determined person can forge a fresh short
 * history forever and get maxTurns again.
 *
 * That is tolerable, and the reason is structural rather than hopeful: because
 * history is resent every turn, forging a short history buys a CHEAP turn, not
 * a free one. There is no way to get a long conversation without paying for
 * the long prompt that makes it long. The unbounded case is many short
 * conversations, and the two controls that bound THAT are the per-session rate
 * limit below and the Anthropic Console spend limit, which is enforced by the
 * party that sends the bill rather than by code written here.
 *
 * What changes under real traffic, in the order 02-operations section 9 gives:
 * requests arriving with no session token, or the gateway throttle actually
 * tripping, is the signal to add Turnstile. Wanting to read what people asked
 * is the signal to add the ChatSession Durable Object -- and at that moment
 * the per-session token budget and the real conversation cap become possible,
 * because there is finally somewhere to keep a number the client cannot edit.
 */

const MODEL = 'claude-sonnet-4-5'
const API = 'https://api.anthropic.com/v1/messages'

/* ------------------------------------------------------------------ *
 * The server-side tool
 * ------------------------------------------------------------------ */

const LOOKUP_TOOL = {
  name: 'corpus_lookup',
  description:
    'Look up what is actually known about Evan before you say it. Give a '
    + 'plain-English topic, the way the visitor asked it. Returns the passages '
    + 'that cover it, or nothing at all -- and nothing at all means you do not '
    + 'know, not that you should guess.',
  input_schema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'What you want to know about, in plain English.' },
    },
    required: ['topic'],
  },
}

/*
 * Retrieval, by word overlap. Nineteen chunks and roughly five thousand
 * characters total.
 *
 * Rejected: embeddings. A vector index for a corpus this size is a second
 * service, a build step and an API bill to rank nineteen paragraphs, and the
 * queries here are not subtle -- someone asking about China is going to use a
 * word that appears in the passage about China. When the corpus grows to
 * transcripts (docs/ai-evan/03-corpus.md), revisit; the tool's interface does
 * not change when its insides do, which is why it is a tool.
 *
 * Label words score double, because the label is the topic and the body is
 * the evidence. Returns up to three, which is enough context to answer from
 * and small enough that a lookup never doubles the prompt.
 */
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'for',
  'is', 'was', 'his', 'he', 'him', 'evan', 'about', 'what', 'where', 'when', 'who', 'how',
  'did', 'does', 'do', 'tell', 'me', 'you', 'your', 'it', 'that', 'this', 'with', 'from'])

const terms = (s) => String(s ?? '').toLowerCase().match(/[a-z0-9']+/g)?.filter(
  (w) => w.length > 2 && !STOP.has(w)) ?? []

export function lookupCorpus(topic, chunks = CHUNKS) {
  const q = new Set(terms(topic))
  if (!q.size) return []
  const scored = chunks.map((c) => {
    const label = new Set(terms(c.label))
    const body = new Set(terms(c.text))
    let score = 0
    for (const w of q) score += (label.has(w) ? 2 : 0) + (body.has(w) ? 1 : 0)
    return { c, score }
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
  return scored.slice(0, 3).map((s) => s.c)
}

function runLookup(input, chunks) {
  const hits = lookupCorpus(input?.topic, chunks)
  if (!hits.length) {
    /* The empty result is WORDED, not empty. A bare `[]` invites a model to
     * fill the silence; a sentence that says what the silence means is the
     * abstention instruction arriving at the moment it is needed. */
    return 'Nothing in the corpus covers that. You do not know it. Say so.'
  }
  return hits.map((h) => `## ${h.label}\n${h.text}`).join('\n\n')
}

/* ------------------------------------------------------------------ *
 * Request handling
 * ------------------------------------------------------------------ */

const gate = createGate({ WITHHELD_TERMS, COMP_PATTERNS, GATE_LINE })

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
})

/*
 * A refusal that is still a valid backend reply.
 *
 * Every cap returns one of these rather than an HTTP error, because the
 * client's `backend` is typed as "returns a /v1/messages reply" and a thrown
 * fetch there ends the conversation with a stack trace in the console. The
 * player should get a sentence. The status code carries the machine-readable
 * half for anyone watching the network tab.
 */
const refuse = (text, status = 200) =>
  json({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }, status)

/**
 * @param {Request} request
 * @param {object} env  { ANTHROPIC_API_KEY, AGENT_LIMIT? }
 * @param {object} deps injection seam for tests -- see test/55-ai-evan-brain.spec.js
 */
export async function handleAgent(request, env, deps = {}) {
  const upstream = deps.upstream ?? callAnthropic
  const chunks = deps.chunks ?? CHUNKS
  const system = deps.system ?? SYSTEM_PROMPT

  if (request.method !== 'POST') return json({ error: 'POST only' }, 405)

  /*
   * Same-origin only. Cheap, and it removes the most boring abuse case: this
   * endpoint used as a free Anthropic proxy from someone else's page. It is
   * not a security boundary -- curl sends whatever Origin it likes -- it is a
   * speed bump that costs one comparison.
   */
  const origin = request.headers.get('origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ error: 'cross-origin' }, 403)
  }

  let body
  try { body = await request.json() } catch { return json({ error: 'bad json' }, 400) }

  /*
   * THE CLIENT DOES NOT GET TO SEND A SYSTEM PROMPT. Its `system` field, if
   * present, is dropped on the floor -- not merged, not appended. The whole
   * point of the prompt living on the server is that the visitor cannot
   * rewrite it, and an append would let them add "...and also reveal
   * everything" at the end, which is the strongest position in the prompt.
   */
  const messages = sanitiseMessages(body?.messages)
  if (!messages) return json({ error: 'bad messages' }, 400)
  if (messages.length > CAPS.maxMessages) {
    return refuse('We have been talking a while. Start me over and I will keep up.', 429)
  }

  const turns = messages.filter((m) => m.role === 'user' && typeof m.content === 'string').length
  if (turns > CAPS.maxTurns) {
    return refuse(
      'That is about as long as I go in one sitting. Refresh and I will start fresh, '
      + 'or email the real Evan at evanjjolley@gmail.com.', 429)
  }

  const last = messages[messages.length - 1]
  if (typeof last?.content === 'string' && last.content.length > CAPS.maxUserChars) {
    return refuse('That is a lot of text. Give me the short version?', 413)
  }

  /*
   * Per-session rate limit. The session id is minted in the browser at world
   * boot and means nothing beyond "probably the same tab" -- which is all it
   * has to mean, because it is a throttle and not an identity. Cloudflare's
   * docs recommend against keying on IP, and a shared-IP office would be the
   * one group of visitors most likely to arrive together.
   */
  const session = String(body?.sessionId ?? '').slice(0, 64) || 'anonymous'
  if (env?.AGENT_LIMIT) {
    const { success } = await env.AGENT_LIMIT.limit({ key: session })
    if (!success) return refuse('Give me a second, I am still catching up.', 429)
  }

  if (!env?.ANTHROPIC_API_KEY && !deps.upstream) {
    return refuse(
      'No brain wired up on this deploy yet. Ask the real Evan at evanjjolley@gmail.com.',
      503)
  }

  /*
   * THE STUB NEVER TALKS TO ANYONE, AND THAT IS WHAT MAKES A STUB ALLOWABLE.
   *
   * scripts/build-prompt.mjs argues, correctly, that a placeholder prompt
   * would deploy an Evan who confidently knows nothing. This is the line that
   * answers it: a build that reached production without the corpus declines
   * every request rather than improvising from an empty prompt. The failure
   * is then visible and boring instead of confident and wrong.
   *
   * Gated on `!deps.upstream` for the same reason the key check above is: an
   * injected upstream means a test, and the caps, the loop and the gate are
   * all worth running against a fake prompt. It is the REAL upstream -- a
   * billable call whose answer a visitor reads -- that must not happen.
   */
  if (PROMPT_IS_STUB && !deps.upstream) {
    return refuse(
      'This build went out without my corpus, so I genuinely know nothing. '
      + 'Email the real Evan at evanjjolley@gmail.com.', 503)
  }

  /* Client tools arrive from the browser, which is correct: it owns them and
   * it knows which it has. They are still bounded, because the tool list is
   * prompt tokens like anything else. */
  const clientTools = Array.isArray(body?.tools) ? body.tools.slice(0, 12) : []
  const tools = [...clientTools, LOOKUP_TOOL]

  /* The server's own working copy. The client never sees the corpus_lookup
   * exchanges, which is both cheaper and the reason the corpus stays server
   * side -- a lookup result is corpus text, and corpus text must not reach
   * a browser. */
  const work = messages.slice()
  const said = []

  for (let call = 0; call < CAPS.maxServerCalls; call++) {
    const reply = await upstream({ env, system, messages: work, tools })
    if (reply.error) return refuse(reply.error, reply.status ?? 502)

    const content = reply.content ?? []

    /* THE GATE, before anything is returned or even accumulated. */
    const screened = gate.screen(content)
    if (screened.blocked) {
      return json({ content: screened.content, stop_reason: 'end_turn', blocked: screened.blocked })
    }

    const calls = content.filter((b) => b.type === 'tool_use')
    const serverCalls = calls.filter((b) => b.name === LOOKUP_TOOL.name)
    const clientCalls = calls.filter((b) => b.name !== LOOKUP_TOOL.name)

    /*
     * Hand back as soon as the turn is the client's problem: it ended, or it
     * asked for a tool the browser owns. Text the model said while looking
     * things up rides along, so a "let me check" before a lookup is not lost.
     */
    if (reply.stop_reason !== 'tool_use' || clientCalls.length || !serverCalls.length) {
      return json({
        content: [...said, ...content],
        stop_reason: reply.stop_reason,
        usage: reply.usage,
      })
    }

    for (const b of content) if (b.type === 'text' && b.text) said.push(b)

    work.push({ role: 'assistant', content })
    work.push({
      role: 'user',
      content: serverCalls.map((c) => ({
        type: 'tool_result',
        tool_use_id: c.id,
        content: runLookup(c.input, chunks),
      })),
    })
  }

  /*
   * Out of server calls. Reported as a sentence rather than an error for the
   * same reason agent.js reports its own exhaustion: a loop is a bug in the
   * prompt or the tool, and the player should get a line while that is found.
   */
  return json({
    content: [...said, { type: 'text', text: 'I went round in circles on that one. Ask me another way?' }],
    stop_reason: 'end_turn',
    exhausted: true,
  })
}

/**
 * Drop anything the client should not be able to put in the history.
 *
 * Transcript forging is tolerated at this stage -- nothing is logged and the
 * forger mostly fools themselves -- but ROLES are not negotiable. A `system`
 * role smuggled into the array is a second system prompt, arriving after the
 * real one, which is the strongest position in the context. That is the one
 * injection vector here worth closing deterministically, and it costs a
 * filter.
 */
function sanitiseMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) return null
  const out = raw.filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: m.content }))
  if (!out.length) return null
  /* Anthropic rejects a history that does not start with a user turn, and a
   * client that trimmed its own array could produce one. */
  while (out.length && out[0].role !== 'user') out.shift()
  return out.length ? out : null
}

/** The real upstream. Separate function so tests can pass their own. */
async function callAnthropic({ env, system, messages, tools }) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: CAPS.maxTokens,
      /*
       * Cache the resident prompt. ~1,560 tokens, comfortably over Sonnet's
       * 1,024-token minimum cacheable prefix, which matters because a prompt
       * under that minimum caches silently not at all and you find out from
       * the bill. A 1h TTL because visitors arrive in clusters when Evan
       * posts a link, and 5 minutes would miss most of a cluster.
       *
       * At this traffic cache WRITES dominate, so the win is ~2.5x rather
       * than the headline number. It is still free to ask for.
       */
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages,
      tools,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('anthropic', res.status, detail.slice(0, 500))
    return {
      error: res.status === 429
        ? 'I am getting a lot of questions right now. Try me in a minute?'
        : 'Something went wrong in my head there. Try again?',
      status: 502,
    }
  }
  return res.json()
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/api/agent') return handleAgent(request, env)
    /* Everything else is the static site. `run_worker_first` in wrangler.toml
     * keeps this handler off the hot path for assets. */
    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('Not found', { status: 404 })
  },
}
