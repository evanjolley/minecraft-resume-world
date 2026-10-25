/*
 * The sky's arithmetic, as Java Edition 1.21 does it. Pure functions of the
 * clock and the weather, so a spec can assert vanilla's numbers outright.
 *
 * Every function here is a port, and the vanilla method it ports is named on
 * it. The one idea that runs through all of them is the CELESTIAL ANGLE:
 * vanilla does not move the sun at a constant rate. DimensionType.timeOfDay
 * bends the clock through a half cosine, so the sun lingers near the top of
 * the sky and hurries across the horizon. The visible result is that day is
 * longer than night. The sun is above the horizon from about tick 23215 to
 * tick 12785, 13570 ticks out of 24000, and at tick 0 it is already about 12
 * degrees up. This world used to drive the sun at a constant rate, which made
 * day and night exactly equal and put sunrise at tick 0.
 */

export const TICKS_PER_DAY = 24000

const TAU = Math.PI * 2
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const frac = (v) => v - Math.floor(v)
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
/* Rec. 601 weights, the ones vanilla's weather tint uses. */
const luma = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11

/** Plains, the biome every sky color here assumes. Biome.skyColor 0x78A7FF. */
export const BIOME_SKY = [0x78 / 255, 0xa7 / 255, 0xff / 255]
/** Plains fog. Biome.fogColor 0xC0D8FF. */
export const BIOME_FOG = [0xc0 / 255, 0xd8 / 255, 0xff / 255]

/**
 * DimensionType.timeOfDay. 0 is noon (sun overhead), 0.25 sunset, 0.5
 * midnight, 0.75 sunrise. Takes any tick count, including day counts past
 * the first.
 */
export function celestialAngle(dayTime) {
  const d = frac(dayTime / TICKS_PER_DAY - 0.25)
  const e = 0.5 - Math.cos(d * Math.PI) / 2
  return (d * 2 + e) / 3
}

/**
 * Unit vector toward the sun. The sun rises in the east, which is -X in this
 * world (+X is west; see docs/TERRAIN.md), crosses overhead and sets at +X.
 * The moon is the negation.
 */
export function sunDirection(angle) {
  return [Math.sin(angle * TAU), Math.cos(angle * TAU), 0]
}

/** cos(angle * 2pi) * 2 + 0.5, clamped: the factor the sky, fog and clouds share. */
const daylight = (angle) => clamp01(Math.cos(angle * TAU) * 2 + 0.5)

/**
 * The weather tint ClientLevel applies to the sky and the clouds: drag the
 * color toward a grey of its own luminance, 60% as bright under rain and 20%
 * under thunder. `weight` is 0.75 for the sky and 0.95 for clouds.
 */
export function weatherTint(c, rain, thunder, weight) {
  let out = c
  if (rain > 0) { const g = luma(out) * 0.6; out = mix(out, [g, g, g], rain * weight) }
  if (thunder > 0) { const g = luma(out) * 0.2; out = mix(out, [g, g, g], thunder * weight) }
  return out
}

/**
 * ClientLevel.getSkyColor: the top of the dome. Black at midnight, which is
 * vanilla; what keeps a night sky from reading as pure black is the fog color
 * at the horizon and the stars.
 */
export function skyColor(angle, rain = 0, thunder = 0, flash = 0) {
  const f = daylight(angle)
  let c = [BIOME_SKY[0] * f, BIOME_SKY[1] * f, BIOME_SKY[2] * f]
  c = weatherTint(c, rain, thunder, 0.75)
  // Lightning: ClientLevel mixes toward (0.8, 0.8, 1.0) by flash * 0.45.
  if (flash > 0) c = mix(c, [0.8, 0.8, 1.0], flash * 0.45)
  return c
}

/**
 * FogRenderer.setupColor, without the parts that depend on where the camera
 * looks (the sunrise blend is applied per direction by the dome instead).
 * `renderChunks` is the render distance in Minecraft chunks; vanilla mixes the
 * fog toward the sky color the shorter it is.
 */
export function fogColor(angle, rain = 0, thunder = 0, renderChunks = 8) {
  const f = daylight(angle) * 0.94 + 0.06
  let c = [BIOME_FOG[0] * f, BIOME_FOG[1] * f, BIOME_FOG[2] * f]
  const sky = skyColor(angle, rain, thunder)
  const k = 1 - Math.pow(0.25 + 0.75 * renderChunks / 32, 0.25)
  c = mix(c, sky, k)
  if (rain > 0) {
    const s = 1 - rain * 0.5
    c = [c[0] * s, c[1] * s, c[2] * (1 - rain * 0.4)]
  }
  if (thunder > 0) {
    const s = 1 - thunder * 0.5
    c = [c[0] * s, c[1] * s, c[2] * s]
  }
  return c
}

/**
 * DimensionSpecialEffects.getSunriseColor: [r, g, b, alpha] while the sun is
 * within 0.4 of the horizon (in cosine), else null.
 */
export function sunriseColor(angle) {
  const g = Math.cos(angle * TAU)
  if (g < -0.4 || g > 0.4) return null
  const i = g / 0.4 * 0.5 + 0.5
  let a = 1 - (1 - Math.sin(i * Math.PI)) * 0.99
  a *= a
  return [i * 0.3 + 0.7, i * i * 0.7 + 0.2, 0.2, a]
}

/** ClientLevel.getStarBrightness, times what rain leaves of it. */
export function starBrightness(angle, rain = 0) {
  const f = clamp01(1 - (Math.cos(angle * TAU) * 2 + 0.25))
  return f * f * 0.5 * (1 - rain)
}

/**
 * Level.getSkyDarken: how bright sky light is, 0.2 at night to 1 at noon,
 * before the lightmap. Rain and thunder each take 5/16 of the daylight part.
 */
export function skyDarken(angle, rain = 0, thunder = 0) {
  let g = clamp01(Math.cos(angle * TAU) * 2 + 0.2)
  g *= 1 - rain * 5 / 16
  g *= 1 - thunder * 5 / 16
  return g * 0.8 + 0.2
}

/** ClientLevel.getCloudColor. */
export function cloudColor(angle, rain = 0, thunder = 0) {
  const f = daylight(angle)
  // Vanilla's order: rain greys the white, daylight scales it, thunder last.
  const c = weatherTint([1, 1, 1], rain, 0, 0.95)
  return weatherTint([c[0] * (f * 0.9 + 0.1), c[1] * (f * 0.9 + 0.1), c[2] * (f * 0.85 + 0.15)],
    0, thunder, 0.95)
}

/** DimensionType.moonPhase: 0 is full, 4 is new, one step per day. */
export function moonPhase(dayTime) {
  return Math.floor(dayTime / TICKS_PER_DAY) % 8
}
