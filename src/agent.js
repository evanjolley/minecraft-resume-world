/*
 * THE AGENT SEAM.
 *
 * This file is the whole reason the naming conversation was built before the
 * model was: it is a real Anthropic tool-use loop with a fake brain, so that
 * putting a real brain in is a change to ONE function (`backend`) and nothing
 * else moves.
 *
 * THE CONTRACT
 * ------------
 * A backend is an async function with exactly the shape of a call to
 * /v1/messages:
 *
 *   backend({ system, messages, tools }) -> {
 *     content: [ { type: 'text', text } | { type: 'tool_use', id, name, input } ],
 *     stop_reason: 'end_turn' | 'tool_use' | 'max_tokens',
 *   }
 *
 * `tools` is a list of Anthropic tool definitions -- `{ name, description,
 * input_schema }` with input_schema being JSON Schema -- which is what
 * `registry.schemas` produces, unmodified, ready to be JSON.stringified into
 * a request body. `messages` is the Anthropic conversation array, including
 * tool_result blocks, which this file maintains.
 *
 * So the real implementation is:
 *
 *   const backend = async (req) =>
 *     (await fetch('/api/agent', { method: 'POST', body: JSON.stringify(req) })).json()
 *
 * and the Worker forwards `req` to Anthropic with the key attached. That is
 * the entire diff. Nothing in npc.js, chat.js or identity.js changes.
 *
 * WHERE THE API KEY LIVES, AND WHY IT CANNOT LIVE HERE
 * ---------------------------------------------------
 * Not in this bundle, not in an import.meta.env var, not in a build-time
 * replacement -- `vite build` inlines those as literals and this whole site
 * is static files served to strangers. Anthropic's API also refuses browser
 * origins by default for exactly this reason.
 *
 * The key lives as a Cloudflare Worker secret (`wrangler secret put
 * ANTHROPIC_API_KEY`), read as `env.ANTHROPIC_API_KEY` inside the Worker's
 * fetch handler, never serialised into a response. This is the thing that
 * makes the Worker in docs/DEPLOYMENT.md load-bearing rather than a nicety:
 * the current deploy is `wrangler deploy` of a purely static bundle, and it
 * only has to become a real Worker with a route because of this one secret.
 *
 * The second thing that follows from the key being on the server: SO IS THE
 * LOOP. `runAgent` below could equally live in the Worker, and probably
 * should once there is a real model, because every iteration of the loop is a
 * billable call and the client is the wrong place to decide how many of them
 * happen (see docs/FUTURE.md section 2, "Cost per visitor. Cap it."). The
 * loop is written here anyway, and written to be movable: it touches no
 * browser API, and the tool registry it calls is passed in.
 *
 * WHY A TOOL CALL FOR set_player_name AND NOT A SPECIAL CASE
 * ---------------------------------------------------------
 * Because "the NPC asks your name and the world changes" is the smallest
 * complete example of the thing this project actually wants -- a model
 * deciding to change world state -- and the version of it that reads the
 * chat line with a regex in npc.js proves nothing, since it is the regex
 * doing the work. Doing it through a tool means the seam is exercised end to
 * end by the first feature rather than retrofitted around the third.
 */

/**
 * A tool registry.
 *
 * Tools are registered as `(definition, run)` where `definition` is literally
 * the Anthropic tool block and `run(input)` is the side effect. Splitting
 * them keeps the half that gets sent to a model free of closures over the
 * world, which is what lets `schemas` be serialised straight into a request.
 */
export function createToolRegistry() {
  const tools = new Map()

  return {
    /**
     * @param {{ name: string, description: string, input_schema: object }} def
     * @param {(input: object) => any} run
     */
    register(def, run) {
      if (tools.has(def.name)) throw new Error(`duplicate tool: ${def.name}`)
      tools.set(def.name, { def, run })
    },

    /** Exactly what goes in the `tools` field of a /v1/messages request. */
    get schemas() { return [...tools.values()].map((t) => t.def) },

    has(name) { return tools.has(name) },

    /**
     * Run one tool call and return an Anthropic tool_result payload.
     *
     * NEVER THROWS. A model that calls a tool wrongly -- bad name, missing
     * argument, thrown handler -- gets `is_error: true` and the message, and
     * gets to try again, which is the documented behaviour and also the only
     * one that degrades well. Letting it throw would take down the whole
     * conversation because the NPC guessed an argument.
     *
     * Rejected: validating `input` against input_schema here. It is the right
     * thing eventually and it is a JSON Schema validator's worth of code for
     * a two-tool registry; each tool checks its own arguments instead, and
     * says so in its error. Revisit when there are enough tools that the
     * checks start being copy-paste.
     */
    async run(name, input) {
      const tool = tools.get(name)
      if (!tool) return { content: `No such tool: ${name}`, is_error: true }
      try {
        const out = await tool.run(input ?? {})
        // Tool results are TEXT to the model. An object is JSON, so a tool
        // that reports structured world state does not have to prose it.
        return {
          content: typeof out === 'string' ? out : JSON.stringify(out ?? null),
          is_error: false,
        }
      } catch (err) {
        return { content: String(err?.message ?? err), is_error: true }
      }
    },
  }
}

/**
 * The tool-use loop.
 *
 * Maintains the Anthropic `messages` array across turns, so the stub backend
 * and a real model see the same history in the same format.
 *
 * `onEvent` is how the world watches the loop happen. It gets `say`,
 * `tool_use` and `tool_result` events. Deliberately an observer rather than a
 * return value: the point of a conversation is that the NPC talks WHILE it
 * works, and a promise that resolves with everything at the end cannot show
 * you that.
 */
export function createAgentSession({ backend, tools, system = '', maxTurns = 8 }) {
  const messages = []
  let busy = false

  /**
   * @param {string} text  what the player said
   * @param {(ev: object) => void} onEvent
   */
  async function send(text, onEvent = () => {}) {
    /*
     * One turn at a time. A player can type faster than a model replies, and
     * two overlapping loops would interleave assistant messages into the
     * shared array and produce a history no API will accept (a tool_use with
     * someone else's tool_result after it). Dropping the second message is
     * the honest answer at this size; a queue is the answer once latency is
     * real.
     */
    if (busy) return { dropped: true }
    busy = true
    try {
      messages.push({ role: 'user', content: text })

      for (let turn = 0; turn < maxTurns; turn++) {
        const reply = await backend({ system, messages, tools: tools.schemas })
        const content = reply.content ?? []
        messages.push({ role: 'assistant', content })

        for (const block of content) {
          if (block.type === 'text' && block.text) onEvent({ type: 'say', text: block.text })
        }

        const calls = content.filter((b) => b.type === 'tool_use')
        if (reply.stop_reason !== 'tool_use' || calls.length === 0) {
          return { turns: turn + 1 }
        }

        /*
         * ALL tool results for one assistant turn go back in a SINGLE user
         * message, in the order the model asked for them. That is the API's
         * requirement, not a preference -- one message per result is rejected,
         * and it is the mistake that is easy to make here because the loop
         * below reads like it wants to be a map.
         */
        const results = []
        for (const call of calls) {
          onEvent({ type: 'tool_use', name: call.name, input: call.input })
          const result = await tools.run(call.name, call.input)
          onEvent({ type: 'tool_result', name: call.name, ...result })
          results.push({
            type: 'tool_result', tool_use_id: call.id,
            content: result.content, is_error: result.is_error,
          })
        }
        messages.push({ role: 'user', content: results })
      }

      /*
       * Ran out of turns. Reported rather than thrown: an agent that loops is
       * a bug in the prompt or the tools, and the player should get a sentence
       * instead of silence while we find out which.
       */
      onEvent({ type: 'error', text: 'gave up after too many tool calls' })
      return { turns: maxTurns, exhausted: true }
    } finally {
      busy = false
    }
  }

  return {
    send,
    get busy() { return busy },
    /** Read-only, for the console and for tests that assert on the loop. */
    get transcript() { return messages.map((m) => ({ ...m })) },
    reset() { messages.length = 0 },
  }
}
