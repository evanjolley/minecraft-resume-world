/*
 * Audio capture.
 *
 * Headless Chromium has no audio device, so nothing here can listen. What it
 * CAN do is watch the graph get built: sounds.js plays a sample by creating an
 * AudioBufferSourceNode, setting its buffer and playbackRate, connecting it to
 * a pooled gain and calling start(). Patching `start` and `connect` on the
 * prototype catches every one of those, with the buffer, the rate and the gain
 * it was routed through.
 *
 * That still leaves "which sample was that", because a decoded AudioBuffer
 * carries no memory of the file it came from. So `arm` decodes every sample in
 * the manifest a second time and hashes the PCM, giving a print -> name table
 * to classify captured sources against.
 *
 * Rejected: asserting on sounds.lastPlayed alone. It answers which EVENT fired
 * but not whether anything actually started, and the interesting bugs in this
 * module are all in the second half -- a manifest entry that never fetched, a
 * sample that failed to decode, a voice pool that handed back a dead node.
 *
 * Rejected: an offline context. sounds.js owns its context and creates it on a
 * user gesture; a second one would be measuring a different graph than the one
 * the game plays through.
 */

/*
 * KeyZ is bound to nothing in this world, which is the whole reason it is the
 * key used here: the autoplay gate wants a TRUSTED gesture, and every other
 * key opens a screen, swaps a hotbar slot or moves the player. This used to be
 * KeyQ, until Q became "throw the held item on the floor" -- a gesture key has
 * to stay a key that does nothing.
 */
const GESTURE_KEY = 'KeyZ'

/**
 * Patch the page's audio graph and build the fingerprint table.
 *
 * @returns a handle: `drain()` for captured sources, `clear()`, `dispose()`.
 *   Call dispose() before the page is handed to another spec -- the patch is
 *   on a browser prototype and would otherwise outlive this file.
 */
export async function armAudio(page) {
  await page.evaluate(() => {
    if (window.__audio) return
    const proto = AudioBufferSourceNode.prototype
    const original = { start: proto.start, connect: proto.connect }

    // connect() is patched only to remember the destination: sounds.js routes
    // every source through a pooled gain node whose value IS the mix, and
    // start() has no way back up the graph to read it.
    proto.connect = function (dest, ...rest) {
      this.__dest = dest
      return original.connect.call(this, dest, ...rest)
    }
    proto.start = function (...args) {
      window.__audio.records.push({
        print: this.buffer ? window.__audio.print(this.buffer) : null,
        rate: this.playbackRate.value,
        gain: this.__dest && this.__dest.gain ? this.__dest.gain.value : null,
      })
      return original.start.apply(this, args)
    }

    window.__audio = {
      records: [],
      restore() { proto.start = original.start; proto.connect = original.connect },
      /*
       * buffer.length alone is not a fingerprint -- a dozen of Minecraft's
       * samples happen to be exactly the same number of frames -- so the print
       * folds in the PCM itself. Strided because hashing 25k floats per sample
       * across 61 samples is real time under software GL, and every 97th frame
       * separates them all.
       */
      print(b) {
        const d = b.getChannelData(0)
        let h = b.length * 31 + b.numberOfChannels
        for (let i = 0; i < d.length; i += 97) h = (h * 33 + Math.round(d[i] * 1e6)) | 0
        return `${b.length}:${h}`
      },
      names: new Map(),
      all: [],
    }
  })

  // The gesture gate. sounds.js will not build a context without one, and a
  // suspended context makes play() a silent no-op that returns false.
  await page.keyboard.press(GESTURE_KEY)
  await page.waitForFunction(() => window.game.sounds.state === 'running',
    null, { timeout: 15_000, polling: 50 })
  await page.waitForFunction(() => window.game.sounds.decoded > 0,
    null, { timeout: 15_000, polling: 50 })

  await page.evaluate(async () => {
    if (window.__audio.names.size) return
    const sounds = window.game.sounds
    window.__audio.all = manifestNames(sounds.manifest)
    for (const name of window.__audio.all) {
      const res = await fetch(`/sounds/${name}.ogg`)
      const buf = await sounds.context.decodeAudioData(await res.arrayBuffer())
      const key = window.__audio.print(buf)
      const seen = window.__audio.names.get(key)
      // Collisions are recorded rather than resolved, so a test that lands on
      // an ambiguous sample sees the ambiguity instead of a coin flip.
      window.__audio.names.set(key, seen ? `${seen}|${name}` : name)
    }

    function manifestNames(m) {
      const out = []
      for (const [group, sets] of Object.entries(m.groups)) {
        for (const [set, count] of Object.entries(sets)) {
          for (let i = 1; i <= count; i++) out.push(`${set}/${group}${i}`)
        }
      }
      // The non-block half names its samples by their real vanilla path.
      for (const paths of Object.values(m.sets ?? {})) out.push(...paths)
      return out
    }
  })

  return {
    /** Every sample name in the manifest, in fetch order. Longer than the
     *  fingerprint table whenever two files decode to the same audio. */
    names: () => page.evaluate(() => [...window.__audio.all]),

    /** Names that share a fingerprint, as 'a|b' -- see the snow note in 12-sounds. */
    collisions: () => page.evaluate(() =>
      [...window.__audio.names.values()].filter(v => v.includes('|'))),

    /** Take everything captured so far and reset the buffer. */
    drain: () => page.evaluate(() => window.__audio.records.splice(0).map(r => ({
      ...r,
      name: window.__audio.names.get(r.print) ?? `unknown:${r.print}`,
    }))),

    clear: () => page.evaluate(() => { window.__audio.records.length = 0 }),

    /** Put the prototype back. Nothing else in the suite expects it patched. */
    dispose: () => page.evaluate(() => {
      if (!window.__audio) return
      window.__audio.restore()
      delete window.__audio
    }),
  }
}
