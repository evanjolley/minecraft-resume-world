import { GAMERULES } from './authority.js'
import { createRainVolume } from './particles.js'
import { createRainAmbience } from './rainAudio.js'

/*
 * Weather: rain, thunder, and the clock that decides when they happen.
 *
 * WHAT WEATHER IS MADE OF, because /weather used to say it plainly and then
 * refuse to pretend: a particle volume that follows the camera and skips
 * sheltered columns (particles.js), a sky and light-level change (sky.js), an
 * ambient bed (rainAudio.js), and a thunder timer. This module is the state
 * that drives all four, and it holds NO rendering of its own.
 *
 * WHERE THE STATE LIVES. Weather is shared-world state in exactly the way game
 * rules and game modes are, so it goes behind authority.js like they do. It
 * does that by DECORATING the authority with a requestWeather method rather
 * than by being a second source of truth -- the same move itemEntity.js makes
 * on requestBlockChange, and for the same reason: the day a Durable Object
 * owns this, one method moves and no caller changes. commands.js asks the
 * authority; the authority asks this; nothing else may set the weather.
 *
 * Rejected: a boolean on the sky, flipped straight from the command. It works
 * for exactly as long as there is one player, and it puts a permission check
 * in a render module.
 *
 * EVERY NUMBER IS MINECRAFT'S:
 *
 *   0.01/tick   how fast rainLevel and thunderLevel ramp -- a plain linear
 *               step, not an ease -- so a storm takes 5 seconds to arrive.
 *   > 0.2       rainLevel above which it counts as raining.
 *   > 0.9       thunderLevel above which it counts as thundering.
 *   thunder x rain   vanilla's getThunderLevel multiplies by the rain level,
 *               so thunder cannot darken a sky that is not already raining.
 *   12000-180000  ticks of clear weather (10-150 minutes).
 *   12000-24000   ticks of rain (10-20 minutes).
 *   3600-15600    ticks of thunder (3-13 minutes).
 *   1/100000    per chunk per tick, the chance of a lightning strike.
 *
 * Deliberately NOT implemented: snow and ice. There are no biomes here and no
 * temperature, so every column would be the same one -- which is a decision
 * about world generation wearing a weather costume.
 */

const TICKS_PER_SECOND = 20

/*
 * Vanilla's four weather timers, as UniformInt providers. /weather with no
 * duration samples the SAME providers the natural cycle uses -- it does not
 * set a fixed 6000 ticks, which is the thing everyone assumes it does.
 */
const RAIN_DELAY = [12000, 180000]
const RAIN_DURATION = [12000, 24000]
const THUNDER_DELAY = [12000, 180000]
const THUNDER_DURATION = [3600, 15600]

/*
 * One bolt per ~500 ticks, or 25 seconds.
 *
 * Vanilla rolls 1-in-100000 per chunk per tick, but only for chunks within 128
 * blocks of a player -- about 200 of them -- which works out at this. Rolling
 * per chunk here would be the more honest-looking code and would give a
 * DIFFERENT answer, because this island is 25 chunks, not 200: a visitor would
 * see one strike every three minutes and conclude thunder does nothing. The
 * number a Minecraft player experiences is the one worth matching.
 */
const BOLT_ODDS_PER_TICK = 1 / 500

// Vanilla's skyFlashTime: a bolt washes the sky for two ticks.
const FLASH_TICKS = 2

export const WEATHER_KINDS = ['clear', 'rain', 'thunder']

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)
const sample = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1))

/*
 * authority.js's refusal, repeated rather than imported because it is not
 * exported -- vanilla never admits a command exists to someone who may not run
 * it, so a non-operator gets the ordinary parse failure. If that string ever
 * changes there, it changes here.
 */
const NOT_ALLOWED = { ok: false, error: 'Unknown or incomplete command, see below for error' }

/**
 * @param {object} noa
 * @param {object} deps
 * @param {object} deps.sky        installSky's handle; weather pushes levels into it.
 * @param {object} deps.authority  decorated with requestWeather.
 * @param {object} [deps.sounds]   installSounds' handle, for its AudioContext only.
 */
export function installWeather(noa, { sky, authority, sounds = null } = {}) {
  const rain = createRainVolume(noa)
  const ambience = createRainAmbience(sounds)

  /*
   * The game rule is registered INTO authority.js's table rather than added to
   * its source, because that file belongs to another agent this pass. It
   * belongs in the table itself -- /gamerule finds it either way, since it
   * reads the same object -- and moving it there is a three-line change that
   * needs no code around it.
   */
  if (!GAMERULES.doWeatherCycle) {
    GAMERULES.doWeatherCycle = { type: 'boolean', value: true }
  }

  /* Vanilla's LevelData: two independent countdowns plus a clear-weather
   * override, which is what makes /weather clear last a fixed stretch and then
   * hand control back to the cycle rather than freezing it forever. */
  let raining = false
  let thundering = false
  let clearTime = 0
  let rainTime = sample(RAIN_DELAY)
  let thunderTime = sample(THUNDER_DELAY)

  let rainLevel = 0
  let thunderLevel = 0
  let flashTicks = 0
  let bolts = 0

  const isRaining = () => rainLevel > 0.2
  const isThundering = () => thunderLevel * rainLevel > 0.9

  /** What /weather just did, for the message and for tests. */
  const kind = () => (thundering ? 'thunder' : raining ? 'rain' : 'clear')

  function setParameters(clear, weather, isRain, isThunder) {
    clearTime = clear
    rainTime = weather
    thunderTime = weather
    raining = isRain
    thundering = isThunder
  }

  /*
   * Vanilla's advanceWeatherCycle, timer for timer.
   *
   * The shape looks redundant -- why park both countdowns at 1 while clear
   * weather runs? -- and it is not: it guarantees that the tick after clear
   * weather expires, both timers hit zero and flip, so the world does not sit
   * in a fourth state waiting for a countdown that was never started.
   */
  function advanceCycle(ticks) {
    if (clearTime > 0) {
      clearTime -= ticks
      thunderTime = thundering ? 0 : 1
      rainTime = raining ? 0 : 1
      thundering = false
      raining = false
      return
    }
    if (thunderTime > 0) {
      thunderTime -= ticks
      if (thunderTime <= 0) thundering = !thundering
    } else {
      thunderTime = thundering ? sample(THUNDER_DURATION) : sample(THUNDER_DELAY)
    }
    if (rainTime > 0) {
      rainTime -= ticks
      if (rainTime <= 0) raining = !raining
    } else {
      rainTime = raining ? sample(RAIN_DURATION) : sample(RAIN_DELAY)
    }
  }

  /** A bolt: two ticks of flash, and a clap at a random distance. */
  function strike() {
    bolts++
    flashTicks = FLASH_TICKS
    /*
     * Pushed to the sky HERE as well as from the tick below, because sky.js
     * registered its tick handler first and therefore reads these levels one
     * tick before this module writes them. A 33 ms lag is nothing for a storm
     * rolling in over five seconds and is a third of a lightning flash.
     */
    sky.setWeatherLevels({ rain: rainLevel, thunder: thunderLevel * rainLevel, flash: 1 })
    // Vanilla plays entity.lightning_bolt.thunder at the strike, at a volume
    // that carries for 256 blocks. Distance is what makes one clap a crack and
    // the next a rumble, and here there is no bolt to measure it from.
    ambience.thunder(Math.random())
  }

  noa.on('tick', (dtMs) => {
    const ticks = (dtMs / 1000) * TICKS_PER_SECOND

    /*
     * doWeatherCycle gates the COUNTDOWN and nothing else, which is exactly
     * what vanilla gates: the ramps below, and /weather itself, run either
     * way. Turning it off freezes the weather you are in rather than stopping
     * a storm mid-fall.
     */
    if (GAMERULES.doWeatherCycle.value) advanceCycle(ticks)

    // A plain linear 0.01 per tick, clamped. Not an ease -- vanilla's is a
    // straight line, and five seconds of it is the whole transition.
    const step = 0.01 * ticks
    rainLevel = clamp01(rainLevel + (raining ? step : -step))
    thunderLevel = clamp01(thunderLevel + (thundering ? step : -step))

    if (flashTicks > 0) flashTicks -= ticks

    // Vanilla's getThunderLevel is thunderLevel * rainLevel, so a thunderstorm
    // that is still fading in cannot darken the sky ahead of its own rain.
    const storm = thunderLevel * rainLevel
    const flash = flashTicks > 0 ? Math.min(1, flashTicks / FLASH_TICKS) : 0

    sky.setWeatherLevels({ rain: rainLevel, thunder: storm, flash })
    rain.setLevel(rainLevel)
    // Vanilla swaps to weather.rain.above -- quieter, pitched down -- when the
    // column overhead is closed, which is the same test the drops use.
    ambience.setLevel(rainLevel, rain.sheltered)

    /*
     * Lightning only strikes where rain is actually falling: vanilla requires
     * isRainingAt(target), and a bolt out of a sky that is dry over your head
     * is the kind of detail that reads as fake without being nameable.
     */
    if (isThundering() && rain.openColumns > 0 && Math.random() < BOLT_ODDS_PER_TICK * ticks) {
      strike()
    }
  })

  /*
   * THE authority seam. Same shape as every request* in authority.js: op-gated,
   * promise-returning, one refusal shape, vanilla's wording from en_us.json.
   */
  authority.requestWeather = async (what, duration = null) => {
    if (!authority.isOperator()) return NOT_ALLOWED
    if (!WEATHER_KINDS.includes(what)) return { ok: false, error: `Unknown weather type: ${what}` }
    // No duration given means SAMPLE the provider, not a fixed default.
    if (what === 'clear') setParameters(duration ?? sample(RAIN_DELAY), 0, false, false)
    else if (what === 'rain') setParameters(0, duration ?? sample(RAIN_DURATION), true, false)
    else setParameters(0, duration ?? sample(THUNDER_DURATION), true, true)
    return { ok: true, message: `Set the weather to ${what}` }
  }

  return {
    /** 'clear' | 'rain' | 'thunder' -- what the world is HEADING for. */
    get kind() { return kind() },
    /** What it currently looks like, which lags the above by five seconds. */
    get rainLevel() { return rainLevel },
    get thunderLevel() { return thunderLevel * rainLevel },
    isRaining,
    isThundering,
    /** Lightning strikes since load, and a way to force one for a screenshot. */
    get bolts() { return bolts },
    strike,
    /** Ticks left on whichever countdown is currently running. */
    get timeLeft() { return clearTime > 0 ? clearTime : rainTime },
    rain,
    ambience,
    dispose() { rain.dispose(); ambience.dispose() },
  }
}
