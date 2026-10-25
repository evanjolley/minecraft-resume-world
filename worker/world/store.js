/*
 * ONE DURABLE OBJECT PER SIGNED-IN VISITOR, WITH ITS OWN SQLITE.
 *
 * Holds everything that belongs to one person and nobody else: their
 * passkeys, their nickname and their saved world. Guests never create one;
 * a guest's world lives in their browser's IndexedDB until they sign in.
 *
 * Why an object per visitor rather than one D1 database for everyone is
 * argued with numbers in docs/decisions.md. The short version: every visitor
 * is a separate world, so there is never a query that spans two of them, and
 * an object per visitor turns "1,000 people saving at once" into 1,000
 * independent single-writer databases instead of one queue.
 *
 * The AI EVAN agent's per-visitor memory can live here too (same key, same
 * lifetime) or in its own class keyed by the same visitor id; either works
 * because the id is the only coupling.
 *
 * This file is the logic only. worker/world/visitor.js is the Durable Object
 * shell that exposes it, and says why that is JSON over fetch rather than
 * native RPC.
 *
 * STORAGE SHAPE, chosen to keep rows written per save at one or two:
 *   kv           profile and state, a JSON blob each
 *   worlds       one row per dimension, the whole edit list as one JSON blob
 *   credentials  one row per passkey
 * A per-edit table was rejected: SQLite-backed objects bill per row written,
 * and a save that touches 50 blocks would be 50 billable rows instead of one.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS worlds (dim TEXT PRIMARY KEY, gen TEXT NOT NULL, edits TEXT NOT NULL, tiles TEXT);
  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY, public_key TEXT NOT NULL,
    sign_count INTEGER NOT NULL, created INTEGER NOT NULL);
`

/**
 * The logic, separate from the DurableObject subclass so a test can drive it
 * against node:sqlite without the Workers runtime. `sql` is anything with
 * the `exec(query, ...bindings)` shape of ctx.storage.sql.
 */
export class VisitorStore {
  constructor(sql) {
    this.sql = sql
    for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) sql.exec(stmt)
  }

  #get(k) {
    const row = this.sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray()[0]
    return row ? JSON.parse(row.v) : null
  }

  #set(k, v) {
    this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      k, JSON.stringify(v))
  }

  /* ---- profile ---- */

  getProfile() { return this.#get('profile') }

  setNickname(nickname) {
    const profile = { ...(this.#get('profile') ?? { created: Date.now() }), nickname }
    this.#set('profile', profile)
    return profile
  }

  /* ---- passkeys ---- */

  addCredential({ credentialId, publicKey, signCount }) {
    this.sql.exec(`INSERT INTO credentials (id, public_key, sign_count, created) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`, credentialId, JSON.stringify(publicKey), signCount, Date.now())
    if (!this.#get('profile')) this.#set('profile', { created: Date.now(), nickname: null })
  }

  getCredential(id) {
    const row = this.sql.exec('SELECT * FROM credentials WHERE id = ?', id).toArray()[0]
    return row ? { id: row.id, publicKey: JSON.parse(row.public_key), signCount: row.sign_count } : null
  }

  setSignCount(id, signCount) {
    this.sql.exec('UPDATE credentials SET sign_count = ? WHERE id = ?', signCount, id)
  }

  credentialCount() {
    return this.sql.exec('SELECT COUNT(*) AS n FROM credentials').toArray()[0].n
  }

  /* ---- the saved world ---- */

  getSave() {
    const meta = this.#get('save')
    if (!meta) return { rev: 0, save: null }
    const worlds = {}
    for (const row of this.sql.exec('SELECT dim, gen, edits, tiles FROM worlds').toArray()) {
      worlds[row.dim] = { gen: row.gen, edits: JSON.parse(row.edits), ...(row.tiles ? { tiles: JSON.parse(row.tiles) } : {}) }
    }
    return { rev: meta.rev, save: { v: meta.v, updatedAt: meta.updatedAt, state: meta.state, worlds } }
  }

  /**
   * Optimistic concurrency: the write lands only if the client saw the latest
   * revision. Otherwise the current save comes back for the client to merge
   * (src/persistence.js mergeSaves) and retry. Two devices playing at once
   * therefore never silently overwrite each other.
   *
   * Only CHANGED worlds are rewritten, compared as JSON text, so a save that
   * only moved the player costs one row.
   */
  putSave(baseRev, save) {
    const meta = this.#get('save')
    const rev = meta?.rev ?? 0
    if (baseRev !== rev) return { ok: false, conflict: true, ...this.getSave() }

    const existing = new Map(this.sql.exec('SELECT dim, gen, edits, tiles FROM worlds').toArray()
      .map((r) => [r.dim, r]))
    for (const [dim, w] of Object.entries(save.worlds)) {
      const edits = JSON.stringify(w.edits)
      const tiles = w.tiles ? JSON.stringify(w.tiles) : null
      const was = existing.get(dim)
      if (was && was.gen === w.gen && was.edits === edits && was.tiles === tiles) continue
      this.sql.exec(`INSERT INTO worlds (dim, gen, edits, tiles) VALUES (?, ?, ?, ?)
        ON CONFLICT(dim) DO UPDATE SET gen = excluded.gen, edits = excluded.edits, tiles = excluded.tiles`,
      dim, w.gen, edits, tiles)
    }
    for (const dim of existing.keys()) {
      if (!(dim in save.worlds)) this.sql.exec('DELETE FROM worlds WHERE dim = ?', dim)
    }
    const next = rev + 1
    this.#set('save', { rev: next, v: save.v, updatedAt: save.updatedAt, state: save.state ?? null })
    return { ok: true, rev: next }
  }

  /** "Forget me": every row this visitor has, passkeys included. */
  forget() {
    for (const table of ['kv', 'worlds', 'credentials']) this.sql.exec(`DELETE FROM ${table}`)
    return { forgotten: true }
  }
}

