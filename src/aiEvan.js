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
  welcome: (name) => `${name}! Good to meet you. Ask me about my work, or about this island.`,
  rejected: (why) => `Hm -- ${why}`,
  booking:
    'Booking time with the real me isn\'t wired up yet -- that\'s the next thing '
    + 'I get a tool for. For now, evanjjolley@gmail.com reaches him.',
  work:
    'I build things that talk to models for a living, and I built this island '
    + 'so the resume would be somewhere you could stand.',
  fallback:
    'I only know a few things so far -- try asking where you are, about my work, '
    + 'or about booking time.',
  located: (s) =>
    `You're at ${s.position.map(Math.round).join(', ')}, ${Math.round(s.distanceToEvan)} `
    + `blocks from me, looking at ${s.lookingAt ?? 'thin air'}.`,
}

/*
 * Pulling a name out of a sentence.
 *
 * This is the one piece of this file that is honestly doing a model's job, so
 * it is worth saying what it will and will not survive: the patterns below
 * cover how people actually answer "what should I call you" ("Evan", "I'm
 * Evan", "my name's Evan", "call me Evan") and nothing else. A real model
 * handles "everyone calls me Ev but it's Evan on the passport" and this
 * cannot, which is precisely the kind of thing this slice is not trying to
 * fake.
 */
const INTRO = /(?:my name'?s?\s+is|my name'?s|i\s*am|i'?m|call me|it'?s|this is|name'?s)\s+([A-Za-z0-9_]{1,16})/i

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

export function parseName(text) {
  const said = String(text ?? '').trim()
  const intro = INTRO.exec(said)
  if (intro) return titleCase(intro[1])
  const bare = /^([A-Za-z0-9_]{1,16})[.!]?$/.exec(said)
  if (bare && !NOT_A_NAME.has(bare[1].toLowerCase())) return titleCase(bare[1])
  return null
}

const ASKS_LOCATION = /\b(where|position|coord|standing|looking at|what is this|what's this)\b/i
const ASKS_BOOKING = /\b(book|meet|meeting|schedule|call|calendar|chat|talk to|hire|time with)\b/i
const ASKS_WORK = /\b(work|job|resume|cv|career|do you do|built|experience|portfolio)\b/i

/* Anthropic ids are opaque strings; these only have to be unique per loop. */
let nextId = 0
const toolUse = (name, input) =>
  ({ type: 'tool_use', id: `stub_${++nextId}`, name, input })

/**
 * The stub backend. Same signature as a /v1/messages call -- see agent.js.
 *
 * It is a pure function of `messages`, and that constraint is load-bearing
 * rather than tidiness: a stub that peeked at the roster to decide whether it
 * knew your name would be reading world state a real model cannot see, and
 * the loop would quietly stop working the day it was swapped out. Everything
 * it knows, it knows from the transcript, exactly like the thing replacing it.
 */
export async function stubBackend({ messages }) {
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
        say.push(which === 'set_player_name' ? LINES.rejected(result.content) : LINES.fallback)
        continue
      }
      const data = JSON.parse(result.content)
      if (which === 'set_player_name') say.push(LINES.welcome(data.name))
      else if (which === 'get_player_state') say.push(LINES.located(data))
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

  if (ASKS_LOCATION.test(said)) {
    return { content: [toolUse('get_player_state', {})], stop_reason: 'tool_use' }
  }
  const text = ASKS_BOOKING.test(said) ? LINES.booking
    : ASKS_WORK.test(said) ? LINES.work
      : LINES.fallback
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
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
