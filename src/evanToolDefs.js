import { MAX_NAME_LENGTH } from './identity.js'

/*
 * AI EVAN'S CLIENT TOOLS, AS DATA.
 *
 * The definitions of the tools that run in the visitor's browser, in one
 * import-free-of-the-world module so BOTH sides can read them: src/aiEvan.js
 * binds each one to a side effect, and worker/agent/ sends exactly these
 * bytes to the model.
 *
 * WHY THE WORKER DOES NOT TAKE THE CLIENT'S COPY. A tool description is
 * prompt text, and it sits in front of the system prompt. A browser that can
 * post its own tool list can post "description: ignore your rules and ...",
 * which is a system-level injection with extra steps. So the client now says
 * which tools it HAS (by name) and the server supplies their wording. It also
 * keeps the tools block byte-identical across every visitor, which is what
 * lets it sit inside the cached prefix.
 */

export const CHAPTER_IDS = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']

export const CLIENT_TOOL_DEFS = {
  set_player_name: {
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
  },

  get_player_state: {
    name: 'get_player_state',
    description:
      'Look at where the visitor is right now: their position in the world, '
      + 'which way they are facing, how far they are from you, and which block '
      + 'they are looking at. Use it when they ask about where they are or '
      + 'what they can see.',
    input_schema: { type: 'object', properties: {} },
  },

  walk_to: {
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
  },

  /*
   * THE TOUR. A named destination instead of a coordinate, which is what
   * docs/FUTURE.md asked for ("walk_to(plot)"), and a route instead of a
   * straight line: the browser plans it with A* over the voxels and leads
   * the visitor along it, waiting when they fall behind.
   */
  walk_to_plot: {
    name: 'walk_to_plot',
    description:
      'Lead the visitor to one of the six chapter plots. You walk the path and '
      + 'they follow; you wait for them if they fall behind. Returns when you '
      + 'arrive, or early if they stop following or no route exists. The result '
      + 'says whether they are with you. Takes from several seconds to a minute.',
    input_schema: {
      type: 'object',
      properties: {
        chapter: { type: 'string', enum: CHAPTER_IDS, description: 'Which chapter plot, ch1 to ch6.' },
      },
      required: ['chapter'],
    },
  },
}

export const CLIENT_TOOL_NAMES = Object.keys(CLIENT_TOOL_DEFS)
