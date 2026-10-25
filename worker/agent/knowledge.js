/*
 * EVAN'S KNOWLEDGE: the read-only half of memory.
 *
 * Everything AI Evan knows about Evan is compiled from corpus/ at deploy time
 * into worker/prompt.generated.js (scripts/build-prompt.mjs) and arrives here
 * as CHUNKS: { id, label, source, text, kind?, chapter? }. It is bundled with
 * the Worker, held in memory by every isolate, shared by every visitor, and
 * costs nothing to read. There is no database for it because it changes only
 * when Evan re-runs the interview and deploys, and a database would be a
 * network hop per lookup to read a few hundred kilobytes that fit in RAM.
 *
 * The split the corpus doc argues for (03-corpus.md, "Structured facts versus
 * prose"): a short resident prompt that says who he is and how he talks, and
 * everything else behind a lookup the model calls before it states a fact.
 * This file is the lookup.
 *
 * RETRIEVAL IS BM25 OVER WORDS, not embeddings, for the reason the original
 * lookup gave and with the one weakness it had fixed: plain word overlap
 * scored "the" in a 2,000-character chunk the same as a rare name. BM25 weights
 * rare words up and long chunks down, which is what a keyword search needs to
 * stay sane as the interview grows the corpus from 19 chunks to a few hundred.
 * Labels count double, because the label is the topic.
 */

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'for',
  'is', 'was', 'his', 'he', 'him', 'evan', 'about', 'what', 'where', 'when', 'who', 'how',
  'did', 'does', 'do', 'tell', 'me', 'you', 'your', 'it', 'that', 'this', 'with', 'from',
  'are', 'were', 'be', 'been', 'has', 'have', 'had', 'there', 'their', 'they', 'them',
  'would', 'could', 'should', 'can', 'any', 'some', 'more', 'like', 'just', 'really'])

/** Lowercase words, stopwords out, a light plural/tense fold. */
export function tokens(s) {
  return (String(s ?? '').toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(fold)
}

function fold(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

const INDEX = new WeakMap()

function indexOf(chunks) {
  let idx = INDEX.get(chunks)
  if (idx) return idx
  const docs = chunks.map((c) => {
    const label = tokens(c.label)
    const body = tokens(c.text)
    const tf = new Map()
    for (const w of body) tf.set(w, (tf.get(w) ?? 0) + 1)
    for (const w of label) tf.set(w, (tf.get(w) ?? 0) + 2)
    return { c, tf, len: body.length + label.length * 2, chapter: chapterOf(c) }
  })
  const df = new Map()
  for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1)
  const avg = docs.reduce((n, d) => n + d.len, 0) / Math.max(1, docs.length)
  idx = { docs, df, avg, n: docs.length }
  INDEX.set(chunks, idx)
  return idx
}

/** A chunk's chapter: an explicit field, or the interview file naming it. */
export function chapterOf(c) {
  if (c.chapter) return c.chapter
  const m = /^interview-(ch[1-6])\b/.exec(c.id ?? '')
  return m ? m[1] : null
}

/**
 * @param {string} query
 * @param {Array} chunks
 * @param {{ chapter?: string, limit?: number, kinds?: string[] }} [opts]
 */
export function searchKnowledge(query, chunks, { chapter = null, limit = 3, kinds = null } = {}) {
  if (!Array.isArray(chunks) || !chunks.length) return []
  const { docs, df, avg, n } = indexOf(chunks)
  const q = [...new Set(tokens(query))]
  const k1 = 1.2
  const b = 0.75
  const scored = []
  for (const d of docs) {
    if (kinds && d.c.kind && !kinds.includes(d.c.kind)) continue
    let s = 0
    for (const w of q) {
      const f = d.tf.get(w)
      if (!f) continue
      const idf = Math.log(1 + (n - df.get(w) + 0.5) / (df.get(w) + 0.5))
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.len / avg))))
    }
    /* A chapter filter boosts that chapter's chunks rather than excluding the
     * rest: the Harvard story may well live in a file about something else. */
    if (chapter && d.chapter === chapter) s += q.length ? 1.5 : 1
    if (s > 0) scored.push({ c: d.c, s })
  }
  scored.sort((x, y) => y.s - x.s)
  return scored.slice(0, limit).map((x) => x.c)
}

/** Render hits the way the original corpus_lookup did: label, source, text. */
export function renderHits(hits) {
  if (!hits.length) return 'Nothing in the corpus covers that. You do not know it. Say so.'
  /* The source line is rendered, not optional -- see runLookup in
   * worker/index.js for why the trust class has to reach the model. */
  return hits.map((h) => `## ${h.label}\nsource: ${h.source ?? 'unlabelled, treat with care'}\n${h.text}`).join('\n\n')
}

/** Everything known about one chapter, for when he arrives at its plot. */
export function chapterNotes(chapter, chunks, plots) {
  const plot = plots.find((p) => p.id === chapter)
  if (!plot) return `There is no chapter called ${chapter}. The chapters are ${plots.map((p) => p.id).join(', ')}.`
  const hits = searchKnowledge(plot.label, chunks, { chapter, limit: 4 })
  const head = `You are at chapter ${plot.n}, "${plot.label}". The build there is a`
    + ' Minecraft rendering of that part of Evan\'s life.'
  if (!hits.length) {
    return `${head}\nNothing in the corpus covers this chapter yet. Name the chapter, `
      + 'say plainly that you do not have the story for it yet, and do not describe the build: '
      + 'you cannot see it, so anything you said about it would be a guess.'
  }
  return `${head}\n\n${renderHits(hits)}`
}
