/*
 * Non-cube blocks: geometry, and the collision noa doesn't give us.
 *
 * blocks.js owns WHICH non-cube blocks exist. This file owns what they look
 * like and what it's like to walk on them.
 *
 *
 * WHAT NOA ACTUALLY SUPPORTS
 *
 * Rendering: `registerBlock(id, { blockMesh })` hands noa a Babylon mesh. Every
 * voxel of that id becomes a THIN INSTANCE of that one mesh, managed per chunk
 * by lib/objectMesher.js, drawn in one call per block id. It never touches the
 * terrain mesher, so a non-cube block gets no greedy merging and no ambient
 * occlusion -- AO is baked into terrain vertex colours during greedy meshing
 * and there is no hook to ask for it here. Lighting still matches, because
 * terrain and these meshes are both lit by the same Babylon DirectionalLight
 * off the same normals; only the corner darkening is missing.
 *
 * Collision: NOTHING. noa's physics is
 * voxel-physics-engine -> voxel-aabb-sweep, and the sweep's only question about
 * the world is `testSolid(x, y, z) -> boolean` over INTEGER voxel coords. A
 * voxel is a full unit cube or it is nothing. There is no per-block AABB
 * anywhere in noa, voxel-physics-engine or voxel-aabb-sweep, and
 * `registerBlock`'s `solid` flag is a boolean, not a shape.
 *
 * So the three options were:
 *   1. `solid: true`  -- a slab you stand half a block above. Visibly wrong.
 *   2. `solid: false` -- a slab you fall through. Visibly wrong.
 *   3. Resolve sub-voxel collision ourselves. Done here.
 *
 * Non-cube blocks are registered `solid: false`, so noa's sweep ignores them
 * completely, and this module owns 100% of their collision. Full cubes are
 * untouched -- they stay on noa's swept path, which is the one that decides
 * whether parkour feels right, and which nothing here should be trusted with.
 *
 * The hook is `noa.physics.tick`, wrapped rather than replaced. Engine.tick
 * runs physics BEFORE the entity systems that read `body.resting` (movement's
 * jump check, survival's fall damage, physics.js's footsteps), so correcting
 * inside that wrapper is indistinguishable from noa having done it. A
 * `noa.on('tick')` listener would have been the polite hook and is too late:
 * it fires last, after everything has already read a stale resting flag.
 *
 * Rejected: noa's own `body.autoStep`, which steps up to the next whole voxel
 * boundary. That is a 1-block step, which would let you walk up the parkour
 * course. Minecraft's step height is 0.6 and it is per-obstacle, which is
 * exactly what STEP_HEIGHT below is.
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh.js'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js'
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js'

/* ------------------------------------------------------------------ *
 * Shapes.
 *
 * A shape is a list of boxes in block-local coordinates, [x0,y0,z0,x1,y1,z1]
 * with every component in 0..1. One list drives BOTH the mesh and the
 * collision, which is the only reason the two can't drift apart -- and
 * "the stairs render one way and collide another" is precisely the bug this
 * whole file exists to avoid.
 *
 * These are Minecraft's own boxes. A stair is a bottom slab plus a half-depth
 * step on the side it FACES: vanilla's stairs.json is
 * `from [0,0,0] to [16,8,16]` plus `from [8,8,0] to [16,16,16]` at facing=east,
 * so the tall half is on the facing side and you climb toward it.
 *
 * NOT modelled: stair corner shapes (inner/outer). Vanilla picks those from
 * the two neighbouring stairs, which is neighbour-dependent GEOMETRY -- see
 * the note about fences at the bottom of this file for why that is a
 * different and much larger problem than these two.
 * ------------------------------------------------------------------ */

/*
 * Unit vectors for the four horizontal facings, in Minecraft's names.
 *
 * EAST IS -X AND WEST IS +X, which looks like a typo and is not. Babylon's
 * scene is left-handed, so facing +Z (which this world calls south, and which
 * is noa's heading 0) puts +X on your RIGHT -- measured, in
 * test/25-orientation.spec.js -- and Minecraft facing south puts WEST on your
 * right. There is no assignment of the four names to the four axis directions
 * that both turns clockwise and keeps vanilla's `east = +X`; the long version
 * of that argument is the compass note in src/debugScreen.js.
 *
 * This table used to say `east: [1, 0, 0]` and `headingToFacing` below used to
 * call +X east to match, which is why stairs still placed correctly: the name
 * was mirrored and the geometry was mirrored to cancel it. Both were flipped
 * IN THE SAME COMMIT, which is the only safe way to touch either -- rename one
 * without the other and stairs place backwards while every test still passes,
 * because nothing in this repo ever compared a stair's name to Minecraft's.
 *
 * What the pairing buys now that it is honest: a stair state imported from a
 * real Minecraft build says `facing=east`, and east in this world is -X, and
 * that is where its tall half will be. Before this commit it would have been
 * built pointing the other way.
 */
export const FACINGS = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [1, 0, 0],
  east: [-1, 0, 0],
}

const slabBoxes = (half) =>
  half === 'top' ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]]

function stairBoxes(facing, half) {
  // The step sits in the half of the footprint the stair faces...
  const [fx, , fz] = FACINGS[facing]
  const x0 = fx > 0 ? 0.5 : 0, x1 = fx < 0 ? 0.5 : 1
  const z0 = fz > 0 ? 0.5 : 0, z1 = fz < 0 ? 0.5 : 1
  // ...and "upside down" is the whole model mirrored through y = 0.5.
  return half === 'top'
    ? [[0, 0.5, 0, 1, 1, 1], [x0, 0, z0, x1, 0.5, z1]]
    : [[0, 0, 0, 1, 0.5, 1], [x0, 0.5, z0, x1, 1, z1]]
}

/** shape key -> boxes. Keys are `slab_<half>` and `stairs_<facing>_<half>`. */
export const SHAPE_BOXES = {
  slab_bottom: slabBoxes('bottom'),
  slab_top: slabBoxes('top'),
}
for (const facing of Object.keys(FACINGS)) {
  for (const half of ['bottom', 'top']) {
    SHAPE_BOXES[`stairs_${facing}_${half}`] = stairBoxes(facing, half)
  }
}

/*
 * The torch, and it is ONE BOX. That is worth saying out loud, because the
 * torch everybody remembers is two crossed transparent planes and a little
 * post, and that model is gone: modern `block/template_torch.json` (read out
 * of 1.21.8's jar, not from memory) is a single element
 *
 *     from [7, 0, 7] to [9, 10, 9]
 *
 * with all six faces textured and no planes at all. A 2x2 post, ten pixels
 * tall, sitting in the middle of the cell.
 *
 * THE UVS COME OUT RIGHT WITHOUT ASKING, which is luck worth recording so
 * nobody "fixes" it. Vanilla's side faces are `uv [7, 6, 9, 16]` -- columns
 * 7..9, rows 6..16 counted from the TOP of the image. This file's mesher cuts
 * every face from the slice of the texture its box occupies, and a box
 * spanning x 7..9 and y 0..10 is columns 7..9 and (Babylon uploads flipped,
 * so v = 0 is the bottom row) the bottom ten rows -- rows 6..16 from the top.
 * The same pixels, arrived at from the other end.
 *
 * The two faces that do NOT match are the cap and the underside, where
 * vanilla hand-picks `uv [7, 6, 9, 8]` and `[7, 13, 9, 15]` instead of the
 * natural slice's rows 7..9. Both are 2x2 pixels: one is the lit tip seen
 * from directly above, the other is against the floor. Reproducing them means
 * a per-face UV override in `buildShapeMesh` for a two-pixel difference
 * nobody can see. Rejected; if a sign ever needs real per-face UVs, that is
 * the change to make and this is the note that says it was considered.
 */
SHAPE_BOXES.torch = [[7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16]]

/* ------------------------------------------------------------------ *
 * Wall torches, and the first shape in this file that is not axis-aligned.
 *
 * A wall torch IS a transform of a floor torch, which is the whole reason
 * this is five block ids and not a research project. Compare the fence note
 * at the bottom of the file: a fence post with two arms and one with three
 * are not related by ANY transform, so they need different vertices and noa
 * gives every voxel of an id the same vertices. Four facings of one leaning
 * torch are one shape seen from four angles, which is exactly what this file
 * already does eight times over for stairs.
 *
 * VANILLA'S NUMBERS, from `block/template_torch_wall.json` in 1.21.8's jar:
 *
 *     from [-1, 3.5, 7] to [1, 13.5, 9]
 *     rotation { origin: [0, 3.5, 8], axis: "z", angle: -22.5 }
 *
 * Three things in there are worth reading twice. The box starts at x = -1, so
 * it hangs a pixel OUT of its own cell and into the wall -- that pixel is what
 * hides the join. It is 10 tall like the floor torch but starts at y = 3.5,
 * so the torch sits higher on a wall than on a floor. And the pivot is at the
 * wall plane, at the BOTTOM of the post, so the tilt swings the flame out
 * into the room rather than sliding the whole torch sideways.
 *
 * The angle is 22.5 degrees, which is not a number to guess at: eyeballing
 * an axis-aligned approximation gets you a stick glued flat to a wall, and
 * 22.5 is one of the five angles Minecraft's model format even permits.
 *
 * FACING NAMES THE DIRECTION THE TORCH POINTS, away from the wall holding it
 * -- vanilla's convention, confirmed from `blockstates/wall_torch.json`,
 * where facing=east is the unrotated model and the unrotated model leans
 * toward +x, which is east in Minecraft. It is NOT east here; see the FACINGS
 * note above for why east is -x in this world. Deriving the geometry from the
 * FACINGS vector rather than from the name is what keeps that one decision in
 * one place.
 * ------------------------------------------------------------------ */

/** Vanilla's tilt, in degrees. */
const WALL_TORCH_TILT = 22.5

/**
 * Where a shape's mesh is rotated after it is built, keyed like SHAPE_BOXES.
 * Absent for every axis-aligned shape, which is all of them but these four.
 */
export const SHAPE_ROTATION = {}

function wallTorch(facing) {
  const d = FACINGS[facing]
  // The axis the torch points along, and which way along it.
  const a = d[0] ? 0 : 2
  const s = d[a]
  // The wall plane in block-local coordinates: 0 at the -axis face, 1 at +.
  const wall = (1 - s) / 2
  // The other horizontal axis, which the post is centred on and which the
  // tilt turns about.
  const p = a === 0 ? 2 : 0

  const lo = [0, 0, 0], hi = [0, 0, 0]
  lo[a] = wall - 1 / 16; hi[a] = wall + 1 / 16
  lo[1] = 3.5 / 16; hi[1] = 13.5 / 16
  lo[p] = 7 / 16; hi[p] = 9 / 16

  /*
   * Sign of the tilt. Both rotations are right-handed about a positive axis,
   * and the top of the post starts directly above the pivot:
   *   about z, a point at (0, h) goes to (-h sin0, h cos0) -- so to lean
   *   toward +x the angle must be NEGATIVE;
   *   about x, a point at (h, 0) goes to (h cos0, h sin0) in (y, z) -- so to
   *   lean toward +z the angle must be POSITIVE.
   * Vanilla's own model is the a=0, s=+1 case and says -22.5, which is the
   * check that this table is not mirrored.
   */
  const deg = WALL_TORCH_TILT * (a === 0 ? -s : s)
  const origin = [0.5, 3.5 / 16, 0.5]
  origin[a] = wall

  return { boxes: [[...lo, ...hi]], rotation: { axis: p, deg, origin } }
}

for (const facing of Object.keys(FACINGS)) {
  const { boxes, rotation } = wallTorch(facing)
  SHAPE_BOXES[`torch_wall_${facing}`] = boxes
  SHAPE_ROTATION[`torch_wall_${facing}`] = rotation
}

/**
 * The facing name for a block face's outward normal, or null for up and down.
 * The inverse of the FACINGS table, and the thing that turns "which face did
 * you click" into "which variant do you get".
 */
export function facingFromNormal(normal) {
  for (const [name, v] of Object.entries(FACINGS)) {
    if (v[0] === normal[0] && v[2] === normal[2]) return name
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Meshing.
 *
 * Hand-built VertexData rather than CreateBox, for two reasons that are both
 * about UVs. Minecraft cuts a cuboid's texture from the SLICE of the parent
 * block's texture that the cuboid occupies -- a bottom slab's side shows the
 * bottom half of the texture, not the whole texture squashed to half height --
 * and Babylon's box builder can only put an axis-aligned rectangle on a whole
 * face. Second, CreateBox's per-face UV orientation is inconsistent between
 * its `wrap` and non-`wrap` layouts, so "which way up is this texture" would
 * have been a per-face lookup table anyway.
 * ------------------------------------------------------------------ */

/*
 * Per face: outward normal, and the block-local axes that texture u and v
 * increase along. u runs right and v runs up as seen from OUTSIDE the block,
 * with the top face's v pointing north -- Minecraft's convention. Babylon
 * uploads textures with UNPACK_FLIP_Y, so v = 1 is the top row of the image.
 *
 * NOT TOUCHED by the terrain X flip, and worth one line so nobody goes hunting.
 * These u directions are stated in engine coordinates, and a left-handed render
 * mirrors them on screen the same way it mirrors everything else -- so every
 * side face here draws its texture left-right flipped against what vanilla
 * draws. That was true before the flip and is true after it; the flip moved
 * BLOCKS, not the UVs inside one. It is invisible on Minecraft's textures,
 * which have no text and no handed detail, and fixing it means negating the
 * x component of u on every face and rebaselining every screenshot in the
 * suite. Not worth it until something in the atlas is actually handed.
 */
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },   // +x  west
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },   // -x  east
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },   // +y  top
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },   // -y  bottom
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },    // +z  south
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },  // -z  north
]

const axisOf = (vec) => (vec[0] ? 0 : vec[1] ? 1 : 2)

/** Where a point lands on a face's u or v axis, as a 0..1 texture coord. */
const coordAlong = (p, dir) => {
  const c = p[axisOf(dir)]
  return (dir[0] + dir[1] + dir[2]) > 0 ? c : 1 - c
}

/**
 * Is this face buried inside another box of the same shape?
 *
 * Only matters for stairs, whose two boxes meet at y = 0.5. Backface culling
 * would hide the pair anyway, so this is about not paying for geometry nobody
 * can ever see rather than about correctness.
 */
function faceIsInterior(box, face, others) {
  const a = axisOf(face.n)
  const plane = face.n[a] > 0 ? box[a + 3] : box[a]
  for (const o of others) {
    if (o === box) continue
    // The neighbour must start exactly where this face ends...
    const meets = face.n[a] > 0 ? o[a] === plane : o[a + 3] === plane
    if (!meets) continue
    // ...and cover it completely on the other two axes.
    let covered = true
    for (let i = 0; i < 3; i++) {
      if (i === a) continue
      if (o[i] > box[i] || o[i + 3] < box[i + 3]) { covered = false; break }
    }
    if (covered) return true
  }
  return false
}

/**
 * Build one Babylon mesh for a shape.
 *
 * The mesh's local frame is noa's: objectMesher puts the instance origin at
 * (voxel x + 0.5, voxel y, voxel z + 0.5), so x and z run -0.5..0.5 and y runs
 * 0..1.
 *
 * EVERY CALL MUST PRODUCE A FRESH GEOMETRY. objectMesher dedupes its instance
 * managers by `mesh.geometry` identity, so two block ids sharing one geometry
 * would silently collapse into one manager and one of them would render as the
 * other. That rules out `mesh.clone()` for, say, the four facings of a stair.
 */
export function buildShapeMesh(scene, name, boxes, material, rotation = null) {
  const positions = [], normals = [], uvs = [], indices = []

  for (const box of boxes) {
    for (const face of FACES) {
      if (faceIsInterior(box, face, boxes)) continue

      const a = axisOf(face.n)
      const plane = face.n[a] > 0 ? box[a + 3] : box[a]
      const ua = axisOf(face.u), va = axisOf(face.v)

      // Corner order is [right-bottom, left-bottom, left-top, right-top] and
      // the triangles are 0-1-2 / 0-2-3, which is clockwise seen from outside
      // -- Babylon's front-face winding in its default left-handed scene.
      const uPos = face.u[ua] > 0 ? [box[ua + 3], box[ua]] : [box[ua], box[ua + 3]]
      const vPos = face.v[va] > 0 ? [box[va], box[va + 3]] : [box[va + 3], box[va]]
      const corners = [
        [uPos[0], vPos[0]], [uPos[1], vPos[0]], [uPos[1], vPos[1]], [uPos[0], vPos[1]],
      ]

      const first = positions.length / 3
      for (const [uc, vc] of corners) {
        const p = []
        p[a] = plane
        p[ua] = uc
        p[va] = vc
        positions.push(p[0] - 0.5, p[1], p[2] - 0.5)
        normals.push(face.n[0], face.n[1], face.n[2])
        uvs.push(coordAlong(p, face.u), coordAlong(p, face.v))
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3)
    }
  }

  /*
   * The tilt, applied to the finished vertices rather than to the boxes,
   * because a box list cannot hold one -- every entry in it is a min and a
   * max on three axes, which is the definition of axis-aligned.
   *
   * AND THAT IS WHY A ROTATED SHAPE MUST NOT COLLIDE. The collision resolver
   * reads the same box list this mesh was built from, so the instant the mesh
   * is turned and the boxes are not, the two have drifted -- which is the one
   * thing this file exists to prevent. The check below is the invariant
   * restated as code: you may rotate a shape only if the shape has opted out
   * of collision entirely, and blocks.js throws at registration rather than
   * shipping a torch you can trip over in a place it does not appear to be.
   *
   * The road not taken is worth a line: noa's `onCustomMeshCreate` hands out
   * a TransformNode per voxel, so the rotation COULD live there instead of in
   * the vertices. It would be the same pixels and one more moving part, and
   * it would make the mesh a lie about itself -- `buildShapeMesh` would hand
   * back geometry that is only correct once somebody else turns it.
   */
  if (rotation) rotateVertices(positions, normals, rotation)

  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = positions
  data.normals = normals
  data.uvs = uvs
  data.indices = indices
  data.applyToMesh(mesh)
  mesh.material = material
  return mesh
}

/**
 * Turn a finished vertex list about one axis-aligned axis, in place.
 *
 * Positions rotate about `origin`; normals rotate about nothing, because a
 * direction has no position -- rotating them about the origin too would move
 * them off the unit sphere and light the faces wrong.
 */
function rotateVertices(positions, normals, { axis, deg, origin }) {
  const rad = (deg * Math.PI) / 180
  const sin = Math.sin(rad), cos = Math.cos(rad)
  // The two axes that MOVE, in right-handed order, for each axis of rotation.
  const [i, j] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1]
  // Mesh space is block space shifted: x and z run -0.5..0.5, y runs 0..1.
  const o = [origin[0] - 0.5, origin[1], origin[2] - 0.5]

  for (let k = 0; k < positions.length; k += 3) {
    const u = positions[k + i] - o[i], v = positions[k + j] - o[j]
    positions[k + i] = o[i] + u * cos - v * sin
    positions[k + j] = o[j] + u * sin + v * cos
    const nu = normals[k + i], nv = normals[k + j]
    normals[k + i] = nu * cos - nv * sin
    normals[k + j] = nu * sin + nv * cos
  }
}

/**
 * One Babylon material per texture NAME, shared across every shape that uses
 * it -- 10 oak stair/slab variants are 10 meshes but one material.
 *
 * Road not taken: noa's own paged atlas material, which would have made these
 * pixel-identical to terrain and cost zero extra texture fetches. It is not
 * reachable: `TerrainMatManager` and the Babylon material plugin that samples
 * the atlas are both closure-private inside noa's terrainMesher, and its
 * materials are created lazily while terrain meshes, so there is nothing to
 * ask for at registration time. The per-name 16x16 PNGs used here are already
 * emitted by the build for blockIcon.js's CSS cubes.
 *
 * Note this means non-cube blocks add ZERO layers to the paged atlas. The
 * 128-layers-per-page budget is untouched by anything in this file.
 *
 *
 * CUTOUT, THE SECOND KIND OF MATERIAL, and it is a general capability rather
 * than one block's special case.
 *
 * Every material this cache made used to be opaque, because every shape in
 * this file was a solid cuboid of a solid block's texture. A torch is not: it
 * is a 16x16 sprite that is mostly nothing, and drawn opaque the nothing is a
 * black rectangle with a torch in it. The same is true of the NEXT non-cube
 * this file gets -- docs/FUTURE.md item 1 is signs, whose texture is a plank
 * on a post and transparent everywhere else -- so the flag lives on the cache
 * and any shape can ask for it.
 *
 * Asking is opt-IN, and that is the load-bearing half: the cache is shared by
 * all 280 slab and stair variants, and a cutout flag set on the cache instead
 * of per call would have quietly moved every one of them onto the alpha path.
 * The cache key carries the flag, so `materialFor('torch', { cutout: true })`
 * and `materialFor('torch')` are two different materials and neither can be
 * handed out in place of the other.
 *
 * CUTOUT, NOT BLEND, and blocks.js's installAlphaPageMaterials note is the
 * long version: `diffuseTexture.hasAlpha` alone buys alpha TESTING -- the
 * shader compiles ALPHATEST and discards any texel under `alphaCutOff` (0.4)
 * -- and leaves everything that survives fully opaque. That is exactly right
 * for art whose alpha is only ever 0 or 255, which is what a torch sprite is.
 * It also costs no depth sorting, which blending would, and a blended torch
 * seen through another blended torch is a sorting bug waiting to be reported.
 *
 * `useAlphaFromDiffuseTexture` is therefore deliberately NOT set here; that is
 * the flag that turns the same texture into a blend, and water is the only
 * material in this world that wants it.
 *
 * backFaceCulling off, because a cutout shape is thin enough to see the inside
 * of. A torch is a 2x2 pixel post: stand beside one and the far face is what
 * you are looking at through the near face's discarded texels.
 */
export function createMaterialCache(noa) {
  const scene = noa.rendering.getScene()
  // noa prefixes this onto every material's textureURL; reuse it so both
  // paths agree about where textures live.
  const path = noa.registry._texturePath ?? '/textures/'
  const cache = new Map()
  return (textureName, { cutout = false } = {}) => {
    const key = cutout ? `${textureName}|cutout` : textureName
    let mat = cache.get(key)
    if (mat) return mat
    mat = noa.rendering.makeStandardMaterial(`noncube-${key}`)
    // NEAREST, or 16x16 pixel art turns to soup the moment it is minified.
    const tex = new Texture(
      `${path}${textureName}.png`, scene, false, false, Texture.NEAREST_SAMPLINGMODE)
    mat.diffuseTexture = tex
    if (cutout) {
      tex.hasAlpha = true
      mat.backFaceCulling = false
    }
    mat.freeze()
    cache.set(key, mat)
    return mat
  }
}

/**
 * Force noa's thin-instance buffers to actually reach the GPU.
 *
 * THIS IS A WORKAROUND FOR A BUG IN noa + Babylon 6.49, and without it half
 * the non-cube blocks in the world are invisible.
 *
 * objectMesher allocates a matrix buffer at capacity 8 and hands it to Babylon
 * BEFORE writing any instance into it, then relies on
 * `mesh.thinInstanceBufferUpdated('matrix')` to push the real matrices up
 * afterwards. On Babylon 6.49 that call does nothing observable: the GPU keeps
 * the zeroed buffer from the first upload. The only reason this isn't obvious
 * in noa's own demos is that it self-corrects once the instance count passes 8
 * -- growing the buffer re-uploads it -- so a wall of a hundred slabs looks
 * fine and a single slab is invisible.
 *
 * Measured, since the symptom is baffling on its own: one brick slab placed
 * alone rendered nothing at all; eleven more placed beside it made all twelve
 * appear at once.
 *
 * Re-setting the buffer is what re-uploads it. `thinInstanceSetBuffer` also
 * resets the instance count to the buffer's capacity, so the live count has to
 * be put back or the seven unused slots draw as ghost blocks at the origin.
 *
 * Rejected: calling `thinInstanceBufferUpdated` a second time (measured: no
 * effect), and patching noa in node_modules (invisible to anyone who reinstalls).
 */
export function installThinInstanceUploadFix(noa) {
  const mesher = noa._objectMesher
  const original = mesher.buildObjectMeshes.bind(mesher)

  mesher.buildObjectMeshes = () => {
    original()
    for (const mesh of mesher.allBaseMeshes) {
      const count = mesh?.thinInstanceCount
      if (!count) continue
      const data = mesh._thinInstanceDataStorage?.matrixData
      if (!data) continue
      mesh.thinInstanceSetBuffer('matrix', data)
      mesh.thinInstanceCount = count
    }
  }
}

/* ------------------------------------------------------------------ *
 * Collision.
 * ------------------------------------------------------------------ */

/*
 * THE OPT-OUT, and read the invariant it is opting out of first.
 *
 * One box list drives BOTH the mesh and the collision. That is the whole
 * reason this file exists -- "the stairs render one way and collide another"
 * is the bug it was written to make impossible -- and nothing below weakens
 * it for slabs, for stairs, or for anything that arrives later and says
 * nothing.
 *
 * But some shapes are not things you bump into. You walk THROUGH a torch in
 * Minecraft, and through a sign, and through a flower; vanilla gives all
 * three an empty collision shape while drawing them in full. So the opt-out
 * is not "this shape's boxes are different from its mesh" -- that is the
 * drift the invariant forbids -- it is "this shape has NO collision at all".
 * A shape either collides as exactly what it looks like, or it does not
 * collide. There is no third answer here and there should not be one.
 *
 * Declared per SHAPE KEY rather than per block id, so it is a fact about the
 * geometry (a torch is a torch) rather than a list blocks.js has to remember
 * to keep in step. blocks.js turns the keys into ids in the same loop that
 * builds shapeById, and hands them here.
 *
 * NOT non-solid: these blocks stay in `shapeById`, so blocks.js's
 * `blockTargetIdCheck` still lets the crosshair land on one and you can still
 * mine it. What they leave is the physics resolver and `shapeBoxesFor`, which
 * is also what dropped items sweep against -- an item that landed on top of a
 * torch would be resting on nothing.
 *
 * Signs are next and will be in this set for the same reason (docs/FUTURE.md
 * item 1). It is a capability of the file, not a torch's special case.
 */
export const PASS_THROUGH_SHAPES = new Set([
  'torch', 'torch_wall_north', 'torch_wall_south', 'torch_wall_east', 'torch_wall_west',
])

/** Minecraft's player step height: onto a slab, never onto a full block. */
const STEP_HEIGHT = 0.6

/*
 * Slop, in blocks. Big enough to swallow the float error in a player who has
 * been resting on y = 64.5 for a thousand ticks, small enough to be invisible.
 */
const EPS = 1e-4

/*
 * Cap on how far a single tick's sweep is allowed to scan. A player falling
 * the full height of the island tops out near two blocks per tick, so this is
 * pure insurance against a teleport turning one tick into a million voxel
 * reads.
 */
const MAX_SCAN = 32

const overlaps = (aMin, aMax, bMin, bMax) => aMin < bMax - EPS && aMax > bMin + EPS

/**
 * Every sub-box of every non-cube block intersecting a region, in noa's LOCAL
 * (origin-rebased) coordinates -- the same frame the physics bodies live in.
 */
function collectBoxes(noa, shapeById, lo, hi, out) {
  out.length = 0
  const off = noa.worldOriginOffset
  const world = noa.world
  for (let i = 0; i < 3; i++) {
    if (hi[i] - lo[i] > MAX_SCAN) return out
  }
  for (let x = lo[0]; x <= hi[0]; x++) {
    for (let y = lo[1]; y <= hi[1]; y++) {
      for (let z = lo[2]; z <= hi[2]; z++) {
        const id = world.getBlockID(x + off[0], y + off[1], z + off[2])
        const boxes = shapeById[id]
        if (!boxes) continue
        for (const b of boxes) {
          out.push([x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]])
        }
      }
    }
  }
  return out
}

const boxIntersectsBody = (b, base, max) =>
  overlaps(base[0], max[0], b[0], b[3]) &&
  overlaps(base[1], max[1], b[1], b[4]) &&
  overlaps(base[2], max[2], b[2], b[5])

/** Would the body, moved to this Y, be clear of every sub-box and of terrain? */
function fitsAt(noa, boxes, base, max, y) {
  const lo = [base[0], y, base[2]]
  const hi = [max[0], y + (max[1] - base[1]), max[2]]
  for (const b of boxes) {
    if (boxIntersectsBody(b, lo, hi)) return false
  }
  // Full cubes are still noa's, so ask noa -- and ask through the live
  // `testSolid`, so a spectator's noclip override is honoured here too.
  const solid = noa.physics.testSolid
  for (let x = Math.floor(lo[0]); x <= Math.floor(hi[0] - EPS); x++) {
    for (let y2 = Math.floor(lo[1]); y2 <= Math.floor(hi[1] - EPS); y2++) {
      for (let z = Math.floor(lo[2]); z <= Math.floor(hi[2] - EPS); z++) {
        if (solid(x, y2, z)) return false
      }
    }
  }
  return true
}

/**
 * The top of the sub-box the body is standing on, or null.
 *
 * "Standing on" is a box whose top is exactly underfoot, which is the one
 * shape all three ways of getting there share: landing on it, being stepped
 * up onto it, and having simply not moved since last tick.
 */
function findSupport(boxes, base, max) {
  for (const b of boxes) {
    if (Math.abs(b[4] - base[1]) > EPS) continue
    if (!overlaps(base[0], max[0], b[0], b[3])) continue
    if (!overlaps(base[2], max[2], b[2], b[5])) continue
    return b[4]
  }
  return null
}

/**
 * Resolve one body against the sub-boxes, given where it was before noa moved
 * it. Mutates the body's AABB, velocity and resting flags exactly as
 * voxel-physics-engine's own collision pass would, and returns the height of
 * the sub-box it ends up standing on (or null).
 */
function resolveBody(noa, shapeById, body, prevBase, scratch) {
  const box = body.aabb
  const base = box.base, max = box.max

  /*
   * The -EPS on `lo` is load-bearing, not defensive rounding. A body standing
   * on a stair's upper step rests at a whole number, and the box holding it up
   * lives in the voxel BELOW that number -- so flooring the feet exactly would
   * scan from the voxel above its own support and conclude it was in mid-air.
   * The symptom was a player who climbed two steps and then refused the third.
   */
  const lo = [
    Math.floor(Math.min(base[0], prevBase[0]) - EPS),
    Math.floor(Math.min(base[1], prevBase[1]) - EPS),
    Math.floor(Math.min(base[2], prevBase[2]) - EPS),
  ]
  const hi = [
    Math.floor(Math.max(max[0], prevBase[0] + box.vec[0]) - EPS),
    Math.floor(Math.max(max[1], prevBase[1] + box.vec[1]) - EPS),
    Math.floor(Math.max(max[2], prevBase[2] + box.vec[2]) - EPS),
  ]
  const boxes = collectBoxes(noa, shapeById, lo, hi, scratch)
  if (boxes.length === 0) return null

  const shift = (axis, d) => { base[axis] += d; max[axis] += d }

  /*
   * 1. Vertical, SWEPT rather than by penetration depth.
   *
   * Penetration alone would let a fast fall tunnel straight through a slab:
   * at 50 blocks/sec a tick moves nearly two blocks and the half-block target
   * is simply never overlapped on any frame we look at. Comparing where the
   * feet WERE against where they are now catches the crossing regardless of
   * speed, which is the same thing voxel-aabb-sweep does for whole cubes.
   */
  const dy = base[1] - prevBase[1]
  if (dy < 0) {
    let landing = -Infinity
    for (const b of boxes) {
      if (!overlaps(base[0], max[0], b[0], b[3])) continue
      if (!overlaps(base[2], max[2], b[2], b[5])) continue
      if (b[4] <= prevBase[1] + EPS && b[4] > base[1] - EPS) landing = Math.max(landing, b[4])
    }
    if (landing > -Infinity) {
      shift(1, landing - base[1])
      body.velocity[1] = 0
      body.resting[1] = -1
    }
  } else if (dy > 0) {
    let ceiling = Infinity
    const prevTop = prevBase[1] + box.vec[1]
    for (const b of boxes) {
      if (!overlaps(base[0], max[0], b[0], b[3])) continue
      if (!overlaps(base[2], max[2], b[2], b[5])) continue
      if (b[1] >= prevTop - EPS && b[1] < max[1] + EPS) ceiling = Math.min(ceiling, b[1])
    }
    if (ceiling < Infinity) {
      shift(1, ceiling - max[1])
      body.velocity[1] = 0
      body.resting[1] = 1
    }
  }

  /*
   * Grounded state has to be settled BEFORE the horizontal pass, because
   * that is what decides whether a step is climbed or walked into. It cannot
   * wait until the end: a body held up by the normal force below never moves
   * vertically at all, so neither branch above fires and `resting[1]` would
   * still read as airborne -- which is exactly the bug that made a player on
   * a slab refuse to step onto the stair in front of them.
   */
  if (findSupport(boxes, base, max) !== null) body.resting[1] = -1

  /*
   * 2. Horizontal, by penetration -- and this is where stairs are climbed.
   *
   * Horizontal speed is bounded by sprinting (5.6 blocks/sec, under a fifth of
   * a block per tick), so there is nothing to tunnel through and penetration
   * depth is both simpler and stabler than a second sweep.
   *
   * The loop runs a few times because resolving against one box can push the
   * body into another -- an inside corner of two stairs is the ordinary case.
   */
  for (let pass = 0; pass < 4; pass++) {
    let hit = null
    let worst = 0
    for (const b of boxes) {
      if (!boxIntersectsBody(b, base, max)) continue
      // Pick the deepest intrusion, so a graze never wins over a real wall.
      const depth = Math.min(max[0] - b[0], b[3] - base[0], max[2] - b[2], b[5] - base[2])
      if (depth > worst) { worst = depth; hit = b }
    }
    if (!hit) break

    // Step up, if this is a step and not a wall. Minecraft allows it whenever
    // the rise is within the step height; requiring `resting[1] < 0` as well
    // keeps a jump from being converted into a free climb mid-air.
    const rise = hit[4] - base[1]
    if (body.resting[1] < 0 && rise > EPS && rise <= STEP_HEIGHT &&
        fitsAt(noa, boxes, base, max, hit[4])) {
      shift(1, rise)
      continue
    }

    // Otherwise push out along whichever horizontal axis is least buried.
    // Four candidate escapes, signed: negative moves the body toward -axis.
    const outs = [
      { axis: 0, d: hit[0] - max[0] }, { axis: 0, d: hit[3] - base[0] },
      { axis: 2, d: hit[2] - max[2] }, { axis: 2, d: hit[5] - base[2] },
    ]
    let best = outs[0]
    for (const o of outs) if (Math.abs(o.d) < Math.abs(best.d)) best = o
    shift(best.axis, best.d)
    body.velocity[best.axis] = 0
    body.resting[best.axis] = best.d > 0 ? -1 : 1
  }

  // 3. Asked again, because a step-up moved the body onto a different box.
  const support = findSupport(boxes, base, max)
  if (support !== null) body.resting[1] = -1
  return support
}

/**
 * The lateral friction noa would have derived from a tick of gravity.
 *
 * Copied from voxel-physics-engine's applyFrictionByAxis, because supplying
 * the normal force (see below) removes the very velocity change noa computes
 * standing friction from -- without this you would coast across a slab floor
 * like ice the moment you let go of the key.
 */
function applyStandingFriction(body, dvFromGravity) {
  if (!body.friction) return
  const dvMax = Math.abs(body.friction * dvFromGravity)
  const vCurr = Math.hypot(body.velocity[0], body.velocity[2])
  if (vCurr < 1e-5) return
  const scaler = vCurr > dvMax ? (vCurr - dvMax) / vCurr : 0
  body.velocity[0] *= scaler
  body.velocity[2] *= scaler
}

/**
 * Wrap noa's physics step so non-cube blocks collide.
 *
 * @param {*} noa
 * @param {any[]} shapeById sparse array: block id -> boxes, or undefined
 */
/*
 * The shape table, captured at install so other systems can ask about real
 * solidity rather than noa's boolean.
 *
 * noa's registry answers `getBlockSolidity(id)` with a boolean, and non-cube
 * blocks register as NOT solid so noa's own sweep leaves them alone. Anything
 * else doing its own collision -- dropped items, for one -- would otherwise
 * see a staircase as empty air and fall straight through it.
 */
let shapeLookup = []

/**
 * The sub-boxes a block id COLLIDES as: undefined for cubes, for air, and for
 * a pass-through shape, which is drawn and never bumped into.
 */
export const shapeBoxesFor = (id) => shapeLookup[id]

/**
 * @param {*} noa
 * @param {any[]} shapeById sparse array: block id -> boxes, or undefined
 * @param {Set<number>} passThrough ids whose shape is drawn but never collided
 */
export function installNonCubeCollision(noa, shapeById, passThrough = new Set()) {
  /*
   * The collision view of the one table. Holes for the pass-through ids and
   * the SAME array instances for everyone else -- a copy of the boxes would
   * be a second place for a shape to live, which is the drift the whole file
   * is guarding against.
   */
  const collideById = shapeById.map((boxes, id) => (passThrough.has(id) ? undefined : boxes))
  shapeLookup = collideById
  const physics = noa.physics
  const originalTick = physics.tick.bind(physics)

  /*
   * physics.js's spectator noclip works by swapping `noa.physics.testSolid`
   * for one that says nothing is solid. That is the whole of noclip, and it
   * would leave a spectator stopped dead by a slab unless we notice. Comparing
   * against the function we captured is the cheapest honest test for "someone
   * else is driving solidity now".
   */
  const realSolidTest = physics.testSolid

  const prev = new WeakMap()
  /** body -> the sub-box top it was resting on at the end of the last tick. */
  const support = new WeakMap()
  const propped = new Set()
  const scratch = []

  physics.tick = (dt) => {
    propped.clear()
    for (const body of physics.bodies) {
      let p = prev.get(body)
      if (!p) prev.set(body, p = [0, 0, 0])
      p[0] = body.aabb.base[0]
      p[1] = body.aabb.base[1]
      p[2] = body.aabb.base[2]

      /*
       * THE NORMAL FORCE, and the subtlest thing in this file.
       *
       * Correcting after the fact is not enough on its own. noa still runs a
       * full tick of gravity first, so a body standing on a slab dips ~0.035
       * blocks into the voxel below before we put it back -- and during that
       * dip noa's OWN cube sweep is running. Any solid block flush under the
       * surface you are standing on (the wall under a staircase, the stone
       * beside a top slab) is then a wall at ankle height, and you stop dead
       * against thin air. Measured: a player climbing a supported staircase
       * froze at exactly the voxel boundary, every time.
       *
       * So instead of letting the dip happen and fixing it, don't let it
       * happen: a body resting on a sub-box gets the upward force its support
       * is exerting on it, which is what a floor physically does and what noa
       * does implicitly for solid voxels. Net vertical acceleration is zero
       * and the body holds its exact height through the sweep.
       *
       * NOT applied when an upward impulse is pending, which is the tick a
       * jump launches. The jump impulse in physics.js is CALIBRATED against
       * one tick of gravity being applied at launch (see its comment);
       * cancelling gravity on that tick would quietly raise every jump apex
       * and break the parkour the whole world is designed around.
       */
      const h = support.get(body)
      if (h === undefined || body.mass <= 0) continue
      if (Math.abs(body.aabb.base[1] - h) > EPS) continue
      if (body.velocity[1] > 0 || body._impulses[1] > 0) continue
      body.velocity[1] = 0
      body.applyForce([0, -physics.gravity[1] * body.gravityMultiplier * body.mass, 0])
      propped.add(body)
    }

    originalTick(dt)

    if (physics.testSolid !== realSolidTest) return
    const dvFromGravity = physics.gravity[1] * (dt / 1000)
    for (const body of physics.bodies) {
      if (body.mass <= 0) continue
      const h = resolveBody(noa, collideById, body, prev.get(body), scratch)
      if (h === null) support.delete(body)
      else support.set(body, h)
      if (propped.has(body)) applyStandingFriction(body, dvFromGravity * body.gravityMultiplier)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Placement orientation.
 *
 * Stairs and slabs are only worth having if placing one puts it the way you
 * meant. That decision belongs to the code that handles a right-click, which
 * is interact.js -- and interact.js has no concept of a block with variants
 * and isn't this change's to edit. So the rewrite happens at the other end,
 * in `noa.setBlock`, which is the single funnel every placement passes
 * through (interact.js -> authority.js -> main.js's world adapter -> here).
 *
 * The cost of doing it here rather than at the click: `/setblock` and `/fill`
 * go through the same funnel, so filling a region with stairs orients them all
 * to wherever you happen to be looking. That is odd but harmless, and only the
 * FAMILY'S CANONICAL ID is rewritten -- a specific variant passes through
 * untouched, so importing a real Minecraft build (which is the point of all
 * this) can address every state directly.
 * ------------------------------------------------------------------ */

const TWO_PI = Math.PI * 2

/*
 * Player heading -> cardinal direction. noa's forward is (sin h, 0, cos h),
 * so the quarter turns are +Z, +X, -Z, -X and the names are this world's:
 * south, west, north, east. See the FACINGS table above for why +X is west,
 * and change the two together or not at all.
 *
 * This is the same table as `FACING` in main.js and `FACINGS` in
 * debugScreen.js. Reported rather than merged: the three answer different
 * questions (which shape to place, who is facing where in the roster, what to
 * print on F3) and folding them into one export would couple a rendering
 * detail to a HUD string. They now at least AGREE, which they did not before.
 */
function headingToFacing(heading) {
  const h = ((heading % TWO_PI) + TWO_PI) % TWO_PI
  const octant = Math.round(h / (Math.PI / 2)) % 4
  return ['south', 'west', 'north', 'east'][octant]
}

/**
 * Which half a slab or stair lands in, from the face that was clicked and
 * where on it. Minecraft's rule exactly: the top face gives you a bottom
 * slab, the bottom face gives you a top slab, and a side face splits on
 * whether you clicked above or below its midpoint.
 */
function halfFromTarget(normal, hitY) {
  if (normal[1] > 0) return 'bottom'
  if (normal[1] < 0) return 'top'
  return (hitY - Math.floor(hitY)) > 0.5 ? 'top' : 'bottom'
}

/**
 * @param {*} noa
 * @param {Map<number, (facing: string, half: string, normal: number[]) => number>} variantOf
 *        canonical block id -> resolver for the id to place instead
 *
 * The resolver gets the clicked face's NORMAL as well, because not every
 * family picks its variant from the same thing. A stair takes its facing from
 * where the player is LOOKING (vanilla: you build a staircase by walking up
 * it, not by aiming at a wall); a torch takes it from the face you clicked,
 * because the face is the wall it hangs on. Both answers are the same
 * question asked of different data, so both are passed and each family reads
 * the one it means.
 */
export function installPlacementOrientation(noa, variantOf) {
  const originalSetBlock = noa.setBlock.bind(noa)

  noa.setBlock = (id, x, y, z) => {
    const resolve = variantOf.get(id)
    if (!resolve) return originalSetBlock(id, x, y, z)

    const target = noa.targetedBlock
    // No target means this came from a command, not a click. Face the way the
    // player is looking and put it in the bottom half, which is what vanilla's
    // /setblock defaults to.
    const normal = target ? target.normal : [0, 1, 0]
    // `_pickResult.position` is the precise hit point from the pick that
    // produced `targetedBlock` this tick -- the sub-voxel detail that
    // `targetedBlock` itself rounds away.
    const hitY = target ? noa._pickResult.position[1] : 0

    const facing = headingToFacing(noa.camera.heading)
    return originalSetBlock(
      resolve(facing, halfFromTarget(normal, hitY), normal), x, y, z)
  }
}

/* ------------------------------------------------------------------ *
 * Attachment: the blocks that need something to hold them up.
 *
 * THE FIRST NEIGHBOUR-DEPENDENT BEHAVIOUR IN THIS WORLD, and it is worth
 * being precise about how that differs from the fence problem at the bottom
 * of this file. A fence needs neighbour-dependent GEOMETRY -- what it looks
 * like changes when something is built next to it, which noa cannot express
 * because every voxel of an id shares one mesh. A torch needs
 * neighbour-dependent EXISTENCE: it looks the same forever and simply stops
 * being there when its wall goes. Nothing about the mesh changes, so nothing
 * about the engine's one-mesh-per-id rule is in the way.
 *
 * Vanilla calls this `canSurvive`, checks it on every neighbour update, and
 * on a false answer breaks the block and drops it. This is that, narrowed to
 * the one shape of support a torch has: ONE neighbour, at a fixed offset.
 * A sign on a wall is the same shape of rule and will reuse this; a sugar
 * cane that wants "water within one block" is not, and would want its own.
 *
 * IT DROPS, it does not vanish. That is the whole reason the break goes
 * through a callback instead of a bare `setBlock(0)`: the caller hands us the
 * authority's own break path, so the torch pops as an item exactly the way a
 * mined one does, honours creative's no-drops rule, and is announced to every
 * listener that cares. Writing air here would have been one line and would
 * have eaten the torch.
 *
 * IT ALSO VALIDATES PLACEMENT, and that was not extra code. The sweep runs
 * after every write, not only after a break, so a torch placed where nothing
 * can hold it is taken back off in the same breath -- which is what makes
 * "click a ceiling with a torch" behave when the placement seam has no way to
 * say no. One rule, both directions.
 *
 * WHAT COUNTS AS SUPPORT is noa's own solidity, which means a full cube. That
 * is narrower than vanilla, where a torch stands on a bottom slab's sturdy
 * top face; here a slab is registered non-solid (the whole reason this file
 * has a collision resolver at all) and a torch will not stay on one. Named
 * rather than hidden: the fix is a "does this shape fill the face I need"
 * question asked of SHAPE_BOXES, and it is not worth building until something
 * asks for it.
 * ------------------------------------------------------------------ */

/** The six neighbours, in the order the sweep visits them. */
const NEIGHBOURS = [
  [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
]

/**
 * @param {*} noa
 * @param {Map<number, number[]>} supportOffset block id -> the [dx,dy,dz] of
 *        the neighbour that must be solid for it to stay
 * @param {(x: number, y: number, z: number) => void} breakBlock how to take one
 *        off the world so that it DROPS -- the authority's break path
 */
export function installAttachment(noa, supportOffset, breakBlock) {
  if (supportOffset.size === 0) return
  const originalSetBlock = noa.setBlock.bind(noa)
  const solid = noa.registry.getBlockSolidity.bind(noa.registry)

  /** Is the block at these coordinates still held up? */
  const supported = (x, y, z) => {
    const off = supportOffset.get(noa.getBlock(x, y, z))
    if (!off) return true
    return solid(noa.getBlock(x + off[0], y + off[1], z + off[2]))
  }

  /*
   * Re-entrancy is real and is not a hypothetical: `breakBlock` goes back
   * through the authority, which comes back through `noa.setBlock`, which is
   * this function. The guard keeps one sweep running at a time and lets the
   * inner write land without starting a second one -- the outer sweep has
   * not finished its six neighbours yet and will see the result anyway.
   */
  let sweeping = false

  noa.setBlock = (id, x, y, z) => {
    const result = originalSetBlock(id, x, y, z)
    if (sweeping) return result
    sweeping = true
    try {
      // The block just written (did we place a torch on nothing?) and then
      // the six around it (did we take something's wall away?).
      if (!supported(x, y, z)) breakBlock(x, y, z)
      for (const [dx, dy, dz] of NEIGHBOURS) {
        if (!supported(x + dx, y + dy, z + dz)) breakBlock(x + dx, y + dy, z + dz)
      }
    } finally {
      sweeping = false
    }
    return result
  }
}

/* ------------------------------------------------------------------ *
 * Why there are no fences, walls, panes or bars here.
 *
 * Those four connect to their neighbours, and a connection is different
 * GEOMETRY, not a different transform. noa draws every voxel of a block id as
 * a thin instance of one shared mesh: objectMesher's `onCustomMeshCreate` hook
 * hands you a TransformNode, so position, rotation and scale can vary per
 * voxel and vertices cannot. A fence post with two arms and a fence post with
 * three are not related by any transform.
 *
 * That leaves three ways out, and all three are a bigger project than this one:
 *
 *   - 16 block ids per fence material, one per connection bitmask, rebuilt on
 *     every neighbour change. The ids are affordable; the rewriting is not,
 *     because block ids are save data and a fence would change id whenever
 *     something was built next to it.
 *   - A parallel instanced-mesh system outside noa, driven by the registry's
 *     onSet/onUnset/onLoad/onUnload handlers. Workable, and it has to
 *     reimplement objectMesher's origin rebasing -- noa shifts every instance
 *     matrix when the player wanders 25 blocks from the origin and offers no
 *     hook to shift ours with them.
 *   - Ship them unconnected. A lone post looks like a stick and a lone pane
 *     looks like a pane; a run of either looks broken.
 *
 * Stairs and slabs need none of that, which is why they are what shipped.
 * ------------------------------------------------------------------ */
