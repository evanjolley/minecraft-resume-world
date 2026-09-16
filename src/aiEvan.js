import { isLegalName, MAX_NAME_LENGTH } from './identity.js'

/*
 * AI EVAN: the tools he can call, and the fake brain that calls them.
 *
 * Two halves, deliberately in one file because they are two halves of one
 * character and splitting them would mean reading both to understand either:
 *
 *   createEvanTools(world)  -- real side effects, bound to the real world
 *   stubBackend             -- a deterministic stand-in for a model
 *
 * The first half survives contact with a real model unchanged. The second is
 * the throwaway: see agent.js for the one-function swap.
 */

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

/**
 * @param {object} world
 * @param {() => string} world.playerId      whose name a rename applies to
 * @param {(id: string, name: string) => boolean} world.setName
 * @param {(id: string) => string} world.nameOf
 * @param {() => object} world.playerState   position, facing, target block
 */
export function createEvanTools(world) {
  return [
    /*
     * TOOL 1: the rename.
     *
     * The argument is the name the MODEL parsed out of the sentence, not the
     * sentence. That split is the contract: the model does language, the tool
     * does world state, and the tool is allowed to refuse. It refuses on
     * exactly the rule identity.js publishes, and it says WHY in the result,
     * because the model's next move depends on which failure it was -- a
     * 30-character name should produce "that's a bit long, got a shorter
     * one?" and not a retry of the same call.
     */
    [{
      name: 'set_player_name',
      description:
        'Set the display name of the visitor you are talking to. Use this as '
        + 'soon as they tell you their name. Pass just the name itself, not the '
        + `sentence they said it in. Names are 1-${MAX_NAME_LENGTH} characters, `
        + 'letters, digits and underscores only.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The visitor\'s name, on its own.' },
        },
        required: ['name'],
      },
    }, ({ name }) => {
      if (typeof name !== 'string' || !name.trim()) throw new Error('name is required')
      const trimmed = name.trim()
      if (!isLegalName(trimmed)) {
        throw new Error(
          `"${trimmed}" is not a usable name: 1-${MAX_NAME_LENGTH} characters, `
          + 'letters, digits and underscores only. Ask them for another.')
      }
      const id = world.playerId()
      const changed = world.setName(id, trimmed)
      return changed
        ? { ok: true, name: trimmed }
        : { ok: true, name: trimmed, note: 'they were already called that' }
    }],

    /*
     * TOOL 2, which exists so the interface is not shaped by a single case.
     *
     * A READ, and that is the point: set_player_name proves a tool can change
     * the world, this proves a tool can observe it, and the two together are
     * what a tool layer has to support. Written before it was needed by
     * anything, because an interface derived from one example is an interface
     * with one example's assumptions baked in -- in this case, that every tool
     * returns a success flag and takes an argument. This one does neither.
     *
     * It is also the seed of the "point at things in the world" tool in
     * docs/FUTURE.md section 2: knowing where someone is standing is the
     * prerequisite for telling them where to go.
     */
    [{
      name: 'get_player_state',
      description:
        'Look at where the visitor is right now: their position in the world, '
        + 'which way they are facing, how far they are from you, and which block '
        + 'they are looking at. Use it when they ask about where they are or '
        + 'what they can see.',
      input_schema: { type: 'object', properties: {} },
    }, () => world.playerState()],

    /*
     * TOOL 3: THE FIRST ONE THAT MOVES A BODY.
     *
     * The seam was built on a rename and a coordinate readout -- one write to
     * a roster, one read of it -- and neither of those touches the world the
     * player is standing in. This one asks a simulated body to walk somewhere
     * and does not finish until it gets there or fails, which is the first
     * real test of whether the registry generalises past trivia: it is
     * ASYNC, it takes SECONDS rather than microseconds, and it can fail for a
     * reason the model has to do something about.
     *
     * It is deliberately the primitive and not the feature. docs/FUTURE.md's
     * guided tour is `walk_to(plot)` -- a NAMED destination, "the No Logo
     * build" -- and that tool is this tool plus a table of plots. The table
     * is not here because the builds are not here; a tour to nowhere is a
     * lookup table of coordinates pretending to be content.
     *
     * COORDINATES AND NOT A DIRECTION. "walk five blocks north" reads more
     * natural and is the wrong shape: the model would be integrating its own
     * dead reckoning, and it cannot see where he ended up. A point is
     * checkable, and pairs with get_player_state, which already reports one.
     *
     * NO Y. The ground picks the height, exactly as it does for the drop. A
     * model that could specify an altitude would be able to ask him to stand
     * in the air, and the honest answer to that request does not exist.
     */
    [{
      name: 'walk_to',
      description:
        'Walk to a spot in the world and stop there. Give the x and z of the '
        + 'place on the ground -- the height is worked out for you. This takes a '
        + 'few seconds and does not return until you have arrived. It fails if '
        + 'something taller than one block is in the way, in which case try a '
        + 'closer or clearer spot rather than the same one again.',
      input_schema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Target x, in world coordinates.' },
          z: { type: 'number', description: 'Target z, in world coordinates.' },
        },
        required: ['x', 'z'],
      },
    }, async ({ x, z }) => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        throw new Error('walk_to needs a numeric x and z')
      }
      // Throws on failure, and that is the point: agent.js turns a throw into
      // `is_error` with the message, so "I could not get there because a wall
      // is in the way" arrives as something the model can act on rather than
      // as silence.
      const arrived = await world.walkTo({ x, z })
      return { ok: true, ...arrived }
    }],
  ]
}

/* ------------------------------------------------------------------ *
 * The stub brain
 * ------------------------------------------------------------------ */

/*
 * Every line Evan can say, in one table, because the thing that will replace
 * this file is a system prompt and a system prompt is also one block of text
 * about how he talks. Keeping the voice in one place makes that port a
 * rewrite of a constant rather than a hunt through branches.
 */
export const LINES = {
  greet: 'Hey! I\'m Evan -- well, a Minecraft-shaped version of him. What should I call you?',
  reask: 'Didn\'t catch a name in there. What should I call you?',
  welcome: (name) => `${name}! Good to meet you. Ask me about my work, or about this place.`,
  rejected: (why) => `Hm -- ${why}`,
  booking:
    'Booking time with the real me isn\'t wired up yet -- that\'s the next thing '
    + 'I get a tool for. For now, evanjjolley@gmail.com reaches him.',
  work:
    'I build things that talk to models for a living, and I built this place '
    + 'so the resume would be somewhere you could stand.',
  /*
   * The refusal, and the most important line in this table.
   *
   * It says there is no model, out loud, because the alternative is worse in
   * a specific way: this stub has two tools and one of them reports your
   * coordinates, so an unscoped question used to fall through to
   * get_player_state and answer "where does Evan work" with a position
   * readout. Confidently wrong reads as broken; "I do not know that yet"
   * reads as unfinished, which is what it is.
   *
   * It names the stub rather than pretending to be a shy person, because the
   * one thing this slice is actually demonstrating is the seam -- and a
   * visitor who is told there is no brain behind it yet understands what
   * they are looking at. The day a real model lands, this LINE goes and the
   * model does its own refusing.
   */
  fallback:
    'That one is past me. There is no model behind this Evan yet, just a short '
    + 'script -- ask me where you are, about my work, or about booking time, and '
    + 'the script has an answer.',
  located: (s) =>
    `You're at ${s.position.map(Math.round).join(', ')}, ${Math.round(s.distanceToEvan)} `
    + `blocks from me, looking at ${s.lookingAt ?? 'thin air'}.`,
  onMyWay: 'On my way.',
  arrived: 'Here I am.',
  cantWalk: (why) => `I can't get there -- ${why}`,
}

/*
 * Pulling a name out of a sentence.
 *
 * THROWAWAY, and worth saying so loudly because it is the one piece of this
 * file that looks like it wants to grow. Name extraction from a sentence is
 * free the moment there is a model behind the seam -- a model handles
 * "everyone calls me Ev but it's Evan on the passport" without being told,
 * and these four regexes never will. They exist so the DEMO does not look
 * broken while there is no model, and they get deleted whole on the day one
 * lands. Do not extend this; if it is missing a case, that case is an
 * argument for wiring up the backend, not for a fifth pattern.
 *
 * The bar is the orderings a person actually uses in answer to "what should
 * I call you": the name on its own, the name in front ("plop is my name"),
 * the name behind ("my name is plop", "call me plop"), and any of those
 * wrapped in politeness ("hi, plop!").
 */

/*
 * Politeness either side of the answer, stripped before anything is matched
 * so the patterns below only have to know one shape each. Note what this
 * buys and what it costs: "hi, plop" becomes a name, and "hi" on its own
 * becomes the empty string and is correctly still NOT a name -- the refusal
 * has to survive this, which is why NOT_A_NAME stays as well.
 */
const FILLER = new RegExp(
  '^(?:(?:hi|hey|hello|yo|sup|ok|okay|well|so|um|uh|just|sure|please|thanks)\\b[\\s,.!-]*)+'
  + '|[\\s,.!]*(?:thanks|thank you|please|mate|man|dude)[\\s.!]*$', 'gi')

/** The name behind the phrase. "my name is plop", "i'm plop", "call me plop". */
const INTRO =
  /(?:(?:my|the)?\s*name'?s?(?:\s+is)?|i\s*am|i'?m|call me|it'?s|it is|this is)\s+([A-Za-z0-9_]{1,16})/i

/** The name in FRONT of it. "plop is my name", "plop here" -- the ordering
 *  that the intro patterns cannot see, and the one he was caught missing. */
const OUTRO = /^([A-Za-z0-9_]{1,16})\s+(?:is\s+my\s+name|here)\b/i

/*
 * A single bare word is a name -- unless it is one of these, which is how
 * "hello" stops becoming somebody's name. Only the words that actually turn
 * up as a whole answer to "what should I call you"; a longer list would start
 * excluding real names, and Sue is a real name in a way that "hi" is not.
 */
const NOT_A_NAME = new Set([
  'hi', 'hey', 'hello', 'yo', 'sup', 'yes', 'no', 'yeah', 'nope', 'ok', 'okay',
  'what', 'who', 'why', 'nothing', 'none', 'nevermind', 'nah', 'sure', 'thanks',
])

/** Capitalise only if they gave it to us flat -- never touch "McKay". */
const titleCase = (s) => (s === s.toLowerCase() ? s[0].toUpperCase() + s.slice(1) : s)

/** A single bare word, with whatever punctuation they put after it. */
const BARE = /^([A-Za-z0-9_]{1,16})[.!?]*$/

export function parseName(text) {
  // FILLER is /g, so `replace` runs it from 0 and leaves lastIndex reset --
  // the trap that makes a shared global regex return alternate answers.
  const said = String(text ?? '').trim().replace(FILLER, '').trim()
  const named = (m) => (m && !NOT_A_NAME.has(m[1].toLowerCase()) ? titleCase(m[1]) : null)
  return named(INTRO.exec(said)) ?? named(OUTRO.exec(said)) ?? named(BARE.exec(said))
}

/*
 * ASKS ABOUT *YOU*, not about anything with the word "where" in it.
 *
 * get_player_state reports the VISITOR's position, so the intent it answers
 * is second-person. The first version of this was `\bwhere\b` and it ate
 * "where does Evan work" -- a question about a career, answered with a
 * coordinate readout. The subject is what makes the difference, so the
 * subject is in the pattern.
 */
const ASKS_LOCATION =
  /\b(where\s+(?:am|are)\s+(?:i|we)|where\s+i\s+am|my\s+(?:position|coord\w*|location)|am\s+i\s+standing|(?:what|which)\s+(?:block\s+)?am\s+i\s+looking\s+at|what\s+is\s+this\s+block|what's\s+this\s+block)\b/i
/*
 * ASKS HIM TO MOVE, which is the first intent in this table whose answer is
 * TWO tool calls rather than one.
 *
 * He cannot walk to you without knowing where you are, and the stub is a pure
 * function of the transcript -- it is not allowed to peek at the world, for
 * the reason stubBackend's comment gives. So it does what a real model would
 * have to do: calls get_player_state, reads the position out of the result,
 * and calls walk_to with it. That chain is the thing worth having in the stub
 * at all. A single hardcoded destination would have exercised the tool and
 * proved nothing about the loop.
 */
const ASKS_COME =
  /\b(come\s+(?:here|over|to\s+me)|walk\s+(?:to|over)\s+(?:to\s+)?me|follow\s+me|over\s+here)\b/i
const ASKS_BOOKING = /\b(book|meet|meeting|schedule|call|calendar|chat|talk to|hire|time with)\b/i
const ASKS_WORK = /\b(work|job|resume|cv|career|do you do|built|experience|portfolio)\b/i

/* Anthropic ids are opaque strings; these only have to be unique per loop. */
let nextId = 0
const toolUse = (name, input) =>
  ({ type: 'tool_use', id: `stub_${++nextId}`, name, input })

/* ------------------------------------------------------------------ *
 * Latency
 * ------------------------------------------------------------------ */

/*
 * HE HAS TO TAKE A MOMENT.
 *
 * A reply that lands in the same frame as your Enter key reads as a lookup
 * table, which is exactly what this is and exactly what it must not look
 * like. So the stub waits.
 *
 * WHAT THE WAIT IS MODELLING, because that decides where it lives. It is not
 * pacing and it is not a flourish -- it is the round trip that agent.js's
 * `backend` will really have once it is a fetch to the Worker and a call to
 * /v1/messages. Sonnet-class first-token latency on a short prompt is around
 * a second, longer under load, and it VARIES, which is why this is a range
 * and not a constant: a fixed 1500 ms is its own kind of uncanny, because
 * nothing that thinks takes the same time twice.
 *
 * WHERE IT LIVES IS THE WHOLE DESIGN. Inside the stub backend, not in npc.js
 * and not in chat.js, so that the artificial wait is DELETED BY THE SWAP --
 * `backend: stubBackend` becomes `backend: fetchAgent` and the fake latency
 * leaves with the fake brain. A setTimeout in npc.js would have looked
 * identical today and would then have stacked a second and a half on top of
 * a real model's second and a half, and nobody would have gone looking for
 * it in the NPC file.
 *
 * It also falls out of this that a turn WITH A TOOL CALL takes longer than
 * one without: agent.js calls the backend once to get the tool_use and again
 * to narrate the result, so two waits, which is the real shape too.
 *
 * Rejected: a typing indicator. Minecraft has no such thing -- there is no
 * "someone is typing" in vanilla chat, and npc.js already turned down a
 * thinking indicator for tool calls on the grounds that inventing UI for
 * model latency is a different piece of work (docs/FUTURE.md section 2).
 * Adding a spinner here would contradict that decision from the other side,
 * and it would be the one bit of this conversation that could not exist on a
 * real server. A pause before someone talks is in-fiction; a typing bubble
 * is a chat app.
 */
const LATENCY_MS = { min: 900, max: 2100 }

/** One sample of the wait. Exported so a spec can assert on the range. */
export const stubLatency = (random = Math.random) =>
  LATENCY_MS.min + random() * (LATENCY_MS.max - LATENCY_MS.min)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The stub backend. Same signature as a /v1/messages call -- see agent.js.
 *
 * It is a pure function of `messages`, and that constraint is load-bearing
 * rather than tidiness: a stub that peeked at the roster to decide whether it
 * knew your name would be reading world state a real model cannot see, and
 * the loop would quietly stop working the day it was swapped out. Everything
 * it knows, it knows from the transcript, exactly like the thing replacing it.
 */
export async function stubBackend(request) {
  await sleep(stubLatency())
  return replyTo(request)
}

/**
 * The same thing with the wait taken out, for tests and for the console.
 *
 * Exported so a spec can assert on what he SAYS without paying a second and
 * a half per line -- and so the latency can be tested as its own thing,
 * rather than every assertion in the file becoming a timing assertion.
 */
export function replyTo({ messages }) {
  const last = messages[messages.length - 1]

  /*
   * Case 1: we are being called back with tool results. Narrate them. A real
   * model does this from the result text; the stub reads the same JSON.
   */
  if (Array.isArray(last?.content)) {
    const say = []
    for (const result of last.content) {
      if (result.type !== 'tool_result') continue
      const which = toolCallNamed(messages, result.tool_use_id)
      if (result.is_error) {
        if (which === 'set_player_name') say.push(LINES.rejected(result.content))
        else if (which === 'walk_to') say.push(LINES.cantWalk(result.content))
        else say.push(LINES.fallback)
        continue
      }
      const data = JSON.parse(result.content)
      if (which === 'set_player_name') say.push(LINES.welcome(data.name))
      else if (which === 'walk_to') say.push(LINES.arrived)
      else if (which === 'get_player_state') {
        /*
         * The chain. The same read tool answers two different questions, and
         * which one it was is in what the PLAYER said, not in the result --
         * so the intent is re-read off the last thing they typed rather than
         * stashed in a variable this function is not allowed to have.
         */
        if (ASKS_COME.test(lastPlayerSaid(messages))) {
          return {
            content: [
              { type: 'text', text: LINES.onMyWay },
              toolUse('walk_to', { x: data.position[0], z: data.position[2] }),
            ],
            stop_reason: 'tool_use',
          }
        }
        say.push(LINES.located(data))
      }
    }
    return { content: say.map((text) => ({ type: 'text', text })), stop_reason: 'end_turn' }
  }

  const said = String(last?.content ?? '')

  /*
   * Case 2: we do not have a name yet. Everything else waits -- which is a
   * real property of the character ("his first goal is to find out your
   * name"), not a limitation of the stub, and is the sort of thing that will
   * be a sentence in the system prompt later.
   */
  if (!nameIsKnown(messages)) {
    const name = parseName(said)
    if (!name) return { content: [{ type: 'text', text: LINES.reask }], stop_reason: 'end_turn' }
    return {
      content: [toolUse('set_player_name', { name })],
      stop_reason: 'tool_use',
    }
  }

  // Both of these start with the same read. See ASKS_COME.
  if (ASKS_COME.test(said) || ASKS_LOCATION.test(said)) {
    return { content: [toolUse('get_player_state', {})], stop_reason: 'tool_use' }
  }
  const text = ASKS_BOOKING.test(said) ? LINES.booking
    : ASKS_WORK.test(said) ? LINES.work
      : LINES.fallback
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
}

/** The last thing the PLAYER typed, skipping the tool_result messages the
 *  loop puts in the user role. */
function lastPlayerSaid(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
      return messages[i].content
    }
  }
  return ''
}

/** Which tool produced this result -- the assistant turn that asked for it. */
function toolCallNamed(messages, toolUseId) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i].content
    if (messages[i].role !== 'assistant' || !Array.isArray(content)) continue
    const call = content.find((b) => b.type === 'tool_use' && b.id === toolUseId)
    if (call) return call.name
  }
  return null
}

/** Have we already successfully named them, this conversation? */
function nameIsKnown(messages) {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (block.type !== 'tool_result' || block.is_error) continue
      if (toolCallNamed(messages, block.tool_use_id) === 'set_player_name') return true
    }
  }
  return false
}

/* ------------------------------------------------------------------ *
 * The real brain
 * ------------------------------------------------------------------ */

/*
 * THE SWAP. One line in main.js:
 *
 *   backend: stubBackend,   ->   backend: workerBackend(),
 *
 * (plus `workerBackend` added to the import on line 47, which is the only
 * other character that moves.)
 *
 * Everything above this comment stays. The stub is not deleted, and that is
 * deliberate: it is the OFFLINE PATH. It needs no key, no Worker and no
 * network, so `npm run dev` keeps working on a plane and test/21-ai-evan.spec
 * keeps asserting on the seam without spending money. A stub you delete on
 * launch day is a stub you rewrite the first time the API is down.
 *
 * WHAT THIS FUNCTION IS NOT ALLOWED TO CONTAIN. No key, no system prompt, no
 * corpus, no model name. Every one of those is a server decision, and the
 * reason is the same each time: this file is bundled by vite and served to
 * strangers as readable text. The request this sends is the conversation and
 * the tool schemas, nothing else -- and the Worker ignores a `system` field
 * even if one turns up, so a visitor editing this in devtools gains nothing.
 */

/*
 * A session id, minted once per page load, kept in memory.
 *
 * Only job is to be the key the Worker's rate limit counts on. Cloudflare's
 * own docs recommend against keying a rate limit on IP, and an office behind
 * one NAT is precisely the group of visitors most likely to arrive together.
 *
 * Deliberately NOT persisted to localStorage and deliberately not an identity.
 * Persisting it would make it a tracking cookie in everything but name, which
 * needs a privacy notice this project does not have; refreshing the page to
 * get a new one is a hole an attacker walks through, and the caps that matter
 * do not depend on plugging it (see CAPS in worker/index.js).
 */
const SESSION_ID = (() => {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return [...b].map((n) => n.toString(16).padStart(2, '0')).join('')
})()

/**
 * A backend that posts the conversation to the Worker.
 *
 * @param {object} [opts]
 * @param {string} [opts.url]       where the Worker is. Same origin by default.
 * @param {function} [opts.fetch]   injected in tests.
 */
export function workerBackend({ url = '/api/agent', fetch: f = globalThis.fetch } = {}) {
  return async ({ messages, tools }) => {
    let res
    try {
      res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID, messages, tools }),
      })
    } catch {
      /*
       * A network failure returns a VALID BACKEND REPLY rather than throwing.
       * agent.js has no catch around `backend(...)` on purpose -- it is one
       * function call in a loop -- so a throw here would abort the turn and
       * leave the player looking at an NPC that stopped mid-sentence. A
       * sentence is the honest failure mode, and it keeps the contract at the
       * top of agent.js true: a backend always returns a /v1/messages reply.
       */
      return offline('I lost my connection there. Say that again?')
    }
    if (!res.ok && res.status >= 500) return offline('Something broke on my end. One more time?')
    try {
      return await res.json()
    } catch {
      return offline('That came back garbled. Try again?')
    }
  }
}

const offline = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' })
