import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { PAINTINGS, artUrl, CUSTOM_PX_PER_BLOCK } from './paintings.js'
import {
  isPaintingId, paintingNormal, PAINTING_WALL, PAINTING_KEYS, PAINTING_DEPTH,
} from './blocks.js'

/* ------------------------------------------------------------------ *
 * A PAINTING IS A BLOCK HERE, AND IT IS AN ENTITY IN VANILLA.
 *
 * That is the biggest deliberate divergence in this file, so it goes first.
 *
 * Vanilla 1.21 is unambiguous: `net.minecraft.world.entity.decoration.
 * Painting extends HangingEntity extends BlockAttachedEntity extends Entity`,
 * registered in `EntityType.java` as "painting" with `.noLootTable()`. It
 * hangs on a wall face, it has no collision (`Entity.canBeCollidedWith`
 * returns false and nothing in that chain overrides it), and it re-checks
 * whether its wall is still there every 100 ticks.
 *
 * NONE OF THAT ARGUES FOR AN ENTITY *HERE*, because the question is not "what
 * is it called in Mojang's type system", it is "which of this engine's two
 * kinds of thing already does what a painting needs". Count what a painting
 * needs against what each side gives:
 *
 *   targetable by the crosshair   block: src/targeting.js, already shape-
 *                                 accurate. entity: nothing exists. noa's
 *                                 picker walks VOXELS; there is no entity
 *                                 pick at all, and adding one means a second
 *                                 raycast that has to agree with the first
 *                                 about which of the two got hit first.
 *   an outline you can aim at     block: TARGET_BOXES, free.
 *                                 entity: src/highlight.js is driven off
 *                                 noa.targetedBlock. Rewrite.
 *   breaks and drops              block: items.js's loot tables and
 *                                 itemEntity.js's break seam, free.
 *                                 entity: a whole parallel damage path.
 *   pops when its wall is mined   block: installAttachment, free, and
 *                                 BETTER than vanilla -- vanilla notices on
 *                                 a 5-second poll, this notices on the tick.
 *                                 entity: a poll of our own.
 *   survives origin rebasing      block: noa shifts every chunk mesh when
 *                                 the player wanders 25 blocks. An entity
 *                                 mesh would need its own bookkeeping, which
 *                                 is the same objection blockMeshes.js's
 *                                 fence note raises against a parallel
 *                                 instanced system.
 *   walked through                both: PASS_THROUGH_SHAPES for a block.
 *
 * Five of six are already built and all five are keyed on BLOCK IDS. Choosing
 * "entity" here buys fidelity to a class name and pays for it by
 * reimplementing five working systems. Rejected.
 *
 * WHAT IT COSTS, named rather than hidden. A painting is a rectangle of
 * blocks, so it occupies real voxels: you cannot hang one in a doorway you
 * also want to walk through the plane of, and two paintings cannot overlap
 * the way two entities harmlessly could (vanilla forbids that anyway --
 * `HangingEntity.survives` rejects an overlapping hanging entity). It also
 * means every block behind the rectangle must be solid, which is again
 * exactly what `survives` requires. The divergence is smaller in behaviour
 * than it is in vocabulary.
 *
 *
 * AND THE ARTWORK IS NOT A BLOCK, WHICH IS THE OTHER HALF.
 *
 * noa draws every voxel of an id as a THIN INSTANCE of one shared mesh:
 * position, rotation and scale vary per voxel, vertices and materials do not.
 * So 51 vanilla variants plus seven photographs cannot be 58 block ids' worth
 * of artwork -- and even if they could, a 3x2 painting is SIX voxels showing
 * ONE picture, which no per-voxel transform can express.
 *
 * This is the sign problem, one size up, and it takes the sign's answer:
 *
 *   THE FRAME IS A BLOCK. Every cell of the rectangle is a
 *   `painting_wall_<facing>` block, 1/16 deep against the wall (vanilla's
 *   `Painting.DEPTH = 0.0625F`, verified in 1.21.8 source). Every painting's
 *   frame is identical, which is precisely the case a thin instance is for,
 *   so all of them share one mesh and one material.
 *
 *   THE PICTURE IS ONE MESH PER PAINTING. Four vertices spanning the whole
 *   w x h rectangle, sampling that painting's own texture.
 *
 *
 * COUNTED, because signText.js counted and was right to. Per painting:
 *
 *   geometry   4 vertices -- position, uv, normal -- about 130 BYTES.
 *              A sign's 60-character text is 240 vertices; a painting is the
 *              cheapest mesh in this repo.
 *   texture    shared per NAME, not per painting. Two `kebab`s on two walls
 *              are one 16x16 upload between them.
 *
 * So the recurring cost is the texture set, not the painting count:
 *
 *   51 vanilla variants, 16 px/block, RGBA8             329 KB for ALL of them
 *   1 custom 3x2 at 128 px/block (384x256)                        393 KB each
 *   7 custom 3x2, one per chapter                                   2.75 MB
 *
 * THE VANILLA SET IS CHEAPER THAN ONE PHOTOGRAPH, which is the line that
 * makes the 128 px decision easy to sanity-check: all 51 of Mojang's
 * paintings together cost less GPU memory than a single 3x2 custom one. Pixel
 * art is small. That is why vanilla could afford 16 px/block and why a
 * photograph cannot live at it.
 *
 * ...and only the ones actually hung are ever fetched, because the texture is
 * created lazily on the first painting of a name. A world with one custom
 * painting on a wall pays 393 KB, not 2.7 MB.
 *
 * REJECTED: one atlas holding all 58 pictures, which is what signText.js does
 * with its glyphs and is wrong here for a reason worth writing down. The
 * glyph atlas wins because a hundred signs REUSE 95 glyphs -- the sharing is
 * the whole saving. Paintings do not share: a painting's picture is used by
 * that painting. An atlas would upload all seven photographs to show one, add
 * a packer, and make CUSTOM_PX_PER_BLOCK a global rather than a knob. The
 * middle answer signText.js rejected ("one canvas keyed by content") is the
 * RIGHT answer here, and it is what the texture cache below is.
 *
 * REJECTED: a DynamicTexture per painting, drawn from a canvas. That is what
 * signText.js counted at 899 KB and refused. A painting's art is a static PNG
 * on disk, so a plain `Texture` from a URL is smaller, needs no canvas, and
 * lets the browser's image decoder do the work off the main thread.
 * ------------------------------------------------------------------ */

/**
 * How far proud of the frame's front face the picture sits.
 *
 * It has to be bigger than zero, because two coplanar surfaces z-fight and
 * the fight is per-pixel and moves with the camera -- which reads as the
 * painting FLICKERING rather than as a depth bug.
 *
 * AND IT HAS TO BE SMALLER THAN THE SELECTION BOX'S OWN PULL, which is the
 * half that cost this file a screenshot. src/highlight.js does not inflate
 * the outline; it copies vanilla's `VIEW_OFFSET_Z_LAYERING` and shifts the
 * wireframe's ORIGIN toward the camera by `distance / 4096`. At 3 blocks
 * that is 0.00073 blocks. The first version of this constant was 1/512 =
 * 0.00195 -- nearly three times as much -- so the picture sat IN FRONT of
 * its own selection box and aiming at a painting drew no outline at all. The
 * targeting test passed the whole time, because targeting was never broken.
 *
 * 1/4096 is the same denominator highlight.js uses, which makes the rule
 * legible rather than tuned: the outline wins at every distance past one
 * block, and one block is closer than the near plane lets you get to a wall.
 */
const ART_PROUD = 1 / 4096

/* ------------------------------------------------------------------ *
 * THE MIRROR TRAP.
 *
 * docs/builds/README.md: "TEXT COMES OUT MIRRORED, AND IT COST TWO AGENTS AN
 * AFTERNOON." Babylon is left-handed, four builds have shipped reversed
 * content, and A PHOTOGRAPH IS THE MOST OBVIOUSLY WRONG THING TO MIRROR --
 * a flipped brick pattern is invisible, a flipped building is not.
 *
 * So the horizontal direction is DERIVED, never assumed, and it is derived by
 * the same line signText.js uses and has screenshot tests for. A viewer
 * stands on the +normal side and looks along -normal; noa's right at heading
 * h is (cos h, 0, -sin h), forward is (sin h, 0, cos h), so
 *
 *     forward = -n   =>   right = (-n.z, 0, n.x)
 *
 * Checked on the case anybody can picture: a painting facing north has
 * n = (0,0,-1) in this world's FACINGS, the viewer looks along +z, and this
 * gives right = (1,0,0). +x is FACINGS.west in this world -- which is the
 * viewer's right hand when they are looking north, and is exactly the
 * east/west flip that makes this worth deriving instead of remembering.
 *
 * And per that same README, a derivation is not a check: the painting is
 * screenshotted and looked at in test/87-paintings.spec.js.
 * ------------------------------------------------------------------ */
const viewerRight = (normal) => [-normal[2], 0, normal[0]]

/* ------------------------------------------------------------------ *
 * The registry. Module-level and writable before noa exists, for exactly the
 * reason signText.js's is: a build stamps its world while the renderer is
 * still coming up, and a build should not have to know that.
 * ------------------------------------------------------------------ */

/** anchor "x,y,z" -> { name, facing, w, h } */
const hung = new Map()
/** cell "x,y,z" -> anchor key. Every cell of every painting, including the anchor. */
const cellOwner = new Map()
/** anchor key -> { mesh } */
const live = new Map()
/** Anchors whose blocks have not appeared yet. */
const pending = new Set()

let ctx = null

const keyOf = (x, y, z) => `${x},${y},${z}`

/**
 * THIS IS THE CALL A BUILD MAKES. One line hangs a painting.
 *
 *     import { hangPainting } from '../paintingArt.js'
 *
 *     hangPainting(s, [12, 4, 0], 'south', 'millard_north')
 *
 * IT TAKES THE STAMPER, and that is the ergonomic decision in this file.
 * setSignText does not -- a build stamps `oak_wall_sign_north` itself and
 * then calls setSignText at the same coordinate, which is two places to get
 * right and works because a sign is one block. A 3x2 painting is SIX blocks
 * plus an art registration, and asking a build author to write an `s.box` of
 * the correct facing variant and then repeat the corner coordinate is asking
 * for a painting whose picture is one block left of its frame.
 *
 * So this writes both halves from one set of numbers. There is no way to
 * desync them because there is only one place to type them.
 *
 * @param {*} s        the stamper, plot-local. Blocks go through `s.set`, so
 *                     the plot bounds check applies -- a painting that pokes
 *                     into somebody else's chapter throws, same as any block.
 * @param {number[]} at PLOT-LOCAL [x, y, z] of the BOTTOM-LEFT cell as a
 *                     VIEWER SEES IT. Not as the source file reads: see the
 *                     mirror note above. The rectangle grows up, and to the
 *                     viewer's right.
 * @param {string} facing which way the PICTURE LOOKS -- 'north' | 'south' |
 *                     'east' | 'west'. The wall it hangs on is behind it, so
 *                     a painting on the south face of a building faces south.
 * @param {string} name a key in src/paintings.js: a vanilla variant, or a
 *                     custom row.
 */
export function hangPainting(s, at, facing, name) {
  const v = PAINTINGS.get(name)
  if (!v) {
    throw new Error(`no painting called "${name}". `
      + `Add a row to CUSTOM_PAINTINGS in src/paintings.js and run \`npm run paintings\`.`)
  }
  /*
   * THE KEY COMES OUT OF THE TABLE, not out of a template string. North's
   * block key is the bare `painting`, because the canonical variant is also
   * the item -- so `painting_wall_${facing}` is right for three facings and
   * throws on the fourth. This line was that bug.
   */
  const blockKey = PAINTING_KEYS.get(facing)
  if (!blockKey) {
    throw new Error(`painting "${name}" wants to face "${facing}"; `
      + 'a painting hangs on a wall, so it must face north, south, east or west.')
  }
  const [lx, ly, lz] = at
  const normal = paintingNormal(PAINTING_WALL.get(facing))
  const right = viewerRight(normal)

  /*
   * Stamp the rectangle. `u` runs along the viewer's right and `v` runs up,
   * so the loop is written in the frame a person standing in front of it
   * would describe -- which is the frame the caller's coordinates are in.
   */
  for (let u = 0; u < v.w; u++) {
    for (let vy = 0; vy < v.h; vy++) {
      s.set(lx + right[0] * u, ly + vy, lz + right[2] * u, blockKey)
    }
  }

  // The art is registered in WORLD coordinates, because the renderer runs
  // against a live world and has no plot to be local to.
  const [wx, wy, wz] = s.toWorld(lx, ly, lz)
  registerPainting(wx, wy, wz, facing, name)
  return s
}

/**
 * Register artwork at a world coordinate whose blocks are already there (or
 * are about to be). `hangPainting` is the call builds make; this is the seam
 * under it, and it is what the placement path and the test suite use.
 */
export function registerPainting(x, y, z, facing, name) {
  const v = PAINTINGS.get(name)
  if (!v) throw new Error(`no painting called "${name}"`)
  const key = keyOf(x, y, z)
  clearPainting(x, y, z)
  const entry = { name, facing, w: v.w, h: v.h, custom: v.custom }
  hung.set(key, entry)

  const normal = paintingNormal(PAINTING_WALL.get(facing))
  const right = viewerRight(normal)
  for (let u = 0; u < v.w; u++) {
    for (let vy = 0; vy < v.h; vy++) {
      cellOwner.set(keyOf(x + right[0] * u, y + vy, z + right[2] * u), key)
    }
  }
  if (ctx) render(x, y, z, entry)
  return entry
}

/** The painting covering this cell, or null. For tests and the debug screen. */
export function paintingAt(x, y, z) {
  const anchor = cellOwner.get(keyOf(x, y, z))
  return anchor ? { anchor, ...hung.get(anchor) } : null
}

/** How many paintings are hung, and how many textures they share between them. */
export const paintingStats = () => ({
  hung: hung.size,
  drawn: live.size,
  pending: pending.size,
  textures: ctx ? ctx.textures.size : 0,
})

/** Forget one painting: its art, its mesh, and every cell it claimed. */
export function clearPainting(x, y, z) {
  const key = keyOf(x, y, z)
  const entry = hung.get(key)
  if (!entry) return
  disposeMesh(key)
  hung.delete(key)
  pending.delete(key)
  for (const [cell, anchor] of cellOwner) {
    if (anchor === key) cellOwner.delete(cell)
  }
}

function disposeMesh(key) {
  const e = live.get(key)
  if (!e) return
  e.mesh.dispose()
  live.delete(key)
}

/**
 * One texture per painting NAME, shared by every painting showing it.
 *
 * TRILINEAR, NOT NEAREST, and this is the second place custom paintings
 * diverge from the rest of the world. Every other texture in this repo is
 * sampled NEAREST, because a 16x16 block texture magnified to fill the screen
 * must stay hard-edged or Minecraft stops looking like Minecraft. A
 * photograph is the opposite case: it is being MINIFIED (384 source pixels
 * across three blocks, which is well under one texel per screen pixel at any
 * sane distance), and nearest-neighbour minification is where moire comes
 * from. Mipmaps and trilinear filtering are what stop a brick wall in the
 * photo from shimmering as you walk past it.
 *
 * Vanilla art stays NEAREST for the same reason it is 16 px: it is pixel art
 * and smoothing it would be vandalism.
 */
function textureFor(name, custom) {
  let tex = ctx.textures.get(name)
  if (tex) return tex
  const url = artUrl(name)
  tex = new Texture(
    url, ctx.scene,
    /* noMipmap  */ !custom,
    /* invertY   */ false,
    custom ? Texture.TRILINEAR_SAMPLINGMODE : Texture.NEAREST_SAMPLINGMODE,
  )
  /*
   * CLAMP, not the default WRAP. A quad's UVs run exactly 0..1 here so wrap
   * should never fire -- but bilinear filtering samples HALF A TEXEL past the
   * edge, and with WRAP that half texel comes from the opposite side of the
   * image. The symptom is a one-pixel strip of the right-hand sky down the
   * left edge of the painting, which looks like a frame and is not one.
   */
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE
  /*
   * MISSING ART IS A VISIBLE PLACEHOLDER, NOT A CRASH, and this is the case
   * that matters most because it is the DEPLOYED one. `npm run build:deploy`
   * builds textures from the CE pack, which has no painting art at all, and
   * public/paintings/vanilla/ is gitignored -- so on the live site every
   * vanilla painting's texture 404s. Babylon's default for a failed load is a
   * fully transparent texture, which would draw a painting-shaped hole and
   * look like a rendering bug. A flat colour looks like a canvas nobody has
   * painted yet, which is what it is.
   *
   * Custom paintings are unaffected: their art is committed and ships.
   */
  tex.onLoadErrorObservable?.addOnce?.(() => {
    console.warn(`painting art missing: ${url} -- drawing a blank canvas.`
      + ' Run `npm run paintings` (vanilla art needs a local Minecraft install).')
  })
  ctx.textures.set(name, tex)
  return tex
}

function materialFor(name, custom) {
  let mat = ctx.materials.get(name)
  if (mat) return mat
  mat = ctx.noa.rendering.makeStandardMaterial(`painting-${name}`)
  mat.diffuseTexture = textureFor(name, custom)
  /*
   * PAINTINGS ARE UNLIT, and this is a known divergence rather than an
   * oversight, so it is written down where somebody will find it.
   *
   * Object meshes are not lit by blockLight.js at all -- the sign agent found
   * signs render at full brightness in a dark room, and docs/builds/README.md
   * warns that "a sign, a chart or a plaque has to be its own light". The
   * same is true here, and the choice is not "lit or unlit", it is "unlit, or
   * lit by Babylon's scene lighting, which knows nothing about block light".
   *
   * Unlit wins for a reason specific to this content. The whole job of the
   * Millard North painting is that a visitor can compare a photograph to a
   * building; a photograph rendered at 30% brightness because the wall behind
   * it is in shadow fails that job in the exact situation it is needed --
   * indoors, where you would hang one. Vanilla paintings ARE block-lit and do
   * go dark; matching that would be more faithful and less useful.
   *
   * The consequence to expect: a painting on an unlit wall at night is the
   * brightest thing in the room. If that ever reads wrong, the fix is for
   * blockLight.js to grow an object-mesh path, which every sign in the world
   * wants too -- it is one bug, not a painting bug.
   *
   * The three colour lines are nametag.js's and signText.js's, for their
   * reason: Babylon ADDS emissive and ambient rather than modulating them, so
   * a default-white emissive pins the quad to white before the texture is
   * even sampled.
   */
  mat.diffuseColor = new Color3(0, 0, 0)
  mat.emissiveTexture = mat.diffuseTexture
  mat.emissiveColor = new Color3(1, 1, 1)
  mat.ambientColor = new Color3(0, 0, 0)
  mat.specularColor = new Color3(0, 0, 0)
  mat.disableLighting = true
  // A painting has a back -- the frame block behind it is opaque -- so the
  // reverse face is never seen. Culled, which halves the fragments.
  mat.backFaceCulling = true
  mat.freeze()
  ctx.materials.set(name, mat)
  return mat
}

/**
 * The picture: four vertices spanning the whole rectangle.
 *
 * Built in LOCAL space around the bottom-left corner and positioned by the
 * caller, so noa's origin rebasing moves it for free -- the same arrangement
 * signText.js uses and for the same reason.
 */
function artVertexData(entry, right) {
  const [rx, , rz] = right
  const w = entry.w, h = entry.h
  // Corners, anticlockwise from bottom-left as the viewer sees it.
  const corners = [
    [0, 0], [w, 0], [w, h], [0, h],
  ]
  const positions = []
  for (const [u, vy] of corners) positions.push(rx * u, vy, rz * u)
  /*
   * V IS FLIPPED, and the flip is HERE rather than on the texture.
   *
   * A PNG's rows run top-down; Babylon's UV v runs bottom-up on the quad. The
   * texture is created with invertY:false (Babylon's default for a URL is
   * true, which flips at UPLOAD time) because flipping here keeps the whole
   * orientation question -- which way is up, which way is right -- in one
   * function that a screenshot test reads. A flip split across two files is
   * how an upside-down painting survives a code review.
   *
   * So the TOP of the quad (vy = h) takes v = 0, the top row of the image.
   */
  const uvs = [0, 1, 1, 1, 1, 0, 0, 0]
  const indices = [0, 1, 2, 0, 2, 3]
  // Unlit, so these are decoration -- supplied because Babylon invents bogus
  // ones otherwise and culling reads them.
  const normals = []
  for (let i = 0; i < 4; i++) normals.push(0, 0, 1)

  const data = new VertexData()
  data.positions = positions
  data.uvs = uvs
  data.indices = indices
  data.normals = normals
  return data
}

/**
 * Where the bottom-left corner of the picture sits in world coordinates: on
 * the front face of the frame, a hair proud of it.
 */
function artOrigin(x, y, z, normal, right) {
  // The axis the painting faces along, and the block-local plane of the wall
  // it hangs on. Same construction as a wall sign's and a wall torch's:
  // derive from the vector, never from the name.
  const a = normal[0] ? 0 : 2
  const s = normal[a]
  const wall = (1 - s) / 2
  const origin = [x + 0.5, y, z + 0.5]
  origin[a] = [x, y, z][a] + wall + s * (PAINTING_DEPTH + ART_PROUD)
  /*
   * The other horizontal axis: the quad grows along `right`, so it starts at
   * whichever edge of the anchor cell `right` points AWAY from. `right` is
   * always an axis vector here (a painting faces one of four ways), so this
   * is 0 or 1 and never a fraction.
   */
  const p = a === 0 ? 2 : 0
  origin[p] = [x, y, z][p] + (right[p] > 0 ? 0 : 1)
  return origin
}

function render(x, y, z, entry) {
  const key = keyOf(x, y, z)
  disposeMesh(key)
  const id = ctx.noa.getBlock(x, y, z)
  /*
   * THE PICTURE CANNOT DRAW WITHOUT THE BLOCKS, exactly as a sign's text
   * cannot. A build stamps into the chunk generator rather than through
   * setBlock, so there is no write to hook and the chunk may not be resident
   * yet -- so an entry whose cells are not there is kept PENDING and retried.
   */
  if (!isPaintingId(id)) { pending.add(key); return }
  pending.delete(key)

  const normal = paintingNormal(id)
  const right = viewerRight(normal)
  const mesh = new Mesh(`painting-${key}`, ctx.scene)
  artVertexData(entry, right).applyToMesh(mesh)
  mesh.material = materialFor(entry.name, entry.custom)
  // The FRAME is what the crosshair hits; the picture is a decal on it. A
  // pickable art mesh would put a second surface in front of every painting
  // for targeting.js to argue with.
  mesh.isPickable = false
  ctx.noa.rendering.addMeshToScene(mesh, true, artOrigin(x, y, z, normal, right))
  live.set(key, { mesh })
}

/**
 * Wire the renderer up. Call once, after the blocks are registered, and AFTER
 * installAttachment and installPlacementOrientation for the reason
 * installSignText gives: a wrap that ran first would see the id that was
 * asked for rather than the one that landed.
 */
export function installPaintingArt(noa) {
  ctx = {
    noa,
    scene: noa.rendering.getScene(),
    textures: new Map(),
    materials: new Map(),
  }

  const originalSetBlock = noa.setBlock.bind(noa)
  /*
   * TEARDOWN, AND IT IS THE SUBTLE PART OF THIS FILE.
   *
   * A painting is N blocks and ONE object. Break any one of its cells -- by
   * mining it, or by mining the wall behind it and letting installAttachment
   * pop it -- and the whole painting has to go, or you are left with five
   * sixths of a frame and a picture floating over the gap.
   *
   * THE OTHER CELLS ARE WRITTEN THROUGH `originalSetBlock`, WHICH IS WHY
   * EXACTLY ONE ITEM DROPS. itemEntity.js hangs the loot roll off
   * `authority.requestBlockChange`, so a break that never goes through the
   * authority never drops. The cell the player actually hit went through the
   * normal path and dropped its painting; the other five are erased quietly.
   * Vanilla lands in the same place from the other direction -- its painting
   * is one entity and drops one generic `minecraft:painting`, variant and all
   * discarded (`Painting.dropItem`). A six-cell block painting that dropped
   * six items would be this design leaking through the seam.
   *
   * `originalSetBlock` also avoids re-entering this very wrap, which would
   * recurse once per cell.
   */
  noa.setBlock = (id, x, y, z) => {
    const result = originalSetBlock(id, x, y, z)
    const cell = keyOf(x, y, z)
    const anchor = cellOwner.get(cell)
    if (anchor) {
      // Still a painting block? Then this was the painting being placed, not
      // broken, and nothing is owed.
      if (!isPaintingId(noa.getBlock(x, y, z))) {
        const [ax, ay, az] = anchor.split(',').map(Number)
        const cells = [...cellOwner].filter(([, a]) => a === anchor).map(([c]) => c)
        clearPainting(ax, ay, az)
        for (const c of cells) {
          if (c === cell) continue
          const [cx, cy, cz] = c.split(',').map(Number)
          if (isPaintingId(noa.getBlock(cx, cy, cz))) originalSetBlock(0, cx, cy, cz)
        }
      }
      return result
    }
    // A painting's own cells arriving: draw once the last one has landed.
    const entry = hung.get(cell)
    if (entry) render(x, y, z, entry)
    return result
  }

  for (const [key, entry] of hung) {
    const [x, y, z] = key.split(',').map(Number)
    render(x, y, z, entry)
  }

  /*
   * The retry, free once the world has settled: it returns on its first line
   * while `pending` is empty, which it is for every tick after the last
   * build's chunks have meshed. Twenty ticks rather than one, signText.js's
   * number, for signText.js's reason.
   */
  let tick = 0
  noa.on('tick', () => {
    if (pending.size === 0 || ++tick % 20) return
    for (const key of [...pending]) {
      const [x, y, z] = key.split(',').map(Number)
      const entry = hung.get(key)
      if (entry) render(x, y, z, entry)
      else pending.delete(key)
    }
  })
}

/** For tests and world switches: forget every painting in the world. */
export function resetPaintings() {
  for (const key of [...live.keys()]) disposeMesh(key)
  hung.clear()
  cellOwner.clear()
  pending.clear()
}

/** Bytes of GPU texture the hung paintings are holding. For the debug screen. */
export function paintingTextureBytes() {
  if (!ctx) return 0
  let bytes = 0
  for (const name of ctx.textures.keys()) {
    const v = PAINTINGS.get(name)
    if (!v) continue
    const px = v.custom ? CUSTOM_PX_PER_BLOCK : 16
    bytes += v.w * px * v.h * px * 4
  }
  return bytes
}
