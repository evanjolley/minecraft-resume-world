import { RECIPES, TAGS } from './recipes.js'
import { itemId } from './items.js'

/*
 * Recipe matching.
 *
 * Pure functions over a grid of stacks. No DOM, no inventory -- inventory.js
 * owns the grid the player is filling, this owns the question "what does that
 * make". Splitting it that way is what lets the 2x2 in the inventory and the
 * 3x3 at a crafting table share one implementation instead of two that drift.
 *
 * The two matching rules are Minecraft's, and both are the parts people get
 * wrong:
 *
 * 1. A SHAPED pattern matches ANYWHERE in the grid. The pattern describes the
 *    ingredients' positions relative to EACH OTHER, not relative to the grid.
 *    A stick over a stick makes a stick-shape whether you put it in the left
 *    column or the right one. Implementing "pattern rows == grid rows" is the
 *    classic bug: it works in the 2x2, where there is only one offset, and
 *    silently breaks every small recipe at a crafting table.
 *
 * 2. Every shaped pattern also matches MIRRORED. Vanilla's ShapedRecipe.matches
 *    tries each offset twice, once flipped horizontally, unconditionally --
 *    there is no per-recipe opt-in. That is why a left-handed axe works.
 *
 * The pattern is trimmed to its bounding box at load, which is what makes
 * offset matching correct: without it, a pattern written with a leading blank
 * column would refuse to sit in the leftmost column of the grid.
 */

/**
 * An ingredient -- an item key, or "#tag" for any of a set -- as the set of
 * item ids that satisfy it.
 *
 * Resolved once at module load rather than per match. The cost of getting
 * this wrong is not performance, it's that a typo'd key would fail silently
 * per-match; itemId() throws, so a bad recipe stops the module evaluating.
 */
function resolve(spec) {
  if (!spec.startsWith('#')) return new Set([itemId(spec)])
  const members = TAGS[spec.slice(1)]
  if (!members) throw new Error(`no such recipe tag: "${spec}"`)
  return new Set(members.map(itemId))
}

/**
 * Trim a pattern to its bounding box and flatten it to a cells array.
 * Returns { w, h, cells } where a cell is a Set of ids or null for empty.
 */
function compile(pattern, key) {
  const rows = pattern.map(r => [...r])
  const width = Math.max(...rows.map(r => r.length))
  // Pad short rows so column arithmetic below can't read undefined. Vanilla
  // requires equal-length rows; padding is friendlier and costs nothing.
  for (const r of rows) while (r.length < width) r.push(' ')

  const filled = (ch) => ch !== ' '
  let x0 = width, x1 = -1, y0 = rows.length, y1 = -1
  rows.forEach((r, y) => r.forEach((ch, x) => {
    if (!filled(ch)) return
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }))
  if (x1 < 0) throw new Error('empty recipe pattern')

  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const cells = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ch = rows[y][x]
      if (!filled(ch)) { cells.push(null); continue }
      const spec = key[ch]
      if (!spec) throw new Error(`recipe pattern uses "${ch}" with no key entry`)
      cells.push(resolve(spec))
    }
  }
  return { w, h, cells }
}

/** Flip a compiled pattern horizontally. Precomputed, not derived per match. */
const mirror = ({ w, h, cells }) => {
  const out = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(cells[y * w + (w - 1 - x)])
  return { w, h, cells: out }
}

function compileRecipe(r) {
  const result = itemId(r.result)
  if (r.type === 'shapeless') {
    return { ...r, result, ingredients: r.ingredients.map(resolve) }
  }
  const shape = compile(r.pattern, r.key)
  const flipped = mirror(shape)
  // A symmetric pattern mirrors to itself; skipping the duplicate halves the
  // work for the majority of recipes, which are symmetric.
  const same = shape.cells.every((c, i) => c === flipped.cells[i])
  return { ...r, result, shapes: same ? [shape] : [shape, flipped] }
}

/** Every recipe, compiled. Built once -- the table is static. */
export const RECIPE_BOOK = RECIPES.map(compileRecipe)

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/** Does a compiled shape sit in this grid at exactly one offset? */
function shapeMatches(shape, cells, gw, gh) {
  if (shape.w > gw || shape.h > gh) return false
  for (let dy = 0; dy <= gh - shape.h; dy++) {
    for (let dx = 0; dx <= gw - shape.w; dx++) {
      let ok = true
      for (let y = 0; y < gh && ok; y++) {
        for (let x = 0; x < gw; x++) {
          const inside = x >= dx && x < dx + shape.w && y >= dy && y < dy + shape.h
          const want = inside ? shape.cells[(y - dy) * shape.w + (x - dx)] : null
          const stack = cells[y * gw + x]
          // Both directions matter. A cell OUTSIDE the pattern must be empty,
          // or a 2x2 recipe would match a grid with junk in the third column.
          if (!want) { if (stack) { ok = false; break } continue }
          if (!stack || !want.has(stack.id)) { ok = false; break }
        }
      }
      if (ok) return true
    }
  }
  return false
}

/**
 * Shapeless: the same multiset of ingredients in any arrangement.
 *
 * Backtracking rather than a greedy pass, because tags overlap -- a stack of
 * cobblestone satisfies both "#stone_tool_materials" and "cobblestone", and a
 * greedy assignment can consume it on the wrong one and then declare no match.
 * At most nine items against at most nine ingredients, so the search is free.
 */
function shapelessMatches(ingredients, stacks) {
  if (ingredients.length !== stacks.length) return false
  const used = new Array(stacks.length).fill(false)
  const assign = (i) => {
    if (i === ingredients.length) return true
    for (let j = 0; j < stacks.length; j++) {
      if (used[j] || !ingredients[i].has(stacks[j].id)) continue
      used[j] = true
      if (assign(i + 1)) return true
      used[j] = false
    }
    return false
  }
  return assign(0)
}

/**
 * What this grid makes, or null.
 *
 * @param cells  gw*gh array of null | { id, count }, row-major
 * @returns { id, count, recipe } | null
 *
 * Linear scan over ~180 recipes. Rejected: indexing recipes by their
 * ingredient set. It is the obvious optimisation and it is not worth it here
 * -- this runs on grid CHANGE, which is a mouse click, not per frame, and an
 * index has to be rebuilt correctly every time the recipe table grows.
 */
export function findRecipe(cells, gw, gh) {
  const stacks = cells.filter(Boolean)
  if (stacks.length === 0) return null

  for (const r of RECIPE_BOOK) {
    if (r.type === 'shapeless') {
      if (shapelessMatches(r.ingredients, stacks)) return { id: r.result, count: r.count, recipe: r }
      continue
    }
    for (const shape of r.shapes) {
      if (shapeMatches(shape, cells, gw, gh)) return { id: r.result, count: r.count, recipe: r }
    }
  }
  return null
}

/**
 * Spend one of every occupied cell.
 *
 * One of EACH, not "one of each ingredient": a match guarantees every
 * occupied cell is an ingredient, and counting per-ingredient instead would
 * double-spend a 2x2 of the same block. This is also Minecraft's rule --
 * craft one torch from a full stack of coal and you lose exactly one coal.
 *
 * Mutates in place and returns the cells, so the caller's array identity
 * survives (the screen holds a reference to it).
 *
 * NOT IMPLEMENTED: remainder items. Vanilla hands back an empty bucket when a
 * recipe consumes a filled one. Nothing here has a remainder, and inventing
 * the mechanism for zero users is how you get an untested code path.
 */
export function consumeGrid(cells) {
  for (let i = 0; i < cells.length; i++) {
    const s = cells[i]
    if (!s) continue
    s.count--
    if (s.count <= 0) cells[i] = null
  }
  return cells
}
