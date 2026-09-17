import { MC } from './physics.js'
import { entityBox } from './entityBox.js'

/*
 * THE SWIRL -- the coloured motes that orbit anything carrying an effect.
 *
 * THIS FILE WAS 365 LINES AND IS NOW 165, because the thing it was missing
 * arrived. Its own header used to open by explaining why it could not live in
 * particles.js: that file keyed pooled systems by texture, every quad in a
 * system shared one material tint, and per-particle colour is the entire
 * content of this effect. That was true and it is fixed -- `vertexColor: true`
 * on a spec, eleven lines in systemFor, and the pooled mesh, the CPU
 * billboard, the swap-remove, the globalToLocal rebase and the whole
 * per-frame loop are gone from here. Read particles.js's header; every trap
 * it names still applies and none of them are this file's problem any more.
 *
 * WHAT WAS ACTUALLY WRONG WITH THE PICTURE, which is a separate bug and the
 * one the owner reported. The old version drew a soft radial blob that grew,
 * faded out over the second half of its life and drifted outward at 0.22
 * blocks a second. Vanilla's entity_effect particle is none of those things.
 *
 *   `assets/minecraft/particles/entity_effect.json` names EIGHT sprites and
 *   every one is a hollow RING at a different diameter -- effect_0 is a
 *   two-pixel speck and effect_7 fills the 8x8 tile. SpellParticle picks the
 *   frame from its own age with setSpriteFromAge, and the list is in REVERSE
 *   (effect_7 first), so a mote is born as a wide ring and COLLAPSES INWARD
 *   to a dot. That collapse is the animation. A blob has no animation at all,
 *   which is why the swirl read as fog.
 *
 *   It does not fade. SpellParticle's per-tick alpha line is
 *   `alpha = lerp(0.05, alpha, originalAlpha)`, an ease toward a CONSTANT
 *   target -- it exists for the spyglass-scope case, where alpha is snapped to
 *   zero, and does nothing otherwise. The mote holds full opacity and then
 *   stops.
 *
 *   It does not shrink either. quadSize is fixed for the whole life; the
 *   apparent shrinking is entirely the sprite strip. So `shrink: false`, and
 *   this is the one place the two look like the same thing and are not.
 *
 *   And it moves forty times faster than the old one. See SPELL_SPEC.
 */

/*
 * SpellParticle's own numbers, converted from blocks-per-tick to
 * blocks-per-second once here rather than at every use.
 *
 *   super(level, x, y, z, 0.5 - RANDOM.nextDouble(), yd, 0.5 - RANDOM.nextDouble())
 *   this.friction = 0.96F
 *   this.gravity = -0.1F
 *   this.yd *= 0.2F
 *   this.quadSize *= 0.75F
 *   this.lifetime = (int)(8.0 / (Math.random() * 0.8 + 0.2))
 *   this.hasPhysics = false
 *
 * THE CONSTRUCTOR THROWS AWAY THE HORIZONTAL VELOCITY IT IS HANDED. Look at
 * the super() call: the x and z arguments are `0.5 - nextDouble()`, the
 * particle's own roll, not the caller's. LivingEntity passes (1.0, 1.0, 1.0)
 * and only the y survives -- and then gets multiplied by 0.2. So every spell
 * mote in the game launches at up to half a block per TICK sideways (ten
 * blocks a second) and 0.2 up, whatever spawned it. The old swirl's 0.22
 * blocks per second was two orders of magnitude short, which is most of why
 * it sat on the body like smoke instead of spreading.
 *
 * GRAVITY IS NEGATIVE, so motes RISE. Particle.tick does `yd -= 0.04 *
 * gravity`, and with gravity -0.1 that is +0.004 blocks/tick^2 upward, which
 * is 1.6 blocks/s^2 in this file's units. Hence the minus sign below, which
 * is not a typo.
 */
const TPS = MC.TICKS_PER_SECOND

export const SPELL_TEXTURE = 'particle/spell'

const SPELL_SPEC = {
  /*
   * Vanilla spawns at most one mote per entity per tick and they live under
   * two seconds, so a couple of bodies settle around 30 live. The headroom is
   * for the SPLASH, which throws 100 in a single frame and can have two in
   * the air at once.
   */
  pool: 512,
  // Negative: a spell mote drifts up. See the header.
  gravity: -0.004 * TPS * TPS,
  dragTick: 0.96,
  // hasPhysics = false. A mote passes through the world.
  collide: false,
  // Eight frames of ring, indexed by age.
  frames: 8,
  crops: 1,
  // Vanilla's particles do not roll, and a spinning ring reads as a wobble.
  spin: 0,
  // quadSize is CONSTANT over the life. The shrinking is the sprite.
  shrink: false,
  // SpellParticle takes the world lightmap like everything else here.
  dimmed: true,
  alphaTest: false,
  blend: true,
  vertexColor: true,
}

/* `(int)(8.0 / (random * 0.8 + 0.2))` ticks -- 8 to 40, so 0.4 to 2 seconds. */
const life = () => Math.floor(8 / (Math.random() * 0.8 + 0.2)) / TPS

/*
 * The quad's EDGE, in blocks, which is twice vanilla's quadSize.
 *
 * SingleQuadParticle starts at `0.1 * (random*0.5 + 0.5) * 2.0`, which is 0.1
 * to 0.2, and SpellParticle multiplies it by 0.75 -- so quadSize is 0.075 to
 * 0.15. THE QUAD SPANS PLUS AND MINUS THAT, so the edge is 0.15 to 0.3, and
 * particles.js's `size` is the edge (it halves it into `h` itself). Passing
 * quadSize straight through draws every mote at half size, which is what the
 * first screenshot showed and what the flame's own note already warns about.
 */
const quadSize = () => (0.1 * (Math.random() * 0.5 + 0.5) * 2) * 0.75 * 2

/** One mote's launch velocity, in blocks/second. `up` is vanilla's yd. */
function launch(p, up) {
  p.vx = (0.5 - Math.random()) * TPS
  p.vz = (0.5 - Math.random()) * TPS
  p.vy = up * 0.2 * TPS
}

export function installEffectSwirl(noa, effects, particles) {
  /*
   * Spawning is on the TICK and drawing is on the FRAME, which is the same
   * split hud.js's blink uses and for the same reason: vanilla's chance is
   * 1-in-4 PER MINECRAFT TICK, so rolling it per frame would make the density
   * a function of the frame rate. A 144 Hz machine would be lousy with motes.
   *
   * noa ticks at 30 and Minecraft at 20, so the chance is scaled by 20/30 --
   * the RATE is what vanilla specifies, and the rate is what has to survive
   * the conversion.
   */
  const TICK_RATIO = TPS / 30

  /*
   * Where on the body, and this is a DELIBERATE DEPARTURE with a screenshot
   * behind it.
   *
   * Vanilla is `getRandomX(0.5), getRandomY(), getRandomZ(0.5)` -- a uniform
   * point through the bounding box. That works in Minecraft and it did not
   * work here: the player MODEL is as wide as its box, so an interior point
   * is inside opaque geometry and the depth test eats it. Photographed in
   * third person with two effects up, the first version produced motes the
   * spec could count and the picture could not show.
   *
   * So the horizontal position is pushed out to the box's own half-width and
   * a hair beyond, and the height stays uniform over the box -- which is
   * where the swirl's shape comes from. With vanilla's real velocity now in
   * place the motes leave the skin within a tick or two anyway; this only
   * decides where the first frame of each one is.
   *
   * entityBox.js is what answers "where is this body, in world coordinates".
   * Reading `body.aabb` is the trap that file documents at length, because
   * the physics solver runs in noa's rebased frame.
   */
  function spawn(entity, color) {
    const box = entityBox(noa, entity)
    if (!box) return
    const hw = (box.max[0] - box.min[0]) / 2
    const a = Math.random() * Math.PI * 2
    const r = hw * 1.1
    const x = (box.min[0] + box.max[0]) / 2 + Math.cos(a) * r
    const z = (box.min[2] + box.max[2]) / 2 + Math.sin(a) * r
    const y = box.min[1] + Math.random() * (box.max[1] - box.min[1])

    const p = particles.emitTex(SPELL_TEXTURE, SPELL_SPEC, x, y, z, 0, 0, 0, life(), quadSize())
    if (!p) return
    launch(p, 1)
    p.r = color[0]; p.g = color[1]; p.b = color[2]
  }

  const onTick = () => {
    for (const entity of effects.affected) {
      const color = effects.swirlColor(entity)
      if (!color) continue
      if (Math.random() < effects.swirlChance(entity) * TICK_RATIO) spawn(entity, color)
    }
  }
  noa.on('tick', onTick)

  /* ------------------------------------------------------------------ *
   * The shatter, which is level event 2002 and was left as a TODO.
   *
   * potions.js's breakPotion already returned `{ at, color, hits }` with the
   * colour vanilla sends as the event's data int, and nothing drew it.
   * LevelRenderer's case 2002/2007, in full:
   *
   *   for (int i = 0; i < 100; i++) {
   *       double d = random.nextDouble() * 4.0;              // radius
   *       double e = random.nextDouble() * Math.PI * 2.0;    // angle
   *       double f = Math.cos(e) * d, h = Math.sin(e) * d;
   *       double g = 0.01 + random.nextDouble() * 0.5;
   *       Particle p = addParticleInternal(opts, ..., x + f*0.1, y + 0.3, z + h*0.1, f, g, h);
   *       float s = 0.75F + random.nextFloat() * 0.25F;
   *       p.setColor(red * s, green * s, blue * s);
   *       p.setPower((float)d);
   *   }
   *
   * TWO THINGS IN THAT ARE EASY TO GET WRONG, and both are why this is
   * transcribed rather than approximated.
   *
   *   `f` and `h` are computed, passed, and then DISCARDED -- SpellParticle's
   *   constructor overwrites the horizontal velocity with its own roll, same
   *   as above. What f and h actually do is set the POSITION offset (times
   *   0.1) and nothing else. Reproducing them as a velocity gives a neat
   *   radial starburst, which is not what a bottle breaking looks like.
   *
   *   `setPower(d)` is the real spread, applied AFTER construction:
   *   `xd *= d; yd = (yd - 0.1) * d + 0.1; zd *= d`. With d up to 4 that
   *   multiplies an already-fast mote by four, and it correlates speed with
   *   the position offset -- the ones thrown furthest out are the ones moving
   *   fastest. That correlation is the shape of the splash.
   *
   * The per-particle brightness jitter (0.75-1.0) is the other half: 100
   * motes of one flat colour read as a decal, and vanilla breaks that up
   * without changing the hue.
   * ------------------------------------------------------------------ */
  const SPLASH_COUNT = 100

  function shatter([x, y, z], color) {
    for (let i = 0; i < SPLASH_COUNT; i++) {
      const d = Math.random() * 4
      const e = Math.random() * Math.PI * 2
      const f = Math.cos(e) * d, h = Math.sin(e) * d
      const g = 0.01 + Math.random() * 0.5

      const p = particles.emitTex(SPELL_TEXTURE, SPELL_SPEC,
        x + f * 0.1, y + 0.3, z + h * 0.1, 0, 0, 0, life(), quadSize())
      if (!p) return
      launch(p, g)
      // setPower(d), verbatim. The +0.1/-0.1 is vanilla's, and it is what
      // keeps the burst from being pulled flat at large d.
      p.vx *= d
      p.vy = (p.vy - 0.1 * TPS) * d + 0.1 * TPS
      p.vz *= d

      const s = 0.75 + Math.random() * 0.25
      p.r = color[0] * s; p.g = color[1] * s; p.b = color[2] * s
    }
  }

  return {
    shatter,
    /** Live motes. The spec asserts this is non-empty before asserting colour. */
    get live() { return particles.liveIn(SPELL_TEXTURE) },
    /** Every live mote's colour, 0-1 per channel. For the spec's assertions. */
    colors() { return particles.stateIn(SPELL_TEXTURE).map(p => p.color) },
    /** Full per-mote state, so a spec can assert the frame really advances. */
    state() { return particles.stateIn(SPELL_TEXTURE) },
    dispose() { noa.off('tick', onTick) },
  }
}
