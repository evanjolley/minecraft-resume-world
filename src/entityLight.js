import { Color3 } from '@babylonjs/core/Maths/math.color'

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
  for (const [mat, probe] of tracked) apply(mat, probe)
}

export function getEntityLight() {
  return level
}

/** Test seam: the suite needs to know whether anything is actually wired up. */
export function trackedEntityMaterials() {
  return [...tracked.keys()]
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
