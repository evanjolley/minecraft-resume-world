import { ARMOR_SLOTS, armorOf } from './items.js'

/*
 * Armor: what the four slots are worth, and what they do to a hit.
 *
 * Pure. It takes stacks and a damage number and returns a damage number, so
 * survival.js can apply it with one line and this file never learns what a
 * player is. That matters because damage application is not ours to own --
 * see the report for the wiring -- and a reduction function is the smallest
 * thing survival.js can be asked to accept.
 */

export { ARMOR_SLOTS }

/*
 * Damage sources armor does nothing about.
 *
 * Vanilla flags these on the damage type itself (`bypasses_armor`), which is
 * the right model and would be over-built here for two causes. Starving in
 * full diamond still starves; the void does not care what you are wearing.
 * `command` is absent on purpose -- survival.js's /kill deliberately skips
 * damage() altogether, so it never reaches this.
 */
const BYPASSES_ARMOR = new Set(['starve', 'void'])

/**
 * Total defense points and toughness for a set of four stacks.
 * Missing or non-armor stacks contribute nothing, so a half-equipped player
 * needs no special case.
 */
function armorStats(stacks) {
  let points = 0, toughness = 0
  for (const stack of stacks) {
    const a = stack && armorOf(stack.id)
    if (!a) continue
    points += a.points
    toughness += a.toughness
  }
  return { points, toughness }
}

/**
 * Minecraft's armor formula, verbatim from CombatRules.getDamageAfterAbsorb:
 *
 *   f = 2 + toughness / 4
 *   g = clamp(points - damage / f, points * 0.2, 20)
 *   damage * (1 - g / 25)
 *
 * Two things in there are the whole reason to look it up rather than guess:
 *
 *   - Reduction is NOT `points * 4%` flat. Big hits punch through armor,
 *     because `damage / f` is subtracted from the points before they count.
 *     Toughness raises f, which is exactly what makes diamond and netherite
 *     hold up against big hits where iron does not.
 *   - The floor at `points * 0.2` means armor always does SOMETHING, however
 *     large the hit, and the ceiling at 20 caps reduction at 80%. Nothing in
 *     Minecraft makes you immune through armor alone.
 *
 * Damage is in half-hearts, the same unit survival.js stores health in, so
 * the numbers here are Minecraft's own with no scaling.
 */
function damageAfterArmor(amount, points, toughness = 0) {
  if (amount <= 0 || points <= 0) return amount
  const f = 2 + toughness / 4
  const g = Math.min(20, Math.max(points * 0.2, points - amount / f))
  return amount * (1 - g / 25)
}

/**
 * The function survival.js gets handed.
 *
 * Reads the armor slots live rather than caching a total, because the player
 * can swap a chestplate mid-fight and a cached number would be a stale one at
 * exactly the wrong moment.
 *
 * Returns a FRACTIONAL damage value, deliberately -- Minecraft's health is a
 * float and rounding here would either make small hits free in good armor or
 * make armor worthless against them. hud.js draws a partial half-heart as a
 * half-heart, which is also what Minecraft does.
 */
export function createArmorReduction(inv) {
  return (amount, cause = 'generic') => {
    if (BYPASSES_ARMOR.has(cause)) return amount
    const { points, toughness } = armorStats(inv.armor)
    return damageAfterArmor(amount, points, toughness)
  }
}

/** The bar's value, 0-20, in the same half-unit scale as hearts and hunger. */
export const armorPoints = (inv) => armorStats(inv.armor).points
