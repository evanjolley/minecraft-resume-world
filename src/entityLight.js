import { Color3 } from '@babylonjs/core/Maths/math.color'

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
 * Rejected: reading light from the voxel the entity stands in, like vanilla.
 * noa has no light engine -- ambient occlusion and one directional vector,
 * with no per-voxel value to query. See the cave limitation below.
 */

/** Vanilla light.glsl's `* 0.6 + 0.4`, and the reason those two sum to 1. */
export const ENTITY_FLOOR = 0.4
export const ENTITY_DIFFUSE = 1 - ENTITY_FLOOR

/*
 * WHAT THIS DOES NOT DO: BLOCK LIGHT, AND THEREFORE CAVES.
 *
 * Minecraft lights an entity from max(skyLight * daylight, blockLight) at its
 * position. Only the first half is implementable here, because noa has no
 * light propagation at all -- the same gap that made the F3 screen drop its
 * Client/Server Light lines. So this is correct outdoors and WRONG
 * UNDERGROUND: a player in a cave stays lit as if they were standing in the
 * open, and a torch does not light them.
 *
 * Deliberately not faked with a "are you under cover" heuristic. A ray cast
 * to the sky would darken anyone standing in a doorway, and a wrong lighting
 * model is harder to notice and harder to remove than a missing one. Written
 * down in docs/FUTURE.md instead.
 */

/** Materials whose emissive tracks the clock. Set once per tick, by sky.js. */
const tracked = new Set()

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
export function trackEntityLight(mat) {
  mat.ambientColor = new Color3(0, 0, 0)
  mat.diffuseColor = new Color3(ENTITY_DIFFUSE, ENTITY_DIFFUSE, ENTITY_DIFFUSE)
  mat.emissiveColor = new Color3(0, 0, 0)
  tracked.add(mat)
  // Entity materials outlive most things but not everything -- the held item
  // rebuilds its mesh, and an NPC can be removed. Without this the Set is a
  // leak that also writes to disposed materials every tick.
  mat.onDisposeObservable?.addOnce(() => tracked.delete(mat))
  apply(mat)
  return mat
}

/** Called by sky.js, once a tick, with the same `level` the sun light gets. */
export function setEntityLight(value) {
  level = value
  for (const mat of tracked) apply(mat)
}

export function getEntityLight() {
  return level
}

/** Test seam: the suite needs to know whether anything is actually wired up. */
export function trackedEntityMaterials() {
  return [...tracked]
}

function apply(mat) {
  const floor = level * ENTITY_FLOOR
  mat.emissiveColor.set(floor, floor, floor)
}
