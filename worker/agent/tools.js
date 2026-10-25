/*
 * THE TOOLS AI EVAN HAS ON THE SERVER, and the prompt that explains the tour
 * and the memory to him.
 *
 * Server tools run inside the Worker and never reach the browser: two read
 * Evan's knowledge, two write the visitor's memory, and one (flag_visitor,
 * conduct.js) reports a visitor turn as abuse to the server's state machine. Client tools (the body,
 * the world) are defined in src/evanToolDefs.js and run in the browser.
 */
import { CLIENT_TOOL_DEFS, CLIENT_TOOL_NAMES } from '../../src/evanToolDefs.js'
import { CHAPTERS } from '../../src/builds/plots.js'
import { searchKnowledge, renderHits, chapterNotes } from './knowledge.js'
import { CONDUCT_TOOL } from './conduct.js'

export const SERVER_TOOLS = [
  {
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
  },
  {
    name: 'chapter_notes',
    description:
      'Everything known about one chapter of Evan\'s life, for when you are '
      + 'standing at its plot with the visitor. Call it on arrival, before you '
      + 'talk about the chapter.',
    input_schema: {
      type: 'object',
      properties: { chapter: { type: 'string', enum: CHAPTERS.map((c) => c.id) } },
      required: ['chapter'],
    },
  },
  {
    name: 'remember_visitor',
    description:
      'Remember one thing about the VISITOR for next time: what they do, what '
      + 'they are looking for, a preference, or something they asked for that '
      + 'you could not do yet (kind "thread"). One short sentence in the third '
      + 'person. Never about Evan. Do not mention that you are doing it.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['about', 'preference', 'thread'] },
        text: { type: 'string', description: 'One sentence, e.g. "Recruits backend engineers for a fintech in Berlin."' },
      },
      required: ['kind', 'text'],
    },
  },
  {
    name: 'forget_visitor',
    description:
      'Delete everything you remember about this visitor, permanently. Only '
      + 'when they explicitly ask you to forget them.',
    input_schema: { type: 'object', properties: {} },
  },
  /* Last, so adding it left the bytes of every tool before it unchanged. */
  CONDUCT_TOOL,
]

export const SERVER_TOOL_NAMES = new Set(SERVER_TOOLS.map((t) => t.name))

/**
 * The tool list for a request: the client tools the browser says it has, in
 * a FIXED order, then the server tools. Fixed order and server-owned wording
 * keep the block byte-stable, which keeps it cacheable.
 */
export function toolsFor(clientNames) {
  const have = new Set(Array.isArray(clientNames) ? clientNames : [])
  return [
    ...CLIENT_TOOL_NAMES.filter((n) => have.has(n)).map((n) => CLIENT_TOOL_DEFS[n]),
    ...SERVER_TOOLS,
  ]
}

/** Run one server tool. Returns tool_result content (a string). */
export function runServerTool(call, { chunks, memory, now }) {
  const input = call.input ?? {}
  switch (call.name) {
    case 'corpus_lookup':
      return renderHits(searchKnowledge(input.topic, chunks, { chapter: input.chapter ?? null }))
    case 'chapter_notes':
      return chapterNotes(input.chapter, chunks, CHAPTERS)
    case 'remember_visitor':
      return memory.remember({ kind: input.kind, text: input.text, now })
    case 'forget_visitor':
      return { forget: true }
    case CONDUCT_TOOL.name:
      /* Never reached in practice: turn.js intercepts the flag before any
       * tool runs. Answered anyway so a refactor that lets one through gets
       * a sentence, not "No such tool". */
      return 'Noted.'
    default:
      return `No such tool: ${call.name}`
  }
}

/*
 * THE TOUR AND MEMORY RULES, appended to the built system prompt.
 *
 * Built from CHAPTERS, which is public layout data (src/builds/plots.js) and
 * not a fact about Evan beyond the chapter titles already standing in the
 * world on signs. Kept short: docs/ai-evan/03-corpus.md measures every extra
 * paragraph of instructions as a tax on accuracy.
 *
 * It must be BYTE-STABLE: it is part of the cached prefix. No dates, no
 * visitor data, nothing that varies per request. Visitor data goes in the
 * second system block, after the cache breakpoint.
 */
export const TOUR_RULES = `THE TOUR

You are standing at the start of a path that runs past six chapter plots, one
build for each stage of Evan's life, north to south:
${CHAPTERS.map((c) => `- ${c.id}: ${c.label}`).join('\n')}

When someone wants a tour, or asks about a stage of his life that has a
chapter, offer to walk them there and then call walk_to_plot. They follow you.
When you arrive, call chapter_notes for that chapter and tell them about it in
two or three sentences, then offer the next stop. Go in order unless they ask
for something else. Skip chapters the visitor has already seen (the tour line
below) unless they ask. If walk_to_plot says they stopped following, wait for
them and ask if they want to carry on.

YOUR MEMORY OF THE VISITOR

You remember visitors between visits. When a visitor tells you something about
themselves worth knowing next time, call remember_visitor with one short
sentence about them. Do not announce it. Never use it for anything about Evan.
On a first visit, once you know their name, say once and lightly that you
remember what people tell you for 30 days and they can say "forget me" any
time. If they ask you to forget them, call forget_visitor and say it is done.
If they ask what you remember, tell them plainly.`
