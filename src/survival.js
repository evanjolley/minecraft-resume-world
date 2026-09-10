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
export const HUNGER_DRAIN_ENABLED = false

/**
 * @param rules  the gamemode/game-rule gates. Injected rather than imported so
 *   survival.js keeps knowing nothing about modes or operators: it asks "may
 *   this happen", and authority.js is what answers. Defaults are full survival
 *   rules, which is what the module means on its own.
 */
export function createSurvival(noa, {
  allowDamage = () => true,
  allowRegen = () => true,
} = {}) {
  const state = {
    health: MAX_HEALTH,
    food: MAX_FOOD,
    saturation: 5,
    xpLevel: 0,
    xpProgress: 0, // 0..1 across the current level
    dead: false,
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
