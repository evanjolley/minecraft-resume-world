import { foodOf } from './items.js'
import { MC } from './physics.js'

/*
 * Eating. Hold right-click with food for 32 ticks (1.6 s) and it goes onto
 * the hunger bar, vanilla's Consumable with its default consume time.
 *
 * The shape is potions.js's drinking, deliberately: one hold-to-use in this
 * world already has the right cancel rules (let go, scroll the hotbar, open a
 * screen, lose the stack), and a second one that cancelled differently would
 * be the bug. Like vanilla you cannot eat on a full bar; there is no golden
 * apple here to be the exception.
 */

export const EAT_TICKS = 32
export const EAT_SECONDS = EAT_TICKS / MC.TICKS_PER_SECOND

export function installFood(noa, { inventory, survival, inputLock, authority, effects = null, sounds = null }) {
  let eating = null // { id, slot, elapsed }

  function finish() {
    const { id } = eating
    eating = null
    const food = foodOf(id)
    if (!food) return false
    survival.eat(food.nutrition, food.saturation)
    // Raw chicken: a 30% chance of Hunger for 30 seconds.
    if (food.effect && effects && Math.random() < food.effect.chance) {
      effects.give(noa.playerEntity, food.effect.key, food.effect.seconds, 0)
    }
    if (!authority.caps().infiniteResources) inventory.consumeSelected()
    sounds?.play?.('eat')
    return true
  }

  noa.on('tick', (dtMs) => {
    if (!eating) return
    const stack = inventory.slots[eating.slot]
    if (inputLock.locked || !noa.inputs.state['alt-fire']
      || inventory.selected !== eating.slot || !stack || stack.id !== eating.id) {
      eating = null
      return
    }
    eating.elapsed += dtMs / 1000
    if (eating.elapsed >= EAT_SECONDS) finish()
  })

  noa.inputs.down.on('alt-fire', () => {
    if (inputLock.locked || eating) return
    const stack = inventory.selectedStack()
    if (!stack || !foodOf(stack.id)) return
    // A full bar refuses, as vanilla's canEat(false) does. Creative eats
    // anyway: vanilla lets an instabuild player eat at any hunger.
    if (survival.food >= 20 && !authority.caps().infiniteResources) return
    eating = { id: stack.id, slot: inventory.selected, elapsed: 0 }
  })

  return {
    get eating() { return eating ? eating.id : null },
    progress: () => (eating ? Math.min(1, eating.elapsed / EAT_SECONDS) : 0),
    /** Finish the bite now, for specs that should not wait 1.6 s. */
    eatNow() {
      const stack = inventory.selectedStack()
      if (!stack || !foodOf(stack.id)) return false
      eating = { id: stack.id, slot: inventory.selected, elapsed: EAT_SECONDS }
      return finish()
    },
  }
}
