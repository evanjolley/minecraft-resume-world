/*
 * Error capture.
 *
 * Four separate channels, because a missing texture shows up in a different
 * one depending on how it was requested: a <img>/CSS url is a `requestfailed`
 * or a 404 response, a Babylon Texture is a console error, and a genuine bug
 * is a `pageerror`. Watching only console output -- which is what the
 * throwaway scripts did -- misses two of the three.
 */

/*
 * Noise that headless produces and a browser with a human in it does not.
 * Filtered by SUBSTRING, and each entry has to justify itself here, because
 * this list is the one place a real failure could hide.
 */
const HEADLESS_NOISE = [
  // Pointer lock is never granted without a trusted user gesture, and main.js
  // retries it ~15 times after any click. Chrome rejects the returned promise,
  // which surfaces as an unhandled rejection. Nothing to do with the game.
  'requestPointerLock',
  'pointer lock',
  'PointerLock',
  // Same event, phrased by Chrome as a permissions-policy complaint.
  'exited the lock',
  // swiftshader announces itself on some builds.
  'SwiftShader',
  'Automatic fallback to software WebGL',
]

const isNoise = (text) => HEADLESS_NOISE.some(n => text.includes(n))

/**
 * Attaches the four listeners to a page and returns a collector.
 *
 * `since()` is what makes a shared page usable: it snapshots the current
 * length so a later test can assert "nothing new broke" without inheriting
 * every error an earlier test deliberately provoked.
 */
export function watchErrors(page) {
  const all = []
  const push = (kind, text) => { if (!isNoise(text)) all.push(`[${kind}] ${text}`) }

  page.on('pageerror', e => push('pageerror', e.stack || e.message))
  page.on('console', m => { if (m.type() === 'error') push('console', m.text()) })
  page.on('requestfailed', r => {
    push('requestfailed', `${r.url()} ${r.failure()?.errorText ?? ''}`)
  })
  page.on('response', r => {
    if (r.status() >= 400) push('http', `${r.status()} ${r.url()}`)
  })

  return {
    all,
    /** Everything seen so far. */
    list: () => all.slice(),
    /** A cursor, so one test can assert only on errors it caused. */
    mark: () => all.length,
    since: (n) => all.slice(n),
  }
}
