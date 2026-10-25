/*
 * THE INTERVIEW ENGINE: "download my brain", one question at a time.
 *
 * Pure logic with three injected seams, so a spec can run a whole interview
 * with no key, no terminal and no disk:
 *
 *   client   an Anthropic client (the SDK's, or a fake with messages.create)
 *   io       { ask(prompt) -> Promise<string>, say(text) }
 *   files    { read(path) -> string|null, write(path, text) }
 *
 * THE FLOW
 *   1. Interview. For each section of plan.mjs, ask the seed questions. After
 *      each answer the model decides on ONE follow-up (or none), up to
 *      MAX_FOLLOW_UPS per seed, aimed at the story, the number or the name
 *      the answer skipped. Saved after every answer, so Ctrl-C loses nothing
 *      and `npm run interview` picks up where it stopped.
 *   2. Distill. `--distill` turns each section's answers into short records
 *      (fact, story, opinion, voice, boundary), REWRITTEN, never quoted --
 *      Evan's standing rule in 03-corpus.md. Drafts land in
 *      corpus/interview/drafts/ as markdown he can read and edit.
 *   3. Approve. `--approve <section|all>` copies a reviewed draft into the
 *      places the knowledge store builds from: corpus/extra/interview-*.md
 *      (looked up at runtime) and corpus/knowledge/voice.md (resident).
 *      Boundaries are NOT auto-published: they go into profile.md's Never
 *      section by hand, because that section is what the output gate's
 *      withheld terms are derived from, and a rule about what to withhold is
 *      the one thing that must not be served back verbatim.
 *
 * Everything written is under corpus/, which is gitignored. Nothing here
 * runs in the Worker.
 */
import { SECTIONS, MAX_FOLLOW_UPS } from './plan.mjs'

export const INTERVIEW_MODEL = 'claude-opus-5-5'

export const PATHS = {
  state: 'corpus/interview/session.json',
  profile: 'corpus/profile.md',
  draft: (id) => `corpus/interview/drafts/${id}.md`,
  draftJson: (id) => `corpus/interview/drafts/${id}.json`,
  extra: (id) => `corpus/extra/interview-${id}.md`,
  voice: 'corpus/knowledge/voice.md',
  boundaries: 'corpus/interview/boundaries-to-merge.md',
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export function freshState(now = new Date()) {
  return {
    version: 1,
    startedAt: now.toISOString(),
    sections: Object.fromEntries(SECTIONS.map((s) => [s.id, { status: 'todo', turns: [] }])),
  }
}

export function loadState(files) {
  const raw = files.read(PATHS.state)
  if (!raw) return null
  const s = JSON.parse(raw)
  /* A plan that grew a section since the last run gets it appended, so an
   * old session file never blocks a new question. */
  for (const sec of SECTIONS) s.sections[sec.id] ??= { status: 'todo', turns: [] }
  return s
}

export const saveState = (files, state) => files.write(PATHS.state, JSON.stringify(state, null, 2))

/* ------------------------------------------------------------------ *
 * Model calls
 * ------------------------------------------------------------------ */

const FOLLOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['follow_up', 'covered'],
  properties: {
    follow_up: { type: 'string', description: 'One short follow-up question, or an empty string to move on.' },
    covered: { type: 'boolean', description: 'True if the answers so far fully cover this seed question.' },
  },
}

const INTERVIEWER = `You are interviewing Evan Jolley to build the knowledge base behind
"AI Evan", a character in a Minecraft-style world built as his resume, who
gives visitors a tour and answers questions about him. Visitors are often
recruiters, so facts must be exact and stories must be specific.

After each answer, decide whether ONE follow-up question would get something
the answer skipped: the specific story, the number and what it measures, the
name of the thing he personally built, the date, why he left, or what he
would say if a recruiter pushed. Ask it short and plain, the way a good
podcast host would. If the answer is already specific, or he said he does not
want to go there, return an empty follow_up. Never ask about other people's private lives,
compensation, or anything he flagged as off limits.`

function textOf(res) {
  return (res?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
}

/** Decide on a follow-up. Returns a question string or null. */
export async function followUp(client, { section, seed, turns, profile }) {
  const res = await client.messages.create({
    model: INTERVIEW_MODEL,
    max_tokens: 2000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: FOLLOW_SCHEMA } },
    system: INTERVIEWER,
    messages: [{
      role: 'user',
      content: [
        profile ? `<already_known>\n${profile.slice(0, 12000)}\n</already_known>` : '',
        `<section title="${section.title}">${section.goal}</section>`,
        `<seed_question>${seed}</seed_question>`,
        '<answers>',
        ...turns.map((t) => `Q: ${t.q}\nA: ${t.a}`),
        '</answers>',
      ].filter(Boolean).join('\n'),
    }],
  })
  try {
    const j = JSON.parse(textOf(res))
    const q = typeof j.follow_up === 'string' ? j.follow_up.trim() : ''
    return q && !j.covered ? q : null
  } catch {
    return null
  }
}

const DISTILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['records'],
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'label', 'text', 'private'],
        properties: {
          kind: { type: 'string', enum: ['fact', 'story', 'opinion', 'voice', 'boundary'] },
          label: { type: 'string', description: 'The words a visitor would use to ask about this. Three to eight words.' },
          text: { type: 'string', description: '60 to 1,500 characters, rewritten, never quoted.' },
          private: { type: 'boolean', description: 'True if Evan said this must not be shared with visitors.' },
        },
      },
    },
  },
}

const DISTILLER = `You turn raw interview answers from Evan Jolley into the knowledge base
behind "AI Evan". Evan types fast and on purpose; his answers are source
material, NOT copy. Rules:

- REWRITE everything. Never copy a run of more than eight of his words. Fix
  typos. Turn instructions to the writer ("say 12M GMV") into the fact itself.
- One record per topic a visitor would ask about. The label is the words they
  would use ("why he left No Logo", "the custom CRM"), because retrieval
  matches on the label.
- kind: fact (dates, titles, numbers, exactly as precise as he was and no
  more), story (one anecdote, past tense, third person), opinion (what he
  thinks and why, third person), voice (how he talks: length, register,
  phrases he uses or never uses, and his ways of saying "I don't know"; short
  example lines are fine here), boundary (what AI Evan must refuse or deflect).
- private: true for anything he said is not for visitors. Keep it, marked,
  so the build can withhold it; never soften it into something shareable.
- Never add a fact he did not state. If he was unsure, say he was unsure.
- No colons used as dramatic pauses and no em dashes in the text.`

/** Distill one section's answers into records. */
export async function distillSection(client, section, turns) {
  const res = await client.messages.create({
    model: INTERVIEW_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: DISTILL_SCHEMA } },
    system: DISTILLER,
    messages: [{
      role: 'user',
      content: `<section title="${section.title}" kind="${section.kind}">${section.goal}</section>\n`
        + `<answers>\n${turns.map((t) => `Q: ${t.q}\nA: ${t.a}`).join('\n\n')}\n</answers>`,
    }],
  })
  const j = JSON.parse(textOf(res))
  return (j.records ?? []).filter((r) => r && r.label && r.text)
}

/* ------------------------------------------------------------------ *
 * The interview loop
 * ------------------------------------------------------------------ */

export const HELP = `Answer in as many lines as you like; finish with an empty line.
Commands on their own line:  /skip  next question   /next  next section
                             /stop  save and quit   /help  this text`

/**
 * Run (or resume) the interview.
 * @param {object} a
 * @param {string[]} [a.only]  section ids to cover, default all not done
 */
export async function interview({ client, io, files, only = null, now = () => new Date() }) {
  const state = loadState(files) ?? freshState(now())
  const profile = files.read(PATHS.profile)
  io.say(`Interview for AI Evan. Saved to ${PATHS.state} after every answer.\n${HELP}\n`)

  for (const section of SECTIONS) {
    if (only && !only.includes(section.id)) continue
    const rec = state.sections[section.id]
    if (rec.status === 'done' && !only) continue
    io.say(`\n=== ${section.title} ===\n${section.goal}\n`)
    rec.status = 'in_progress'

    for (const seed of section.seeds) {
      if (rec.turns.some((t) => t.seed === seed && (t.kind === 'seed' || t.skipped))) continue
      const thread = []
      let q = seed
      let kind = 'seed'
      for (let round = 0; round <= MAX_FOLLOW_UPS; round++) {
        const a = await io.ask(`\n${q}\n> `)
        const cmd = a.trim().toLowerCase()
        if (cmd === '/stop') {
          saveState(files, state)
          io.say(`\nSaved. Run it again to pick up at "${q}".`)
          return { stopped: true, state }
        }
        if (cmd === '/help') { io.say(HELP); round--; continue }
        if (cmd === '/next') { rec.status = 'done'; saveState(files, state); break }
        if (cmd === '/skip' || !a.trim()) {
          if (kind === 'seed') rec.turns.push({ seed, kind, q, a: '', skipped: true, at: now().toISOString() })
          saveState(files, state)
          break
        }
        const turn = { seed, kind, q, a: a.trim(), at: now().toISOString() }
        rec.turns.push(turn)
        thread.push(turn)
        saveState(files, state)
        if (round === MAX_FOLLOW_UPS) break
        const next = await followUp(client, { section, seed, turns: thread, profile })
        if (!next) break
        q = next
        kind = 'follow'
      }
      if (rec.status === 'done') break
    }
    rec.status = 'done'
    saveState(files, state)
  }
  io.say('\nThat is everything in the plan. Next: npm run interview -- --distill')
  return { stopped: false, state }
}

/* ------------------------------------------------------------------ *
 * Distill and approve
 * ------------------------------------------------------------------ */

const today = (d) => d.toISOString().slice(0, 10)

/** Render a section's records as a reviewable draft. */
export function renderDraft(section, records, date) {
  const lines = [
    `# Draft: ${section.title}`,
    '',
    `Distilled from the interview on ${date}. Edit freely, delete what is wrong, then run`,
    `\`npm run interview -- --approve ${section.id}\`. Records marked PRIVATE are never published.`,
    '',
  ]
  for (const r of records) {
    lines.push(`## ${r.label}`)
    lines.push(`Kind: ${r.kind}${r.private ? ' PRIVATE' : ''}`)
    lines.push(r.text.trim())
    lines.push('')
  }
  return lines.join('\n')
}

/** Parse a (possibly hand-edited) draft back into records. */
export function parseDraft(md) {
  return md.split(/^##\s+/m).slice(1).map((part) => {
    const nl = part.indexOf('\n')
    const label = part.slice(0, nl).trim()
    let body = part.slice(nl + 1).trim()
    const m = /^Kind:\s*(\w+)(\s+PRIVATE)?\s*$/im.exec(body)
    const kind = m ? m[1].toLowerCase() : 'fact'
    const priv = !!m?.[2]
    if (m) body = body.replace(m[0], '').trim()
    return { label, kind, private: priv, text: body }
  }).filter((r) => r.label && r.text)
}

export async function distill({ client, io, files, only = null, now = () => new Date() }) {
  const state = loadState(files)
  if (!state) throw new Error(`no interview yet (${PATHS.state} is missing). Run npm run interview first.`)
  const written = []
  for (const section of SECTIONS) {
    if (only && !only.includes(section.id)) continue
    const turns = state.sections[section.id].turns.filter((t) => t.a)
    if (!turns.length) continue
    io.say(`distilling ${section.id} (${turns.length} answers)...`)
    const records = await distillSection(client, section, turns)
    files.write(PATHS.draftJson(section.id), JSON.stringify({ section: section.id, records }, null, 2))
    files.write(PATHS.draft(section.id), renderDraft(section, records, today(now())))
    written.push(PATHS.draft(section.id))
  }
  io.say(written.length ? `\nDrafts to review:\n${written.map((w) => `  ${w}`).join('\n')}` : 'Nothing to distill yet.')
  return written
}

/**
 * Publish reviewed drafts into the knowledge store's inputs.
 *
 *   fact, story, opinion -> corpus/extra/interview-<id>.md, one ## per record,
 *                           with Kind: and Chapter: lines build-prompt reads
 *   voice                -> corpus/knowledge/voice.md (resident, so short)
 *   boundary             -> corpus/interview/boundaries-to-merge.md, by hand
 *   PRIVATE              -> nowhere
 */
export function approve({ io, files, only = null, now = () => new Date() }) {
  const date = today(now())
  const voice = []
  const boundaries = []
  const out = []
  for (const section of SECTIONS) {
    if (only && !only.includes(section.id)) continue
    const md = files.read(PATHS.draft(section.id))
    if (!md) continue
    const records = parseDraft(md).filter((r) => !r.private)
    const lookup = records.filter((r) => ['fact', 'story', 'opinion'].includes(r.kind))
    voice.push(...records.filter((r) => r.kind === 'voice'))
    boundaries.push(...records.filter((r) => r.kind === 'boundary'))
    if (lookup.length) {
      const body = [
        `Source: Evan, in his own words, from the interview on ${date}, rewritten and sorted by topic.`,
        '',
        ...lookup.flatMap((r) => [
          `## ${r.label}`,
          `Kind: ${r.kind}`,
          ...(section.chapter ? [`Chapter: ${section.chapter}`] : []),
          r.text,
          '',
        ]),
      ].join('\n')
      files.write(PATHS.extra(section.id), body)
      out.push(PATHS.extra(section.id))
    }
  }
  if (voice.length) {
    files.write(PATHS.voice, [
      `How Evan talks, from the interview on ${date}. Read resident, so keep it short.`,
      '',
      ...voice.map((r) => `- ${r.text.replace(/\s+/g, ' ')}`),
      '',
    ].join('\n'))
    out.push(PATHS.voice)
  }
  if (boundaries.length) {
    files.write(PATHS.boundaries, [
      `# Boundaries from the interview, ${date}`,
      '',
      'Merge these into the "how the agent behaves" section of corpus/profile.md by hand.',
      'Anything that names a thing to withhold belongs under its Never heading.',
      '',
      ...boundaries.flatMap((r) => [`## ${r.label}`, r.text, '']),
    ].join('\n'))
    out.push(PATHS.boundaries)
  }
  io.say(out.length ? `Wrote:\n${out.map((p) => `  ${p}`).join('\n')}\nThen: npm run prompt` : 'No drafts to approve.')
  return out
}
