import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { SIGN_GEOMETRY } from './blockMeshes.js'
import { isSignId, isWallSign, signNormal } from './blocks.js'

/*
 * SIGN TEXT, and the whole file is an answer to one constraint.
 *
 * noa draws every voxel of a block id as a THIN INSTANCE of one shared mesh.
 * Position, rotation and scale vary per voxel; vertices and materials cannot.
 * That is exactly right for a sign's board, which is the same plank
 * everywhere, and it is fatal for the text, because every sign says something
 * different. So the board is a block (blockMeshes.js) and the text is a
 * separate mesh per sign, owned here. There is no third option inside noa.
 *
 *
 * WHAT WAS REJECTED, and the numbers are the reason.
 *
 * docs/FUTURE.md item 1 proposed "a canvas and a DynamicTexture per placed
 * sign, which is a budget nobody has counted yet". Counted:
 *
 *   A sign's text block is 90 x 39 font pixels. nametag.js draws its font at
 *   8 canvas pixels per font pixel, which is what keeps Minecraft's bitmap
 *   glyphs hard-edged instead of soft, so the canvas is 720 x 312 = 224,640
 *   texels. At RGBA8 that is 899 KB per sign, and a GPU texture is not
 *   compressed. A HUNDRED SIGNS IS 88 MB of texture memory, for a hundred
 *   pictures of the same 95 glyphs in different orders.
 *
 * So the glyphs are rasterised ONCE into a shared atlas and every sign is a
 * quad per character with UVs into it. The atlas is 128 x 66 = 33 KB, and it
 * is 33 KB whether there is one sign in the world or a thousand. A sign's own
 * cost drops to its vertex buffer: 60 characters is 240 vertices, about
 * 7.7 KB. A hundred signs is 770 KB of geometry and ONE texture -- a
 * hundredfold saving that is not a micro-optimisation, it is the difference
 * between "label every plot" being free and being a memory budget.
 *
 * (It was 768 x 432 = 1.27 MB until the atlas was snapped to the font's own
 * pixel grid -- see THE GRAIN below, which is a legibility fix that happens
 * to take a factor of 38 off this paragraph.)
 *
 * Draw calls are the same either way (one mesh per sign), because all the
 * per-sign textures would have forced separate calls too. What the atlas adds
 * is that every sign now shares ONE material, which is the precondition for
 * ever merging them into a single mesh if a thousand signs is a real number.
 *
 * Also rejected: one canvas holding many sign faces, keyed by text. It is the
 * middle answer -- it fixes duplicate strings and nothing else, and plot
 * labels are all different by definition, so it would have saved nothing on
 * the one workload that exists.
 *
 *
 * ALPHA TESTING, NOT BLENDING, which is where this diverges from nametag.js
 * despite drawing the same font. A nametag needs real blending because its
 * background plate is 63/255 and its see-through pass is 32/255 -- both below
 * the 0.4 alpha-test cutoff, and alpha testing would throw both away (that
 * bug is written up at length in nametag.js). Sign text has no background and
 * no translucency: a texel is a glyph or it is nothing. So it takes the
 * cutout path blocks.js's installAlphaPageMaterials note argues for, which
 * costs no depth sorting and cannot flicker against the board behind it.
 */

/** Blocks per font pixel. Vanilla: 0.015625 * RENDER_SCALE, = (1/64) * (2/3). */
const FONT_PX = 1 / 96

/** SignBlockEntity.TEXT_LINE_HEIGHT and SignText.LINES, read from 1.21 source. */
const LINE_HEIGHT = 10
export const SIGN_LINES = 4

/*
 * Monocraft is monospaced at 6 font pixels of advance and a 9-pixel line box
 * -- the same relationship hud.js, chat.js and nametag.js all rely on.
 */
const GLYPH_W = 6
const GLYPH_H = 9

/*
 * SignBlockEntity.getMaxTextLineWidth() = 90. Vanilla enforces this in PIXELS
 * in the edit screen, not in characters, and has no character cap at all
 * below the 384-byte wire limit. Monocraft being monospaced turns 90 pixels
 * into exactly 15 characters here, which is where the number everyone quotes
 * comes from -- but the pixel is the real rule and it is the one applied.
 */
const MAX_LINE_WIDTH = 90
const MAX_CHARS = Math.floor(MAX_LINE_WIDTH / GLYPH_W)

/*
 * SignRenderer.TEXT_OFFSET is Vec3(0, 0.33333334, 0.046666667), in BLOCKS,
 * applied at the sign's pivot before the 2/3 scale. The z is the part that
 * matters here: the board's front face is half of 4/3 of a pixel from the
 * pivot plane, so the text sits 0.005 blocks -- four fifths of one twentieth
 * of a pixel -- proud of the wood. That gap is the whole z-fighting fix and
 * it is vanilla's number, not a tuned one.
 */
const TEXT_OFFSET_Y = 0.33333334
const TEXT_INSET = 0.046666667 - (SIGN_GEOMETRY.BOARD_THICKNESS / 2) / 16

/** A wall sign's pivot drops 0.3125 blocks; translateSign's magic number. */
const WALL_PIVOT_DROP = 0.3125

/*
 * Canvas pixels per font pixel WHILE RASTERISING. Not in the atlas -- see
 * THE GRAIN below. This is how finely the vector font is sampled before it is
 * reduced to the pixel grid it was drawn on, and 8 is enough that a 50%
 * coverage rule has 64 samples to decide each pixel from.
 */
const SUPERSAMPLE = 8


/*
 * One transparent font pixel of gutter around each cell in the atlas.
 *
 * Only needed because the atlas is now ONE texel per font pixel. At eight it
 * did not matter what a sampler did at a cell boundary, because being one
 * texel out is an eighth of a pixel; at one, being one texel out is a whole
 * pixel of the NEIGHBOURING GLYPH -- and this file has already shipped that
 * bug once, when v ran up the canvas and every letter came out as one from
 * the wrong row. A gutter makes the worst case a blank pixel instead.
 */
const PAD = 1
const CELL_W = GLYPH_W + 2 * PAD
const CELL_H = GLYPH_H + 2 * PAD

/** Printable ASCII, and a 16-wide grid because 95 glyphs want six rows. */
const FIRST_CHAR = 32
const LAST_CHAR = 126
const COLUMNS = 16
const ROWS = Math.ceil((LAST_CHAR - FIRST_CHAR + 1) / COLUMNS)

/** The atlas itself: 128 x 66 texels, 33 KB, one for the whole world. */
const ATLAS_W = COLUMNS * CELL_W
const ATLAS_H = ROWS * CELL_H

/** Vanilla's default sign text is DyeColor.BLACK, whose textColor is 0. */
const DEFAULT_COLOUR = '#000000'

const fontSpec = () => `${GLYPH_H * SUPERSAMPLE}px Monocraft, monospace`

/* ------------------------------------------------------------------ *
 * THE GRAIN, reported from play as "texture of text on sign is a liitle
 * cooked/grainy" and measured in test/90-sign-crispness.spec.js.
 *
 * The atlas used to BE the 8x rasterisation: 768 x 432 texels, eight per font
 * pixel, sampled NEAREST. That sounds harmless -- eight copies of a pixel is
 * still that pixel -- and it is not, because a browser does not put a vector
 * font's edges on an eight-texel grid. A dump of the old atlas found:
 *
 *   alphas 0, 55, 102, 117, 207, 238, 249, 255
 *   16,000 texels at partial coverage, one in five of the ink
 *
 * Every glyph edge carried a one-texel fringe at 0.46 and 0.81 coverage, and
 * the glyph sat 7.25 texels down a cell whose grid starts at 0. The
 * alpha-test cutoff is 0.4, so those fringes PASSED it -- a stem was eight
 * texels of ink or nine, depending on the fringe.
 *
 * Then the quad presents that atlas at about 2.6 screen pixels per font
 * pixel, which is 3 texels per screen pixel of MINIFICATION, and NEAREST
 * minification is point sampling: each screen pixel picks one texel out of
 * three and whether it picks a fringe is a matter of phase. Stroke weight
 * came out uneven down a single stem. That is the whole bug, and 1/96 of a
 * block per font pixel is why it can never be tuned away -- the ratio is not
 * a power of two, so no supersample makes the phase come out even.
 *
 * SO THE ATLAS IS SNAPPED BACK TO THE GRID THE FONT WAS DRAWN ON. Rasterise
 * at 8x as before, then reduce each 8x8 block to one texel by area coverage
 * with a 50% rule. Two alpha values, one texel per font pixel, 128 x 66. A
 * screen pixel now samples a pixel of the font, not a guess at one, and at
 * 2.6 screen pixels per font pixel the sampler is MAGNIFYING, which NEAREST
 * is exact at.
 *
 * The 50% rule survives the 7.25-texel misalignment without being told about
 * it: a destination texel overlapping its source pixel by 90% and the next
 * one by 10% resolves to the 90%. The net shift is a tenth of a font pixel.
 *
 *
 * WHAT WAS REJECTED.
 *
 * MIPMAPS AND A LINEAR MINIFICATION FILTER, which is the textbook answer to
 * NEAREST aliasing and is the wrong one here for a reason specific to this
 * material: sign text is ALPHA TESTED, and a mip chain averages alpha, so a
 * black stroke at distance falls under the 0.4 cutoff and is DISCARDED. The
 * text would not soften with distance, it would erode and then vanish --
 * which is the classic foliage bug, and 86-leaves has it written up. Taking
 * mipmaps would mean taking blending too, and blending is what the top of
 * this file argues against (and what the painting z-fighting work is
 * currently paying for elsewhere). Not worth it for a surface whose whole
 * job is to be read.
 *
 * KEEPING THE 8x ATLAS AND JUST FLATTENING ITS FRINGES to 0 or 255 in place.
 * Same picture, 64x the texture memory, and it leaves 768 x 432 of texels
 * that carry no information that 128 x 66 does not. The saving is not the
 * point -- the point is that a texel being a font pixel is a thing this file
 * can now assert.
 *
 * DIVERGING FROM nametag.js, deliberately, and it keeps its 8x. A nametag is
 * 0.025 blocks per font pixel against a sign's 1/96, so its glyphs are two
 * and a half times larger on screen at the same distance, and it BLENDS
 * rather than alpha-tests -- a fringe there is a slightly soft edge, not a
 * texel that flips between ink and nothing. Its own note says why it also
 * turns mipmaps off. Left alone rather than made uniform: the two paths
 * diverge because the numbers do.
 * ------------------------------------------------------------------ */

/**
 * WHERE THE FONT'S PIXEL GRID ACTUALLY IS, in the rasterisation, per axis.
 *
 * ASKED RATHER THAN ASSUMED, and that is the second half of this fix. The
 * arithmetic says a font pixel starts every 8 texels from the cell's corner.
 * It does not. Chromium lands Monocraft's rows on 7, 15, 23 and WebKit lands
 * them on 3, 11, 19 -- half a font pixel apart, on the same font at the same
 * size with the same reported metrics (both say actualBoundingBoxAscent 56).
 * The first version of this reduction assumed the grid, which meant it was
 * right on Chromium and catastrophic on WebKit: every 8x8 block straddled two
 * of the font's rows, the 50% rule took whichever had four of them, and A, B,
 * D and O came out as SOLID BLOCKS with their counters filled. The 8x
 * rasterisation was perfect in both engines; only the reduction was wrong.
 *
 * So the phase is measured off the rasterisation itself. Sum the alpha along
 * each row and each column of the whole 8x canvas, and a font-pixel boundary
 * is a place where that sum JUMPS. Every boundary in the canvas is at the
 * same offset modulo 8, so adding the jumps up by offset and taking the
 * largest bucket finds it in one pass, with 95 glyphs voting.
 *
 * Rejected: reading only the middle 4x4 of each block and hoping the slack
 * covered it. Tried, measured, still blobbed -- WebKit's grid is four texels
 * out, and no amount of margin fixes being half a pixel wrong.
 *
 * Rejected: a per-engine constant. It is the same class of mistake one level
 * up, and the next font rasteriser gets it wrong again.
 */
function gridPhase(src, hiW, hiH) {
  const rows = new Float64Array(hiH), cols = new Float64Array(hiW)
  for (let y = 0; y < hiH; y++) {
    for (let x = 0; x < hiW; x++) {
      const a = src[(y * hiW + x) * 4 + 3]
      rows[y] += a
      cols[x] += a
    }
  }
  const phaseOf = (profile) => {
    const jump = new Float64Array(SUPERSAMPLE)
    for (let i = 1; i < profile.length; i++) {
      jump[i % SUPERSAMPLE] += Math.abs(profile[i] - profile[i - 1])
    }
    let best = 0
    for (let i = 1; i < SUPERSAMPLE; i++) if (jump[i] > jump[best]) best = i
    return best
  }
  return [phaseOf(cols), phaseOf(rows)]
}

/**
 * Every printable glyph, once, in a grid. Drawn white so a material can tint
 * it: the alpha channel is the glyph and the colour is the sign's.
 */
function drawGlyphAtlas(texture) {
  const hiW = COLUMNS * GLYPH_W * SUPERSAMPLE
  const hiH = ROWS * GLYPH_H * SUPERSAMPLE

  /*
   * A THROWAWAY CANVAS for the rasterisation, because the texture's own is
   * now 1:1 and 36 times smaller than the rendering needs. Same trick
   * nametag.js uses to measure text before it sizes its canvas.
   */
  const hi = document.createElement('canvas')
  hi.width = hiW
  hi.height = hiH
  const hiCtx = hi.getContext('2d', { willReadFrequently: true })
  hiCtx.clearRect(0, 0, hiW, hiH)
  hiCtx.font = fontSpec()
  hiCtx.textAlign = 'center'
  hiCtx.textBaseline = 'middle'
  hiCtx.fillStyle = 'rgb(255, 255, 255)'
  for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
    const i = code - FIRST_CHAR
    const cx = (i % COLUMNS) * GLYPH_W * SUPERSAMPLE
    const cy = Math.floor(i / COLUMNS) * GLYPH_H * SUPERSAMPLE
    /*
     * The glyph's vertical middle is 4.5 font pixels down its own line box,
     * which is the same anchor nametag.js uses (`1 + LINE_H / 2` on a canvas
     * that starts one pixel above the box). Getting this wrong shifts every
     * glyph in the world by the same amount, which reads as "the font is
     * slightly low" rather than as a bug.
     */
    hiCtx.fillText(String.fromCharCode(code),
      cx + (GLYPH_W * SUPERSAMPLE) / 2, cy + 4.5 * SUPERSAMPLE)
  }

  const src = hiCtx.getImageData(0, 0, hiW, hiH).data
  const [phaseX, phaseY] = gridPhase(src, hiW, hiH)
  const ctx = texture.getContext()
  const out = ctx.createImageData(ATLAS_W, ATLAS_H)
  const dst = out.data
  const half = (SUPERSAMPLE * SUPERSAMPLE) / 2

  for (let i = 0; i <= LAST_CHAR - FIRST_CHAR; i++) {
    const col = i % COLUMNS, row = Math.floor(i / COLUMNS)
    for (let py = 0; py < GLYPH_H; py++) {
      for (let px = 0; px < GLYPH_W; px++) {
        // Coverage of one font pixel, as a count of its 64 subsamples.
        let covered = 0
        const sx = (col * GLYPH_W + px) * SUPERSAMPLE + phaseX
        const sy = (row * GLYPH_H + py) * SUPERSAMPLE + phaseY
        for (let y = 0; y < SUPERSAMPLE; y++) {
          const gy = Math.min(hiH - 1, sy + y)
          for (let x = 0; x < SUPERSAMPLE; x++) {
            covered += src[(gy * hiW + Math.min(hiW - 1, sx + x)) * 4 + 3] / 255
          }
        }
        if (covered < half) continue           // background, and it stays 0
        const dx = col * CELL_W + PAD + px
        const dy = row * CELL_H + PAD + py
        const d = (dy * ATLAS_W + dx) * 4
        dst[d] = dst[d + 1] = dst[d + 2] = dst[d + 3] = 255
      }
    }
  }
  ctx.putImageData(out, 0, 0)
  texture.update(false)
}

/* ------------------------------------------------------------------ *
 * THE MIRROR TRAP, and this is the file it would poison.
 *
 * Babylon is left-handed: noa's forward at heading h is (sin h, 0, cos h), so
 * a reader looking along +z has +x on their RIGHT. Three builds in this repo
 * have shipped reversed text -- `4202` on Widener's frieze, a backwards
 * `2026` on a hoarding, a mirrored `?` -- because a row of blocks stamped in
 * source order runs right-to-left for half the walls in the world.
 *
 * So the reading direction is never assumed here, it is DERIVED. A reader
 * stands on the +normal side of the board and looks along -normal, so their
 * forward is -n and their right is forward turned a quarter clockwise:
 *
 *     right(h) = (cos h, 0, -sin h) = (forward.z, 0, -forward.x)
 *     forward  = -n
 *     right    = (-n.z, 0, n.x)
 *
 * Checked against the one case anybody can picture: a sign facing north has
 * n = (0, 0, -1) in this world's FACINGS, the reader looks along +z, and the
 * formula gives right = (1, 0, 0) -- text runs east, which is where the
 * reader's right hand is. The other three fall out of the same line.
 *
 * AND THE OTHER TWELVE, since blocks.js grew sixteen standing rotations. This
 * line needed no change to take them, which is the payoff of having written
 * it as a vector rotation instead of a table of four names: it is a quarter
 * turn about y, and a quarter turn about y is a quarter turn about y at 22.5
 * degrees as much as at 90. What DOES change is that `normal` is no longer
 * one of four axis vectors, so nothing downstream may ask "which axis is
 * this" -- see textAnchor.
 *
 * And per docs/builds/README.md, a derivation is not a check. Four compass
 * facings and four off-axis rotations are screenshotted and read in
 * test/76-signs.spec.js and test/82-sign-rotation.spec.js.
 * ------------------------------------------------------------------ */
const readingDirection = (normal) => [-normal[2], 0, normal[0]]

/**
 * Where the text plane sits, in world coordinates: the centre of the four
 * lines, on the face of the board.
 */
function textAnchor(id, x, y, z) {
  const normal = signNormal(id)
  const G = SIGN_GEOMETRY
  const origin = [x + 0.5, 0, z + 0.5]

  if (isWallSign(id)) {
    /*
     * A WALL sign is still one of four, and it has to be: it hangs on a block
     * face, and a block has four vertical faces. So this branch keeps the
     * axis arithmetic -- the wall plane in block-local coordinates, then
     * outward to the board's face and the hair's breadth past it. Same
     * construction as the wall torch's, and the same reason: derive from the
     * vector, never the name.
     */
    const a = normal[0] ? 0 : 2
    const s = normal[a]
    const wall = (1 - s) / 2
    origin[a] = [x, y, z][a] + wall + s * (G.WALL_FRONT / 16 + TEXT_INSET)
    origin[1] = y + 0.5 - WALL_PIVOT_DROP + TEXT_OFFSET_Y
  } else {
    /*
     * A STANDING sign is one of sixteen, twelve of which are off-axis, so the
     * step out of the board is along the NORMAL rather than along an axis.
     * `normal[a] ? ...` was the old form and it is now a bug waiting to
     * happen: at 22.5 degrees both components are non-zero and picking one of
     * them would put the text on the diagonal of the board it belongs to.
     *
     * For the four compass segments this is arithmetically identical to what
     * it replaced -- one component is exactly 0 and the other exactly +-1 --
     * which is why the existing four-facing screenshots still read.
     */
    const out = (G.BOARD_THICKNESS / 2) / 16 + TEXT_INSET
    origin[0] = x + 0.5 + normal[0] * out
    origin[2] = z + 0.5 + normal[2] * out
    origin[1] = y + 0.5 + TEXT_OFFSET_Y
  }
  return { origin, right: readingDirection(normal), normal }
}

/**
 * One sign's text as a quad per character.
 *
 * Built in LOCAL space around the anchor and positioned by the caller, so
 * noa's origin rebasing (it shifts the whole scene every 25 blocks) moves it
 * for free.
 */
function textVertexData(lines, right) {
  const positions = [], uvs = [], indices = [], normals = []
  for (let i = 0; i < SIGN_LINES; i++) {
    const text = String(lines[i] ?? '').slice(0, MAX_CHARS)
    if (!text) continue
    /*
     * Vanilla centres each line on `-font.width(line) / 2` and stacks the
     * four on `i * 10 - 20`, which is the TOP of line i's box in font space.
     * Font space is y-down and the renderer's scale negates it, so world-up
     * is the negation.
     */
    const startU = -(text.length * GLYPH_W) / 2
    const top = -(i * LINE_HEIGHT - 20)

    for (let j = 0; j < text.length; j++) {
      const code = text.charCodeAt(j)
      if (code <= FIRST_CHAR || code > LAST_CHAR) continue   // space draws nothing
      const g = code - FIRST_CHAR
      const col = g % COLUMNS, row = Math.floor(g / COLUMNS)
      const u0 = startU + j * GLYPH_W, u1 = u0 + GLYPH_W
      const v0 = top, v1 = top - GLYPH_H

      const base = positions.length / 3
      for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
        positions.push(right[0] * u * FONT_PX, v * FONT_PX, right[2] * u * FONT_PX)
      }
      /*
       * V RUNS DOWN THE CANVAS, and assuming otherwise is what the first
       * screenshot of this file caught: every glyph came out as some OTHER
       * glyph, from the wrong row and upside down.
       *
       * nametag.js states the rule from the other side -- "a DynamicTexture's
       * canvas is Y-DOWN and Babylon samples the plane's UVs Y-UP, so the
       * glyphs come out upside down" -- and fixes it by flipping the whole
       * texture with vScale. That is right for one glyph on one quad and
       * wrong here: flipping the texture would flip the ATLAS, so the rows
       * would swap places as well as the glyphs turning over. An atlas has to
       * address the canvas in the canvas's own frame, so v is canvasY / H and
       * the top of a cell has the SMALLER v.
       */
      const uMin = (col * CELL_W + PAD) / ATLAS_W
      const uMax = (col * CELL_W + PAD + GLYPH_W) / ATLAS_W
      const vTop = (row * CELL_H + PAD) / ATLAS_H
      const vBottom = (row * CELL_H + PAD + GLYPH_H) / ATLAS_H
      uvs.push(uMin, vTop, uMax, vTop, uMax, vBottom, uMin, vBottom)
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
      // Unlit, so these are decoration -- supplied anyway because Babylon
      // computes bogus ones when they are missing and culling reads them.
      for (let k = 0; k < 4; k++) normals.push(0, 0, 1)
    }
  }
  const data = new VertexData()
  data.positions = positions
  data.uvs = uvs
  data.indices = indices
  data.normals = normals
  return data
}

/* ------------------------------------------------------------------ *
 * The registry.
 *
 * Module-level and writable BEFORE noa exists, because the callers that
 * matter are builds: src/builds/* runs while the world is being stamped, and
 * a build should not have to know whether the renderer is up yet. Entries set
 * early are flushed when installSignText runs.
 * ------------------------------------------------------------------ */

/** "x,y,z" -> { lines, colour } */
const texts = new Map()
/** "x,y,z" -> { mesh } */
const live = new Map()
/** Coordinates with words waiting for a sign to appear under them. */
const pending = new Set()

let ctx = null

const keyOf = (x, y, z) => `${x},${y},${z}`

/**
 * Put words on a sign.
 *
 * THIS IS THE CALL A BUILD MAKES. World coordinates, up to four lines, each
 * truncated at vanilla's 90-pixel line width (15 Monocraft characters):
 *
 *     import { setSignText } from '../signText.js'
 *     setSignText(-63, 137, 120, ['Stage 7', 'Patronus AI', '2026'])
 *
 * The sign block itself is placed the ordinary way -- `oak_sign` for a
 * standing one, which resolves to a facing on placement, or one of the eight
 * ids directly. Text set for a coordinate with no sign on it is kept and
 * drawn; text on a coordinate that stops being a sign is dropped.
 *
 * @param {number} x @param {number} y @param {number} z world coordinates
 * @param {string[]} lines up to four
 * @param {{colour?: string}} [opts] CSS colour; vanilla's default is black
 */
export function setSignText(x, y, z, lines, opts = {}) {
  const entry = {
    lines: (Array.isArray(lines) ? lines : [lines]).slice(0, SIGN_LINES),
    colour: opts.colour ?? DEFAULT_COLOUR,
  }
  texts.set(keyOf(x, y, z), entry)
  if (ctx) renderSign(x, y, z, entry)
}

/**
 * What a coordinate already says, or undefined.
 *
 * For signScreen.js, which has to prefill its four boxes: a sign just placed
 * says nothing, and a sign being edited a second time must not be blanked by
 * the screen that opened to edit it. Returns the stored entry rather than a
 * copy, and the caller reads it -- a clone would be honest and would also
 * suggest that writing to it does something, which it does not.
 */
export function signTextAt(x, y, z) {
  return texts.get(keyOf(x, y, z))
}

/** Take the words off, without touching the block. */
export function clearSignText(x, y, z) {
  const key = keyOf(x, y, z)
  texts.delete(key)
  pending.delete(key)
  disposeSign(key)
}

/** For the spec, which has to assert on a non-empty sample before anything. */
export function signTextStats() {
  return {
    signs: live.size,
    /** One shared atlas, whatever the sign count. */
    textures: ctx ? 1 : 0,
    atlasBytes: ctx ? ATLAS_W * ATLAS_H * 4 : 0,
    vertices: [...live.values()].reduce((n, s) => n + s.mesh.getTotalVertices(), 0),
  }
}

function disposeSign(key) {
  const entry = live.get(key)
  if (!entry) return
  entry.mesh.dispose()
  live.delete(key)
}

/** Colour -> material. One per distinct ink, not one per sign. */
function materialFor(colour) {
  let mat = ctx.materials.get(colour)
  if (mat) return mat
  mat = ctx.noa.rendering.makeStandardMaterial(`sign-text-${colour}`)
  mat.diffuseTexture = ctx.atlas
  /*
   * Same three colour lines as nametag.js and crackOverlay.js, and the same
   * reason: Babylon ADDS emissive and ambient rather than modulating them, so
   * anything left at its default white pins the quad to white before the
   * texture is sampled -- and this text is BLACK, which is the one colour
   * that failure mode hides completely.
   */
  mat.diffuseColor = Color3.FromHexString(colour)
  mat.emissiveColor = new Color3(0, 0, 0)
  mat.ambientColor = new Color3(0, 0, 0)
  mat.specularColor = new Color3(0, 0, 0)
  mat.disableLighting = true
  /*
   * Off, so a sign read from behind shows nothing rather than nothing-shaped
   * geometry, and so winding order cannot silently swallow a glyph. The board
   * is opaque and occludes the back face anyway; vanilla draws a separate
   * back text, which is out of scope here and noted in docs/FUTURE.md.
   */
  mat.backFaceCulling = false
  mat.freeze()
  ctx.materials.set(colour, mat)
  return mat
}

function renderSign(x, y, z, entry) {
  const key = keyOf(x, y, z)
  disposeSign(key)
  const signId = ctx.noa.getBlock(x, y, z)
  /*
   * THE TEXT CANNOT DRAW WITHOUT THE BLOCK, and that is not a limitation to
   * work around -- the block id is the only thing that knows which way the
   * board faces, which is the only thing that knows which way the words run.
   *
   * So an entry whose coordinate is not (yet) a sign is kept as PENDING and
   * retried, rather than dropped or guessed at. Two things make it land:
   * the setBlock hook below, for a sign placed by hand or by a command, and
   * the tick retry, for a sign that arrives as terrain -- a build stamps into
   * the chunk generator rather than through setBlock, so there is no write to
   * hook and the chunk may not even be resident when the text is set.
   */
  if (!isSignId(signId)) { pending.add(key); return }
  pending.delete(key)

  const { origin, right } = textAnchor(signId, x, y, z)
  const data = textVertexData(entry.lines, right)
  if (data.indices.length === 0) return   // four blank lines is not a mesh

  const mesh = new Mesh(`sign-text-${key}`, ctx.scene)
  data.applyToMesh(mesh)
  mesh.material = materialFor(entry.colour)
  mesh.isPickable = false
  // Static: noa's octree owns the frustum culling and the origin rebasing,
  // which is the only reason this can be a plain world-space mesh at all.
  ctx.noa.rendering.addMeshToScene(mesh, true, origin)
  live.set(key, { mesh })
}

/**
 * Wire the renderer up. Call once, after the blocks are registered.
 *
 * The setBlock wrap is the same pattern installAttachment and
 * installPlacementOrientation use, and it is installed AFTER both so that the
 * id it reads is the one that actually landed -- a wrap that ran first would
 * see the canonical `oak_sign` rather than the facing variant it resolves to.
 */
export function installSignText(noa) {
  const scene = noa.rendering.getScene()
  /*
   * generateMipMaps FALSE (the fourth argument) and NEAREST, both stated
   * rather than inherited. See THE GRAIN above for why a mip chain is the
   * wrong medicine for a surface that is alpha tested.
   */
  const atlas = new DynamicTexture('sign-glyph-atlas', {
    width: ATLAS_W, height: ATLAS_H,
  }, scene, false, Texture.NEAREST_SAMPLINGMODE)
  atlas.hasAlpha = true
  atlas.wrapU = atlas.wrapV = Texture.CLAMP_ADDRESSMODE
  ctx = { noa, scene, atlas, materials: new Map() }
  drawGlyphAtlas(atlas)

  /*
   * ...and again once the font has actually loaded, which is a trap the
   * nametags do not have. A nametag redraws on every rename, so a tag drawn
   * in the fallback monospace fixes itself the first time anybody is renamed.
   * This atlas is drawn ONCE and every sign in the world samples it forever,
   * so drawing it before Monocraft arrives would make every sign permanently
   * wrong. Redrawing the same texture object needs no mesh rebuilt: the UVs
   * are unchanged and the material already points at it.
   */
  document.fonts?.ready?.then(() => { if (ctx) drawGlyphAtlas(atlas) })

  const originalSetBlock = noa.setBlock.bind(noa)
  noa.setBlock = (id, x, y, z) => {
    const result = originalSetBlock(id, x, y, z)
    const key = keyOf(x, y, z)
    const entry = texts.get(key)
    if (!entry) return result
    if (isSignId(noa.getBlock(x, y, z))) renderSign(x, y, z, entry)
    else clearSignText(x, y, z)
    return result
  }

  for (const [key, entry] of texts) {
    const [x, y, z] = key.split(',').map(Number)
    renderSign(x, y, z, entry)
  }

  /*
   * The retry, and it costs nothing once the world has settled: the handler
   * returns on its first line while `pending` is empty, which it is for every
   * tick after the last build's chunks have meshed. Every 20 ticks rather
   * than every tick because a chunk arriving one second late is invisible and
   * a getBlock per pending sign per tick is not free at a hundred of them.
   */
  let tick = 0
  noa.on('tick', () => {
    if (pending.size === 0 || ++tick % 20) return
    for (const key of [...pending]) {
      const [x, y, z] = key.split(',').map(Number)
      const entry = texts.get(key)
      if (entry) renderSign(x, y, z, entry)
      else pending.delete(key)
    }
  })
}

/** For tests and world switches: forget every sign in the world. */
export function resetSignText() {
  for (const key of [...live.keys()]) disposeSign(key)
  texts.clear()
  pending.clear()
}
