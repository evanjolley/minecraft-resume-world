import { MC } from './physics.js'

/*
 * Water and lava: being in one, moving through one, and what each does to you.
 *
 * WHAT NOA GIVES YOU, AND WHAT IT DOES NOT. Worth knowing before touching any
 * of this, because the gap is larger than the docs suggest.
 *
 * Free:
 *   - `fluid: true` on a block registration flips solid and opaque off, so you
 *     fall into water instead of standing on it, and the crosshair raycast
 *     (blocks.js's blockTargetIdCheck) skips it so you cannot mine or place it.
 *   - voxel-physics-engine's applyFluidForces runs every step, works out how
 *     much of the player's box is under the surface, and applies an Archimedes
 *     force plus a heavier drag. `body.inFluid` and `body.ratioInFluid` are the
 *     result and are correct.
 *   - `body.fluidDrag` is a PER-BODY override of that drag. Genuinely useful.
 *
 * Not free, and this is the trap:
 *   - `fluidDensity` and `viscosity` on a block registration are DEAD in noa
 *     0.33. registry.js stores them in blockProps and nothing reads them back.
 *     applyFluidForces uses the engine-global `self.fluidDensity`; the drag
 *     term uses the engine-global `self.fluidDrag` or the per-body override.
 *     So the engine has no idea that lava is thicker than water, and the only
 *     way to tell it is to change the global as you swim between them -- which
 *     is what setFluid() below does, and why it is commented as global.
 *   - There is no swimming. Nothing converts "jump is held" into upward motion
 *     while off the ground, so the climb is applied here as a force.
 *   - There is no drowning, no burning, and no fall-damage cancel.
 *
 * ------------------------------------------------------------------
 * MINECRAFT'S NUMBERS, and how they map onto a continuous integrator.
 *
 * Minecraft's fluid movement is three per-tick numbers in LivingEntity.travel:
 * an acceleration, a velocity retention, and (for the climb) an impulse.
 *
 *   water:  -0.005 b/tick^2 down   (gravity 0.08 / 16), retention 0.8/tick
 *   lava:   -0.02  b/tick^2 down   (gravity 0.08 / 4),  retention 0.5/tick
 *   climb:  +0.04  b/tick^2        (LivingEntity.jumpInLiquid -- and note it
 *                                   is the SAME value in both fluids)
 *
 * Accelerations convert cleanly: a tick is 0.05 s, so b/tick^2 * 400 = b/s^2.
 * 0.005 -> 2, 0.02 -> 8, 0.04 -> 16. Those go straight in.
 *
 * The RETENTIONS do not convert, and trying is the mistake worth naming. The
 * obvious move is to turn 0.8-per-20Hz-tick into a continuous decay rate
 * (-ln(0.8)/0.05 = 4.46/s) and use that. It gives the wrong answer, because
 * noa's drag is LINEAR -- voxel-physics-engine does `v *= 1 - drag*dt/mass`,
 * not `v *= exp(-drag*dt)`. The one thing that linear form buys you is that
 * terminal velocity is exactly `accel / drag` at any timestep, so the drag
 * constants below are derived from MINECRAFT'S TERMINAL SPEEDS instead:
 *
 *   water sinking:  0.5 b/s   ->  drag = 3.529
 *   lava sinking:   0.8 b/s   ->  drag = 7.5
 *
 * (Minecraft's own terminal, from `v' = 0.8v - 0.005`: 0.005/0.2 = 0.025
 * b/tick = 0.5 b/s. Lava, from `v' = 0.5v - 0.02`: 0.02/0.5 = 0.04 = 0.8 b/s.
 * The two drag figures are computed at runtime by dragFor(), which is where
 * the one-tick correction they carry is explained.)
 *
 * The climb then falls out without being fitted, which is the check that says
 * the model is right rather than merely tuned:
 *
 *   water rise = 14/3.529 - 14/30 = 3.5 b/s -- Minecraft: 0.175 b/tick = 3.5
 *   lava rise  = 8/7.5    - 8/30  = 0.8 b/s -- Minecraft: 0.04  b/tick = 0.8
 *
 * Both land on the published figures to the digit, off two constants fitted to
 * the SINK speeds alone. That is the whole justification for the drag numbers.
 *
 * Horizontal is the one place Minecraft's own arithmetic and its own
 * measurements disagree slightly: `v' = 0.8(v + 0.02)` gives 0.1 b/tick =
 * 2.0 b/s, while the wiki's measured figure for a partly-submerged player is
 * 1.97 b/s (2.20 swimming along the surface, 3.918 sprint-swimming). 2.0 is
 * used, because it is the number the game's own code produces.
 *
 * NOT REPRODUCED, deliberately, each because it needs machinery this world
 * does not have:
 *   - sprint-swimming (the crawl pose) and its 0.9 retention -> 3.918 b/s.
 *     There is no swim pose, no animation and no 0.6-tall hitbox here.
 *   - Depth Strider, Respiration, Dolphin's Grace. No enchantments exist.
 *   - The -0.003 clamp in getFluidFallingAdjustedMovement. At normal gravity
 *     its two conditions are mutually exclusive (|y-0.005| >= 0.003 AND
 *     |y-0.005| < 0.003), so it is unreachable dead code unless Slow Falling
 *     is active, and there are no potions here either.
 *   - Holding sneak to sink faster (goDownInWater, -0.04/tick -> 4.5 b/s).
 *     Sneak is already bound to the sneak walk and the ledge guard.
 *   - Flowing fluids. Every fluid voxel here is a full still block: no levels,
 *     no current pushing you downstream, no falling water column.
 */

/* ------------------------------------------------------------------ *
 * Which fluid, and where on the body
 * ------------------------------------------------------------------ */

/**
 * Per-fluid tuning, keyed by the block key blocks.js registers.
 *
 * `down` is the net downward acceleration Minecraft applies IN that fluid,
 * after buoyancy -- not gravity minus something, the final figure. `drag` is
 * noa's linear drag coefficient derived from the terminal speed above.
 */
const TUNING = {
  water: { down: MC.WATER_GRAVITY, sink: MC.WATER_SINK_SPEED, forward: MC.SWIM_SPEED },
  lava: { down: MC.LAVA_GRAVITY, sink: MC.LAVA_SINK_SPEED, forward: MC.LAVA_SPEED },
}

/**
 * Fluid sensing plus the movement side of being in one.
 *
 * Separated from the damage side (installFluidEffects, below) for a boring
 * but load-bearing reason: physics.js needs the sensor while it is wiring up
 * movement, and survival.js has to exist before anything can drown you. One
 * function that did both would force main.js into an ordering it cannot have.
 *
 * @param noa
 * @param move  noa's movement component state, for `responsiveness` -- see
 *   maxSpeed() for why a swim speed cannot just be assigned.
 */
export function createFluids(noa, move) {
  const player = noa.playerEntity
  const body = () => noa.ents.getPhysics(player).body

  /*
   * The player's own displacement and mass, read from the body rather than
   * from MC.PLAYER_WIDTH/HEIGHT. noa builds the box from its own
   * playerWidth/playerHeight options, and if those ever drift from
   * Minecraft's the buoyancy would silently stop matching -- the failure
   * would look like "swimming feels slightly wrong", which is unfindable.
   */
  const box = body().aabb
  const volume = box.vec[0] * box.vec[1] * box.vec[2]
  const mass = body().mass

  /**
   * noa's buoyant force is `-gravity * fluidDensity * volumeDisplaced`, so the
   * density that produces a chosen net downward acceleration is algebra:
   *
   *   net = g*gravMult - g*density*volume/mass
   *   density = (g*gravMult - net) * mass / (g * volume)
   *
   * Inverted here rather than hardcoded because g, the box and the mass are
   * all things someone could reasonably change, and every one of them moves
   * this number.
   */
  const densityFor = (net) => ((MC.GRAVITY - net) * mass) / (MC.GRAVITY * volume)

  /*
   * The physics step, in seconds. Every coefficient below depends on it,
   * which is the one genuinely surprising thing in this file.
   *
   * voxel-physics-engine integrates as `v = (v + a*dt) * (1 - drag*dt/mass)`
   * -- acceleration first, drag SECOND, applied to the already-accelerated
   * velocity. So terminal is not `a/drag`, it is
   *
   *   v = (a/drag) * (1 - drag*dt/mass)   equivalently   v = a/drag - a*dt/mass
   *
   * and the `a*dt` deficit is one whole tick of free acceleration that never
   * gets dragged. At noa's 30 Hz that is 13% of the sink speed in water and
   * 33% in lava -- measured 0.431 against a predicted 0.5, and 0.536 against
   * 0.8, which is what sent me reading the integrator. Inverting it gives the
   * drag that lands on a chosen terminal:
   *
   *   drag = a / (v + a*dt/mass)
   */
  const dt = 1 / noa.tickRate
  const dragFor = (accel, terminal) => accel / (terminal + (accel * dt) / mass)

  /*
   * id -> key. Handed in rather than imported, so this file never needs the
   * block table -- registerBlocks already returns the map and main.js has it.
   * Empty until then, which makes every sample read as "not in a fluid": the
   * right answer during the boot frames before blocks exist.
   */
  let byId = new Map()
  const setIds = (ids) => { byId = new Map([[ids.water, 'water'], [ids.lava, 'lava']]) }

  /** Which fluid occupies a world point, or null. */
  const fluidAt = (x, y, z) =>
    byId.get(noa.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))) ?? null

  let atFeet = null
  let atEyes = null

  /*
   * Feet and eyes are sampled separately because Minecraft asks two different
   * questions of them. Damage and movement are "is the entity IN the fluid",
   * which is the body; breath is `isEyeInFluid`, which is strictly the eye
   * point -- standing chest-deep in a pond you are slowed and you are not
   * drowning, and one sample could not tell you both.
   */
  const sample = () => {
    const p = noa.ents.getPositionData(player).position
    atFeet = fluidAt(p[0], p[1] + FOOT_PROBE, p[2])
    atEyes = fluidAt(p[0], p[1] + MC.EYE_HEIGHT, p[2])
  }

  /*
   * Applied at the vertical tuning and at the climb, and swapped as you cross
   * from one fluid to the other.
   *
   * THE DENSITY IS GLOBAL, and that is a real limitation rather than a
   * shortcut: voxel-physics-engine has one `fluidDensity` for the whole
   * simulation, so a second physics body swimming in the other fluid at the
   * same time would get this one's buoyancy. There is exactly one body in this
   * world today (the player). physics.js's noclip has the identical caveat for
   * the identical reason, and the identical fix if it ever matters: the flag
   * has to move into the body.
   *
   * The drag does NOT have that problem -- `body.fluidDrag` is per-body, and
   * is set per-body here precisely so only half of this is global.
   */
  const applyTuning = (b) => {
    const t = atFeet && TUNING[atFeet]
    if (!t) {
      b.fluidDrag = -1              // -1 means "use the engine default"
      return
    }
    /*
     * A flying player has gravityMultiplier 0, so there is no weight for
     * buoyancy to cancel and the full upward force would launch them out of
     * the water. Creative flight underwater should hover, the way it does
     * everywhere else.
     */
    noa.physics.fluidDensity = b.gravityMultiplier === 0 ? 0 : densityFor(t.down)
    b.fluidDrag = dragFor(t.down, t.sink)
  }

  noa.on('tick', () => {
    sample()
    const b = body()
    applyTuning(b)

    /*
     * The climb. Minecraft's jumpInLiquid adds a flat +0.04 b/tick^2 while the
     * jump key is held and you are in a fluid -- there is no ground check and
     * no cooldown, which is exactly why holding space is how you swim up.
     *
     * A FORCE, not an impulse, because noa's applyForce is divided by dt in
     * the integrator and applyImpulse is not: an impulse would make the climb
     * rate depend on the frame rate.
     */
    if (atFeet && noa.inputs.state.jump && b.gravityMultiplier !== 0) {
      b.applyForce([0, MC.SWIM_UP_ACCEL * mass, 0])
    }
  })

  return {
    setIds,

    /** key -> block id, so a test or the console can place a pool. */
    get ids() { return Object.fromEntries([...byId].map(([id, key]) => [key, id])) },

    /** 'water', 'lava' or null -- what the body is in. */
    get feet() { return atFeet },
    /** 'water', 'lava' or null -- what the eyes are in, for breath. */
    get eyes() { return atEyes },

    /**
     * The horizontal speed cap physics.js should use, or null to leave it
     * alone. INFLATED ON PURPOSE.
     *
     * noa's movement component pushes with a force proportional to how far
     * below maxSpeed you are (`responsiveness * deficit`), and fluid drag
     * pulls back with `drag * v`. Those balance at
     *
     *   v = maxSpeed * responsiveness / (responsiveness + drag)
     *
     * which is strictly below maxSpeed. Assigning Minecraft's 2.0 b/s
     * directly gets you 1.58 -- the first version did exactly that, and the
     * symptom was swimming that felt right and measured 20% slow. The factor
     * is recomputed from `move.responsiveness` rather than baked in, because
     * that constant lives in physics.js and would otherwise drift away from
     * the correction that depends on it.
     */
    maxSpeed() {
      const t = atFeet && TUNING[atFeet]
      if (!t) return null
      /*
       * Solved, not fudged. Per step the movement component adds
       * `r*(S - v)` to the velocity and then drag multiplies it by `1 - k`,
       * with r = responsiveness*dt/mass and k = drag*dt/mass. Steady state:
       *
       *   v = (1-k) * (v*(1-r) + r*S)
       *   S = v * (1 - (1-k)(1-r)) / ((1-k) * r)
       *
       * The first version used the continuous approximation
       * `S = v*(responsiveness + drag)/responsiveness`, which ignores that
       * both effects land once per step rather than continuously and reads
       * about 2.5% slow -- inside feel, outside the suite's 1.5% tolerance.
       */
      const k = (dragFor(t.down, t.sink) * dt) / mass
      const r = (move.responsiveness * dt) / mass
      return (t.forward * (1 - (1 - k) * (1 - r))) / ((1 - k) * r)
    },
  }
}

/*
 * How far above the position point to sample for the feet.
 *
 * The position IS the bottom of the box, so sampling at exactly y reads the
 * block the player is standing on when resting on a boundary -- the same
 * off-by-a-boundary that physics.js's groundBlock and the sneak edge guard
 * both bias around, in the other direction.
 */
const FOOT_PROBE = 0.1

/* ------------------------------------------------------------------ *
 * What fluids do to you
 * ------------------------------------------------------------------ */

/**
 * Drowning, burning and the fall-damage cancel.
 *
 * Everything here is expressed as a call into survival.js rather than as
 * arithmetic on health, for the same reason fall damage is: survival owns the
 * gates (creative invulnerability, the fallDamage game rule) and a second
 * place that subtracted from `health` would bypass all of them.
 */
export function installFluidEffects(noa, { fluids, survival }) {
  noa.on('tick', (dt) => {
    const secs = dt / 1000

    /*
     * Breath. survival.js runs the clock; this only reports whether the eyes
     * are under water. Lava deliberately does NOT drown you -- vanilla's air
     * supply drains on `isEyeInFluid(FluidTags.WATER)` only, and a player in
     * lava is dead from the lava long before breath would matter.
     */
    survival.breathe(secs, fluids.eyes === 'water')

    if (fluids.feet === 'water') {
      /*
       * Water cancels fall damage OUTRIGHT, it does not reduce it.
       * Entity.updateInWaterStateAndDoWaterCurrents calls resetFallDistance()
       * every tick you are touching water, so a 100-block drop into one block
       * of water hurts exactly as much as stepping off a kerb. The same call
       * clears fire, which is why extinguish lives on this branch too.
       *
       * Lava is the near-miss worth knowing: it only HALVES fall distance per
       * tick (`fallDistance *= 0.5`) rather than zeroing it. Not reproduced --
       * survival.js tracks a peak height rather than an accumulating distance,
       * so there is nothing to halve.
       */
      survival.clearFallTracking()
      survival.extinguish()
    }

    if (fluids.feet === 'lava') {
      /*
       * Entity.lavaHurt: 4 damage, and setSecondsOnFire(15) refreshed every
       * tick you remain in it. The damage rate is NOT 4 per second -- hurt()
       * sets invulnerableTime to 20 ticks but lets an equal-or-greater hit
       * through once past half of that, so an unchanging 4 lands every 10
       * ticks. Half a second. 8 health per second, four hearts, which is why
       * a full-health player in lava dies in two and a half seconds.
       */
      survival.lavaBurn(secs)
    }
  })
}

/** Wire the whole thing up. One call, so main.js has one line to read. */
export function installFluids(noa, { blockIds, fluids, survival }) {
  fluids.setIds(blockIds)
  installFluidEffects(noa, { fluids, survival })
}
