/*
 * THE SAVE FORMAT, as the server accepts it. The client builds it in
 * src/persistence.js; this is the gate on what reaches storage.
 *
 *   {
 *     v: 1,
 *     updatedAt: <ms>,
 *     state: { dimension, position: [x,y,z], heading, pitch, gamemode, time,
 *              inventory: { slots, armor, offhand, selected } },
 *     worlds: {
 *       <dimension name>: {
 *         gen: <generation id string>,
 *         edits: [[x, y, z, toKey, wasKey], ...]
 *       }
 *     }
 *   }
 *
 * BLOCKS ARE STORED BY KEY, never by numeric id. Engine ids are positional:
 * they change whenever blocks.js gains an entry, so a save written in ids
 * would turn into different blocks after the next release.
 *
 * `wasKey` is what the GENERATOR put at that coordinate when the edit was
 * made, and it is what lets a save survive the landscape changing under it:
 * an edit is only replayed where the generator still produces `wasKey`. See
 * src/persistence.js for the rule and docs/decisions.md for why it is per
 * edit rather than one generation id for the whole world.
 *
 * The validator is strict about SHAPE and generous about CONTENT. It does not
 * know the block list (that would couple the Worker to blocks.js and refuse
 * saves from a newer client), so an unknown key is stored and the client
 * skips it on load.
 */

export const SAVE_VERSION = 1
export const MAX_SAVE_BYTES = 1_500_000
export const MAX_EDITS_PER_WORLD = 40_000
const KEY_SHAPE = /^[a-z0-9_:]{1,48}$/
/* typeof first: RegExp.test coerces, so a numeric id 7 would pass as "7". */
const KEY = { test: (s) => typeof s === 'string' && KEY_SHAPE.test(s) }
const DIM = /^[a-z0-9_-]{1,32}$/
const COORD = 30_000_000

const isInt = (n) => Number.isInteger(n) && Math.abs(n) <= COORD
const isNum = (n) => typeof n === 'number' && Number.isFinite(n)

function validStack(s) {
  return s === null || (s && typeof s === 'object' && KEY.test(s.key)
    && Number.isInteger(s.count) && s.count > 0 && s.count <= 64)
}

function validInventory(inv) {
  if (!inv || typeof inv !== 'object') return false
  const arr = (a, n) => Array.isArray(a) && a.length <= n && a.every(validStack)
  return arr(inv.slots, 36) && arr(inv.armor ?? [], 4) && arr(inv.offhand ?? [], 1)
    && (inv.selected === undefined || (Number.isInteger(inv.selected) && inv.selected >= 0 && inv.selected < 9))
}

/** @returns {string|null} the reason it is refused, or null if it is fine */
export function invalidSave(save) {
  if (!save || typeof save !== 'object') return 'not an object'
  if (save.v !== SAVE_VERSION) return 'unknown save version'
  if (!isNum(save.updatedAt)) return 'updatedAt missing'
  const st = save.state
  if (st != null) {
    if (typeof st !== 'object') return 'bad state'
    if (st.position != null && !(Array.isArray(st.position) && st.position.length === 3
      && st.position.every(isNum))) return 'bad position'
    if (st.dimension != null && !DIM.test(st.dimension)) return 'bad dimension'
    if (st.gamemode != null && !/^[a-z]{1,16}$/.test(st.gamemode)) return 'bad gamemode'
    if (st.time != null && !isNum(st.time)) return 'bad time'
    if (st.inventory != null && !validInventory(st.inventory)) return 'bad inventory'
  }
  if (!save.worlds || typeof save.worlds !== 'object') return 'worlds missing'
  const dims = Object.keys(save.worlds)
  if (dims.length > 8) return 'too many worlds'
  for (const dim of dims) {
    if (!DIM.test(dim)) return 'bad world name'
    const w = save.worlds[dim]
    if (!w || typeof w.gen !== 'string' || w.gen.length > 64) return 'bad generation id'
    if (!Array.isArray(w.edits) || w.edits.length > MAX_EDITS_PER_WORLD) return 'bad edits'
    for (const e of w.edits) {
      if (!Array.isArray(e) || e.length !== 5 || !isInt(e[0]) || !isInt(e[1]) || !isInt(e[2])
        || !KEY.test(e[3]) || !KEY.test(e[4])) return 'bad edit'
    }
  }
  return null
}
