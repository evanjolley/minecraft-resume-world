import { MC } from './physics.js'
import { createEmitter } from './emitter.js'

/*
 * Survival state: health, hunger, XP, fall damage, death.
 *
 * Minecraft counts health and hunger in HALF units. 20 health = 10 hearts,
 * 20 food = 10 drumsticks. Storing the display value (10) instead of the
 * game value (20) is the classic mistake, because it makes half-hearts
 * unrepresentable and every damage number wrong by 2x.
 */

export const MAX_HEALTH = 20
export const MAX_FOOD = 20

// Hunger drain is real Minecraft, but this world's job is to be read. A
// visitor who idles for ten minutes reading a resume plot should not starve.
// Flip to true for full survival rules.
const HUNGER_DRAIN_ENABLED = false

/**
 * @param rules  the gamemode/game-rule gates. Injected rather than imported so
 *   survival.js keeps knowing nothing about modes or operators: it asks "may
 *   this happen", and authority.js is what answers. Defaults are full survival
 *   rules, which is what the module means on its own.
 */
export function createSurvival(noa, {
  allowDamage = () => true,
  allowRegen = () => true,
  // Armor sits here rather than inside damage() because what reduces incoming
  // damage is inventory state, and survival has no business reading the
  // inventory. main.js supplies it.
  damageReduction = (amount) => amount,
} = {}) {
  const state = {
    health: MAX_HEALTH,
    food: MAX_FOOD,
    saturation: 5,
    xpLevel: 0,
    xpProgress: 0, // 0..1 across the current level
    dead: false,
    /*
     * Air, in TICKS, because that is the unit Minecraft counts it in and the
     * unit every rule about it is stated in -- 300 max, one per tick under
     * water, four per tick back. The HUD divides by 30 to get bubbles; storing
     * bubbles here instead would make the 20-tick grace period below
     * unrepresentable, which is the same mistake as storing hearts instead of
     * half-hearts.
     */
    air: MC.AIR_TICKS,
    /** Whether the fire overlay should be drawn. Seconds remaining is private. */
    burning: false,
  }

  const listeners = new Set()
  const changed = () => listeners.forEach(fn => fn(state))
  state.onChange = fn => { listeners.add(fn); fn(state); return () => listeners.delete(fn) }

  const player = noa.playerEntity
  const body = () => noa.ents.getPhysics(player).body

  /*
   * Damage and death are published as events, separately from onChange.
   *
   * onChange fires for every state edit -- healing, hunger ticking, a reset --
   * so anything that wants to react specifically to being HURT (a sound, a
   * red screen flash, a knockback) would have to diff the health value to
   * find out. These say it directly.
   */
  const hurt = createEmitter()   // { amount, health, cause }
  const died = createEmitter()   // { cause }
  state.onHurt = hurt.on
  state.onDeath = died.on

  state.damage = (amount, cause = 'generic') => {
    if (state.dead || amount <= 0) return
    // The one gate. Creative and spectator invulnerability and the fallDamage
    // game rule are all the same question asked of the same function, so
    // there is no mode-specific branch anywhere in this file.
    if (!allowDamage(cause)) return
    amount = damageReduction(amount, cause)
    if (amount <= 0) return
    state.health = Math.max(0, state.health - amount)
    if (state.health === 0) state.dead = true
    changed()
    hurt.emit({ amount, health: state.health, cause })
    if (state.dead) died.emit({ cause })
  }

  state.heal = (amount) => {
    if (state.dead) return
    state.health = Math.min(MAX_HEALTH, state.health + amount)
    changed()
  }

  state.reset = () => {
    state.health = MAX_HEALTH
    state.food = MAX_FOOD
    state.saturation = 5
    state.dead = false
    // Air and fire are part of "back to a fresh player" for the same reason
    // health is. Leaving them out is how a test that drowned leaks an empty
    // breath meter into the next one.
    airTicks = MC.AIR_TICKS
    state.air = MC.AIR_TICKS
    state.extinguish()
    changed()
  }

  /*
   * Fall damage. Minecraft measures the distance from the highest point
   * reached since you last touched ground, and deals floor(distance - 3)
   * half-hearts on landing. The subtle part is WHERE you reset the peak:
   * it has to be the moment you touch ground, not the moment you jump,
   * otherwise a jump off a ledge measures from the ledge instead of from
   * the top of the jump arc and under-reports by the jump height.
   */
  let peakY = null

  noa.on('tick', () => {
    const y = noa.ents.getPositionData(player).position[1]
    const onGround = body().atRestY() < 0

    if (onGround) {
      if (peakY !== null) {
        const fallen = peakY - y
        const excess = Math.floor(fallen - MC.FALL_SAFE_BLOCKS)
        if (excess > 0) state.damage(excess, 'fall')
        peakY = null
      }
    } else {
      peakY = peakY === null ? y : Math.max(peakY, y)
    }
  })

  /*
   * Void death. Falling out of the world kills you in Minecraft rather than
   * teleporting you home, so respawn.js defers to this when survival is on.
   *
   * It bypasses damage() deliberately -- vanilla's out-of-world damage source
   * is flagged bypass-invulnerability, which is why a creative player still
   * dies down there -- but it must NOT bypass the death event. Falling off
   * this island is by a wide margin the most common death in the world, and a
   * subscriber that only heard about the rare ones would have to re-derive the
   * common one by diffing health on every change.
   *
   * Ordering matches damage(): state is committed, changed() fires, then the
   * event. Anything listening to both therefore sees `dead` already true when
   * the event arrives, in both paths.
   */
  state.onVoidFall = () => {
    if (state.dead) return
    state.health = 0
    state.dead = true
    peakY = null
    changed()
    hurt.emit({ amount: MAX_HEALTH, health: 0, cause: 'void' })
    died.emit({ cause: 'void' })
  }

  // Clearing the peak on respawn matters: without it you take fall damage
  // for the drop you already died from, the instant you land at spawn.
  state.clearFallTracking = () => { peakY = null }

  /*
   * /kill, and it deliberately does NOT go through damage().
   *
   * Vanilla's /kill is Float.MAX_VALUE from a damage source flagged
   * bypass-invulnerability, so it kills a creative player who is otherwise
   * immune to everything. Routing it through the gate above would make /kill
   * silently do nothing in exactly the mode you are most likely to be in when
   * you type it.
   */
  state.kill = () => {
    if (state.dead) return
    state.health = 0
    state.dead = true
    peakY = null
    changed()
    hurt.emit({ amount: MAX_HEALTH, health: 0, cause: 'command' })
    died.emit({ cause: 'command' })
  }

  /* ------------------------------------------------------------------ *
   * Breath, drowning and burning.
   *
   * These are DRIVEN, not self-sensing: fluids.js decides every tick whether
   * the eyes are under water and whether the feet are in lava, and calls in.
   * The alternative -- survival sampling blocks itself -- would put a second
   * answer to "am I in water" in the codebase, and the two would disagree the
   * first time either changed.
   * ------------------------------------------------------------------ */

  /*
   * The live counter, which goes NEGATIVE. `state.air` is the clamped copy the
   * HUD paints; this is the real one, because the twenty ticks below zero are
   * exactly the grace period between the bar emptying and the first hit.
   */
  let airTicks = MC.AIR_TICKS

  /**
   * @param secs        elapsed time
   * @param submerged   whether the EYES are in water. Not the feet: standing
   *   chest-deep in a pond slows you down and does not drown you, and vanilla
   *   tests isEyeInFluid for exactly this.
   */
  state.breathe = (secs, submerged) => {
    if (state.dead) return
    const ticks = secs * MC.TICKS_PER_SECOND
    const before = airTicks

    if (!submerged) {
      if (airTicks >= MC.AIR_TICKS) return
      airTicks = Math.min(MC.AIR_TICKS, airTicks + ticks * MC.AIR_REFILL_PER_TICK)
    } else {
      airTicks -= ticks
      /*
       * Vanilla hurts you at exactly -20 and then sets the counter back to 0,
       * NOT to -20. That reset is what makes drowning one hit per second
       * rather than one per tick, and it is the only reason this reads as a
       * comparison against a negative number instead of against zero.
       */
      if (airTicks <= -MC.DROWN_GRACE_TICKS) {
        airTicks = 0
        state.damage(MC.DROWN_DAMAGE, 'drown')
      }
    }

    /*
     * Rounded, because Minecraft's air supply is an INTEGER tick count and
     * this one is accumulated from a floating-point dt. Without it a meter
     * that has just refilled reads 299.9999999 and the HUD draws nine and a
     * half bubbles at a full breath.
     */
    state.air = Math.max(0, Math.round(airTicks))
    if (before !== airTicks) changed()
  }

  /*
   * Fire, in seconds remaining. Minecraft counts it in ticks and hurts you on
   * every twentieth, which is a modulo on a countdown; a countdown plus a
   * separate interval timer is the same thing and survives a variable dt,
   * which noa's tick has and Minecraft's does not.
   */
  let fireSeconds = 0
  let fireTimer = 0
  let lavaTimer = 0

  /** Minecraft's setSecondsOnFire: it raises the timer, never lowers it. */
  state.ignite = (seconds) => {
    if (state.dead) return
    if (seconds <= fireSeconds) return
    fireSeconds = seconds
    state.burning = true
    changed()
  }

  state.extinguish = () => {
    fireSeconds = 0
    fireTimer = 0
    lavaTimer = 0
    if (state.burning) { state.burning = false; changed() }
  }

  /**
   * A tick spent in lava. Called by fluids.js for as long as the feet are in
   * it, which is also what keeps the 15-second burn topped up.
   */
  state.lavaBurn = (secs) => {
    if (state.dead) return
    state.ignite(MC.BURN_SECONDS)
    /*
     * Fire damage is suppressed while you are still in the lava
     * (`remainingFireTicks % 20 == 0 && !this.isInLava()`), and holding the
     * fire timer at zero is how that is expressed here -- it can never reach
     * one second while this is being called every tick. Rejected: a separate
     * `inLava` flag read by the fire tick below, which would be a frame late
     * in whichever order the two tick handlers happened to be registered.
     */
    fireTimer = 0

    lavaTimer -= secs
    if (lavaTimer <= 0) {
      lavaTimer = MC.LAVA_DAMAGE_INTERVAL
      state.damage(MC.LAVA_DAMAGE, 'lava')
    }
  }

  noa.on('tick', (dt) => {
    if (state.dead || fireSeconds <= 0) return
    const secs = dt / 1000
    fireSeconds -= secs
    fireTimer += secs
    if (fireTimer >= MC.FIRE_INTERVAL) {
      fireTimer -= MC.FIRE_INTERVAL
      state.damage(MC.FIRE_DAMAGE, 'onFire')
    }
    if (fireSeconds <= 0) state.extinguish()
  })

  /*
   * Hunger and regeneration, both real Minecraft rules:
   *   food >= 18       -> health regenerates slowly
   *   food == 0        -> you starve
   * Exhaustion (the thing sprinting and jumping actually spend) is
   * simplified here to a flat drain.
   */
  let regenTimer = 0
  let drainTimer = 0

  noa.on('tick', (dt) => {
    if (state.dead) return
    const secs = dt / 1000

    if (HUNGER_DRAIN_ENABLED) {
      drainTimer += secs
      if (drainTimer > 30) {
        drainTimer = 0
        if (state.food > 0) { state.food--; changed() }
      }
      if (state.food === 0) {
        regenTimer += secs
        if (regenTimer > 4) { regenTimer = 0; state.damage(1, 'starve') }
        return
      }
    }

    if (state.food >= 18 && state.health < MAX_HEALTH && allowRegen()) {
      regenTimer += secs
      if (regenTimer > 4) { regenTimer = 0; state.heal(1) }
    }
  })

  return state
}
