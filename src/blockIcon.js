import { BLOCK_BY_ID, iconFaces } from './blocks.js'
import { SHAPE_BOXES } from './blockMeshes.js'
import { item, itemPlaces } from './items.js'

/*
 * Inventory icons, for both kinds of item.
 *
 * Minecraft draws a block as a little 3D cube seen from above-left and a
 * non-block item as a FLAT 16x16 sprite. That difference is not decoration:
 * it is how you tell a block of coal from a lump of coal at a glance, and a
 * pack that draws everything the same way reads as wrong immediately.
 *
 * One entry point takes an item id and decides which to draw, because every
 * caller has a stack and no caller should have to ask what kind of thing is
 * in it. Road not taken: two functions and a branch at each of the four call
 * sites, which is the same branch written four times.
 *
 * The cube is three CSS-transformed faces rather than a second WebGL context
 * per slot, and it stays crisp because the faces are just the 16x16 textures
 * with pixelated scaling.
 *
 * Road not taken: pre-rendering each cube to a canvas once and caching the
 * data URL. Fewer DOM nodes, but then hover/selection effects need redrawing
 * and we lose the ability to size icons with CSS alone.
 */
export function createItemIcon(itemId, size = 32) {
  return itemPlaces(itemId)
    ? blockCube(itemPlaces(itemId), size)
    : flatSprite(itemId, size)
}

/*
 * A block is not always a cube, and the icon has to say so.
 *
 * Reported from play: "clicked a prismarine block in creative menu, started
 * placing them down: its stairs! Texture in inv is full block." Every slab
 * and every stair drew a full cube, so the picture in the slot was simply not
 * the thing you got when you clicked it.
 *
 * The icon is now built from the same box list as the mesh and the collision:
 * `blocks.js` puts a `shape` key on every non-cube, `SHAPE_BOXES` turns it
 * into boxes in 0..1 block-local coordinates, and each box gets the same three
 * visible faces the cube always had. A cube is the one box [0,0,0,1,1,1], so
 * nothing about a cube's icon changes -- the old three faces are what this
 * produces for it, at the same positions.
 *
 * It generalises to all ten shapes in the table, not just the two that are
 * items: a `_top` variant comes out as the same picture mirrored through the
 * middle of the block (a top slab is a plate at eye level, an upside-down
 * stair hangs its step from the ceiling), and a stair's step sits on the side
 * it faces, which is a different corner for each of the four facings. Only
 * `slab_bottom` and `stairs_north_bottom` reach a slot today, because the
 * other eight are placement variants and not items -- see items.js.
 *
 * Road not taken: importing `shapeBoxesFor()` from blockMeshes instead of
 * SHAPE_BOXES. That reads the table installed at world load, so it answers
 * `undefined` until noa boots -- an icon built on a menu screen, or in a test
 * that never starts the engine, would silently fall back to a cube and this
 * bug would come back wearing a timing bug's clothes. `def.shape` is static
 * data and is right before anything is running.
 */
const UNIT_CUBE = [[0, 0, 0, 1, 1, 1]]

function blockCube(blockId, size) {
  const def = BLOCK_BY_ID.get(blockId)
  const el = document.createElement('div')
  el.className = 'block-icon'
  if (!def) return el

  /*
   * THE FRONT FACE, which is the third thing a slot was getting wrong.
   * Reported from play: "Furnace texture is wrong in the inventory."
   *
   * Sixteen blocks in blocks.js carry a distinct `front` -- the furnace's
   * mouth, the crafting table's grid, the carved pumpkin's face, the observer
   * and the dispenser -- and `iconFaces()` answers with `top` and `side`
   * only, so every one of them drew its plain side texture on all three
   * visible faces. A furnace with no mouth is not a furnace.
   *
   * It goes on the `front` face, which after the icon's fixed rotation is the
   * one on the LEFT of the pair and the brighter of the two. That is where
   * vanilla's own item icon puts it: the lit mouth faces the viewer, and the
   * side texture goes on the face turning away to the right.
   *
   * Merged here rather than fixed in `iconFaces()` where it belongs, because
   * blocks.js belongs to another agent this week. Reported rather than
   * edited, and the one-line merge is the version of this change that touches
   * only my own file.
   */
  const faces = { ...iconFaces(def), front: def.all ?? def.front ?? def.side }
  el.style.setProperty('--icon-size', `${size}px`)
  // For tests and for anyone poking at the DOM: which shape this icon drew.
  el.dataset.shape = def.shape ?? 'cube'
  for (const box of SHAPE_BOXES[def.shape] ?? UNIT_CUBE) {
    for (const face of boxFaces(box, faces)) el.appendChild(face)
  }
  return el
}

/*
 * The three visible faces of one box.
 *
 * Block-local coordinates are Minecraft's: x right, y UP, z toward the
 * viewer, all in 0..1 with the block's centre at (0.5, 0.5, 0.5). CSS screen
 * y points DOWN, which is the one sign flip below and the only place the two
 * spaces disagree.
 *
 * Each face is placed with `translate3d(...) rotate...` rather than the
 * `rotate... translateZ(...)` the cube used. Same result for a cube -- the
 * translation is in the PARENT's space and the rotation then happens about
 * the face's own centre -- and it is the form that generalises, because a
 * face of a half-height box is somewhere other than half a block from the
 * centre and there is no single translateZ that says so.
 *
 * The brightness ladder is unchanged: Minecraft lights the top fully, the
 * front at 80%, the side at 60%, and that ladder is what sells the 3D read.
 */
function boxFaces([x0, y0, z0, x1, y1, z1], faces) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2
  return [
    // [class, texture, brightness, width, height, centre, extra rotation,
    //  the sub-rectangle of the texture this face shows]
    ['top', faces.top, 1.0, w, d, [mx, y1, mz], ' rotateX(90deg)', [x0, w, z0, d]],
    ['front', faces.front, 0.8, w, h, [mx, my, z1], '', [x0, w, 1 - y1, h]],
    ['side', faces.side, 0.6, d, h, [x1, my, mz], ' rotateY(90deg)', [z0, d, 1 - y1, h]],
  ].map(([cls, texture, brightness, fw, fh, [cx, cy, cz], rotate, crop]) => {
    const el = document.createElement('div')
    el.className = `icon-face icon-${cls}`
    el.style.width = u(fw)
    el.style.height = u(fh)
    el.style.left = `calc(50% - ${u(fw / 2)})`
    el.style.top = `calc(50% - ${u(fh / 2)})`
    el.style.transform =
      `translate3d(${u(cx - 0.5)}, ${u(0.5 - cy)}, ${u(cz - 0.5)})${rotate}`
    el.style.backgroundImage = `url(/textures/${texture}.png)`
    el.style.filter = `brightness(${brightness})`
    applyCrop(el, crop)
    return el
  })
}

/** A length in block units, as CSS. `--face` is one whole block. */
const u = (n) => `calc(var(--face) * ${n})`

/*
 * Show only the part of the texture this face covers.
 *
 * Minecraft cuts a cuboid's texture from the SLICE of the parent block's
 * texture the cuboid occupies -- a bottom slab's side is the bottom half of
 * the texture, not the whole texture squashed to half height. blockMeshes.js
 * does exactly this with UVs when it builds the real mesh; this is the same
 * rule expressed as background-size and background-position, so the icon and
 * the block in the world are cut the same way.
 *
 * The position maths: to show the sub-rectangle starting at fraction `f` and
 * spanning `span`, the image is scaled to 1/span and the percentage that puts
 * image-fraction `f` at the container's left edge is f / (1 - span) * 100.
 * A span of 1 makes that 0/0, which is the whole texture and position 0.
 */
function applyCrop(el, [fx, spanX, fy, spanY]) {
  const pos = (f, span) => (span >= 1 ? 0 : (f / (1 - span)) * 100)
  el.style.backgroundSize = `${100 / spanX}% ${100 / spanY}%`
  el.style.backgroundPosition = `${pos(fx, spanX)}% ${pos(fy, spanY)}%`
}

/*
 * A flat item sprite, drawn at the FULL slot size.
 *
 * Note it is not inset the way the cube is: Minecraft's item sprites already
 * carry their own padding inside the 16x16 tile (a stick does not touch the
 * edges), so shrinking them again would leave them swimming in the slot.
 */
function flatSprite(itemId, size) {
  const def = item(itemId)
  const el = document.createElement('div')
  el.className = 'item-icon'
  el.style.width = el.style.height = `${size}px`
  if (def) el.style.backgroundImage = `url(/textures/item/${def.texture}.png)`
  return el
}
