import { MC } from './physics.js'

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

export function createSurvival(noa) {
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

  state.damage = (amount) => {
    if (state.dead || amount <= 0) return
    state.health = Math.max(0, state.health - amount)
    if (state.health === 0) state.dead = true
    changed()
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
        if (excess > 0) state.damage(excess)
        peakY = null
      }
    } else {
      peakY = peakY === null ? y : Math.max(peakY, y)
    }
  })

  // Void death. Falling out of the world kills you in Minecraft rather than
  // teleporting you home, so respawn.js defers to this when survival is on.
  state.onVoidFall = () => {
    state.health = 0
    state.dead = true
    peakY = null
    changed()
  }

  // Clearing the peak on respawn matters: without it you take fall damage
  // for the drop you already died from, the instant you land at spawn.
  state.clearFallTracking = () => { peakY = null }

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
        if (regenTimer > 4) { regenTimer = 0; state.damage(1) }
        return
      }
    }

    if (state.food >= 18 && state.health < MAX_HEALTH) {
      regenTimer += secs
      if (regenTimer > 4) { regenTimer = 0; state.heal(1) }
    }
  })

  return state
}
