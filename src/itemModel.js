import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { item } from './items.js'

/*
 * The extruded item model: how a stick, an ingot or a diamond axe becomes
 * geometry.
 *
 * Minecraft does NOT draw a held item as a flat quad. `ItemModelGenerator`
 * (the baker behind the `builtin/generated` parent that every `item/generated`
 * and `item/handheld` model inherits) EXTRUDES the 16x16 sprite: a front quad,
 * a back quad one model unit behind it, and a rim quad on every edge where an
 * opaque pixel touches a transparent one. That rim is the whole point. It is
 * what makes a sword read as an object rather than a decal when you turn it
 * edge-on, and it is why the pixel staircase along a diamond axe's blade has
 * visible thickness.
 *
 * Every number below is from the real thing, not from eyeballing:
 *
 *   assets/minecraft/models/item/generated.json  -> "parent": "builtin/generated"
 *   ItemModelGenerator.processFrames
 *     MIN_Z = 7.5F, MAX_Z = 8.5F
 *     new BlockElement(new Vector3f(0, 0, 7.5F), new Vector3f(16, 16, 8.5F), ...)
 *     faces: SOUTH uvs (0, 0, 16, 16), NORTH uvs (16, 0, 0, 16)
 *
 * So the slab is ONE model unit thick -- 1/16 of a block -- centred on the
 * block's own z midpoint of 8. The front (SOUTH, +Z in Minecraft) is the face
 * the GUI camera sees; the back (NORTH) has its U range reversed so that both
 * faces show the SAME texel at the same model (x, y), rather than a mirror
 * image. Reproduced here, because a sword whose far side is mirrored looks
 * fine until you rotate it and the blade jumps sides.
 *
 * TEXTURE ORIENTATION, from the explicit flip in createSideElements:
 *
 *     startY *= yScale;  startY = 16.0F - startY;
 *
 * with no matching flip on x. Texture row 0 (the top) is model y = 16, and
 * texture column 0 is model x = 0. Confirmed independently by FaceBakery's
 * default SOUTH uv for this element, which comes out byte-identical to the
 * SOUTH_FACE_UVS constant above.
 *
 * TWO DELIBERATE DIVERGENCES FROM VANILLA, both recorded rather than silent:
 *
 * 1. Rim normals point OUTWARD. Vanilla's SpanFacing enum maps LEFT to
 *    Direction.EAST and RIGHT to Direction.WEST -- inverted, so vanilla's left
 *    rim quads carry a +X normal. That is a real vanilla bug, unchanged from
 *    1.8.9 through 26.x, and it only ever affected directional shading. Here
 *    it would be visible: this scene has one directional light plus an
 *    emissive floor, and an inward normal makes one side of every tool read as
 *    a black stripe. Positions are vanilla's exactly; only the normals differ.
 *
 * 2. Rim UVs sample the PIXEL CENTRE along the depth axis. Vanilla emits a
 *    degenerate UV -- both v coordinates equal the pixel's own edge -- which
 *    with NEAREST sampling lands exactly on a texel boundary and picks a side
 *    by floating-point luck. Half a texel in is the same intent with no coin
 *    flip. (1.21.9 came to the same conclusion and added a 0.1px inset.)
 *
 * WHAT THIS IS NOT: one box per opaque pixel. That is up to 256 boxes and
 * 1536 quads for a sprite that needs about 50. Vanilla merges each rim into
 * runs (its `Span` type) and so does this -- see `rimQuads` below. The other
 * rejected option was a quad per opaque pixel on the front and back faces
 * too; vanilla uses one full 16x16 quad per side and lets the alpha test cut
 * the silhouette out, which is both fewer triangles and exactly right.
 */

/**
 * Alpha at or above this counts as solid, for BOTH the rim scan and the
 * material's alpha test. One constant on purpose: if the geometry's silhouette
 * and the shader's cutout disagree, you get rim quads standing in mid-air
 * beside pixels that were discarded.
 *
 * Vanilla's SpriteContents.isTransparent tests alpha == 0, which would leave a
 * rim around every antialiased pixel in a texture pack that has them.
 */
const SOLID_ALPHA = 128

/** ItemModelGenerator's MIN_Z/MAX_Z, in blocks, either side of the centre. */
const HALF_DEPTH = 0.5 / 16

/*
 * WINDING, derived rather than guessed, because getting it backwards makes a
 * mesh that vanishes from one side and is lit inside out from the other.
 *
 * Babylon's own CreatePlane is the reference: positions (-1,-1,0) (1,-1,0)
 * (1,1,0) with indices [0,1,2] and normal (0,0,-1). The right-handed cross
 * (p1-p0) x (p2-p0) of that triangle is +Z -- the OPPOSITE of its normal. So a
 * front-facing quad is one whose right-handed cross product points AWAY from
 * the outward normal, which is what "left-handed" means here.
 *
 * Each face below therefore lists its two in-plane step directions (a, b) such
 * that a x b = -n, and emits p0, p0+a, p0+a+b, p0+b.
 */

/**
 * Extrude a 16x16 (or any w x h) RGBA sprite into vertex arrays.
 *
 * Pure and engine-free: takes raw pixels, returns plain arrays. That is what
 * lets the same code be measured offline against all 96 sprites without a
 * browser, and it is the only reason the quad counts in the commit message are
 * trustworthy.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba tightly packed, 4 bytes per pixel
 * @returns {{positions:number[], normals:number[], uvs:number[], indices:number[], quads:number}}
 */
function extrudeSprite(rgba, width, height) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  let quads = 0

  const solid = (x, y) => {
    // Out of bounds is transparent, exactly as vanilla's isTransparent does,
    // which is what puts a rim around the outside edge of a full-bleed sprite.
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    return rgba[(y * width + x) * 4 + 3] >= SOLID_ALPHA
  }

  // Model space, in blocks, centred on the origin. The -0.5 shift that
  // ItemTransform.apply does last is baked in here instead: the transforms
  // that use this mesh are expressed about its centre anyway, and a mesh whose
  // origin is its centre is the one Babylon wants for scaling and rotation.
  const px = (x) => x / width - 0.5
  const py = (y) => 0.5 - y / height
  // v is measured from the BOTTOM because the texture is uploaded with
  // invertY -- the same convention playerModel.js documents and verified.
  const pu = (x) => x / width
  const pv = (y) => 1 - y / height

  const quad = (p, u) => {
    const base = positions.length / 3
    // Right-handed cross of the first triangle, negated: see WINDING above.
    const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2]
    const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2]
    let nx = -(ay * bz - az * by)
    let ny = -(az * bx - ax * bz)
    let nz = -(ax * by - ay * bx)
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len

    for (let i = 0; i < 4; i++) {
      positions.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
      normals.push(nx, ny, nz)
      uvs.push(u[i * 2], u[i * 2 + 1])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    quads++
  }

  const zF = -HALF_DEPTH   // Minecraft's SOUTH face, the one facing the viewer
  const zB = HALF_DEPTH    // NORTH

  const x0 = px(0), x1 = px(width), yB = py(height), yT = py(0)
  const u0 = 0, u1 = 1, v0 = 0, v1 = 1

  // Front: one full quad, silhouette cut by the alpha test. a=+x, b=+y.
  quad(
    [x0, yB, zF, x1, yB, zF, x1, yT, zF, x0, yT, zF],
    [u0, v0, u1, v0, u1, v1, u0, v1],
  )
  // Back: a=+y, b=+x. U is NOT mirrored, so the same texel sits at the same
  // model x on both faces -- vanilla's reversed NORTH uv range says the same.
  quad(
    [x0, yB, zB, x0, yT, zB, x1, yT, zB, x1, yB, zB],
    [u0, v0, u0, v1, u1, v1, u1, v0],
  )

  /*
   * The rim. Four passes, each merging maximal runs of exposed pixel edges,
   * which is vanilla's Span and is what keeps a 16x16 sprite at tens of quads
   * instead of hundreds.
   *
   * `exposed(a, b)` is in scan coordinates for that pass, so the two
   * horizontal passes walk x within a row and the two vertical ones walk y
   * within a column, and the run merging is written once.
   */
  const run = (outer, inner, exposed, emit) => {
    for (let o = 0; o < outer; o++) {
      let start = -1
      for (let i = 0; i <= inner; i++) {
        const on = i < inner && exposed(o, i)
        if (on && start < 0) start = i
        if (!on && start >= 0) { emit(o, start, i - 1); start = -1 }
      }
    }
  }

  // UP: an opaque pixel with nothing above it. Quad at the pixel's top edge.
  run(height, width,
    (y, x) => solid(x, y) && !solid(x, y - 1),
    (y, a, b) => {
      const yy = py(y), xa = px(a), xb = px(b + 1)
      const ua = pu(a), ub = pu(b + 1), v = pv(y + 0.5)
      // a=+x, b=+z
      quad([xa, yy, zF, xb, yy, zF, xb, yy, zB, xa, yy, zB],
        [ua, v, ub, v, ub, v, ua, v])
    })

  // DOWN: nothing below. Quad at the pixel's bottom edge. a=+z, b=+x.
  run(height, width,
    (y, x) => solid(x, y) && !solid(x, y + 1),
    (y, a, b) => {
      const yy = py(y + 1), xa = px(a), xb = px(b + 1)
      const ua = pu(a), ub = pu(b + 1), v = pv(y + 0.5)
      quad([xa, yy, zF, xa, yy, zB, xb, yy, zB, xb, yy, zF],
        [ua, v, ua, v, ub, v, ub, v])
    })

  // LEFT: nothing to the -x side. Quad at the pixel's left edge. a=+y, b=+z.
  run(width, height,
    (x, y) => solid(x, y) && !solid(x - 1, y),
    (x, a, b) => {
      const xx = px(x), yb = py(b + 1), yt = py(a)
      const vb = pv(b + 1), vt = pv(a), u = pu(x + 0.5)
      quad([xx, yb, zF, xx, yt, zF, xx, yt, zB, xx, yb, zB],
        [u, vb, u, vt, u, vt, u, vb])
    })

  // RIGHT: nothing to the +x side. Quad at the pixel's right edge. a=+z, b=+y.
  run(width, height,
    (x, y) => solid(x, y) && !solid(x + 1, y),
    (x, a, b) => {
      const xx = px(x + 1), yb = py(b + 1), yt = py(a)
      const vb = pv(b + 1), vt = pv(a), u = pu(x + 0.5)
      quad([xx, yb, zF, xx, yb, zB, xx, yt, zB, xx, yt, zF],
        [u, vb, u, vb, u, vt, u, vt])
    })

  return { positions, normals, uvs, indices, quads }
}

/* ------------------------------------------------------------------ *
 * Display transforms
 *
 * Verbatim from the vanilla model files. Byte-identical across every version
 * from 1.16.5 to 26.1, so these are not going to drift.
 *
 * assets/minecraft/models/item/generated.json
 *   "thirdperson_righthand": rotation [0,0,0]    translation [0,3,1]      scale 0.55
 *   "firstperson_righthand": rotation [0,-90,25] translation [1.13,3.2,1.13] scale 0.68
 *
 * assets/minecraft/models/item/handheld.json   (parent item/generated)
 *   "thirdperson_righthand": rotation [0,-90,55] translation [0,4,0.5]    scale 0.85
 *   "firstperson_righthand": rotation [0,-90,25] translation [1.13,3.2,1.13] scale 0.68
 *
 * assets/minecraft/models/item/handheld_rod.json  (parent item/handheld)
 *   "thirdperson_righthand": rotation [0,90,55]  translation [0,4,2.5]    scale 0.85
 *   "firstperson_righthand": rotation [0,90,25]  translation [0,1.6,0.8]  scale 0.68
 *
 * THE ANSWER TO "IS A SWORD HELD LIKE AN INGOT": in FIRST person, yes --
 * handheld inherits generated's firstperson_righthand unchanged, so the pose
 * is identical and the only difference is that a sword's sprite is drawn on
 * the diagonal. The two part company in THIRD person, where handheld adds
 * rotation [0,-90,55] and a 0.85 scale against generated's identity rotation
 * and 0.55, and that is what puts the blade along the fist.
 *
 * There is deliberately no `gui` entry here. item/generated declares none, so
 * vanilla falls through to ItemTransform.NO_TRANSFORM -- identity rotation,
 * identity scale, and only the -0.5 centring shift. A GUI item really is a
 * flat, front-on, unrotated sprite, which is what blockIcon.js already draws.
 * Checked before touching it; nothing there needed to change.
 *
 * Translations are in model units (1/16 block), as they are in the JSON.
 * Deserializer multiplies by 0.0625 and clamps to +-5 blocks; nothing here is
 * near the clamp.
 * ------------------------------------------------------------------ */

const DISPLAY = {
  generated: {
    firstperson_righthand: { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: 0.68 },
    thirdperson_righthand: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: 0.55 },
  },
  handheld: {
    firstperson_righthand: { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: 0.68 },
    thirdperson_righthand: { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: 0.85 },
  },
  handheld_rod: {
    firstperson_righthand: { rotation: [0, 90, 25], translation: [0, 1.6, 0.8], scale: 0.68 },
    thirdperson_righthand: { rotation: [0, 90, 55], translation: [0, 4, 2.5], scale: 0.85 },
  },
}

/** Which vanilla model parent an item uses. items.js carries the exception
 *  list; everything unmarked is `item/generated`, as in vanilla. */
export const displayFor = (itemId, context) =>
  DISPLAY[item(itemId)?.model ?? 'generated'][context]

/* ------------------------------------------------------------------ *
 * Sprite decoding and the geometry cache
 * ------------------------------------------------------------------ */

/**
 * url -> the in-flight decode. THE cache, and the reason a held axe costs
 * nothing per frame: the same sprite is drawn thirty times a second and the
 * extrusion for it runs exactly once per page.
 *
 * Keyed by URL rather than by item id because two items can share a sprite,
 * and because the URL is what both the geometry and the texture are fetched
 * with.
 */
const pending = new Map()

/**
 * url -> VertexData, once the sprite has actually been decoded.
 *
 * Split from `pending` so a caller can ask "is it ready NOW" without awaiting.
 * That is not tidiness: even a resolved promise only calls back on the next
 * microtask, so a single promise-only API makes the held mesh blink out for a
 * frame every time you scroll back onto an item you were already holding.
 */
const ready = new Map()

/** Counters, for the test suite to prove the cache is real. */
export const itemModelStats = { builds: 0, hits: 0, quads: 0, buildMs: 0 }

function decode(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      // willReadFrequently, because getImageData on a GPU-backed canvas forces
      // a readback; these canvases exist only to be read.
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(0, 0, img.width, img.height))
    }
    img.onerror = () => reject(new Error(`item sprite failed to load: ${url}`))
    img.src = url
  })
}

/** The extruded geometry for this sprite if it has already been built, else
 *  null. Synchronous, which is the whole point -- see `ready` above. */
export function cachedItemGeometry(url) {
  const data = ready.get(url)
  if (data) itemModelStats.hits++
  return data ?? null
}

/**
 * The extruded mesh data for one item sprite, built once and cached forever.
 *
 * Async because the pixels have to come back over the network before the
 * silhouette is known, so the first time you hold a given item its mesh
 * appears a frame late. Every later selection is a synchronous cache hit.
 *
 * Rejected: extruding all 96 sprites at startup. It is only about 3 ms of
 * extrusion, but it is 96 network fetches and 96 canvas readbacks on the same
 * main thread that is meshing chunks during the worst part of the load, for
 * 90-odd sprites nobody is going to hold.
 *
 * Rejected: baking the geometry at build time into public/. The texture
 * pipeline owns that directory, the output would be a second artifact to keep
 * in step with the sprites it came from, and decoding a 16x16 PNG costs less
 * than a frame.
 */
export function loadItemGeometry(url) {
  const done = ready.get(url)
  if (done) { itemModelStats.hits++; return Promise.resolve(done) }

  const inflight = pending.get(url)
  if (inflight) { itemModelStats.hits++; return inflight }

  const built = decode(url).then((image) => {
    const t0 = performance.now()
    const { positions, normals, uvs, indices, quads } =
      extrudeSprite(image.data, image.width, image.height)
    const data = new VertexData()
    data.positions = positions
    data.normals = normals
    data.uvs = uvs
    data.indices = indices
    itemModelStats.builds++
    itemModelStats.quads += quads
    itemModelStats.buildMs += performance.now() - t0
    ready.set(url, data)
    return data
  })

  pending.set(url, built)
  return built
}

/** Where the texture pipeline puts an item's sprite. */
export const itemTextureUrl = (def) => `/textures/item/${def.texture}.png`

/**
 * Item sprites as Babylon textures, one per URL per scene.
 *
 * invertY TRUE, and this is the trap. Babylon's constructor takes invertY as
 * its FOURTH argument and heldItem.js passes false there for the block atlas,
 * so copying that call would have been the obvious move -- and would have
 * uploaded every item sprite upside down. `extrudeSprite` computes v as
 * 1 - row/height, which is playerModel.js's convention, and that file records
 * why: with invertY true, v = 1 is the TOP of the image. Get the pair wrong and
 * a diamond axe is held by its blade.
 */
const textures = new Map()
export function itemTexture(scene, url) {
  let t = textures.get(url)
  if (!t) {
    // NEAREST, like every other texture here: a 16x16 sprite filtered
    // bilinearly is a smudge.
    t = new Texture(url, scene, true, true, Texture.NEAREST_SAMPLINGMODE)
    t.hasAlpha = true
    textures.set(url, t)
  }
  return t
}
