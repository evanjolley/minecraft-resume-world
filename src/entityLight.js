import { Color3 } from '@babylonjs/core/Maths/math.color'

import { MAX_LIGHT } from './blockLight.js'

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
 * src/blockLight.js shipped 2026-09-16 and exposes getBlockLight, and this
 * file now calls it. See "THE MAX, AND THE HALF OF IT THAT IS A PLACEHOLDER"
 * below for what that does and does not buy.
 */

/** Vanilla light.glsl's `* 0.6 + 0.4`, and the reason those two sum to 1. */
export const ENTITY_FLOOR = 0.4
export const ENTITY_DIFFUSE = 1 - ENTITY_FLOOR

/*
 * THE MAX, AND THE HALF OF IT THAT IS A PLACEHOLDER.
 *
 * Minecraft lights an entity from `max(skyLight * daylight, blockLight)` at
 * its position. Both terms are now computed here, in `skyTerm` and
 * `blockTerm`, and `max`ed -- but only ONE of them is the real thing:
 *
 *   blockTerm  REAL. window.blockLight.getBlockLight at the entity's feet,
 *              divided by 15. A player standing next to a glowstone in a
 *              pitch-dark room is now lit by it, and walking away dims him
 *              one level per block, because that is what the BFS stored.
 *
 *   skyTerm    PLACEHOLDER, and it is important not to read it as the other
 *              half of vanilla's formula. It returns sky.js's `level` -- the
 *              DAYLIGHT term on its own, with `skyLight` silently treated as
 *              15 everywhere. SKY LIGHT DOES NOT EXIST: nothing in this
 *              engine knows which voxels can see the sky (blockLight.js says
 *              so at length). So the sky half is still "how bright is the sun
 *              right now", not "how much of the sun reaches HERE".
 *
 * What that costs, stated plainly so nobody reads a lit model in a cave as a
 * bug: underground at noon an entity is still lit as if it were standing in
 * the open, because the placeholder says the sun is out and the max picks it.
 * The block term can only ever RAISE brightness, so it cannot fix that -- a
 * cave gets dark when sky light lands, and not before.
 *
 * SHAPED SO SKY LIGHT DROPS IN WITHOUT A REWRITE. When it does, `skyTerm`
 * becomes `getSkyLight(x, y, z) / 15 * level` and takes the same probe every
 * other term takes; the `max`, the probes, the per-material bookkeeping and
 * everything below this comment stay exactly as they are. That is the whole
 * reason the daylight term is a named function rather than `level` inlined
 * into the max.
 *
 * STILL deliberately not faked with a "can this entity see the sky"
 * heuristic. A ray cast to the sky would darken anyone standing in a doorway,
 * and a wrong lighting model is harder to notice and harder to remove than a
 * missing one. Written down in docs/FUTURE.md instead.
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
 * The sky half of vanilla's max -- AND IT IS A STAND-IN, see the comment at
 * the top of this file. Vanilla's term is `skyLight(x,y,z) / 15 * daylight`;
 * this is `daylight` alone, because sky light is not built. The probe is
 * taken and ignored ON PURPOSE: it is the argument that makes the real
 * version a one-line change here rather than a change at the call site.
 */
function skyTerm(_probe) {
  return level
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

/** Floor under the divisor. sky.js's own floor is 0.18; this is paranoia
 *  about the Nether path and about anyone who calls setEntityLight(0). */
const MIN_SKY = 1e-3

function apply(mat, probe) {
  const sky = skyTerm(probe)
  const effective = Math.max(sky, blockTerm(probe))
  const gain = effective / Math.max(sky, MIN_SKY)
  const floor = effective * ENTITY_FLOOR
  const diffuse = ENTITY_DIFFUSE * gain
  mat.emissiveColor.set(floor, floor, floor)
  mat.diffuseColor.set(diffuse, diffuse, diffuse)
}
