/*
 * The sound of rain, synthesised.
 *
 * WHY THIS EXISTS RATHER THAN A SAMPLE. Minecraft's rain is eight one-shot
 * samples (`weather.rain`, from ambient/weather/rain1-8) fired at a random
 * point overhead about every three ticks, with a muffled variant
 * (`weather.rain.above`, volume 0.1 pitch 0.5) played instead when you are
 * under cover. Those samples are Mojang's, they are not in this repo, and
 * scripts/build-sounds.mjs -- the one thing that could fetch them out of a
 * local Minecraft install -- is another agent's file this pass. Rather than
 * ship a silent storm, this builds the bed out of filtered noise.
 *
 * Filtered noise is not a compromise for rain specifically: rain IS broadband
 * noise, and the whole character of it is in the filter. The part that is
 * genuinely lost is the individual patter of Minecraft's samples, which is why
 * the wiring for the real thing is written up in the report rather than
 * quietly dropped.
 *
 * IT DOES NOT OWN AN AUDIO CONTEXT. sounds.js creates one on the first user
 * gesture (browsers refuse before that) and exposes it; a second context would
 * be a second output device's worth of latency and would not be muted by
 * anything that mutes the first. So this waits for that context to appear and
 * hangs off it, and does nothing at all while it is null.
 */

/* Vanilla's rain is played at volume 0.2, and 0.1 when you are sheltered.
 * These are the same ratio against a bed that is always playing rather than
 * one-shots, so they land quieter in absolute terms. */
const RAIN_GAIN = 0.17
const SHELTERED_GAIN = 0.07

// Open sky is bright and hissy; through a roof you only get the low end.
const OPEN_CUTOFF = 5200
const SHELTERED_CUTOFF = 700

// How fast the bed follows a change. A storm arrives over five seconds, and
// audio that snapped to its new level would arrive before the picture.
const SMOOTH_SECONDS = 1.5

/** Two seconds of white noise, looped. Long enough that the loop point is not
 *  a rhythm you can hear. */
function noiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

/**
 * @param {object|null} sounds  the module from sounds.js, for its AudioContext.
 *   Null, or a context that never appears, leaves every method a no-op.
 */
export function createRainAmbience(sounds) {
  let ctx = null
  let source = null
  let filter = null
  let gain = null
  let level = 0
  let sheltered = false

  /* Built on first use, not at install: the context does not exist until the
   * player has clicked something, and a graph built against a null context is
   * an exception in the middle of the first tick of rain. */
  function ensure() {
    if (gain) return true
    const c = sounds?.context
    if (!c || c.state !== 'running') return false
    ctx = c
    source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx)
    source.loop = true
    filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = OPEN_CUTOFF
    // Resonance flat: a peak at the cutoff makes noise whistle, and rain has
    // no pitch in it at all.
    filter.Q.value = 0.4
    gain = ctx.createGain()
    gain.gain.value = 0
    source.connect(filter).connect(gain).connect(ctx.destination)
    // Started once and never stopped -- an AudioBufferSourceNode cannot be
    // restarted, so the gain is the switch, not the source.
    source.start()
    return true
  }

  const apply = () => {
    if (!gain) return
    const target = level * (sheltered ? SHELTERED_GAIN : RAIN_GAIN)
    const cutoff = sheltered ? SHELTERED_CUTOFF : OPEN_CUTOFF
    const t = ctx.currentTime
    // setTargetAtTime rather than linearRamp: the level changes every tick and
    // a ramp scheduled every tick fights the one before it.
    gain.gain.setTargetAtTime(target, t, SMOOTH_SECONDS / 3)
    filter.frequency.setTargetAtTime(cutoff, t, SMOOTH_SECONDS / 3)
  }

  return {
    /**
     * @param {number} v 0..1, the rain level.
     * @param {boolean} under true when the player has a roof over them, which
     *   is vanilla's weather.rain.above case: quieter and much duller.
     */
    setLevel(v, under = false) {
      level = v < 0 ? 0 : v > 1 ? 1 : v
      sheltered = under
      if (level <= 0 && !gain) return   // don't build a graph to play silence
      if (!ensure()) return
      apply()
    },

    /**
     * One thunderclap: a noise burst under a sweeping lowpass, which is what
     * distance does to a real one -- the high end arrives first and the low
     * end is all that is left by the time it has travelled.
     *
     * @param {number} distance 0 (overhead) .. 1 (far off).
     */
    thunder(distance = 0.3) {
      if (!ensure()) return
      const t = ctx.currentTime
      const length = 2.5 + distance * 2.5
      const src = ctx.createBufferSource()
      src.buffer = noiseBuffer(ctx, length)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.Q.value = 0.7
      lp.frequency.setValueAtTime(2600 - distance * 2000, t)
      lp.frequency.exponentialRampToValueAtTime(90, t + length)
      const g = ctx.createGain()
      const peak = 0.55 * (1 - distance * 0.6)
      // A crack, then a long decaying rumble. One envelope, two slopes.
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(peak, t + 0.04 + distance * 0.3)
      g.gain.exponentialRampToValueAtTime(0.0001, t + length)
      src.connect(lp).connect(g).connect(ctx.destination)
      src.start(t)
      src.stop(t + length)
      // Nodes are disposable, unlike the bed: Web Audio collects a source once
      // it has finished and nothing references it.
      src.onended = () => { try { g.disconnect() } catch { /* already gone */ } }
    },

    /** For tests: has the graph actually been built yet. */
    get running() { return !!gain },

    dispose() {
      if (!gain) return
      try { source.stop() } catch { /* never started */ }
      gain.disconnect()
      gain = null
    },
  }
}
