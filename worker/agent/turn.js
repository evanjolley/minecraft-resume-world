/*
 * ONE TURN OF AI EVAN, WITH MEMORY.
 *
 * The same split loop as worker/index.js (server tools resolved here, client
 * tools handed back to the browser), with one structural change: THE SERVER
 * HOLDS THE TRANSCRIPT. The browser sends only the one new message -- what the
 * visitor typed, or the results of the tools it ran -- and the transcript is
 * read from and appended to the visitor's memory store.
 *
 * That closes the hole the stateless design documented and lived with: the
 * client can no longer forge a history, so the turn cap and the token budget
 * are real numbers kept somewhere the visitor cannot edit.
 *
 *   begin   memory: validate, repair, lease, return history + memory block
 *   loop    model call -> gate -> server tools -> model call ... (capped)
 *   commit  memory: append incoming + replies, book usage, release lease
 *
 * Nothing is written until commit, so a failed model call leaves the
 * transcript exactly as it was and the visitor can simply say it again.
 */
import { SERVER_TOOL_NAMES, runServerTool, toolsFor } from './tools.js'

export const TURN_CAPS = {
  /* Model calls inside one request while resolving server tools. */
  maxServerCalls: 4,
}

/**
 * @param {object} a
 * @param {object} a.memory      MemoryStore, or the Durable Object client (same methods, async)
 * @param {object} a.delta       { role:'user', content: string | tool_result[] }
 * @param {string[]} a.clientTools  names of the tools the browser has
 * @param {Function} a.upstream  ({ staticSystem, memoryBlock, messages, tools }) -> reply
 * @param {string} a.staticSystem
 * @param {Array} a.chunks       Evan's knowledge
 * @param {object} a.gate        createGate(...) from worker/allowlist.js
 * @param {number} a.now
 */
export async function runTurn({ memory, delta, clientTools, upstream, staticSystem, chunks, gate, now }) {
  const begun = await memory.begin({ now, delta })
  if (!begun.ok) return { status: begun.status, reply: say(begun.refuse) }

  const tools = toolsFor(clientTools)
  const work = [...begun.history, ...begun.incoming]
  const appended = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const said = []
  let forget = false

  try {
    for (let call = 0; call < TURN_CAPS.maxServerCalls; call++) {
      const reply = await upstream({ staticSystem, memoryBlock: begun.memoryBlock, messages: work, tools })
      if (reply.error) {
        await memory.release()
        return { status: reply.status ?? 502, reply: say(reply.error) }
      }
      addUsage(usage, reply.usage)
      const content = reply.content ?? []

      /*
       * THE GATE, before anything is stored or returned. A blocked turn is
       * replaced in the transcript by the line the visitor actually saw, so
       * the history the model reads next turn is the conversation that
       * really happened, and its tool calls are dropped with it.
       */
      const screened = gate.screen(content)
      if (screened.blocked) {
        appended.push({ role: 'assistant', content: screened.content })
        await memory.commit({ now, visitId: begun.visitId, incoming: begun.incoming, appended, usage, observed: begun.observed })
        return { status: 200, reply: { content: [...said, ...screened.content], stop_reason: 'end_turn', blocked: screened.blocked } }
      }

      appended.push({ role: 'assistant', content })
      work.push({ role: 'assistant', content })

      const calls = content.filter((b) => b.type === 'tool_use')
      const serverCalls = calls.filter((b) => SERVER_TOOL_NAMES.has(b.name))
      const clientCalls = calls.filter((b) => !SERVER_TOOL_NAMES.has(b.name))

      /*
       * MIXED TURNS. If the model asks for a server tool and a client tool in
       * the same breath ("let me remember that -- follow me"), the server
       * calls are answered now and stored as a trailing user message; the
       * browser's results for the client calls arrive as the next user
       * message. Consecutive user messages are merged by the API, so the
       * assistant turn ends up followed by every one of its results, which is
       * the rule. pendingToolUses() in memory.js knows to look past the
       * trailing partial results.
       */
      if (reply.stop_reason !== 'tool_use' || clientCalls.length || !serverCalls.length) {
        if (clientCalls.length && serverCalls.length) {
          const partial = []
          for (const c of serverCalls) {
            const out = await runServerTool(c, { chunks, memory, now })
            if (out?.forget) forget = true
            partial.push(serverResult(c, out))
          }
          appended.push({ role: 'user', content: partial })
        }
        await memory.commit({ now, visitId: begun.visitId, incoming: begun.incoming, appended, usage, observed: begun.observed })
        return { status: 200, reply: { content: [...said, ...forClient(content)], stop_reason: reply.stop_reason } }
      }

      for (const b of content) if (b.type === 'text' && b.text) said.push({ type: 'text', text: b.text })

      const results = []
      for (const c of serverCalls) {
        const out = await runServerTool(c, { chunks, memory, now })
        if (out?.forget) forget = true
        results.push(serverResult(c, out))
      }
      const resultMsg = { role: 'user', content: results }
      appended.push(resultMsg)
      work.push(resultMsg)
    }

    /* Out of server calls: a sentence, not an error. */
    const giveUp = { role: 'assistant', content: [{ type: 'text', text: 'I went round in circles on that one. Ask me another way?' }] }
    appended.push(giveUp)
    await memory.commit({ now, visitId: begun.visitId, incoming: begun.incoming, appended, usage, observed: begun.observed })
    return { status: 200, reply: { content: [...said, ...giveUp.content], stop_reason: 'end_turn', exhausted: true } }
  } catch (err) {
    await memory.release()
    throw err
  } finally {
    /* "Forget me" is honoured after the commit, so nothing written by this
     * turn survives it. */
    if (forget) await memory.forget()
  }
}

/** What the browser gets back: text and its own tool calls. Thinking blocks,
 *  fallback markers and server tool calls stay on the server. */
function forClient(content) {
  return content.filter((b) => b.type === 'text' || (b.type === 'tool_use' && !SERVER_TOOL_NAMES.has(b.name)))
}

function serverResult(call, out) {
  return {
    type: 'tool_result', tool_use_id: call.id,
    content: out?.forget ? 'Done. Everything about this visitor will be deleted when this turn ends.'
      : typeof out === 'string' ? out : JSON.stringify(out ?? null),
  }
}

function addUsage(acc, u) {
  if (!u) return
  for (const k of Object.keys(acc)) acc[k] += u[k] ?? 0
}

const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' })
