import { Scene } from '@babylonjs/core/scene'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { WATER_TINT } from './blocks.js'

/*
 * What being underwater looks like.
 *
 * THE BUG THIS FIXES. Stand six blocks under the ocean, look up, and you saw
 * clouds. Not "water looked wrong" -- there was no water between the camera
 * and the sky at all. Two reasons, and only the first one is a bug:
 *
 *   1. Nothing in this world or in noa had ever set `scene.fogMode`. A grep
 *      for "fog" across src/ and node_modules/noa-engine/src/ came back empty.
 *   2. noa's greedy mesher culls water-against-water faces, so a lake is a
 *      hollow shell and from inside it you see out through the far wall. That
 *      is CORRECT -- vanilla culls those too. The reason you never notice in
 *      vanilla is that vanilla has fog. So (2) is fixed by fixing (1).
 *
 * ------------------------------------------------------------------
 * THE TRAP, and it is a good one. `terrainMaterials.js` calls `mat.freeze()`
 * on every terrain material it builds. Babylon's `freeze()` sets
 * `checkReadyOnlyOnce`, so `isReadyForSubMesh` returns early forever and
 * `prepareDefines` never runs again. The `FOG` shader define is decided in
 * `prepareDefines`. So:
 *
 *   turn fog on at boot  -> define baked in, fog works on terrain
 *   turn fog on later    -> define never added, fog works perfectly on the
 *                           clouds, the sun and dropped items and does
 *                           NOTHING on the world
 *
 * The second one reads exactly like a Babylon bug and is not one. It is also
 * invisible in a unit test that only checks `scene.fogMode`.
 *
 * So the fog mode is set ONCE, here, at install time -- which is inside
 * main.js's synchronous top-level, long before noa meshes its first chunk --
 * and is never changed again. The switch is `fogDensity`, which is a uniform
 * and is rebound every frame. Density 0 is exactly no fog: EXP2's factor is
 * `exp(-(density * distance)^2)`, which is 1.0 at density 0.
 *
 * REJECTED -- flipping `fogMode` between EXP2 and NONE on entry and exit. Even
 * with the define baked in it is wrong, because Babylon only binds the fog
 * uniforms when `scene.fogMode !== NONE`; set it to NONE and the shader keeps
 * whatever `vFogInfos` it was last handed. The fog would stick.
 *
 * REJECTED -- `unfreeze()` / `markAsDirty()` / `freeze()` on each terrain
 * material at the moment you enter water. It works, and it recompiles shaders
 * in the frame you dive, which is the one frame you cannot afford a hitch in.
 *
 * REJECTED -- putting any of this in sky.js. That file already owns
 * `scene.clearColor` and `scene.ambientColor` off the day/night clock. Two
 * writers to scene-level state on the same tick is the bug you find three
 * weeks later when sunset turns the ocean orange. Vanilla's water fog is not
 * time-driven anyway -- it is the water colour, flat.
 *
 * ------------------------------------------------------------------
 * REJECTED -- `noa.rendering._camScreen`. noa already builds a camera-parented
 * full-screen plane for exactly this (`rendering.js:412`), gated on the
 * camera's block having `matData.color && matData.alpha < 1`. blocks.js
 * registers materials with `{ textureURL, atlasIndex, texHasAlpha }` and no
 * `color`, so the test has failed silently since the day water was added.
 *
 * Making it fire would mean registering water with a `color`, and that is a
 * worse trade than it looks:
 *   - `checkCameraEffect` runs every render and calls `setEnabled(false)`
 *     whenever the camera's block id reads 0. It reads the LIVE voxel array,
 *     so a chunk that has not finished loading answers air and the overlay
 *     blinks off. `fluids.eyes` is the signal that is already correct.
 *   - it is a private field of another package, reset out from under us.
 *   - its material is a frozen StandardMaterial with no diffuse texture, so it
 *     can only ever be a flat colour wash.
 * A separate plane is about fifteen lines. Borrowing that one is fewer lines
 * and a permanent dependency on an accident.
 */

/*
 * Minecraft's default overworld water, #3F76E4, doing double duty: vanilla
 * reuses the biome water tint as the fog colour. Imported from blocks.js
 * rather than restated so the two cannot drift.
 */
const FOG_COLOR = new Color3(WATER_TINT[0] / 255, WATER_TINT[1] / 255, WATER_TINT[2] / 255)

/*
 * EXP2 fog is `exp(-(density * distance)^2)`. Solving for "this is the
 * distance at which you can no longer make anything out" (factor 0.05):
 * density = sqrt(ln(20)) / visibility = 1.73 / visibility.
 *
 * Vanilla publishes no steady-state number -- it is biome-driven and scales
 * with render distance -- so these are tuned by eye against a vanilla
 * screenshot, which is what docs/water.md says to do. ~29 blocks once your
 * eyes have adjusted, ~9 the moment you go under.
 *
 * The wiki's phrase for the entry fog is "obscuring the distance at 0.01
 * blocks", and taken literally that is total blindness for the first few
 * seconds of every dive. Rejected: it is not what vanilla looks like, and the
 * first thing a visitor to this world does with water is jump in it. What IS
 * worth reproducing is the SHAPE -- thick, then clearing -- and that is the
 * ADAPT table below.
 */
const STEADY_DENSITY = 0.06
const ENTRY_DENSITY = 0.20

/*
 * Vanilla's two-fog blend, from minecraft.wiki/w/Fog. Descending into water
 * applies a much thicker fog of the same colour, blended 25% with the normal
 * water fog at the moment of entry, 60% at five seconds, and gone at thirty.
 * Your eyes adjusting is the single most characteristic thing about going
 * under in Minecraft, and it is three numbers.
 *
 * Read these as "how much of the NORMAL fog is in the mix": a quarter of it at
 * entry (so mostly the thick one), all of it once you have been down half a
 * minute.
 */
const ADAPT = [
  [0, 0.25],
  [5, 0.60],
  [30, 1.0],
]

/** Piecewise-linear walk of ADAPT. Returns the normal-fog weight at t seconds. */
function adaptWeight(t) {
  if (t <= ADAPT[0][0]) return ADAPT[0][1]
  for (let i = 1; i < ADAPT.length; i++) {
    const [t1, w1] = ADAPT[i]
    if (t > t1) continue
    const [t0, w0] = ADAPT[i - 1]
    return w0 + (w1 - w0) * ((t - t0) / (t1 - t0))
  }
  return ADAPT[ADAPT.length - 1][1]
}

/*
 * The overlay tile.
 *
 * Vanilla tiles `misc/underwater.png` -- a 16x16, non-greyscale, murky blue
 * square -- across the whole screen while you are submerged. That file is not
 * in public/textures/: extracting it means editing scripts/build-textures.mjs,
 * which is another agent's file this pass.
 *
 * So it is generated here instead, and that turns out to be the better answer
 * rather than the expedient one: `npm run build:deploy` builds textures from
 * Pixel Perfection CE, and CE has no water texture at all, let alone a
 * `misc/underwater.png`. A generated tile is the only version of this that
 * survives a deploy.
 *
 * Value noise, not white noise: neighbouring pixels are correlated, which is
 * what makes it read as murk rather than as television static. Deterministic
 * (a fixed LCG seed) so a screenshot test is not rolling dice.
 */
function murkTexture(scene) {
  const N = 16
  const data = new Uint8Array(N * N * 4)
  // A plain linear congruential generator -- Numerical Recipes' constants.
  // Math.random() would make every boot's overlay a slightly different
  // picture, and screenshot comparison is how this feature gets judged.
  let seed = 0x9e3779b9
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000

  // One low-frequency 4x4 cell grid, bilinearly stretched to 16x16.
  const C = 4
  const cells = Array.from({ length: (C + 1) * (C + 1) }, rnd)
  const at = (i, j) => cells[(j % C) * (C + 1) + (i % C)]
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * C, fy = (y / N) * C
      const i = Math.floor(fx), j = Math.floor(fy)
      const tx = fx - i, ty = fy - j
      // Smoothstep the interpolant, or the cell edges show up as a grid.
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx
      const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx
      const n = top + (bot - top) * sy
      const o = (y * N + x) * 4
      // Around the water tint, shifted a little darker and a little bluer:
      // this sits over everything, so a bright tile would wash the world out.
      data[o] = 20 + n * 30
      data[o + 1] = 55 + n * 45
      data[o + 2] = 130 + n * 60
      data[o + 3] = 255
    }
  }
  const tex = RawTexture.CreateRGBATexture(
    data, N, N, scene, false, false, Texture.NEAREST_SAMPLINGMODE)
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE
  // Tiled a few times across the screen, the way vanilla's is.
  tex.uScale = tex.vScale = 4
  return tex
}

/** How strong the murk tile is at its thickest, and how far it backs off. */
const OVERLAY_ALPHA_ENTRY = 0.35
const OVERLAY_ALPHA_STEADY = 0.18

/**
 * @param noa the engine
 * @param fluids the sensor from fluids.js. `eyes` is the right signal and
 *   `feet` is not: chest-deep in a pond you are slowed but you can still see.
 */
export function installUnderwater(noa, { fluids }) {
  const scene = noa.rendering.getScene()
  const camera = noa.rendering.camera

  /* THE ONE LINE THE WHOLE FILE IS ABOUT. See the freeze note at the top:
   * this has to happen before the first chunk meshes, and it must never be
   * set back to NONE. */
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogColor = FOG_COLOR
  scene.fogDensity = 0

  /*
   * THE BASE FOG, and why this file grew an arbitration problem.
   *
   * This module is the only writer of scene.fogDensity and it writes every
   * frame, so whatever it decides is what the GPU gets. That was fine while
   * the only fog in the world was water: dry meant zero, and zero meant no
   * fog.
   *
   * The Nether breaks that in one line. It is a dimension with fog of its
   * own -- flat red, always on, nothing to do with water -- and it costs no
   * shader work to add because of the decision recorded at the top of this
   * file: FOGMODE_EXP2 is already globally on, so a dimension fog is two
   * runtime uniform writes. What it does cost is this: "dry" can no longer
   * mean zero, or surfacing in the Nether would clear the dimension's fog
   * and leave you looking at a sharp-edged bedrock room.
   *
   * So dry now means BASE, which is zero in the overworld and something red
   * in the Nether, and the arbitration rule is one sentence: **water wins
   * while your eyes are in it, and the base is what you come back to.**
   *
   * REJECTED -- taking the max of the two densities. It reads as the
   * conservative choice and it is wrong in the case it exists for: Nether
   * fog is denser than water fog, so max() would mean putting your head
   * under lava-adjacent water and seeing FURTHER. Water is not a filter over
   * the dimension, it is a different medium, and the last medium your eyes
   * entered is the one you are looking through.
   *
   * REJECTED -- a stack of fog sources with priorities. Two sources, one of
   * which is a property of the dimension and the other of which is a boolean
   * about your head, do not need a stack. When there is a third, it will be
   * clear what shape it wants; guessing now would be guessing.
   */
  let baseDensity = 0
  const baseColor = FOG_COLOR.clone()

  /*
   * The overlay plane. Parented to the camera, so it inherits position and
   * orientation for free and never has to be moved.
   *
   * `renderingGroupId = 2` and not "it'll sort itself out". Babylon sorts the
   * transparent pass back-to-front by distance, and this plane's distance is
   * CONSTANT -- so against the clouds, which are also transparent and also far
   * away, the comparison is a coin flip that can go either way frame to frame.
   * Group 2 puts it after everything: group 0 is the world, and heldItem.js
   * already claims group 1 for the first-person arm and the block in your
   * hand. Vanilla tints the hand too, so being above it is right.
   */
  const plane = CreatePlane('underwater-overlay', { size: 1 }, scene)
  plane.parent = camera
  plane.position.z = 0.05          // camera.minZ is 0.01
  plane.renderingGroupId = 2
  plane.isPickable = false
  // Fogging the fog overlay would be circular, and at 0.05 blocks it would do
  // nothing anyway. Off so the intent is on the record.
  plane.applyFog = false
  // Parented to the camera it is always in frame, but its bounding box is
  // computed in local space and Babylon has been known to cull it on the first
  // frame after a resize. Cheaper to skip the test than to debug the flicker.
  plane.alwaysSelectAsActiveMesh = true
  plane.setEnabled(false)

  const mat = noa.rendering.makeStandardMaterial('underwater-overlay-mat')
  mat.diffuseTexture = murkTexture(scene)
  mat.diffuseTexture.hasAlpha = true
  // Unlit: this is a screen effect, not a surface. Without disableLighting the
  // overlay would get darker at night, which would be a nice touch for about
  // one second and then would stop you seeing anything at all underwater after
  // sunset.
  mat.disableLighting = true
  mat.emissiveTexture = mat.diffuseTexture
  mat.diffuseColor = new Color3(0, 0, 0)
  mat.backFaceCulling = false
  mat.alpha = OVERLAY_ALPHA_STEADY
  plane.material = mat

  /* Fit the plane to the camera frustum at its parked distance. Recomputed on
   * resize rather than cached: the canvas is the browser window here. */
  function fit() {
    const h = 2 * plane.position.z * Math.tan(camera.fov / 2)
    const aspect = scene.getEngine().getAspectRatio(camera)
    // 1.05 is slop. A plane fitted exactly to the frustum shows a hairline of
    // un-tinted world at the screen edge on any rounding error.
    plane.scaling.y = h * 1.05
    plane.scaling.x = h * aspect * 1.05
  }
  fit()

  let submerged = false
  let sinceEntry = 0

  /*
   * Driven off noa's tick rather than beforeRender, because fluids.eyes is
   * updated on the tick and reading it from a render callback would sample it
   * at a different rate than it changes.
   */
  function update(dtSeconds) {
    const wet = fluids.eyes === 'water'

    if (!wet) {
      if (!submerged) return
      /*
       * Surfacing is a CUT, not a fade, and that is vanilla. Your eyes leave
       * the water and the fog is gone in the same frame. A ramp here would
       * also make the "does it clear?" assertion a race against a timer.
       */
      submerged = false
      sinceEntry = 0
      // Back to the dimension's own fog, not to nothing. See baseDensity.
      scene.fogColor = baseColor
      scene.fogDensity = baseDensity
      plane.setEnabled(false)
      return
    }

    if (!submerged) {
      submerged = true
      sinceEntry = 0
      fit()
      // The colour, not just the density: in the Nether the base colour is
      // red, and water that fades to red is a bug you have to be underwater
      // in the Nether to see -- which is to say, one nobody would have found.
      scene.fogColor = FOG_COLOR
      plane.setEnabled(true)
    } else {
      sinceEntry += dtSeconds
    }

    const w = adaptWeight(sinceEntry)
    scene.fogDensity = ENTRY_DENSITY + (STEADY_DENSITY - ENTRY_DENSITY) * w
    mat.alpha = OVERLAY_ALPHA_ENTRY + (OVERLAY_ALPHA_STEADY - OVERLAY_ALPHA_ENTRY) * w

    /*
     * Vanilla scrolls the overlay with where you are looking, which is what
     * sells it as a thing floating in front of your face rather than a filter
     * pasted on the lens. Yaw slides it sideways, pitch slides it up.
     * Divided by TAU so a full turn is a whole number of tile repeats and the
     * seam never lands mid-screen.
     */
    const tex = mat.diffuseTexture
    tex.uOffset = -noa.camera.heading / (Math.PI * 2)
    tex.vOffset = noa.camera.pitch / (Math.PI * 2)
  }

  // noa's tick dt is in milliseconds.
  const onTick = (dt) => update(dt / 1000)
  noa.on('tick', onTick)

  const onResize = () => fit()
  window.addEventListener('resize', onResize)

  return {
    /** Are the eyes under water right now, as this module sees it. */
    get submerged() { return submerged },
    /** Seconds since going under, which is what the fog ramp reads. */
    get sinceEntry() { return sinceEntry },
    /*
     * The live scene values, for the console and for the test suite. A spec
     * that asserts `underwater.submerged` asserts only that a boolean flipped;
     * these are what the GPU is actually being handed, which is the difference
     * between "fog is on" and "fog is on and the terrain shader knows about
     * it". test/28-underwater.spec.js checks both, and the FOG define on the
     * terrain material separately, for the freeze reason at the top.
     */
    get fogDensity() { return scene.fogDensity },
    get fogMode() { return scene.fogMode },

    /**
     * The fog a dry player sees. Set by src/dimensions.js on entering a
     * dimension; see the long note at `baseDensity` for the arbitration rule.
     *
     * Applied immediately when dry so a dimension change is visible in the
     * frame it happens, and held back while submerged so it does not fight
     * the water ramp mid-dive. The `submerged` branch is not a nicety -- a
     * dimension change while swimming is reachable the moment /dimension
     * exists.
     */
    setBaseFog({ color, density }) {
      if (color) baseColor.set(color[0], color[1], color[2])
      baseDensity = density
      if (!submerged) {
        scene.fogColor = baseColor
        scene.fogDensity = baseDensity
      }
    },
    get baseFogDensity() { return baseDensity },
    get overlayEnabled() { return plane.isEnabled() },
    get overlayAlpha() { return mat.alpha },
    dispose() {
      noa.off('tick', onTick)
      window.removeEventListener('resize', onResize)
      plane.dispose()
      mat.dispose()
      scene.fogDensity = 0
    },

  }
}
