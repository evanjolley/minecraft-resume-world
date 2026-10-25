#!/usr/bin/env node
/*
 * npm run interview                      interview, or resume where you stopped
 * npm run interview -- --only ch4,voice  just those sections (redo allowed)
 * npm run interview -- --distill         turn answers into drafts to review
 * npm run interview -- --approve all     publish reviewed drafts into corpus/
 * npm run interview -- --status          what is done and what is left
 *
 * Needs ANTHROPIC_API_KEY in the environment for the interview and distill
 * steps (approve and status are offline). Everything it writes is under
 * corpus/, which is gitignored: this repository is public.
 *
 * The logic is in scripts/interview/engine.mjs; this file is the terminal.
 */
import { createInterface } from 'node:readline/promises'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { interview, distill, approve, loadState } from './interview/engine.mjs'
import { SECTIONS, SECTION_IDS } from './interview/plan.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const files = {
  read(p) {
    const f = join(ROOT, p)
    return existsSync(f) ? readFileSync(f, 'utf8') : null
  },
  write(p, text) {
    const f = join(ROOT, p)
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, text)
  },
}

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true)
}
const parseOnly = (v) => {
  if (!v || v === true || v === 'all') return null
  const ids = String(v).split(',').map((s) => s.trim())
  const bad = ids.filter((id) => !SECTION_IDS.includes(id))
  if (bad.length) throw new Error(`unknown section ${bad.join(', ')}; known: ${SECTION_IDS.join(', ')}`)
  return ids
}

async function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Export it in this shell, then run again.')
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  return new Anthropic()
}

/* Multi-line answers: lines until an empty one, or a /command on its own. */
function terminal() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return {
    io: {
      say: (t) => console.log(t),
      async ask(prompt) {
        const first = await rl.question(prompt)
        if (first.trim() === '' || first.trim().startsWith('/')) return first.trim()
        const lines = [first]
        for (;;) {
          const line = await rl.question('  ')
          if (line.trim() === '') break
          lines.push(line)
        }
        return lines.join('\n')
      },
    },
    close: () => rl.close(),
  }
}

async function main() {
  if (flag('--status')) {
    const s = loadState(files)
    if (!s) { console.log('No interview yet.'); return }
    for (const sec of SECTIONS) {
      const r = s.sections[sec.id]
      console.log(`${sec.id.padEnd(11)} ${r.status.padEnd(12)} ${r.turns.filter((t) => t.a).length} answers`)
    }
    return
  }
  if (flag('--approve')) {
    approve({ io: { say: console.log }, files, only: parseOnly(flag('--approve')) })
    return
  }
  if (flag('--distill')) {
    await distill({ client: await client(), io: { say: console.log }, files, only: parseOnly(flag('--distill')) })
    return
  }
  const c = await client()
  const t = terminal()
  process.on('SIGINT', () => { console.log('\nSaved up to the last answer. Run again to resume.'); process.exit(0) })
  try {
    await interview({ client: c, io: t.io, files, only: parseOnly(flag('--only')) })
  } finally {
    t.close()
  }
}

main().catch((err) => {
  console.error(`\ninterview: ${err.message}`)
  process.exit(1)
})
