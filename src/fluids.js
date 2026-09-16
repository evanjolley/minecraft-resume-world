import { MC } from './physics.js'
/*
 * The one thing this file imports from the block table, and it is not the
 * table: FLUID_FLOW is sixteen rows of {key, fluid, level, falling} saying
 * what a flow level MEANS. The ids still arrive from main.js through
 * setIds/installFluids, the way the note above byId insists -- a level is a
 * shape, an id is a registration, and only the second one is blocks.js's
 * business to hand over.
 */
import { FLUID_FLOW } from './blocks.js'
import { installFluidGeometry, cornerHeight, flowVector, ownHeight } from './fluidGeometry.js'
import { currentDimension } from './island.js'
import { entityBox, everyBody } from './entityBox.js'

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
   *
   * AND IT IS MASS-DEPENDENT, through that correction and only through it --
   * which is why the mass is a parameter now rather than the closed-over
   * player's. The steady-state half, `a/drag`, has no mass in it; the deficit
   * `a*dt/m` does, because noa's drag multiplier is `1 - drag*dt/m`. So a
   * heavier body given the player's coefficient would settle at a different
   * terminal speed than the one that coefficient was fitted to.
   *
   * Today every body in this world has noa's default mass of 1 (nothing in
   * src/ assigns `body.mass`, and voxel-physics-engine's addBody defaults it),
   * so Evan's number comes out bit-identical to the player's. Parameterised
   * anyway: the day something heavy swims, the alternative is a silently
   * wrong terminal velocity, which is the exact failure mode this file's
   * header spends forty lines warning about.
   */
  const dt = 1 / noa.tickRate
  const dragFor = (accel, terminal, m = mass) => accel / (terminal + (accel * dt) / m)

  /*
   * id -> key. Handed in rather than imported, so this file never needs the
   * block table -- registerBlocks already returns the map and main.js has it.
   * Empty until then, which makes every sample read as "not in a fluid": the
   * right answer during the boot frames before blocks exist.
   */
  let byId = new Map()
  /*
   * EVERY flow level maps to its fluid here, not just the two sources. This is
   * the line that keeps the hard-won half of this file honest: a player
   * standing in `water_3` is standing in water, and buoyancy, drowning, the
   * entry transient and the burn all have to agree with that. Miss it and
   * flowing water becomes a hole you fall through.
   */
  let sourceIds = {}
  const setIds = (ids) => {
    byId = new Map(FLUID_FLOW.map(f => [ids[f.key], f.fluid]))
    /*
     * The SOURCE id of each fluid, kept separately, and it has to be.
     *
     * `get ids()` below used to invert byId, which was exact while byId held
     * one id per fluid. It now holds eighteen, and Object.fromEntries keeps
     * the LAST duplicate -- so `ids.water` silently became the id of
     * `water_falling` and every test that fills a pool or hunts for the ocean
     * looked for a block that is not there. Eight failures across
     * 28-underwater and 30-water-entry, all of them this one line, and none of
     * them anywhere near the code they were testing.
     */
    sourceIds = Object.fromEntries(
      FLUID_FLOW.filter(f => f.level === 0 && !f.falling).map(f => [f.fluid, ids[f.key]]))
  }

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
  /*
   * ONE ENTITY'S FEET, and it takes an entity because it has to. This was a
   * closed-over sample of the player alone, and that is the shape the drag
   * bug had -- see the tick.
   *
   * The box comes from entityBox.js, which means from the POSITION COMPONENT
   * rather than from `body.aabb`, and that is not a style preference. noa has
   * a floating origin -- it shifts the whole scene when you wander far enough
   * from it -- so the physics body's aabb is in LOCAL coordinates while
   * noa.getBlock takes global ones. Reading the corners off the aabb looks
   * right, builds, and reports "not in a fluid" everywhere, which is how this
   * was found: the player sank straight through a pool with the climb never
   * firing. entityBox.js documents the identical trap from the placement side
   * and is the reason this is a call rather than ten lines of arithmetic --
   * the frame conversion that never happens cannot be forgotten twice.
   *
   * COST: the columns the box covers, at ONE y. A 0.6-wide body is one column
   * unless it straddles a boundary, so this is 1 to 4 `getBlock` calls per
   * body per tick, against the ~27 the flow push's own scan already does for
   * the same body. Rejected: handing the push's scan back here so each body
   * is walked once. The push is installed later and only exists once the
   * block ids do, while this tuning has to run from boot and has to be right
   * in a STILL pool, where the push returns null and scans nothing.
   */
  const feetFluid = (box) => {
    if (!box) return null
    const y = Math.floor(box.min[1] + BOX_EPSILON)
    const x1 = Math.floor(box.max[0] - BOX_EPSILON)
    const z1 = Math.floor(box.max[2] - BOX_EPSILON)
    for (let x = Math.floor(box.min[0] + BOX_EPSILON); x <= x1; x++) {
      for (let z = Math.floor(box.min[2] + BOX_EPSILON); z <= z1; z++) {
        const f = byId.get(noa.getBlock(x, y, z)) ?? null
        if (f) return f
      }
    }
    return null
  }

  const sample = () => {
    const p = noa.ents.getPositionData(player).position
    atEyes = fluidAt(p[0], p[1] + MC.EYE_HEIGHT, p[2])
    atFeet = feetFluid(entityBox(noa, player))
  }

  /*
   * Applied at the vertical tuning and at the climb, and swapped as you cross
   * from one fluid to the other.
   *
   * THE DENSITY IS GLOBAL, and that is a real limitation rather than a
   * shortcut: voxel-physics-engine has one `fluidDensity` for the whole
   * simulation, so a second physics body swimming in the other fluid at the
   * same time would get this one's buoyancy. physics.js's noclip has the
   * identical caveat for the identical reason, and the identical fix if it
   * ever matters: the flag has to move into the body.
   *
   * THIS PARAGRAPH USED TO SAY "there is exactly one body in this world today
   * (the player)", and that sentence is how the drag bug happened. Evan has
   * had a body since npc.js gave him one -- 1.85 blocks of him -- and the
   * whole tuning tick was still reading and writing the player's. Reported
   * from play: "I seem to flow the correct speed in water, Evan moves super
   * fast." The flow push iterates every body and Evan got the full shove with
   * his ground friction zeroed; nothing ever set his `fluidDrag`, so he fell
   * through to voxel-physics-engine's default of 0.4 against the player's
   * fitted 3.5 -- an order of magnitude less water to push through, under an
   * identical force.
   *
   * Evan still shares the player's BUOYANCY, and that is the limitation above
   * rather than a second bug: there is one global density and a humanoid in
   * water wants roughly the player's anyway. Rejected: letting whichever body
   * is in a fluid write the global, so Evan gets buoyancy when the player is
   * dry. It is one variable and two writers, and the tick the player enters
   * the water is the tick it would be wrong for the one body whose numbers
   * this file's header says not to disturb.
   *
   * The drag does NOT have that problem -- `body.fluidDrag` is per-body, and
   * is set per-body here precisely so only half of this is global. That is
   * the seam, and `tuneDrag` is it.
   */

  /**
   * The only half that is per-body: the water a body has to push through.
   *
   * `-1` is voxel-physics-engine's sentinel for "use the engine default", and
   * restoring it on the way out is not tidiness. A body left with water drag
   * on dry land keeps 3.5 of resistance in the air, which reads as walking
   * through treacle and is nowhere near the water anyone would go looking in.
   */
  const tuneDrag = (b, feet) => {
    const t = feet && TUNING[feet]
    b.fluidDrag = t ? dragFor(t.down, t.sink, b.mass) : -1
  }

  const applyTuning = (b) => {
    tuneDrag(b, atFeet)
    const t = atFeet && TUNING[atFeet]
    if (!t) {
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
  }

  /**
   * Everyone else in the water. Drag, and nothing else.
   *
   * NO BOOKKEEPING, and that is deliberate against the push's `savedFriction`
   * Map a few hundred lines down. This runs over EVERY body EVERY tick and
   * writes one of two answers, so "he left the water" needs no event, no
   * remembered previous state and no cleanup when an entity is removed --
   * the body simply stops being in the list. The push cannot do that because
   * it has to give a borrowed value back; this owns the field outright.
   *
   * The player is skipped because applyTuning has already done him, with the
   * global density he is the only one allowed to set.
   */
  const tuneOthers = () => {
    for (const id of everyBody(noa)) {
      if (id === player) continue
      const b = noa.ents.getPhysics(id)?.body
      if (b) tuneDrag(b, feetFluid(entityBox(noa, id)))
    }
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
    /*
     * BEFORE the early return below, which is the player's. Everything after
     * this line -- the buoyancy top-up, the climb, the entry transient --
     * reads the player's input state and the player's box, and bails when the
     * player is dry. Evan's drag is not the player's business and must not
     * ride on the player being wet.
     */
    tuneOthers()

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
    get ids() { return { ...sourceIds } },

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

/**
 * Wire the whole thing up. One call, so main.js has one line to read.
 *
 * The flow engine is attached to the SAME `fluids` object main.js already
 * holds and already exposes on `window.game`, rather than returned. That is
 * not tidiness: main.js belongs to another agent this session and this landed
 * without touching it, so `game.fluids.flow` is the handle the tests and the
 * console use.
 */
export function installFluids(noa, { blockIds, fluids, survival, authority = null }) {
  fluids.setIds(blockIds)
  installFluidEffects(noa, { fluids, survival })
  fluids.flow = installFluidFlow(noa, { blockIds, authority })
  return fluids.flow
}

/* ------------------------------------------------------------------ *
 * FLOW: water and lava that actually go somewhere
 * ------------------------------------------------------------------ *
 *
 * Reported from play, docs/REPORTED.md item 15: "see a random block of lava in
 * a cave, but it isnt flowing down. Do fluids flow?" ... "water doesnt either".
 * The header above listed flowing fluids as a deliberate non-goal. It was a
 * backlog entry, not a boundary, and this is it being paid off.
 *
 * MINECRAFT'S NUMBERS, and where each was read.
 *
 *   water spreads 7 blocks horizontally from a source on a flat surface, and
 *   downward without limit, at 1 block every 5 game ticks
 *     -- minecraft.wiki/w/Water: "7 blocks horizontally from a source block on
 *        a flat surface", "spreads at a rate of 1 block every 5 game ticks,
 *        or 4 blocks per second".
 *
 *   lava spreads 3 blocks in the Overworld and 7 in the Nether, at 1 block
 *   every 30 ticks in the Overworld and every 10 in the Nether
 *     -- minecraft.wiki/w/Lava: "lava travels 3 blocks in any horizontal
 *        direction from a source block", "in the Nether ... lava travels 7
 *        blocks horizontally"; "1 block every 30 game ticks, or 1.5 seconds"
 *        and "1 block every 10 game ticks, or 2 blocks per second".
 *
 *   THREE IS NOT A SEPARATE RULE FROM SEVEN. Both fluids decay to level 7 and
 *   stop; overworld lava just decays TWO levels per block instead of one, so
 *   it runs out after three. BlockDynamicLiquid.updateTick keeps one decay
 *   constant -- `int j = 1;` -- and doubles it for lava outside a vaporizing
 *   dimension. So DECAY below is 1, 1 and 2, and the 3-vs-7 figures fall out
 *   rather than being typed in. That is worth the indirection: two constants
 *   that have to agree are two constants that eventually will not.
 *
 *   falling fluid carries vanilla's bit 8 and is drawn full height; the block
 *   it lands on counts as decay 0 when its neighbours ask what feeds them,
 *   which is why a waterfall spreads the FULL seven blocks again from the
 *   floor rather than continuing the count from the top of the cliff
 *     -- BlockDynamicLiquid.updateTick: `this.tryFlowInto(worldIn, pos.down(),
 *        iblockstate, i + 8)`, and the horizontal branch is guarded by
 *        `i >= 0 && (i == 0 || this.isBlocked(worldIn, pos.down(), ...))` --
 *        a fluid that CAN fall does nothing else that tick.
 *
 *   infinite water: a flowing block horizontally adjacent to two or more
 *   source blocks, sitting on a solid block or another water source, becomes
 *   a source itself
 *     -- minecraft.wiki/w/Water, and `adjacentSourceBlocks` in
 *        BlockDynamicLiquid. Lava does NOT do this in Java Edition.
 *
 *   water meeting lava: water onto a lava SOURCE gives obsidian in the lava's
 *   cell; the two FLOWING into each other gives cobblestone and removes
 *   neither; lava flowing down onto water turns the water to stone
 *     -- minecraft.wiki/w/Water: "If water touches a lava source, the lava
 *        source turns to obsidian. If both touch each other while flowing,
 *        cobblestone is made and no sources are removed, and if lava flows
 *        downward onto water, the water turns to stone."
 *
 * ------------------------------------------------------------------
 * THE TICK RATES ARE IN MILLISECONDS HERE, NOT TICKS, and that is not a
 * convenience. noa ticks at 30 Hz and Minecraft at 20, so "every 5 ticks"
 * converted as a tick COUNT would run water 1.5x too fast -- the same class of
 * mistake the retention constants at the top of this file document at length.
 * 5 ticks is 250 ms and that is what gets scheduled.
 *
 * ------------------------------------------------------------------
 * SCHEDULING, which is the part that decides whether this is shippable.
 *
 * The naive implementation walks the loaded world every tick looking for
 * fluid. At this world's size that is millions of voxels per frame and the
 * answer is almost always "nothing changed". So: NOTHING IS EVER SCANNED PER
 * TICK. A position enters `pending` only when something happened to it --
 *
 *   - a chunk arrived carrying fluid          (scanned ONCE, on chunkAdded)
 *   - a block next to it changed              (the setBlock wrap below)
 *   - a flow update touched it                (the engine schedules its own)
 *
 * -- and leaves as soon as its update produces no change. A settled pool costs
 * exactly zero. `pending` is a Map of packed position -> due time, so the
 * per-tick cost is the size of the ACTIVE FRONTIER, not of the world.
 *
 * BUDGET is the backstop. A single tick applies at most BUDGET updates and
 * leaves the rest for the next one; a pathological pour spreads over more
 * frames instead of dropping one.
 *
 * REJECTED -- a per-chunk dirty flag and a rescan of dirty chunks. It sounds
 * cheaper and is not: a chunk is 24^3 = 13,824 voxels and one block placed
 * anywhere in it costs a full rescan, where the frontier here is a few dozen
 * entries for a pour that covers a whole room.
 *
 * REJECTED -- running the update off noa's render loop with a time budget in
 * milliseconds. Fluid spread has to be deterministic for the tests to say
 * anything, and a frame-rate-dependent number of updates per second is the
 * opposite of that.
 */

/** Packed position <-> key. Multiplayer will want a string anyway. */
const keyOf = (x, y, z) => `${x},${y},${z}`

/** vanilla's decay per block: one level, except overworld lava's two. */
const DECAY = { water: 1, lavaOverworld: 2, lavaNether: 1 }

/** vanilla tick rates, converted from game ticks to milliseconds at 50 ms. */
const RATE_MS = { water: 5 * 50, lavaOverworld: 30 * 50, lavaNether: 10 * 50 }

/** The last level that still exists. Level 8 would be nothing at all. */
const MAX_LEVEL = 7

/** How many fluid updates one tick may apply before deferring the rest. */
const BUDGET = 256

/**
 * The flow engine.
 *
 * @param noa
 * @param blockIds  key -> id, straight from registerBlocks. This file never
 *   imports the block table (see setIds above for why); FLUID_FLOW is the
 *   shape of a level, and the ids come from the caller.
 * @param flowTable blocks.js's FLUID_FLOW.
 * @param isNether  () => boolean. Overworld lava is half as fast again and
 *   twice as short, and the dimension can change under a running pool.
 * @param setBlock  the applier. See the note at installFluidFlow.
 */
export function createFluidFlow(noa, { blockIds, flowTable, isNether, setBlock }) {
  /* id -> { fluid, level, falling }, and the inverse. Built once. */
  const metaById = new Map()
  const idFor = new Map()
  for (const entry of flowTable) {
    const id = blockIds[entry.key]
    if (id === undefined) throw new Error(`fluid flow: no block id for "${entry.key}"`)
    metaById.set(id, entry)
    idFor.set(`${entry.fluid}:${entry.falling ? 'fall' : entry.level}`, id)
  }
  const idOf = (fluid, level, falling = false) =>
    idFor.get(`${fluid}:${falling ? 'fall' : level}`)

  /* The two blocks water and lava make of each other. Named, not numbered. */
  const STONE = blockIds.stone
  const COBBLESTONE = blockIds.cobblestone
  const OBSIDIAN = blockIds.obsidian

  const pending = new Map()
  let now = 0
  /*
   * OFF SWITCH, and it exists for one caller that is not this file.
   *
   * test/39-animated-textures.spec.js proves the layer-remap animation is real
   * by FREEZING it and asserting the water pixels then stop changing. Its
   * fixture fills a block of water and carves an air pocket for the camera --
   * and the walls of that pocket now flow into it, correctly, so the control
   * sees pixels move with the animation stopped and the proof stops proving
   * anything. That test is right and this engine is right; they just cannot
   * both run.
   *
   * So the seam is here rather than a flag in their file: `flow.setEnabled`
   * is one line at the top of that fixture. Not a gamerule, because a player
   * has no business turning physics off, and not a build flag, because the
   * thing being suppressed is exactly the thing every other test exercises.
   */
  let enabled = true
  /** Updates applied since install. The tests read it; so does the debug HUD. */
  let applied = 0

  const get = (x, y, z) => noa.getBlock(x, y, z)
  const metaAt = (x, y, z) => metaById.get(get(x, y, z)) ?? null

  const rateFor = (fluid) =>
    fluid === 'water' ? RATE_MS.water : (isNether() ? RATE_MS.lavaNether : RATE_MS.lavaOverworld)
  const decayFor = (fluid) =>
    fluid === 'water' ? DECAY.water : (isNether() ? DECAY.lavaNether : DECAY.lavaOverworld)

  /**
   * Put a position in the queue, at vanilla's rate for the fluid that will act
   * on it. An entry already waiting keeps the EARLIER of the two due times --
   * re-scheduling must never be able to postpone an update, or a fast trickle
   * next to a slow one would stall behind it.
   */
  function schedule(x, y, z, fluid) {
    const k = keyOf(x, y, z)
    const due = now + rateFor(fluid)
    const have = pending.get(k)
    if (have !== undefined && have <= due) return
    pending.set(k, due)
  }

  /** The six neighbours of a cell, plus the cell, scheduled. */
  function scheduleAround(x, y, z) {
    for (const [dx, dy, dz] of [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const m = metaAt(x + dx, y + dy, z + dz)
      if (m) schedule(x + dx, y + dy, z + dz, m.fluid)
    }
  }

  /**
   * May this fluid move into that cell?
   *
   * Air, and a thinner amount of the SAME fluid. Vanilla also washes away
   * grass, flowers and torches; this world's palette has none of them as
   * non-solid blocks, so "air or thinner" is the whole rule rather than a
   * simplification of one.
   */
  function canFlowInto(x, y, z, fluid, level) {
    const id = get(x, y, z)
    if (id === 0) return true
    const m = metaById.get(id)
    if (!m || m.fluid !== fluid) return false
    // A falling column is never replaced by a flowing one, and a source never
    // by anything: both are already the most fluid that cell can be.
    if (m.falling || m.level === 0) return false
    return m.level > level
  }

  /**
   * Is this cell SUPPORT -- does it hold a fluid resting on it up?
   *
   * Vanilla's `BlockDynamicLiquid.isBlocked` is `blockMaterial.blocksMovement()`
   * and `MaterialLiquid` overrides that to FALSE. A fluid is not support.
   *
   * WHICH IS THE WHOLE OF THE REPORTED BUG: "I put water on a hill and it
   * spreads directly horizontal over the empty space." The cell hanging over
   * the drop pours downward on its first update, so by its SECOND update the
   * cell beneath it is already a falling column -- and the old body here
   * answered "blocked" for any fluid, which let the sideways branch in
   * update() run at every height of the fall. The result was a sheet of water
   * seven blocks wide hanging in mid-air beside the cliff, exactly as
   * reported. `if (m) return true` was not a simplification of the comment
   * above it; it contradicted it.
   *
   * NOT "the same fluid at full depth", which is what that old comment
   * claimed. A source is not support in vanilla either -- water poured onto a
   * lake does not spread across the surface from the point of impact, it
   * merges. Water landing ON a lake rather than sinking through it is
   * canFlowInto's job (a source and a falling column are both already the most
   * fluid their cell can be), not this one, and that check is untouched.
   */
  const isBlocked = (x, y, z) => {
    const id = get(x, y, z)
    if (id === 0) return false
    return !metaById.has(id)
  }

  /**
   * What water and lava make of each other, and WHERE -- the `where` is the
   * half that is easy to get wrong.
   *
   * @returns true if the encounter consumed the move (so nothing flows).
   */
  function react(fluid, level, falling, x, y, z, fromBelow) {
    const m = metaAt(x, y, z)
    if (!m || m.fluid === fluid) return false

    if (fluid === 'water') {
      // Water reaching lava replaces the LAVA's cell, not the water's:
      // obsidian if that lava is a source, cobblestone if it is flowing.
      setBlock(m.level === 0 && !m.falling ? OBSIDIAN : COBBLESTONE, x, y, z)
      scheduleAround(x, y, z)
      return true
    }
    // Lava reaching water. Straight down onto water turns that water to stone;
    // sideways contact makes cobblestone. Either way the lava does not move in.
    setBlock(fromBelow ? STONE : COBBLESTONE, x, y, z)
    scheduleAround(x, y, z)
    return true
  }

  /** Write a fluid level, count it, and wake the neighbourhood. */
  function place(id, x, y, z, fluid) {
    setBlock(id, x, y, z)
    applied++
    scheduleAround(x, y, z)
    if (fluid) schedule(x, y, z, fluid)
  }

  /**
   * One fluid block's update. Vanilla's BlockDynamicLiquid.updateTick, with
   * the slope search left out -- see the note at the bottom of this function.
   */
  function update(x, y, z) {
    const me = metaAt(x, y, z)
    if (!me) return false
    const { fluid } = me
    const decay = decayFor(fluid)
    const source = me.level === 0 && !me.falling

    /* ---- 1. am I still fed? ---- */
    if (!source) {
      let best = MAX_LEVEL + 1
      let sources = 0
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = metaAt(x + dx, y, z + dz)
        if (!n || n.fluid !== fluid) continue
        /*
         * A FALLING NEIGHBOUR FEEDS AT FULL STRENGTH, and it used to be
         * skipped outright ("a falling column feeds only downward").
         *
         * Vanilla's checkAdjacentBlock reads the neighbour's LEVEL -- which
         * for a falling block is its level with bit 8 set -- and then does
         * `if (i >= 8) i = 0`. Decay 0. That one line is the whole of "a
         * waterfall spreads the full seven blocks again from where it lands",
         * which blocks.js's own note on the falling id already claims.
         *
         * Skipping it did not just shorten the pool, it OSCILLATED: the
         * column at the foot of the fall spread a level-1 cell beside itself,
         * that cell then recomputed its own level, found no feeder it was
         * willing to look at, de-spread to air, and got refilled on the next
         * update -- for ever. A pour off a ledge never settled, which is what
         * a 120-second settle() cap was quietly absorbing.
         *
         * `sources` is NOT fed the same way. Vanilla counts
         * adjacentSourceBlocks before the bit-8 conversion, so a falling
         * column never helps make an infinite source.
         */
        if (n.level === 0 && !n.falling) sources++
        best = Math.min(best, n.falling ? 0 : n.level)
      }
      const above = metaAt(x, y + 1, z)
      const fedFromAbove = !!above && above.fluid === fluid

      let want
      if (fedFromAbove) {
        // Anything under the same fluid is a falling column, at full depth.
        want = { level: 0, falling: true }
      } else if (fluid === 'water' && sources >= 2 && (isBlocked(x, y - 1, z) || (() => {
        const below = metaAt(x, y - 1, z)
        return !!below && below.fluid === 'water' && below.level === 0
      })())) {
        // Infinite water. Two sources and a floor make a third.
        want = { level: 0, falling: false }
      } else {
        want = { level: best + decay, falling: false }
      }

      if (want.level > MAX_LEVEL) {
        // Nothing feeds this any more. Vanilla's de-spread.
        place(0, x, y, z, null)
        return true
      }
      if (want.level !== me.level || want.falling !== me.falling) {
        place(idOf(fluid, want.level, want.falling), x, y, z, fluid)
        return true
      }
    }

    /* ---- 2. straight down, and nothing else if it can ---- */
    const belowY = y - 1
    if (react(fluid, me.level, me.falling, x, belowY, z, true)) return true
    if (canFlowInto(x, belowY, z, fluid, -1)) {
      place(idOf(fluid, 0, true), x, belowY, z, fluid)
      return true
    }

    /*
     * ---- 3. sideways, but only if it could not fall ----
     *
     * `i >= 0 && (i == 0 || isBlocked(below))` in vanilla: a source spreads
     * sideways even over a hole (the hole is fed by the source's own downward
     * flow), and everything else only spreads when it is sitting on something.
     *
     * A FALLING COLUMN IS NOT EXEMPT, and it used to be here. Vanilla stores
     * "falling" as bit 8 of the same `i` the guard reads, so a falling block
     * carries i >= 8, fails `i == 0`, and has to earn its sideways branch
     * through isBlocked like any other flow. The exemption is what made a
     * waterfall a sheet: a column mid-drop cannot flow further down (the cell
     * below it is already its own falling water, which canFlowInto refuses),
     * so it fell through to here and spread. Both halves of that -- the
     * exemption and isBlocked calling fluid "support" -- had to go.
     */
    if (!source && !isBlocked(x, belowY, z)) return false

    // A falling column and a source both count as decay 0 for what they feed.
    const outLevel = (source || me.falling) ? decay : me.level + decay
    if (outLevel > MAX_LEVEL) return false

    let changed = false
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      const nz = z + dz
      if (react(fluid, me.level, me.falling, nx, y, nz, false)) { changed = true; continue }
      if (!canFlowInto(nx, y, nz, fluid, outLevel)) continue
      place(idOf(fluid, outLevel, false), nx, y, nz, fluid)
      changed = true
    }

    /*
     * NOT REPRODUCED -- vanilla's slope search (`getSlopeDistance`, up to four
     * blocks of lookahead per direction, every update). It makes water prefer
     * the direction of the nearest hole instead of spreading evenly, which is
     * the difference between a puddle that finds the drain and one that fills
     * the room first and then finds it. Both end in the same place. The search
     * is 4 directions x 4 depth x 4 directions of recursion per BLOCK per
     * update, on the hot path this whole scheduler exists to keep small, and
     * it buys aesthetics. If a pour ever needs to look right rather than end
     * right, this is the thing to add.
     */
    return changed
  }

  /**
   * One game tick's worth of fluid.
   *
   * @param dtMs milliseconds since the last call.
   */
  function tick(dtMs) {
    if (!enabled) return 0
    return step(dtMs)
  }

  /*
   * The tick, minus the enabled check. `run` goes through here rather than
   * through tick(), so a caller that has switched the engine OFF can still
   * wind it by hand -- which is the whole point of the switch for a test: stop
   * the world's clock from interleaving, then drive the simulation from a
   * clock you control. tick() is the world's clock; this is the mechanism.
   */
  function step(dtMs) {
    now += dtMs
    if (pending.size === 0) return 0
    let done = 0
    /*
     * Collected before applying, because update() schedules -- iterating the
     * Map while it grows would let a flow chase itself across the world inside
     * one tick, which is exactly the "water appears instantly" bug and also an
     * unbounded loop.
     */
    const due = []
    for (const [k, at] of pending) {
      if (at <= now) due.push(k)
      if (due.length >= BUDGET) break
    }
    for (const k of due) {
      pending.delete(k)
      const [x, y, z] = k.split(',').map(Number)
      update(x, y, z)
      done++
    }
    return done
  }

  /**
   * Seed from a chunk that just arrived.
   *
   * ONCE PER CHUNK, on chunkAdded, which is the only place in this file that
   * looks at more than seven voxels. A 24^3 chunk is 13,824 reads of a typed
   * array and it happens on load; the alternative is never noticing the lava
   * that was already in the cave, which is the actual bug report.
   *
   * Only fluids with somewhere to GO are scheduled -- an ocean is millions of
   * blocks and all but its surface and its edges are already settled.
   */
  function seedChunk(chunk) {
    const { voxels } = chunk
    if (!voxels) return 0
    const size = chunk.size
    let n = 0
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        for (let k = 0; k < size; k++) {
          const id = voxels.get(i, j, k)
          const m = metaById.get(id)
          if (!m) continue
          const x = chunk.x + i
          const y = chunk.y + j
          const z = chunk.z + k
          if (!hasSomewhereToGo(x, y, z, m)) continue
          schedule(x, y, z, m.fluid)
          n++
        }
      }
    }
    return n
  }

  /**
   * DOWNWARD ONLY, and the number below is why seedChunk is not wired up.
   *
   * The obvious version also wakes a fluid with AIR BESIDE IT. On this world
   * that is a disaster: the terrain is a real imported Minecraft patch, its
   * oceans and rivers are already at equilibrium, and every surface block along
   * a shore has air beside it. Waking them floods every beach seven blocks
   * inland and leaves a four-figure frontier in the queue forever. Measured:
   * 1,251 pending after one second, still climbing past 2,900 ten seconds
   * later, with a tray of water beside it crawling two blocks in the time it
   * should have gone seven, starved behind an ocean going nowhere.
   *
   * So: air UNDERNEATH, which is the reported bug exactly -- "see a random
   * block of lava in a cave, but it isnt flowing down". And that is still not
   * enough, which is the finding worth writing down. Measured on the real
   * patch, waking only unsupported fluid: 46 updates in the first second,
   * 6,575 by the eighth, pending climbing 17 -> 790 and accelerating. Sampling
   * the queue says what it is -- water_falling at (20, 66..70, 45) and a
   * source at (1, 64, 11) with air under it. The patch contains aquifer water
   * sitting over open cave, and once it is allowed to move it drains into the
   * cave system and keeps draining. That is not a bug in the spread: it is the
   * correct physics of terrain that was never in equilibrium in the first
   * place, and there is no amount of budget that makes an emptying aquifer
   * cheap.
   *
   * The fix is not here. It is either the terrain importer refusing to write
   * unsupported fluid, or a bounded settle pass run ONCE at import time and
   * baked into the asset -- which is what Minecraft's own generator does, and
   * why a vanilla chunk does not flood itself the moment it loads. Both are
   * bigger than this change and neither is in fluids.js.
   *
   * So seedChunk is kept, tested and NOT SUBSCRIBED. Everything the player
   * touches flows, because the setBlock wrap wakes it -- pour a bucket, mine
   * the wall of a pool, /setblock a source, and it goes. The lava that was
   * already in the cave starts moving the moment anything disturbs it, and
   * sits there until then. That is a smaller world than vanilla's and a
   * truthful one; the alternative measured above is a world that floods
   * itself on load.
   */
  function hasSomewhereToGo(x, y, z, _m) {
    return get(x, y - 1, z) === 0
  }

  return {
    tick,
    seedChunk,
    /** Stop or restart the simulation. See `enabled` above for the one caller. */
    setEnabled(on) { enabled = !!on },
    /*
     * Forget everything queued. A test seam, and a specific one: this suite
     * shares a page across spec files, so a pool built by an earlier file
     * leaves its frontier in the queue, and the BUDGET then spends itself on
     * somebody else's ocean while the tray in front of you does not fill. It
     * is not a "clear the world" -- the blocks stay exactly where they are,
     * only the intention to look at them again is dropped.
     */
    reset() { pending.clear() },
    get enabled() { return enabled },
    schedule: (x, y, z) => scheduleAround(x, y, z),
    /** id -> level info, for the HUD, the tests and underwater.js. */
    metaOf: (id) => metaById.get(id) ?? null,
    idOf,
    get pendingCount() { return pending.size },
    /** Test seam: a sample of what is still queued, for diagnosing churn. */
    peek(n = 12) {
      const out = []
      for (const k of pending.keys()) {
        if (out.length >= n) break
        const [x, y, z] = k.split(',').map(Number)
        out.push({ k, id: get(x, y, z) })
      }
      return out
    },
    get applied() { return applied },
    /** Test seam: drain the queue synchronously instead of over real time. */
    run(steps = 200, dtMs = 50) {
      let total = 0
      for (let i = 0; i < steps; i++) total += step(dtMs)
      return total
    },
  }
}

/**
 * Install the flow engine: seed it, wake it, and tick it.
 *
 * THE APPLIER, AND THE ONE THING WORTH ARGUING ABOUT.
 *
 * authority.js says it plainly: nothing calls noa.setBlock behind its back,
 * and a fluid tick is exactly what would be tempting to sneak past. So it is
 * named rather than snuck.
 *
 * authority.js splits DECIDE from APPLY. Its decide half answers "may THIS
 * PLAYER do this" -- `requestBlockChange` refuses a break in adventure mode
 * and a `command` cause from a non-operator. A fluid tick has no player and no
 * capability behind it: it is world simulation, the half that in the
 * multiplayer build docs/FUTURE.md describes runs INSIDE the Durable Object
 * and is broadcast, never requested. Routing it through `requestBlockChange`
 * would mean picking a `cause` and getting the wrong answer for it -- 'command'
 * denies the world its own physics for every non-op, and a fourth cause that
 * is always allowed is an `if (true)` with a name.
 *
 * So `setBlock` is a parameter with noa's as its default, and `authority` is
 * accepted and preferred the moment it offers a fluid path. When the room
 * exists, the server ticks fluids and this engine stops running client-side
 * entirely -- which is the same swap authority.js was shaped for, arriving at
 * the same seam from the simulation side.
 *
 * HANDOFF, so it is not lost: main.js can pass `authority` into
 * installFluids the day authority.js grows a world-simulation path. One line,
 * and it is not written here because main.js is another agent's file today.
 */
function installFluidFlow(noa, { blockIds, authority }) {
  const apply = authority?.applyWorldChange
    ? (id, x, y, z) => authority.applyWorldChange(id, x, y, z)
    : (id, x, y, z) => noa.setBlock(id, x, y, z)

  const flow = createFluidFlow(noa, {
    blockIds,
    flowTable: FLUID_FLOW,
    isNether: () => currentDimension() === 'nether',
    setBlock: apply,
  })

  /*
   * THE WORLD, as the geometry and the push need to see it: two questions and
   * nothing else. Both modules take this object rather than `noa`, which is
   * what lets the height and flow-vector maths be unit-tested against a plain
   * object with no engine under it.
   */
  const solidity = noa.registry.getBlockSolidity
  const world = {
    fluidAt: (x, y, z) => flow.metaOf(noa.getBlock(x, y, z)) || null,
    isSolid: (x, y, z) => !!solidity(noa.getBlock(x, y, z)),
  }
  flow.world = world
  /** A cell's own surface height, 0..1: vanilla's (8 - level)/9. */
  flow.heightAt = (x, y, z) => {
    const m = world.fluidAt(x, y, z)
    return m ? ownHeight(m) : 0
  }
  /** The surface height of a fluid corner, 0..1. Exposed for the specs. */
  flow.cornerHeightAt = (x, y, z) => {
    const m = world.fluidAt(x, y, z)
    return m ? cornerHeight(world, m.fluid, x, y, z) : 0
  }
  /** The ONE flow vector -- shape, texture and push all read this. */
  flow.flowVectorAt = (x, y, z) => flowVector(world, x, y, z)
  flow.geometry = installFluidGeometry(noa, world)
  flow.push = installFluidPush(noa, { flow })

  /*
   * NOT SUBSCRIBED TO chunkAdded, deliberately, and the measurement that
   * decided it is written out above hasSomewhereToGo. Short version: this
   * patch's imported terrain holds aquifer water over open cave, and waking it
   * on load drains that aquifer into the cave system -- a frontier that grows
   * without bound and starves every pour the player makes. `flow.seedChunk` is
   * still here and still tested, for the day the importer stops shipping
   * unsupported fluid, or for a console call.
   */

  /*
   * Waking. Any block change anywhere schedules its own cell and its six
   * neighbours, which is how a pool notices the wall you just mined out of it.
   *
   * WRAPPING noa.setBlock rather than subscribing: noa 0.33 emits nothing on a
   * voxel write. blockMeshes.js already wraps it for placement orientation,
   * and this wrap goes on top so it sees the id that was actually written --
   * order matters, and the order is "last wrapper installed sees the truth".
   *
   * The engine's OWN writes come back through here too, and that is wanted
   * rather than tolerated: one code path schedules neighbours, and it is this
   * one, so there is no second list of who-wakes-whom to keep in step.
   */
  const inner = noa.setBlock.bind(noa)
  noa.setBlock = (id, x, y, z) => {
    const out = inner(id, x, y, z)
    flow.schedule(x, y, z)
    return out
  }

  /*
   * Ticking. noa's 'tick' carries its own dt in milliseconds, which is the
   * number the schedule is written in -- see RATE_MS. Falling back to the
   * nominal tick keeps a test that drives ticks by hand honest.
   */
  noa.on('tick', (dt) => flow.tick(typeof dt === 'number' ? dt : 1000 / noa.tickRate))

  return flow
}

/* ------------------------------------------------------------------ *
 * THE PUSH
 * ------------------------------------------------------------------ *
 *
 * Reported from play: "Water should be pushing me and Evan!"
 *
 * THE SAME VECTOR AS THE SHAPE. fluidGeometry.js's `flowVector` is
 * BlockLiquid.getFlowVector, and in vanilla that ONE function drives the slope
 * of the surface, the rotation of the flow texture and the shove on every
 * entity in the cell. These are not three features. A second direction
 * computed here is a second direction that eventually disagrees with the
 * picture, so there isn't one -- this reads `flow.flowVectorAt`.
 *
 * ------------------------------------------------------------------
 * THE CONSTANT, and where it was read.
 *
 * World.handleMaterialAcceleration, MCP-919:
 *
 *     if (vec3.lengthVector() > 0.0D && entityIn.isPushedByWater()) {
 *         vec3 = vec3.normalize();
 *         double d1 = 0.014D;
 *         entityIn.motionX += vec3.xCoord * d1;  ... etc
 *     }
 *
 * 0.014 blocks per tick added to VELOCITY every tick is an acceleration of
 * 0.014 b/tick^2, and this file's header is explicit about the conversion:
 * a tick is 0.05 s, so b/tick^2 * 400 = b/s^2. 0.014 -> 5.6 b/s^2. The same
 * arithmetic that turned Minecraft's 0.005 sink into 2 b/s^2 at the top of
 * this file, which is the point of doing it the same way.
 *
 * NOTE THE NORMALIZE IS OUTSIDE THE LOOP. Every cell contributes its own unit
 * vector, they are SUMMED, and the sum is normalised once. So standing in two
 * cells whose flows oppose gives you nothing, and standing in two that agree
 * gives you exactly the same shove as standing in one -- the push is a
 * direction at a fixed strength, never a magnitude that builds up.
 *
 * LAVA. In 1.8 lava does not push at all: Entity.moveEntity calls
 * handleMaterialAcceleration with Material.water and nothing else (line 1113),
 * and its only lava call is isMaterialInBB, which asks a question and applies
 * no force. Modern versions do push, through FlowingFluid.motionScale --
 * 0.0023 in an ordinary dimension and 0.007 in an ultrawarm one, which is the
 * Nether. Both are reproduced, because this world has a Nether and because
 * "lava drags you toward the drop" is the behaviour a player expects today.
 *
 * ------------------------------------------------------------------
 * THE BOX IS SHRUNK, and by an asymmetric amount that is vanilla's:
 *
 *     getEntityBoundingBox().expand(0, -0.4, 0).contract(0.001, 0.001, 0.001)
 *
 * 0.4 off the TOP AND BOTTOM vertically. Standing ankle-deep at the thin end
 * of a run is not being in the current -- you have to be 0.4 of a block into
 * it before it can move you, which is why a one-ninth-tall trickle at the end
 * of a pour does nothing to you and the full block at the source does.
 */

/** Minecraft's push, in blocks per tick^2, before the x400 to b/s^2. */
const PUSH_PER_TICK = { water: 0.014, lavaOverworld: 0.0023, lavaNether: 0.007 }

/** Vanilla's box deflation before the scan: 0.4 vertical, 0.001 horizontal. */
const PUSH_DEFLATE_Y = 0.4
const PUSH_DEFLATE_XZ = 0.001

/**
 * WHO IS IN THE WATER.
 *
 * entityBox.js owns that question -- it was "built general because punching is
 * coming", and a fluid tick is the second caller it was built for. The
 * question here is "every simulated body": unlike a placement check or a punch
 * there is no interesting region, and the list this walks is the same list
 * that will grow when the next thing with a body arrives. Writing a second
 * `getStatesList(physics)` loop in this file would be a second answer to a
 * question that already has one.
 *
 * This asked `entitiesInBox` for a box of +-1e7 and got the same list the slow
 * way: a box build and three overlap tests per body, against a region nothing
 * can be outside. `everyBody` is that query with the pretence dropped, and it
 * is now also what the drag tuning walks -- one list, two callers, which is
 * the arrangement that stops the two disagreeing about who is in the water.
 */

export function installFluidPush(noa, { flow }) {
  let lastPush = [0, 0, 0]

  function pushOf(entity) {
    const box = entityBox(noa, entity)
    if (!box) return null
    const x0 = Math.floor(box.min[0] + PUSH_DEFLATE_XZ)
    const x1 = Math.floor(box.max[0] - PUSH_DEFLATE_XZ)
    const z0 = Math.floor(box.min[2] + PUSH_DEFLATE_XZ)
    const z1 = Math.floor(box.max[2] - PUSH_DEFLATE_XZ)
    const yLo = box.min[1] + PUSH_DEFLATE_Y
    const yHi = box.max[1] - PUSH_DEFLATE_Y
    if (yHi < yLo) return null
    let vx = 0, vy = 0, vz = 0
    let fluid = null
    for (let y = Math.floor(yLo); y <= Math.floor(yHi); y++) {
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const m = flow.metaOf(noa.getBlock(x, y, z))
          if (!m) continue
          /*
           * The SURFACE test, and it is why a shallow flow cannot push you.
           * Vanilla: `d0 = (y + 1) - getLiquidHeightPercent(level)` is the top
           * of the fluid, and the cell only counts if the deflated box reaches
           * it. A level-7 cell's surface is a ninth of a block up; a box
           * already shrunk 0.4 from the bottom never gets there.
           */
          const surface = y + 1 - (1 - flow.heightAt(x, y, z))
          if (yHi < surface) continue
          const [ax, ay, az] = flow.flowVectorAt(x, y, z)
          vx += ax; vy += ay; vz += az
          fluid = m.fluid
        }
      }
    }
    if (!fluid) return null
    const n = Math.hypot(vx, vy, vz)
    if (n === 0) return null
    const scale = fluid === 'water'
      ? PUSH_PER_TICK.water
      : (currentDimension() === 'nether' ? PUSH_PER_TICK.lavaNether : PUSH_PER_TICK.lavaOverworld)
    // b/tick^2 -> b/s^2, the conversion this file's header derives.
    const a = scale * 400
    return [vx / n * a, vy / n * a, vz / n * a]
  }

  /*
   * GROUND FRICTION HAS TO STAND DOWN WHILE THE CURRENT IS ON YOU, and this
   * is the one thing here that touches the existing physics at all.
   *
   * voxel-physics-engine's friction is COULOMB -- `dvMax = |friction *
   * dvNormal|`, where dvNormal is the velocity a tick of gravity just added
   * into the floor. That is about 1.07 b/s per tick at this gravity, against
   * the 0.19 b/s the push adds, so a body standing on the bottom had its
   * lateral velocity clamped to exactly zero every single tick. Measured: the
   * player drifted 0 blocks in two seconds with the force applying correctly.
   *
   * Minecraft has no such term. Entity.travel takes its water branch on
   * `isInWater()` and that branch never reads Block.getSlipperiness at all --
   * the only retention in water is the fluid's own 0.8, which here is
   * `body.fluidDrag` and is already set by the tuning above. So zeroing the
   * ground friction while the flow is acting is not a workaround for the
   * engine, it is the engine being asked the question vanilla asks.
   *
   * SCOPED TO FLOWING FLUID, WHICH IS WHY IT IS SAFE. `pushOf` returns null
   * for still water -- a settled pool has a zero flow vector everywhere -- so
   * every existing fluid spec, all of which use still pools, sees the friction
   * it has always seen. The saved value is restored the moment the push stops.
   */
  const savedFriction = new Map()

  noa.on('tick', () => {
    let seen = [0, 0, 0]
    for (const id of everyBody(noa)) {
      const a = pushOf(id)
      const body = noa.ents.getPhysics(id)?.body
      if (!a || !body) {
        if (body && savedFriction.has(id)) {
          body.friction = savedFriction.get(id)
          savedFriction.delete(id)
        }
        continue
      }
      if (!savedFriction.has(id)) savedFriction.set(id, body.friction)
      body.friction = 0
      /*
       * A FORCE, not a velocity write, and not an impulse. The rest of this
       * file's fluid behaviour is expressed as accelerations into the same
       * solver, and the buoyancy top-up a few lines up is applied exactly this
       * way. Writing velocity directly would fight the drag that the sink and
       * climb constants were fitted against -- the one thing the header says
       * not to disturb.
       */
      body.applyForce([a[0] * body.mass, a[1] * body.mass, a[2] * body.mass])
      if (id === noa.playerEntity) seen = a
    }
    lastPush = seen
  })

  return {
    /** The acceleration the flow applied to one entity this tick, b/s^2. */
    accelOn: (entity) => pushOf(entity) || [0, 0, 0],
    /** What the player got last tick. The debug HUD and the specs read it. */
    lastPlayerPush: () => lastPush,
    PUSH_PER_TICK,
  }
}
