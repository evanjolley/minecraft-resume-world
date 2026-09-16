/*
 * WHERE THE BODIES ARE.
 *
 * One question, asked in world coordinates: what is standing in this box.
 *
 * It exists because two unrelated features want the same answer and neither
 * of them is allowed to guess it. Placement is the one that is here today --
 * Minecraft refuses to put a block inside a living entity, which is why you
 * cannot brick yourself in from below (`BlockItem.placeBlock` ->
 * `Level.isUnobstructed`). Combat is the one that is coming: the owner wants
 * to punch Evan and be punched back, and a punch is this same query with a
 * different box, swung in front of the face instead of sitting on a voxel.
 *
 * So it is written as a box test rather than as a placement check. A function
 * called `canPlaceAt` would have to be rewritten the day a fist needs it.
 *
 * WHAT COUNTS AS A BODY: the `physics` component, not the `position` one.
 * Position is the wider set and the wrong one -- anything noa can draw has a
 * position, while a thing you can collide with, stand on, or hit is exactly a
 * thing with a rigid body in the solver. It is also the set that grows
 * correctly: an NPC got a body in the same pass that produced this file, and
 * whatever becomes punchable next will need one too. debugScreen.js's hitbox
 * overlay already walks this same list, which is a good sign it is the list
 * that means "the entities that are physically here".
 *
 * Dropped items are deliberately NOT in it, and that is vanilla's answer too
 * -- `canBeCollidedWith` is false for an ItemEntity, so you can place a block
 * through a floating pickaxe. It costs nothing here because itemEntity.js
 * never made them noa entities in the first place: they are a plain array
 * with their own eight-line integrator.
 */

/*
 * WORLD COORDINATES, and this is the trap the whole file is arranged around.
 *
 * noa keeps THREE positions per entity and only one of them is global.
 * `_localPosition` is the real one and `_extents` is derived from it, but
 * both are relative to `noa.worldOriginOffset` -- the floating origin noa
 * rebases as the player travels, which was 138 blocks from the origin last
 * time anyone measured. `body.aabb` is the same story: the physics solver
 * runs in the rebased frame, so its boxes are local too.
 *
 * `position` is the global one, by noa's own docs, and is the bottom CENTRE
 * of the box rather than a corner. Everything a caller has is a world
 * coordinate -- a targeted voxel, a /setblock argument, a swing in front of
 * the camera -- so building the box from `position` means no frame conversion
 * happens anywhere, and a conversion that never happens cannot be forgotten.
 *
 * Rejected: `body.aabb`, which is the obvious choice and is already a box, so
 * this would be four lines instead of ten. It is in the wrong frame, and the
 * failure mode is the one npc.js documents at length for `testSolid`: it does
 * not throw, it answers confidently about a voxel a hundred blocks away.
 * debugScreen.js reads `body.aabb` and is right to -- it draws into the
 * scene, which is in local coordinates.
 */
export function entityBox(noa, entity) {
  const p = noa.ents.getPositionData(entity)
  if (!p?.position) return null
  const hw = p.width / 2
  const [x, y, z] = p.position
  return {
    min: [x - hw, y, z - hw],
    max: [x + hw, y + p.height, z + hw],
  }
}

/*
 * STRICT inequalities, so boxes that merely touch do not count as overlapping.
 *
 * It is the difference between "you may not build inside someone" and "you
 * may not build next to them". A player standing on top of a block has their
 * feet at exactly its ceiling, and a >= here would call that an intersection
 * and refuse every placement in the column they are standing in.
 */
const overlaps = (a, b) =>
  a.min[0] < b.max[0] && a.max[0] > b.min[0] &&
  a.min[1] < b.max[1] && a.max[1] > b.min[1] &&
  a.min[2] < b.max[2] && a.max[2] > b.min[2]

/**
 * Every simulated body overlapping a world-space box.
 *
 * Returns the ids rather than a boolean, because the callers that are coming
 * need to know WHICH -- a punch has to damage something specific -- and a
 * caller that only wants to know whether the box is clear can ask for
 * `.length`. The reverse does not work.
 *
 * @param {[number,number,number]} min  inclusive corner, world coordinates
 * @param {[number,number,number]} max  exclusive corner, world coordinates
 * @returns {number[]} entity ids
 */
export function entitiesInBox(noa, min, max) {
  const box = { min, max }
  const hits = []
  for (const state of noa.ents.getStatesList(noa.ents.names.physics)) {
    const other = entityBox(noa, state.__id)
    if (other && overlaps(other, box)) hits.push(state.__id)
  }
  return hits
}

/**
 * The same question about one voxel, which is the shape placement asks in.
 *
 * THE WHOLE CELL, not its centre. A 0.6-wide NPC standing dead in the middle
 * of a block does contain its centre, and so does nothing else -- clip the
 * corner of his box and a centre test says the cell is empty and lets you
 * build through his shoulder.
 */
export const entitiesInCell = (noa, x, y, z) =>
  entitiesInBox(noa, [x, y, z], [x + 1, y + 1, z + 1])
