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
 * and so does the sneak sink, added later against the same two constants:
 *
 *   water sneak = 18/3.529 - 18/30 = 4.5 b/s -- Minecraft: 0.225 b/tick = 4.5
 *   lava sneak  = 24/7.5   - 24/30 = 2.4 b/s -- Minecraft: 0.12  b/tick = 2.4
 *
 * Four figures landing on the published ones to the digit, off two constants
 * fitted to the SINK speeds alone. That is the whole justification for the
 * drag numbers, and it is why they are not the thing to reach for when the
 * water feels wrong.
 *
 * ------------------------------------------------------------------
 * WHAT TERMINAL SPEED DOES NOT TELL YOU, which is the entry plunge.
 *
 * Solving the drag backwards from terminal pins the STEADY STATE and says
 * nothing about the transient. Minecraft's 0.8 is not a drag coefficient at
 * all -- it is a flat per-tick velocity retention, and the rate at which a
 * plunge bleeds off is a second, independent fact about the fluid.
 *
 * Both models decay geometrically toward terminal, so they are comparable:
 *
 *   Minecraft      0.8 per 20 Hz tick    -> 1.15e-2 per second
 *   this, drag 3.529 @ 30 Hz  0.88237    -> 2.34e-2 per second
 *
 * Twice as much speed surviving each second, which comes out as exactly 1.25x
 * the overshoot at any entry speed -- measured, not estimated: a 20-block drop
 * enters at 34 b/s and reaches 9.9 blocks down where Minecraft reaches 7.4.
 *
 * AND THE TWO CANNOT BOTH BE HAD FROM ONE LINEAR DRAG. noa's terminal is
 * `a*dt*(1-k)/k` with k = drag*dt/mass, so pinning terminal at 0.5 b/s with
 * a = 2 b/s^2 at 30 Hz FORCES k = 0.1176. Matching Minecraft's decay instead
 * (k = 0.1382) drops terminal to 0.416, and dragging the climb back to match
 * needs SWIM_UP_ACCEL refitted from 16 to 19.25 -- at which point every
 * agreement above is a fit rather than a check. Rejected for exactly that.
 *
 * So the transient is corrected on its own, in sinkTransient() below, as a
 * per-tick factor on the EXCESS over terminal. Terminal is a fixed point of
 * both models, so correcting only the excess leaves the sink, the climb, the
 * sneak sink and the horizontal speed untouched to the last digit.
 *
 * The other half of the entry depth is not this file's: noa's airDrag of 0.1
 * gives a falling terminal of ~318 b/s against Minecraft's 78.4, so a tall
 * drop arrives FASTER here than there (57.9 b/s off 60 blocks, against 46.8).
 * That is physics.js's airDrag and the jump impulse is calibrated against it.
 * Noted in docs rather than changed.
 *
 * ------------------------------------------------------------------
 * BEING IN A FLUID IS BINARY IN MINECRAFT, AND IS NOT IN NOA.
 *
 * Entity.travel picks its fluid branch off `isInWater()`, a yes/no test, and
 * everything inside that branch is at full strength however little of you is
 * under the surface. noa instead models Archimedes properly: the buoyant force
 * is scaled by `ratioInFluid`, the fraction of the box below the surface.
 *
 * That difference has one very visible consequence. The buoyancy that cancels
 * gravity is 30 b/s^2 at full submersion, so at ratio r the net is 30r - 32,
 * and the climb's +16 balances it at r = 0.533 -- feet 0.96 blocks below the
 * surface. That is a STABLE FLOAT LINE: hold jump at the surface of a lake and
 * you rise to 0.96 under it and stop, forever, which is why you could not get
 * out onto a shore. Measured at y=200.04 against a surface at 201, bobbing.
 *
 * So the ratio is compensated back out while the feet are under the surface
 * (see the buoyancy top-up in the tick), and the binary edge is `atFeet`,
 * which is where Minecraft's own edge is: its jump gate is
 * `isInWater() && getFluidHeight(WATER) > 0`, and that height is measured up
 * from the BOTTOM of the box, so it goes to zero the moment the feet clear.
 *
 * noa also fades the DRAG with `1 - (1-ratio)^2`, and that is NOT divided back
 * out. Dividing it would send the coefficient past mass/dt at small ratios,
 * where noa clamps the whole velocity to zero and you read as hitting a wall.
 * The transient correction below handles it from the other end instead, by
 * asking what retention noa actually applied rather than assuming the
 * nominal one -- same result on the vertical axis, no coefficient to blow up.
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
  water: {
    down: MC.WATER_GRAVITY,
    sink: MC.WATER_SINK_SPEED,
    forward: MC.SWIM_SPEED,
    retain: MC.WATER_RETENTION,
  },
  lava: {
    down: MC.LAVA_GRAVITY,
    sink: MC.LAVA_SINK_SPEED,
    forward: MC.LAVA_SPEED,
    retain: MC.LAVA_RETENTION,
  },
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
   *
   * THE BODY QUESTION IS A BOX, NOT A POINT, and that is Minecraft's own
   * test rather than a refinement of it. Entity.updateFluidHeightAndDoFluidPushing
   * deflates the bounding box by 0.001 and walks every voxel column it
   * overlaps, `floor(minX)` through `ceil(maxX)` and the same in Z. A single
   * sample at the centre is only the same answer while the box sits inside one
   * column -- press against a shoreline with half the box over the sand and
   * the centre reads the sand, and the swim push cuts while you are still
   * visibly in the water.
   *
   * ONE Y LEVEL, though, and deliberately: the gate this feeds is
   * `isInWater() && getFluidHeight(WATER) > 0`, and that height is measured
   * up from the BOTTOM of the box. Scanning the whole 1.8 blocks would keep
   * you "in water" with your feet on dry land, which is the opposite of the
   * bug. So the scan is the columns the box covers, at the feet.
   *
   * The 0.001 replaces the old 0.1 probe, and that is the second half of
   * getting out of water: 0.1 cut the climb a tenth of a block BEFORE the
   * surface, which is a tenth less coast to clear the lip with. 0.001 is
   * vanilla's own epsilon and is there for the same off-by-a-boundary reason
   * the 0.1 was -- the position IS the bottom of the box.
   */
  const sample = () => {
    const dat = noa.ents.getPositionData(player)
    const p = dat.position
    atEyes = fluidAt(p[0], p[1] + MC.EYE_HEIGHT, p[2])

    /*
     * The box comes from the POSITION COMPONENT, not from `body.aabb`, and
     * that is not a style preference. noa has a floating origin -- it shifts
     * the whole scene when you wander far enough from it -- so the physics
     * body's aabb is in LOCAL coordinates while noa.getBlock takes global
     * ones. Reading the corners off the aabb looks right, builds, and reports
     * "not in a fluid" everywhere, which is how this was found: the player
     * sank straight through a pool with the climb never firing.
     */
    const half = dat.width / 2
    const y = Math.floor(p[1] + BOX_EPSILON)
    const x1 = Math.floor(p[0] + half - BOX_EPSILON)
    const z1 = Math.floor(p[2] + half - BOX_EPSILON)
    atFeet = null
    for (let x = Math.floor(p[0] - half + BOX_EPSILON); x <= x1 && !atFeet; x++) {
      for (let z = Math.floor(p[2] - half + BOX_EPSILON); z <= z1 && !atFeet; z++) {
        atFeet = byId.get(noa.getBlock(x, y, z)) ?? null
      }
    }
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
      /*
       * And the global density back to nothing, which the first version did
       * not do. Left at water's 1.447 it is a loaded gun: noa's own inFluid
       * is sampled at the box's MIN CORNER while atFeet now scans every
       * column, so the two can disagree by a frame at a shoreline, and the
       * frame they disagree on would get buoyancy with no drag to hold it.
       */
      noa.physics.fluidDensity = 0
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

/*
 * REJECTED, and worth writing down because it was the obvious fix and it was
 * measurably unnecessary: turning noa's autostep on while in a fluid.
 *
 * main.js keeps `playerAutoStep: false` because Minecraft's step height is 0.6
 * -- a slab, never a full block -- and noa's is a whole block, which would
 * walk you up the parkour course. So this world has NO step at all where
 * vanilla has 0.6, and swimming into a bank does read as swimming into a wall:
 * the trace of the original bug had resting[0] pinned for a hundred ticks.
 *
 * It was built, and then reverted: with the buoyancy above restored, held jump
 * lifts the feet clear of the surface and the coast carries you onto the land
 * with the step switched off. Reverting the step made no test go red, and a
 * behaviour change no test covers is not one to ship under a water fix.
 *
 * The 0.6 step remains a real fidelity gap, on its own, for its own change.
 */

  /**
   * The per-tick factor that turns noa's decay toward terminal into
   * Minecraft's.
   *
   * Both models are geometric in the EXCESS over terminal -- noa's
   * `v' = (v + a*dt)(1-k)` rearranges to `v' - vT = (1-k)(v - vT)` exactly --
   * so the whole difference between them is one ratio, and applying it by hand
   * costs nothing and moves nothing else. `retain^(20*dt)` is Minecraft's
   * per-20-Hz-tick number resampled onto this tick rate, which is the only
   * place in this file a retention IS allowed to convert continuously: it is
   * a pure decay with no acceleration riding on it.
   */
  const sinkTransient = (t, b) => {
    /*
     * The retention noa ACTUALLY applied this step, not the nominal one. It
     * differs whenever the box is partly out of the water, because noa fades
     * its drag with `1 - (1-ratio)^2` -- and partly out of the water is
     * precisely where a plunge begins, so using the nominal figure
     * under-corrects the two ticks that matter most. Measured 11% over
     * Minecraft on a 5-block drop with the nominal, and on the number below.
     *
     * The `inFluid` branch is not defensive: noa decides it from the box's MIN
     * CORNER while `atFeet` scans every column the box covers, so at a
     * shoreline they can disagree for a frame, and on that frame noa used air
     * drag.
     */
    const used = b.inFluid
      ? dragFor(t.down, t.sink) * (1 - (1 - b.ratioInFluid) ** 2)
      : (b.airDrag >= 0 ? b.airDrag : noa.physics.airDrag)
    return Math.min(1, t.retain ** (20 * dt) / Math.max(1 - (used * dt) / mass, 1e-6))
  }

  noa.on('tick', () => {
    sample()
    const b = body()
    applyTuning(b)

    const t = atFeet && TUNING[atFeet]
    if (!t || b.gravityMultiplier === 0) return

    /*
     * BUOYANCY TOP-UP. noa applies `-gravity * density * volume * ratio`, the
     * physically correct Archimedes force; Minecraft applies its fluid branch
     * at full strength the instant you are in one. The header has the whole
     * argument -- the short version is that the ratio term is what pins you
     * 0.96 blocks under the surface with jump held and will not let you out.
     *
     * The deficit is `(G - down) * (1 - ratio)`: at ratio 1 it is zero and
     * this line does nothing, which is why nothing measured deep in a shaft
     * moves. `ratioInFluid` is noa's from the step just run rather than one
     * computed here, because it has to be the same number noa scaled by or
     * the two do not cancel.
     */
    if (b.inFluid && b.ratioInFluid < 1) {
      b.applyForce([0, (MC.GRAVITY - t.down) * (1 - b.ratioInFluid) * mass, 0])
    }

    /*
     * The climb, and its mirror. Minecraft's jumpInLiquid adds a flat +0.04
     * b/tick^2 while the jump key is held and you are in a fluid; goDownInWater
     * subtracts exactly the same 0.04 while sneak is held. Neither has a ground
     * check and neither has a cooldown, which is why holding a key is how you
     * swim in both directions -- and they live in separate `if`s in aiStep, so
     * holding both really does cancel to nothing. Written the same way here
     * rather than as an if/else for that reason.
     *
     * FORCES, not impulses, because noa's applyForce is divided by dt in the
     * integrator and applyImpulse is not: an impulse would make the rate depend
     * on the frame rate.
     */
    const S = noa.inputs.state
    if (S.jump) b.applyForce([0, MC.SWIM_UP_ACCEL * mass, 0])
    if (S.sneak) b.applyForce([0, -MC.SINK_DOWN_ACCEL * mass, 0])

    /*
     * And the entry plunge, corrected to Minecraft's decay rate.
     *
     * GATED THREE WAYS, and each gate is load-bearing rather than cautious.
     * The correction's fixed point is the PASSIVE terminal, so it is only
     * valid while passive sinking is the only thing happening: with jump held
     * the fixed point is +3.5 and this would drag the climb down to -0.5, and
     * with sneak held it is -4.5. And it is only applied below terminal
     * because that is the only regime with an excess to bleed -- a body slower
     * than terminal is accelerating INTO it, which noa's drag already does at
     * the right rate for the speeds involved.
     */
    if (!S.jump && !S.sneak && b.velocity[1] < -t.sink) {
      b.velocity[1] = -t.sink + (b.velocity[1] + t.sink) * sinkTransient(t, b)
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
 * How far INTO the box to start the fluid scan.
 *
 * The position IS the bottom of the box, so sampling at exactly y reads the
 * block the player is standing on when resting on a boundary -- the same
 * off-by-a-boundary that physics.js's groundBlock and the sneak edge guard
 * both bias around, in the other direction.
 *
 * This was 0.1 and is now Minecraft's own 0.001, the deflation
 * updateFluidHeightAndDoFluidPushing applies before its scan. 0.1 is a tenth
 * of a block of water you are treated as out of while still in it, at exactly
 * the moment -- the last tenth before the surface -- when you are trying to
 * leave and need every scrap of climb you can get.
 */
const BOX_EPSILON = 0.001

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
