import { test, expect } from '@playwright/test'

import {
  interview, distill, approve, parseDraft, renderDraft, PATHS, INTERVIEW_MODEL, loadState,
} from '../scripts/interview/engine.mjs'
import { SECTIONS, MAX_FOLLOW_UPS } from '../scripts/interview/plan.mjs'
import { buildPrompt } from '../scripts/build-prompt.mjs'

/*
 * THE INTERVIEW ("download my brain"), with a fake Anthropic client, a
 * scripted terminal and an in-memory disk. No key, no stdin, no corpus/.
 *
 * Every answer below is invented. The point is the mechanics: follow-ups,
 * stop and resume, distill into drafts, approve into the files the prompt
 * builder reads, and private records never reaching them.
 */

function memFiles(seed = {}) {
  const disk = new Map(Object.entries(seed))
  return { disk, read: (p) => disk.get(p) ?? null, write: (p, t) => disk.set(p, t) }
}

/** A terminal that answers from a list and records what it was asked. */
function scripted(answers) {
  const asked = []
  const said = []
  return {
    asked, said,
    io: {
      say: (t) => said.push(t),
      ask: async (prompt) => {
        asked.push(prompt.trim().replace(/\n>$/, '').trim())
        return answers.length ? answers.shift() : '/stop'
      },
    },
  }
}

/** A fake client: follow-up once per seed, then move on; distill echoes. */
function fakeClient({ followUps = true } = {}) {
  const calls = []
  return {
    calls,
    messages: {
      async create(params) {
        calls.push(params)
        const user = params.messages[0].content
        if (params.system.startsWith('You are interviewing')) {
          const answered = (user.match(/^A: /gm) ?? []).length
          const q = followUps && answered === 1 ? 'What number, exactly, and over what period?' : ''
          return { content: [{ type: 'text', text: JSON.stringify({ follow_up: q, covered: !q }) }] }
        }
        /* The distiller: one public fact, one private one, one voice line, one boundary. */
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              records: [
                { kind: 'fact', label: 'The invented role', text: 'He held an invented role for an invented number of years at a company that does not exist.', private: false },
                { kind: 'story', label: 'The secret project', text: 'A thing he said must never be shared with any visitor at all.', private: true },
                { kind: 'voice', label: 'How long answers are', text: 'Two sentences, contractions, never a list.', private: false },
                { kind: 'boundary', label: 'Other people', text: 'Never says what working with a named person was like.', private: false },
              ],
            }),
          }],
        }
      },
    },
  }
}

test('the plan covers every chapter plot and the five corpus gaps', () => {
  const ids = SECTIONS.map((s) => s.id)
  for (const ch of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']) expect(ids).toContain(ch)
  for (const gap of ['record', 'opinions', 'voice', 'boundaries']) expect(ids).toContain(gap)
  for (const s of SECTIONS) expect(s.seeds.length).toBeGreaterThan(0)
})

test('it asks a seed, follows up, saves after every answer, and uses the current Opus model', async () => {
  const files = memFiles()
  const client = fakeClient()
  const t = scripted(['I did a thing for years.', 'Twelve, over fifteen months.', '/stop'])
  const out = await interview({ client, io: t.io, files, only: ['record'] })
  expect(out.stopped).toBe(true)
  expect(t.asked[0]).toBe(SECTIONS[0].seeds[0])
  expect(t.asked[1]).toBe('What number, exactly, and over what period?')
  const state = JSON.parse(files.read(PATHS.state))
  expect(state.sections.record.turns.map((x) => x.kind)).toEqual(['seed', 'follow'])
  expect(client.calls[0].model).toBe(INTERVIEW_MODEL)
  expect(INTERVIEW_MODEL).toBe('claude-opus-5-5')
  expect(client.calls[0].output_config.format.type).toBe('json_schema')
})

test('follow-ups are capped per seed', async () => {
  const files = memFiles()
  const client = {
    messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ follow_up: 'And then?', covered: false }) }] }) },
  }
  const t = scripted(['a', 'b', 'c', 'd', '/stop'])
  await interview({ client, io: t.io, files, only: ['record'] })
  /* The seed, then MAX_FOLLOW_UPS follow-ups, then the next seed. */
  expect(t.asked.slice(0, MAX_FOLLOW_UPS + 2)).toEqual([
    SECTIONS[0].seeds[0], ...Array(MAX_FOLLOW_UPS).fill('And then?'), SECTIONS[0].seeds[1],
  ])
})

test('stop and resume: a second run picks up at the next unanswered question', async () => {
  const files = memFiles()
  await interview({ client: fakeClient({ followUps: false }), io: scripted(['answer one', '/stop']).io, files, only: ['ch1'] })
  const t = scripted(['/stop'])
  await interview({ client: fakeClient({ followUps: false }), io: t.io, files, only: ['ch1'] })
  const ch1 = SECTIONS.find((s) => s.id === 'ch1')
  expect(t.asked[0]).toBe(ch1.seeds[1])
})

test('/skip records a skip, /next ends the section, and a finished section is not re-asked', async () => {
  const files = memFiles()
  const t = scripted(['/skip', '/next', '/stop'])
  await interview({ client: fakeClient(), io: t.io, files })
  const state = loadState(files)
  expect(state.sections.record.status).toBe('done')
  expect(state.sections.record.turns[0]).toMatchObject({ skipped: true })
  /* After /next on "record", the next question is chapter 1's first. */
  expect(t.asked[2]).toBe(SECTIONS[1].seeds[0])
})

test('what the corpus already knows is passed to the interviewer, so it does not re-ask', async () => {
  const files = memFiles({ [PATHS.profile]: '# Profile\nAlready known: an invented fact.' })
  const client = fakeClient()
  await interview({ client, io: scripted(['x', '/stop']).io, files, only: ['record'] })
  expect(client.calls[0].messages[0].content).toMatch(/<already_known>[\s\S]*invented fact/)
})

test('distill writes reviewable drafts; approve publishes public records and withholds private ones', async () => {
  const files = memFiles()
  await interview({ client: fakeClient({ followUps: false }), io: scripted(['some answer', '/next', '/stop']).io, files, only: ['ch4'] })
  const drafts = await distill({ client: fakeClient(), io: { say() {} }, files })
  expect(drafts).toEqual([PATHS.draft('ch4')])

  const md = files.read(PATHS.draft('ch4'))
  expect(md).toMatch(/## The secret project\nKind: story PRIVATE/)

  /* Evan edits the draft by hand before approving. */
  files.write(PATHS.draft('ch4'), md.replace('an invented number of years', 'three invented years'))
  approve({ io: { say() {} }, files, only: ['ch4'] })

  const extra = files.read(PATHS.extra('ch4'))
  expect(extra).toMatch(/^Source: Evan, in his own words/)
  expect(extra).toMatch(/## The invented role\nKind: fact\nChapter: ch4\n/)
  expect(extra).toMatch(/three invented years/)
  expect(extra).not.toMatch(/secret project|never be shared/)
  expect(files.read(PATHS.voice)).toMatch(/- Two sentences, contractions/)
  expect(files.read(PATHS.boundaries)).toMatch(/## Other people/)
  expect(extra).not.toMatch(/Other people/)
})

test('a draft round-trips through render and parse', () => {
  const recs = [{ kind: 'opinion', label: 'On growth', text: 'Thinks something.', private: false }]
  expect(parseDraft(renderDraft(SECTIONS[0], recs, '2026-10-25'))).toEqual(recs)
})

test('the prompt builder reads Kind and Chapter, and puts voice notes in the resident prompt', () => {
  /* A minimal invented profile with the four load-bearing sections. */
  const profile = [
    '# Profile', '',
    '## The record', '**Role.** An invented role at an invented company, for long enough to matter here.', '',
    '## Who he is', '**Origin.** Grew up somewhere invented and moved somewhere else invented later on.', '',
    '## How he sounds', 'Short sentences.', '',
    '## How the agent behaves', '### Allowed', 'Talk about the work.',
  ].join('\n')
  const built = buildPrompt({ profile, voiceNotes: '- Two sentences, never a list.' })
  expect(built.system).toMatch(/HOW YOU SOUND\n\nShort sentences\.\n\n- Two sentences, never a list\./)
})
