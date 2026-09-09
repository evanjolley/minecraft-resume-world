import { BLOCK_BY_ID, iconFaces } from './blocks.js'

/*
 * Inventory item icons.
 *
 * Minecraft draws inventory blocks as little 3D cubes seen from above-left,
 * not as flat squares. Reproducing that with three CSS-transformed faces is
 * far cheaper than a second WebGL context per slot, and it stays crisp
 * because the faces are just the 16x16 textures with pixelated scaling.
 *
 * Road not taken: pre-rendering each cube to a canvas once and caching the
 * data URL. Fewer DOM nodes, but then hover/selection effects need redrawing
 * and we lose the ability to size icons with CSS alone.
 */
export function createBlockIcon(blockId, size = 32) {
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
