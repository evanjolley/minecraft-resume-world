import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'

import { MAX_LIGHT, LIGHT_FLOOR } from './blockLight.js'

/*
 * How bright is an entity right now.
 *
 * THE BUG THIS EXISTS TO STOP HAPPENING A FOURTH TIME.
 *
 * Babylon's default.fragment ADDS the emissive term, it does not modulate it:
 *
 *     vec3 emissiveColor = vEmissiveColor;
 *     #ifdef EMISSIVE
 *       emissiveColor += texture2D(emissiveSampler, ...).rgb * vEmissiveInfos.y;
 *     #endif
 *     vec3 finalDiffuse = clamp(diffuseBase * diffuseColor
 *                             + emissiveColor + vAmbientColor, 0.0, 1.0)
 *                       * baseColor.rgb;
 *
 * so any CONSTANT you put in emissiveColor is a brightness the scene's light
 * can never take away. The nametag went white because the constant was 1;
 * crackOverlay.js, particles.js and sky.js all carry a line zeroing
 * ambientColor for the same "Babylon adds this" reason. The player model was
 * the third instance: emissiveTexture = skin AND emissiveColor = 0.45, which
 * sums to 0.45 + skin -- over 1.0 across most of a skin, so the clamp
 * saturated and the model rendered FULLY unlit. It did not merely fail to
 * darken at night; it was never lit at all.
 *
 * The fix is not a better constant. It is that entity brightness has exactly
 * one source -- sky.js's `level` -- and materials subscribe to it here rather
 * than each picking a number. A fourth entity material calls trackEntityLight
 * and cannot get it wrong; if you find yourself typing `emissiveColor =` on
 * something a player can see, that is the smell.
 *
 * WHAT MINECRAFT ACTUALLY DOES. Vanilla shades an entity as
 *
 *     texture * lightmap(lightLevel) * minecraft_mix_light(normal)
 *
 * where the second factor is the whole of the day/night response and the
 * third is face shading from two fixed lights. From Minecraft's core shader
 * `light.glsl`, used by every rendertype_entity_* program:
 *
 *     float light0 = max(0.0, dot(lightDir0, normal));
 *     float light1 = max(0.0, dot(lightDir1, normal));
 *     float lightAccum = min(1.0, (light0 + light1) * 0.6 + 0.4);
 *
 * THAT 0.4 IS THE REAL FLOOR, and the thing to notice is that it is a
 * FRACTION OF THE LIGHT LEVEL, not an absolute brightness. A face pointing
 * away from both lights gets 40% of whatever the lightmap says -- 40% of a
 * lot at noon, 40% of very little at midnight. The old 0.45 was the right
 * ballpark for that 0.4 and was simply pinned instead of scaled, which is the
 * entire bug in one number.
 *
 * So: DIFFUSE + FLOOR = 1, exactly as (x * 0.6 + 0.4) does, and both halves
 * are multiplied by the sky's level.
 *
 * Rejected: keeping emissiveTexture on the skin and just scaling its
 * emissiveColor. The texture is added at full strength regardless, so the
 * model would still saturate at noon and the scaling would only be visible
 * after dark. Emissive has to be a flat grey here; the texture's own colour
 * arrives through diffuseTexture, which is what baseColor.rgb multiplies by.
 *
 * NO LONGER REJECTED: reading light from the voxel the entity stands in, like
 * vanilla. That was rejected because noa had no light engine -- ambient
 * occlusion and one directional vector, with no per-voxel value to query.
 * src/blockLight.js shipped 2026-09-16 and exposes getBlockLight and
 * getSkyLight, and this file calls both. See "THE MAX, AND BOTH HALVES OF IT
 * ARE NOW REAL" below.
 */

/** Vanilla light.glsl's `* 0.6 + 0.4`, and the reason those two sum to 1. */
export const ENTITY_FLOOR = 0.4
export const ENTITY_DIFFUSE = 1 - ENTITY_FLOOR

/*
 * THE TWO LIGHTS, and why one was never going to be enough.
 *
 * `Lighting.java` in 1.21 (com.mojang.blaze3d.platform):
 *
 *     DIFFUSE_LIGHT_0 = new Vector3f( 0.2F, 1.0F, -0.7F).normalize();
 *     DIFFUSE_LIGHT_1 = new Vector3f(-0.2F, 1.0F,  0.7F).normalize();
 *
 * unchanged from 1.8.9's RenderHelper.LIGHT0_POS/LIGHT1_POS, and they are
 * FIXED IN WORLD SPACE -- setupLevel hands the same two vectors to the shader
 * at every hour of the day. An entity's day/night response is the lightmap,
 * which is `level` here; the two lights only decide which SIDE of him is lit.
 *
 * WHY IT TAKES TWO. The report that started this was "walking in circles
 * around Evan, his face is the same level of dimness; fly above him and his
 * face is bright". Both halves are one line: the scene had a single
 * DirectionalLight pointing straight down, so a vertical face gets
 * dot(normal, up) = 0 and NO diffuse at all, at any yaw. His face was lit by
 * the emissive floor alone, which is a constant. Tilt his head up to track
 * you and the normal swings to +y and catches the whole term -- hence bright
 * from above.
 *
 * Two vectors that mirror each other about Y fix exactly that: a horizontal
 * normal gets |0.2*nx - 0.7*nz| / |v|, which is never zero and sweeps roughly
 * 0.16 to 0.57 as you walk around him. That variation IS the thing that was
 * missing.
 *
 * THE COMPASS MIRROR, noted rather than corrected. This engine's X axis is
 * mirrored against Minecraft's (debugScreen.js has the long version), so a
 * faithful port would mirror these two vectors in X. It is not done, and the
 * reason is that the pair is not symmetric under that mirror -- mirroring
 * swaps which of them is which -- so the only visible difference is which
 * cheek of a model is the brighter one. Written down because it is the kind of
 * thing that looks like a bug to the next reader.
 */
const normalize3 = (v) => {
  const n = Math.hypot(v[0], v[1], v[2])
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** Vanilla's level rig, pointing TOWARD the light, as Minecraft stores it. */
export const ENTITY_LIGHT_VECTORS = [
  normalize3([0.2, 1.0, -0.7]),
  normalize3([-0.2, 1.0, 0.7]),
]

/*
 * HOW TWO LIGHTS COME OUT OF A ONE-LIGHT SCENE, and what was rejected.
 *
 * noa creates exactly one DirectionalLight and main.js hands it a vector.
 * That light still exists and still points straight down, because
 * blockMeshes.js's non-cube meshes -- slabs, stairs, fences, the new torches
 * -- are lit by it off the same normals as terrain, and pointing it anywhere
 * else brings report #6 straight back for them. Terrain no longer reads it at
 * all (blockLight.js owns the face table now), so its whole remaining job is
 * those meshes.
 *
 * So the rig is TWO NEW lights, restricted to entity meshes with
 * `includedOnlyMeshes`, and every entity mesh is excluded from noa's light in
 * the same breath. The restriction is per-MESH and this file is handed
 * MATERIALS, which is the awkward part; `adopt` below is the bridge.
 *
 * REJECTED -- computing the two-light accumulation here, in JavaScript, and
 * writing the result into diffuseColor. It is the obvious move because this
 * file already owns diffuseColor, and it cannot work: the accumulation is a
 * function of the surface NORMAL, which exists per fragment and not per
 * material. In JS it would collapse to one number for the whole model, which
 * is precisely the "same level of dimness all the way round" that was
 * reported.
 *
 * REJECTED -- a material plugin on entity materials computing it in GLSL, the
 * way blockLight.js does for terrain. It would be exact and it would cost a
 * second shader-injection path to maintain for a case Babylon's own light loop
 * already sums correctly. Babylon adds `ndl * diffuse * intensity` per light,
 * so two lights at intensity `level` give `level * (d0 + d1)`, and
 * ENTITY_DIFFUSE multiplies it to `level * 0.6 * (d0 + d1)`. That IS
 * light.glsl, arrived at by arithmetic that was already happening.
 *
 * REJECTED -- excluding terrain from the two new lights instead of including
 * only entities. Chunk meshes are created and destroyed constantly; an
 * exclusion list over them is a list that is wrong for one frame every time a
 * chunk loads, and it is the objection sky.js already recorded against
 * per-face lights.
 */
let rig = null
let sun = null

/** Meshes already handed to the rig, so `adopt` is idempotent and cheap. */
const litMeshes = new Set()

/**
 * Tell this file which light noa made, so entity meshes can be taken off it.
 *
 * Called by sky.js, which is the one module that already holds
 * `noa.rendering.light`. Rejected: reaching for `scene.lights[0]`, which is
 * true right up until this file adds two more.
 */
export function setSunLight(light) {
  sun = light
}

/*
 * THERE IS NO TEST SEAM HERE, and there used to be three comments claiming
 * otherwise.
 *
 * `entityRig()`, `getEntityLight()` and `trackedEntityMaterials()` were all
 * exported from this file, and two of them carried comments saying the suite
 * needed them. No spec could reach any of them: main.js never imports this
 * module, it does not self-publish to `window` the way blockLight.js does at
 * :1693, and it has no key in `window.game`. Three exports, zero importers,
 * zero references in test/. They were deleted rather than wired up.
 *
 * Deleted rather than plugged, deliberately. Publishing them would have meant
 * either a second `window.X =` global -- which is exactly the drift
 * docs/HEALTH.md §7 already objects to, three lighting modules having invented
 * three different answers to "how does a spec see me" -- or importing this
 * module into main.js purely to hang a debug handle off `window.game`.
 * Neither is worth doing for a seam nothing has ever asked for. If a spec
 * genuinely needs the rig or the tracked material list later, add it to
 * `window.game` in main.js at that point, which is the convention, and the
 * export comes back in three lines.
 *
 * The rule this is an instance of: a comment asserting a capability that does
 * not exist is worse than no comment, because it stops the next person from
 * checking.
 */

function ensureRig(scene) {
  if (rig) return rig
  rig = ENTITY_LIGHT_VECTORS.map((v, i) => {
    // Babylon's `direction` is the way light TRAVELS; Minecraft's vector
    // points at the source. Hence the negation, and it is the single easiest
    // thing in this file to get backwards.
    const l = new DirectionalLight(
      `entity-rig-${i}`, new Vector3(-v[0], -v[1], -v[2]), scene)
    l.intensity = level
    // No specular on anything in this world; playerModel.js zeroes it on the
    // material too and this is the other end of the same decision.
    l.specular = new Color3(0, 0, 0)
    return l
  })
  return rig
}

/*
 * A new light with an EMPTY includedOnlyMeshes affects every mesh in the
 * scene, which for one frame would be the whole world lit from two angles. So
 * the rig is built lazily, here, in the same synchronous block that gives it
 * its first mesh -- there is no render between the two.
 *
 * Assigned rather than pushed. `includedOnlyMeshes` is a plain array whose
 * SETTER is what hooks it and marks every mesh's light list dirty; a push onto
 * the existing array changes the contents and tells Babylon nothing.
 */
function adopt() {
  for (const mat of tracked.keys()) {
    const meshes = mat.getBindedMeshes ? mat.getBindedMeshes() : []
    for (const mesh of meshes) {
      if (litMeshes.has(mesh)) continue
      litMeshes.add(mesh)
      const [a, b] = ensureRig(mat.getScene())
      a.includedOnlyMeshes = [...a.includedOnlyMeshes, mesh]
      b.includedOnlyMeshes = [...b.includedOnlyMeshes, mesh]
      if (sun) sun.excludedMeshes = [...sun.excludedMeshes, mesh]
      mesh.onDisposeObservable?.addOnce(() => {
        litMeshes.delete(mesh)
        const drop = (arr) => arr.filter((m) => m !== mesh)
        a.includedOnlyMeshes = drop(a.includedOnlyMeshes)
        b.includedOnlyMeshes = drop(b.includedOnlyMeshes)
        if (sun) sun.excludedMeshes = drop(sun.excludedMeshes)
      })
    }
  }
}

/*
 * THE LINE WITHOUT WHICH NONE OF THE NUMBERS BELOW REACH THE SCREEN.
 *
 * noa sets `scene.performancePriority = Intermediate`, Babylon turns that into
 * `checkReadyOnlyOnce`, `isFrozen` IS `checkReadyOnlyOnce`, and
 * StandardMaterial guards its entire material-UBO write behind
 * `!this.isFrozen`. So `vEmissiveColor` and `vDiffuseColor` upload once, on
 * the material's first frame, and never again. Measured: a held block in a
 * dark room and the same block beside a glowstone were byte-identical on
 * screen -- 11,412 green pixels at mean 43.79 in both -- while
 * `emissiveColor.r` read 0.072 and 0.373 in JavaScript. 56d40d2 was the same
 * bug in a different uniform.
 *
 * REJECTED -- `mat.unfreeze()`. It does not stick: `isReadyForSubMesh` ends
 * with another `_checkScenePerformancePriority()`, so the next ready check
 * re-freezes it. Measured -- unfreeze, three ticks, five frames, and
 * `mat.isFrozen` reads TRUE again with the pixels never having moved.
 *
 * REJECTED -- `scene.performancePriority = BackwardCompatible`, which is one
 * line and unfreezes several hundred chunk materials to fix six entity ones.
 *
 * So: shadow the getter. An own property on the instance wins over the
 * prototype's, Babylon never assigns to `isFrozen` (there is no setter), and
 * the material takes the live path forever.
 *
 * IT LIVES HERE NOW. It spent its first life in playerModel.js because this
 * file was being rewritten the day it was written, and two separate agents
 * said in comments that it belonged in `trackEntityLight`. Every tracked
 * material gets it by construction below, so the three call sites that used
 * to do it by hand cannot forget to.
 */
export function keepMaterialLive(mat) {
  Object.defineProperty(mat, 'isFrozen', { get: () => false, configurable: true })
  return mat
}

/*
 * THE MAX, AND BOTH HALVES OF IT ARE NOW REAL.
 *
 * Minecraft lights an entity from `max(skyLight * daylight, blockLight)` at
 * its position. Both terms are computed here, in `skyTerm` and `blockTerm`,
 * and `max`ed:
 *
 *   blockTerm  window.blockLight.getBlockLight at the entity's feet, divided
 *              by 15. A player standing next to a glowstone in a pitch-dark
 *              room is lit by it, and walking away dims him one level per
 *              block, because that is what the BFS stored.
 *
 *   skyTerm    window.blockLight.getSkyLight at the same voxel, divided by 15,
 *              TIMES sky.js's `level`. The stored sky level has no clock in
 *              it -- it is 15 under open sky at midnight too -- so the
 *              multiply here is where the day/night cycle enters, and it
 *              enters on this term ONLY. That asymmetry is the feature: a
 *              glowstone is invisible against the noon sun outdoors and is
 *              the only thing lighting you in a cave at the same instant.
 *
 * THIS USED TO BE A PLACEHOLDER that returned `level` alone -- the daylight
 * term with `skyLight` silently treated as 15 everywhere -- and its docblock
 * said the real version would be a one-line change here with no change at any
 * call site. It was. The probe argument that `skyTerm` took and ignored on
 * purpose is the argument that made it one line, and it is now read.
 *
 * STILL deliberately not faked with a "can this entity see the sky"
 * heuristic. That was the cheap alternative, and it is now not merely rejected
 * but obsolete: a raycast darkens anyone standing in a doorway, where the real
 * propagated value says 15 because the doorway voxel is lit from the opening
 * beside it. Written down in docs/FUTURE.md as rejected.
 *
 * AN OPEN QUESTION, FLAGGED RATHER THAN SETTLED. The held-item agent read
 * `EntityRenderer.updateLightmap` in the MCP-919 decompile and found sky and
 * block combined ADDITIVELY (`f8 = f4 + f3`), not as the `max` this file is
 * built on. MCP-919 is 1.8.9; this project targets 1.21.8, and `LightTexture`
 * was rewritten in between -- the 1.8 lightmap is a 16x16 texture built per
 * (block, sky) pair, so "additive" there may be describing how the TEXTURE is
 * built rather than the per-voxel rule. Not changed on the strength of a
 * thirteen-year-old source. Whoever settles it should settle it against 1.21.
 *
 * AND A WARNING ABOUT MEASURING ANY OF THIS. noa sets
 * `scene.performancePriority = Intermediate`, Babylon turns that into
 * `checkReadyOnlyOnce`, `isFrozen` IS `checkReadyOnlyOnce`, and
 * `StandardMaterial` guards its whole material-UBO write behind
 * `!this.isFrozen` -- so `vEmissiveColor` and `vDiffuseColor` upload ONCE and
 * never again. Every number this file writes can be correct in JavaScript and
 * absent from the screen. `keepMaterialLive` below shadows the getter to stop
 * it, and `trackEntityLight` now calls it on every material it is handed, so
 * a tracked material cannot be a frozen one. Fourth time
 * `performancePriority` has done this here -- see 56d40d2, and see
 * blockLight.js, where the same trap is why terrain's daylight is a plugin
 * uniform and not a material property.
 *
 * A material with NO PROBE gets the old behaviour exactly -- `level` alone,
 * sky treated as open. That is deliberate rather than an oversight: a
 * material nobody has told where it is cannot be darkened honestly, and the
 * honest failure is "lit as if outdoors", which is how it always looked.
 */

/**
 * Material -> probe. A probe answers "where is the entity wearing this
 * material", as the live `[x, y, z]` array noa keeps up to date, or null if
 * nobody has said. Re-read every tick by setEntityLight.
 *
 * A Map rather than the Set this used to be, because block light is a
 * PER-ENTITY number and a Set of materials cannot say which entity a material
 * belongs to. Rejected: a parallel WeakMap beside the Set, which is the same
 * two facts in two containers that can disagree.
 */
const tracked = new Map()

let level = 1

/**
 * Point a material at the sky's light level.
 *
 * Sets up the whole entity shading model, so callers hand over a material and
 * never name a brightness: diffuse scaled to leave room for the floor, the
 * scene's ambient term zeroed (Babylon adds it, and noa leaves ambientColor
 * white, so it would be a SECOND uncontrolled floor on top of this one), and
 * emissive driven from `level` from here on.
 */
export function trackEntityLight(mat, probe = null) {
  keepMaterialLive(mat)
  mat.ambientColor = new Color3(0, 0, 0)
  mat.diffuseColor = new Color3(ENTITY_DIFFUSE, ENTITY_DIFFUSE, ENTITY_DIFFUSE)
  mat.emissiveColor = new Color3(0, 0, 0)
  tracked.set(mat, probe)
  // Entity materials outlive most things but not everything -- the held item
  // rebuilds its mesh, and an NPC can be removed. Without this the Set is a
  // leak that also writes to disposed materials every tick.
  mat.onDisposeObservable?.addOnce(() => tracked.delete(mat))
  apply(mat, probe)
  return mat
}

/**
 * Attach a position probe to a material that is already tracked.
 *
 * Exists because an NPC's skin material is built BEFORE his entity is --
 * npc.js needs the material to build the model, and the model to size the
 * body -- so there is no entity id to hand trackEntityLight at construction.
 * Rejected: reordering npc.js so the entity comes first, which is a bigger
 * edit to someone else's file than one late call, and rejected: passing a
 * `() => entityIdVariable` thunk through createSkinMaterial, which makes
 * every caller carry a late-binding hole for the sake of one.
 *
 * A material with no probe is not broken, it is just sky-only: blockTerm
 * returns 0 and the model behaves exactly as it did before this file learned
 * about block light.
 */
export function bindEntityLight(mat, probe) {
  if (!tracked.has(mat)) return mat
  tracked.set(mat, probe)
  apply(mat, probe)
  return mat
}

/** Called by sky.js, once a tick, with the same `level` the sun light gets. */
export function setEntityLight(value) {
  level = value
  /*
   * Both rig lights carry the FULL level, not half of it each. Babylon sums
   * `ndl * diffuse * intensity` over lights, so `level * (d0 + d1)` is what
   * reaches diffuseBase, ENTITY_DIFFUSE scales it to `0.6 * (d0 + d1)` and
   * the emissive adds the 0.4. Halving them here would halve vanilla's
   * MINECRAFT_LIGHT_POWER along with it.
   */
  if (rig) for (const l of rig) l.intensity = value
  /*
   * Once a tick, not once per mesh creation, because this file is handed
   * materials and Babylon is the only thing that knows which meshes wear
   * them. `getBindedMeshes` reads scene.useMaterialMeshMap's map rather than
   * scanning, and the Set makes every tick after the first a no-op.
   */
  adopt()
  for (const [mat, probe] of tracked) apply(mat, probe)
}

/**
 * The sky half of vanilla's max. 0..1.
 *
 * `skyLight(x, y, z) / 15 * daylight`, which is vanilla's term exactly.
 *
 * Read off `window.blockLight` for the same reason `blockTerm` is, and with
 * the same fallback: no engine, or no probe, and the term is `level` alone --
 * the sky treated as open everywhere, which is what this function returned
 * unconditionally before sky light existed. A missing engine should look like
 * the old world, not like a cave.
 */
function skyTerm(probe) {
  if (!probe) return level
  const light = typeof window !== 'undefined' ? window.blockLight : null
  if (!light || !light.getSkyLight) return level
  const p = probe()
  if (!p) return level
  return light.getSkyLight(p[0], p[1], p[2]) / MAX_LIGHT * level
}

/**
 * The block half, and the real one. 0..1.
 *
 * Read off `window.blockLight` rather than through an import of
 * installBlockLight's return value, because blockLight.js publishes itself on
 * window and main.js never routes it anywhere this module can see. Looked up
 * per call rather than cached at module load: this file is imported by
 * playerModel.js, which main.js imports before it installs the light engine,
 * so a cached reference would be undefined forever.
 *
 * The probe answers the entity's FEET, which is the voxel vanilla samples for
 * an entity's block light too, and getBlockLight floors for us. Feet rather
 * than eyes matters exactly once: standing on a glowstone, where the feet
 * voxel is the air above it at 14 and the eye voxel two up is 12.
 */
function blockTerm(probe) {
  if (!probe) return 0
  const light = typeof window !== 'undefined' ? window.blockLight : null
  if (!light) return 0
  const p = probe()
  if (!p) return 0
  return light.getBlockLight(p[0], p[1], p[2]) / MAX_LIGHT
}

/*
 * WHY THE DIFFUSE COLOUR MOVES TOO, which is the subtle part of this file.
 *
 * The shading model here is vanilla's `* 0.6 + 0.4`, and the two halves do
 * NOT come from the same place: the 0.4 floor is the emissive set below, and
 * the 0.6 comes from the scene's single directional light, whose intensity
 * sky.js drives with the same `level`. So the total an entity renders at is
 *
 *     level * (0.6 * faceTerm + 0.4)
 *
 * and block light cannot enter it through the emissive alone -- pushing the
 * floor up to 0.4 * 1.0 in a dark cave, with the 0.6 still scaled by a
 * midnight sun, tops out around half of what the same light level buys you
 * outdoors at noon. A glowstone would light a model to a visible but plainly
 * wrong brightness, which is the kind of "nearly right" this file's opening
 * comment is entirely about not shipping.
 *
 * So `gain` -- effective / sky -- is multiplied into diffuseColor, which is
 * PER MATERIAL where the light's intensity is per scene. It cancels the
 * light's own `level` exactly and leaves `effective * 0.6 * faceTerm`, so the
 * whole expression becomes `effective * (0.6 * faceTerm + 0.4)`. Vanilla's
 * formula, with block light substituted for the sun.
 *
 * Rejected: adding the shortfall (effective - sky) into the emissive floor
 * instead. One line shorter and it needs no division, but it adds a flat term
 * to every face equally, so a model lit by a glowstone loses its face shading
 * and reads as a cardboard cutout at exactly the moment you are looking at
 * it. Rejected: giving entities their own Babylon light, which is a second
 * brightness source, which is the bug at the top of this file.
 *
 * Values above 1 in diffuseColor are fine -- Babylon clamps the SUM of
 * diffuse + emissive + ambient to 1 before it multiplies the texture, so a
 * gain of 5 at midnight cannot blow anything out. And when there is no block
 * light the gain is exactly 1 and every number below is what it was before.
 */

/** Floor under the divisor. It stopped being paranoia when sky light landed:
 *  `skyTerm` is now genuinely 0 for anyone standing in a sealed cave, and the
 *  `effective / sky` gain below would be a division by zero without this. */
const MIN_SKY = 1e-3

function apply(mat, probe) {
  /*
   * LIGHT_FLOOR is the same number blockLight.js's fragment shader floors
   * terrain at, imported rather than retyped. Without it an entity in a sealed
   * unlit cave renders at exactly zero -- a black silhouette in front of walls
   * that are dim but visible, which reads as a missing texture rather than as
   * darkness. Vanilla's lightmap does not reach black either.
   */
  const effective = Math.max(skyTerm(probe), blockTerm(probe), LIGHT_FLOOR)
  /*
   * THE DIVISOR IS `level`, AND IT USED TO BE THE SKY TERM. Those were the
   * same number until sky light existed, so this line did not change meaning
   * when it changed shape -- but it did change which fact it depends on, and
   * the fact is: what `gain` has to cancel is the SCENE LIGHT'S INTENSITY, and
   * sky.js sets that to `level`. The sky TERM is now `level` scaled by how
   * much of the sky reaches this voxel, which is a different number in a cave
   * and would leave a model underground lit by the full noon sun.
   */
  const gain = effective / Math.max(level, MIN_SKY)
  const floor = effective * ENTITY_FLOOR
  const diffuse = ENTITY_DIFFUSE * gain
  mat.emissiveColor.set(floor, floor, floor)
  mat.diffuseColor.set(diffuse, diffuse, diffuse)
}
