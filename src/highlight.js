import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { targetShapeBoxesFor } from './blockMeshes.js'
import { isPaintingId, paintingNormal } from './blocks.js'
import { paintingAt, viewerRight } from './paintingArt.js'

/*
 * The selection outline: a wireframe of the block's SHAPE.
 *
 * WHAT THIS USED TO BE, and why that was never going to be right. noa's
 * highlight is one Babylon plane -- `CreatePlane("highlight", { size: 1 })`
 * in its rendering.js -- parked on the face the ray struck. This file existed
 * only to restyle that plane, because noa's white 20%-alpha fill washed out
 * the breaking crack underneath it. But a plane is a plane: it outlined ONE
 * face of ONE cell, so a slab got a full-size square floating over its empty
 * half and a torch got a square metre of nothing.
 *
 * WHAT VANILLA DRAWS. `LevelRenderer.renderHitOutline` hands the block's
 * outline shape to `ShapeRenderer.renderShape`, which calls
 * `VoxelShape.forAllEdges` and emits a line segment per edge. The whole
 * wireframe of the whole shape, every frame, in RGBA (0, 0, 0, 0.4) --
 * `ARGB.color(102, -16777216)` in 1.21.8's LevelRenderer, 102/255 = 0.4.
 * That is what is reproduced here.
 *
 * TWO DELIBERATE DEPARTURES FROM VANILLA, both recorded because they are the
 * kind of thing someone will otherwise "fix":
 *
 * 1. EACH BOX GETS ITS OWN TWELVE EDGES. Vanilla's `forAllEdges` is not a
 *    box-edge loop at all -- `DiscreteVoxelShape.forAllEdges` rasterises the
 *    shape to a grid and emits an edge only where the four cells around a
 *    grid line make it a silhouette or a crease, so the seam where a stair's
 *    two boxes meet flush is suppressed and collinear runs are merged. For
 *    every single-box shape here (slab, torch, cube) the two are identical;
 *    on a stair, ours draws one extra line across the tread where vanilla
 *    draws none. Implementing the grid rasteriser to delete one line was not
 *    worth it today, and this is the note that says so rather than the note
 *    that pretends the difference isn't there.
 *
 * 2. THE LINE IS OPAQUE, AND VANILLA'S IS 40%. Measured, not guessed: at
 *    alpha 0.4 a one-pixel GL line over terrain is invisible in this
 *    renderer -- not faint, gone -- and it comes back somewhere around 0.9.
 *    (Sweep the value and screenshot each step; that is how this was picked,
 *    after an hour of chasing a z-fight that was not happening.) Vanilla's
 *    0.4 rides on a line TWO pixels wide, which is a render type Babylon's
 *    LinesMesh does not have, so 0.4 here buys the transparency and loses the
 *    line. Opaque black is what a player can actually see, and the day this
 *    grows a real line width the 0.4 comes back with it.
 *
 * 3. THE Z-FIGHT FIX IS A TRANSLATION, NOT AN INFLATION. Vanilla does not
 *    grow the box; `RenderType.lines()` carries VIEW_OFFSET_Z_LAYERING, which
 *    scales the modelview by 4095/4096 before drawing (`ProjectionType.java`),
 *    pulling the wireframe toward the camera. Scaling the whole scene is not
 *    something one mesh can do, so the same thing is done to the mesh's
 *    ORIGIN: shifted toward the camera by distance/4096. For a mesh a single
 *    block across the two differ by a quarter of a millimetre, and unlike an
 *    inflated box it does not make the outline visibly bigger than the torch.
 */

/** See departure 2 above: vanilla is 0.4, and 0.4 does not survive here. */
const OUTLINE_ALPHA = 1

/** Vanilla's VIEW_OFFSET_Z_LAYERING, as a fraction of the view distance. */
const VIEW_OFFSET = 1 / 4096

/** What a block with no shape table entry is outlined as. */
const FULL_CUBE = [[0, 0, 0, 1, 1, 1]]

/* ------------------------------------------------------------------ *
 * A PAINTING IS OUTLINED AS ONE RECTANGLE, NOT AS SIX SQUARES.
 *
 * Everywhere else in this file the outline is a function of the BLOCK, and
 * that is honest: a slab is a slab whatever is next to it. A painting is the
 * one thing in this world where the block is not the object. A 3x2 painting
 * is six `painting_wall_*` blocks showing ONE picture -- paintingArt.js's
 * whole argument -- so outlining the cell under the crosshair drew a box
 * around one sixth of a photograph and told the player the wrong thing about
 * what they were about to break. (And breaking any cell takes the whole
 * painting off the wall, which is the behaviour the outline has to agree
 * with.)
 *
 * Vanilla does not have this problem and therefore has no answer to copy: its
 * painting is an entity, `renderHitOutline` never runs on one, and what you
 * get is the entity's own selection box around the whole rectangle. That is
 * the shape reproduced here, arrived at from the other direction.
 *
 * The rectangle is built from the ANCHOR cell -- the bottom-left as a viewer
 * sees it, which is the cell paintingArt.js keys everything on -- so the mesh
 * is positioned there rather than at the targeted cell. `right` and the
 * normal come from paintingArt.js and blocks.js rather than from the facing
 * NAME, for the reason those files both give: the east/west flip is the thing
 * that gets remembered wrong.
 *
 * Rejected: unioning the cells' boxes and letting build() emit twelve edges
 * per cell. Same silhouette, six times the lines, and the internal seams are
 * exactly the creases vanilla's edge rasteriser exists to suppress.
 * ------------------------------------------------------------------ */
const paintingOutline = (id, position) => {
  if (!isPaintingId(id)) return null
  const p = paintingAt(position[0], position[1], position[2])
  // A painting block with no art registered against it is a bare frame --
  // /setblock can make one -- and a bare frame really is one cell.
  if (!p) return null

  const right = viewerRight(paintingNormal(id))
  const cell = (targetShapeBoxesFor(id) ?? FULL_CUBE)[0]
  const box = [...cell]

  // The axis the rectangle grows along, and which way. `right` is an axis
  // vector, so this is +1 or -1 on exactly one of x and z.
  const r = right[0] ? 0 : 2
  if (right[r] > 0) box[r + 3] += p.w - 1
  else box[r] -= p.w - 1
  // ...and it grows UP from the anchor, which is why only the top moves.
  box[4] += p.h - 1

  const [ax, ay, az] = p.anchor.split(',').map(Number)
  return { key: `${id}:${p.w}x${p.h}`, boxes: [box], origin: [ax, ay, az] }
}

export function installHighlightStyle(noa) {
  /*
   * noa parks its own plane on the struck face via a `targetBlockChanged`
   * listener it deliberately hangs off itself "in case people want to remove
   * it later". Removing it is the supported exit, and it is better than the
   * alternatives: the plane is built LAZILY inside highlightBlockFace, so
   * with no listener the mesh is never created at all -- nothing to restyle,
   * nothing to hide, no second highlight to keep in step with this one.
   */
  noa.off('targetBlockChanged', noa.defaultBlockHighlightFunction)

  let mesh = null
  /**
   * What `mesh` was built for. The block id for everything except a painting,
   * whose geometry is also a function of its size -- hence a string key and
   * not a number. Two paintings of the same size on the same wall share it.
   */
  let builtFor = null
  const local = [0, 0, 0]

  /*
   * Rebuilt only when the SHAPE changes, not when the target moves. Panning
   * across a stone wall changes the targeted cell every few frames and must
   * not dispose and re-create a mesh each time; it only moves this one. The
   * shape is a function of the block id alone, so the id is the whole cache
   * key -- which is also why a slab and a stair of the same wood, being
   * different ids, cannot share a stale outline.
   */
  const build = (key, boxes) => {
    if (mesh) mesh.dispose()
    const lines = []
    for (const [x0, y0, z0, x1, y1, z1] of boxes) {
      const v = (x, y, z) => new Vector3(x, y, z)
      // Four uprights, then the top and bottom rings. The rings are 5-point
      // polylines rather than 4 separate segments -- CreateLineSystem takes
      // a polyline per entry, so a closed ring is one entry that returns to
      // its start.
      for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
        lines.push([v(x, y0, z), v(x, y1, z)])
      }
      for (const y of [y0, y1]) {
        lines.push([v(x0, y, z0), v(x1, y, z0), v(x1, y, z1), v(x0, y, z1), v(x0, y, z0)])
      }
    }
    mesh = CreateLineSystem('block-highlight', { lines }, noa.rendering.getScene())
    mesh.color = new Color3(0, 0, 0)
    mesh.alpha = OUTLINE_ALPHA
    // The crosshair is not a mouse: nothing may ever pick this mesh, and a
    // pickable outline would sit between the camera and the block it outlines.
    mesh.isPickable = false
    /*
     * Vertices are in BLOCK-LOCAL 0..1 coordinates and the mesh is moved to
     * the block each frame below, so the [0, 0, 0] here is just "put it at
     * the origin for now". That differs from debugScreen.js's chunk borders,
     * which bake absolute world coordinates into their vertices and let noa
     * re-base them; baking is right for geometry that never moves and wrong
     * for this, which moves every time you look somewhere else.
     */
    noa.rendering.addMeshToScene(mesh, false, [0, 0, 0])
    builtFor = key
  }

  /*
   * beforeRender, not tick. The target is computed at the top of noa's tick
   * and the world is drawn at up to twice the tick rate; positioning the
   * outline on tick leaves it a frame behind the block it is outlining, which
   * on a fast turn reads as the outline sliding into place.
   */
  noa.on('beforeRender', () => {
    const target = noa.targetedBlock
    if (!target) {
      if (mesh) mesh.setEnabled(false)
      return
    }
    /*
     * The shape, and WHERE the shape is anchored. They come back together
     * because for a painting they disagree with `target.position`: the
     * rectangle is drawn from its bottom-left cell however far away that is
     * from the one the crosshair struck.
     */
    const painting = paintingOutline(target.blockID, target.position)
    const key = painting ? painting.key : String(target.blockID)
    if (key !== builtFor) {
      build(key, painting ? painting.boxes : (targetShapeBoxesFor(target.blockID) ?? FULL_CUBE))
    }

    noa.globalToLocal(painting ? painting.origin : target.position, null, local)
    /*
     * ...and then toward the camera, by a fixed fraction of how far away it
     * is. See the VIEW_OFFSET note at the top: this is vanilla's line-layering
     * scale applied to the one mesh instead of to the projection.
     */
    const eye = noa.camera._localGetPosition()
    mesh.position.copyFromFloats(
      local[0] + (eye[0] - local[0]) * VIEW_OFFSET,
      local[1] + (eye[1] - local[1]) * VIEW_OFFSET,
      local[2] + (eye[2] - local[2]) * VIEW_OFFSET,
    )
    mesh.setEnabled(true)
  })
}
