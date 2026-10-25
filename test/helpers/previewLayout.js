/*
 * Where chapters 4, 5 and 6 sit in the test-only preview world, as plain data
 * with NO imports -- so node-side spec code can do coordinate arithmetic
 * without loading a build file.
 *
 * WHY THAT MATTERS: the builds call setSignText, src/signText.js imports
 * Babylon by extensionless paths that only vite resolves, so a build file
 * cannot be imported by node at all (the same is true of ch1, which is why
 * no node-side spec has ever imported it). Everything that needs the build
 * itself runs inside the page; see test/helpers/previewWorld.js.
 *
 * `side` is copied from the overworld rows so the builds are previewed with
 * the path on the side they were designed for: ch4 and ch6 are RIGHT (path
 * at local x = 0), ch5 is LEFT (path at local x = w - 1). Each plot has a
 * lane of open ground on its path side, so the "from the path" photographs
 * stand where a visitor will.
 */
export const PREVIEW_WORLD = 'preview-chapters'
export const PREVIEW_SIZE = 256
export const PREVIEW_ORIGIN_X = 87
export const PREVIEW_ORIGIN_Z = 56
export const PREVIEW_GROUND_Y = 136

export const PREVIEW_AT = {
  ch4: { x0: 24, z0: 8, side: 'RIGHT' },
  ch5: { x0: 108, z0: 8, side: 'LEFT' },
  ch6: { x0: 24, z0: 100, side: 'RIGHT' },
}

/** Plot-local -> world coordinates in the preview world: what /tp takes. */
export function previewWorldXYZ(id, x, y, z) {
  const p = PREVIEW_AT[id]
  return [p.x0 + x - PREVIEW_ORIGIN_X, PREVIEW_GROUND_Y + y, p.z0 + z - PREVIEW_ORIGIN_Z]
}
