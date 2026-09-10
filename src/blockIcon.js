import { BLOCK_BY_ID, iconFaces } from './blocks.js'
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

function blockCube(blockId, size) {
  const def = BLOCK_BY_ID.get(blockId)
  const el = document.createElement('div')
  el.className = 'block-icon'
  if (!def) return el

  const faces = iconFaces(def)
  // The face brightness ladder is what sells the 3D read. Minecraft lights
  // the top fully, the front at 80%, the side at 60%.
  const spec = [
    ['top', faces.top, 1.0],
    ['front', faces.side, 0.8],
    ['side', faces.side, 0.6],
  ]

  el.style.setProperty('--icon-size', `${size}px`)
  for (const [cls, texture, brightness] of spec) {
    const face = document.createElement('div')
    face.className = `icon-face icon-${cls}`
    face.style.backgroundImage = `url(/textures/${texture}.png)`
    face.style.filter = `brightness(${brightness})`
    el.appendChild(face)
  }
  return el
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
