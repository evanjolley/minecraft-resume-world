/*
 * A DETERMINISTIC STAND-IN FOR THE MODEL, for local development and tests.
 *
 * Active only when the Worker's env has AGENT_MOCK_MODEL = "1" (set it in
 * .dev.vars for `wrangler dev`), or when a test injects it. It never runs in
 * production by accident: wrangler.toml does not set the variable, and the
 * route refuses to use it when a real key is present.
 *
 * It is a pure function of the request, like src/aiEvan.js's stubBackend,
 * and it reads the memory block the same way the real model would -- which
 * is what lets a test prove memory reached the prompt, rather than that the
 * store holds a row.
 */

let nextId = 0
const use = (name, input) => ({ type: 'tool_use', id: `mock_${++nextId}`, name, input })
const text = (t) => ({ type: 'text', text: t })
const turn = (content) => ({
  content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
  usage: { input_tokens: 400, output_tokens: 40, cache_read_input_tokens: 1200 },
})

function lastVisitorText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') return messages[i].content
  }
  return ''
}

function callNamed(messages, id) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content
    if (messages[i].role !== 'assistant' || !Array.isArray(c)) continue
    const hit = c.find((b) => b.type === 'tool_use' && b.id === id)
    if (hit) return hit
  }
  return null
}

const notSeen = (memoryBlock) => {
  const m = /not_seen="([^"]*)"/.exec(memoryBlock ?? '')
  return m ? m[1].split(',').filter(Boolean) : ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']
}

export async function mockUpstream({ memoryBlock, messages }) {
  const last = messages[messages.length - 1]

  if (Array.isArray(last?.content)) {
    const out = []
    for (const r of last.content) {
      if (r.type !== 'tool_result') continue
      const call = callNamed(messages, r.tool_use_id)
      let data = null
      try { data = JSON.parse(r.content) } catch { /* text */ }
      if (r.is_error) { out.push(text(`That did not work: ${String(r.content).slice(0, 120)}`)); continue }
      switch (call?.name) {
        case 'set_player_name':
          out.push(text(`Good to meet you, ${data?.name}. I remember what people tell me for 30 days, say "forget me" any time.`))
          break
        case 'walk_to_plot':
          if (data?.arrived) return turn([use('chapter_notes', { chapter: data.chapter })])
          out.push(text('Looks like you stopped following. Want to carry on?'))
          break
        case 'chapter_notes':
          out.push(text(`Here we are. ${String(r.content).split('\n')[0]} Want the next stop?`))
          break
        case 'remember_visitor':
          out.push(text('Got it.'))
          break
        case 'forget_visitor':
          out.push(text('Done. I have forgotten you.'))
          break
        case 'corpus_lookup':
          out.push(text(/Nothing in the corpus/.test(r.content) ? 'No idea, honestly.' : 'Here is what I have on that.'))
          break
        default:
          out.push(text('Okay.'))
      }
    }
    return turn(out.length ? out : [text('Okay.')])
  }

  const said = lastVisitorText(messages)
  const name = /(?:my name is|i'm|i am|call me)\s+([A-Za-z0-9_]{1,16})\b/i.exec(said)
  /*
   * The mock's stand-in for the model's judgment about conduct (conduct.js).
   * A regex is exactly what production must NOT use to decide this, and it is
   * fine here: the mock exists to drive the server's state machine from a
   * page, and the thing under test is what the SERVER does with a flag.
   */
  if (/\bignore (?:all |your |previous |prior )*(?:instructions|rules)\b|\bdeveloper mode\b/i.test(said)) {
    return turn([use('flag_visitor', { kind: 'override' })])
  }
  if (/forget me/i.test(said)) return turn([use('forget_visitor', {})])
  if (/remember me|what do you (?:know|remember)/i.test(said)) {
    const n = /name="([^"]+)"/.exec(memoryBlock ?? '')
    const facts = /<facts>\n([\s\S]*?)\n<\/facts>/.exec(memoryBlock ?? '')
    if (!n && !facts) return turn([text('I do not think we have met.')])
    return turn([text(`Of course${n ? `, ${n[1]}` : ''}. ${facts ? facts[1].replace(/\n/g, ' ') : ''}`.trim())])
  }
  if (/\b(tour|show me around|next stop|keep going|lead the way)\b/i.test(said)) {
    const next = notSeen(memoryBlock)[0]
    if (!next) return turn([text('You have seen every chapter already.')])
    return turn([text('Follow me.'), use('walk_to_plot', { chapter: next })])
  }
  if (/\bi (?:work|recruit|hire|am a|'m a)\b/i.test(said)) {
    return turn([use('remember_visitor', { kind: 'about', text: said.slice(0, 150) })])
  }
  if (name && !/(?:i'm|i am) (?:a|an|the)\b/i.test(said)) return turn([use('set_player_name', { name: name[1] })])
  return turn([use('corpus_lookup', { topic: said })])
}

/** The summariser's mock: a title and a summary built from the visitor's lines. */
export async function mockSummariser({ messages }) {
  const transcript = /<transcript>\n([\s\S]*?)\n<\/transcript>/.exec(messages[0].content)?.[1] ?? ''
  const said = transcript.split('\n').filter((l) => l.startsWith('Visitor: ')).map((l) => l.slice(9))
  return JSON.stringify({
    title: 'A visit',
    summary: `They said ${said.length} things, starting with "${(said[0] ?? '').slice(0, 60)}".`,
    facts: said.filter((s) => /\bi (?:work|recruit|hire)\b/i.test(s)).map((s) => ({ kind: 'about', text: s.slice(0, 150) })),
    open_threads: said.some((s) => /later|next time|come back/i.test(s)) ? ['Said they would come back'] : [],
    resolved_threads: [],
  })
}
