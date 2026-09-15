/*
 * The line chat prints when somebody dies.
 *
 * Vanilla builds these from translation keys in en_us.json -- death.attack.drown
 * is "%1$s drowned" -- and CombatTracker.getDeathMessage picks the key from the
 * damage source that landed the killing blow. This is that lookup, with the
 * keys kept in the comments so the strings are checkable against the game
 * rather than trusted because they look right.
 *
 * WHY ITS OWN FILE, and this is the only real design call here. Two places
 * need the same sentence: the chat log, which shows it for EVERY player, and
 * the death screen, which shows it for YOU. chat.js is the wrong home because
 * respawn.js would have to import the chat overlay to label a screen; survival
 * is the wrong home because it owns numbers and has no opinions about English.
 * So the table sits on its own and both call in.
 *
 * Rejected: formatting the string inside survival.js and shipping it on the
 * death event. That bakes a display string into game state, which is the exact
 * mistake identity.js has a long comment about -- the moment a server is
 * involved, the wire should carry the CAUSE and each client should render it in
 * its own language. A cause is data; a sentence is a view.
 *
 * NOT IMPLEMENTED, deliberately, because this world cannot produce them:
 * every death.attack.* key involving another entity (slain, shot, fireball,
 * pricked, squished, blown up), the climbable-block fall variants
 * (death.fell.accident.ladder / .vines / .scaffolding -- nothing here is
 * climbable), and death.attack.inFire, "%1$s went up in flames", which needs a
 * standing fire BLOCK to be in. Inventing any of them would be inventing
 * fidelity; see the same argument in sounds.js about hurt sounds.
 */

/** CombatTracker only reaches for a height message above five blocks fallen. */
const FALL_HIGH_BLOCKS = 5

/**
 * @param {string} name  the player's BARE name, straight off the roster.
 *   No `<>` -- those belong to the chat format, which a system message is not
 *   in -- and no `[Admin]`, because a rank is chat decoration and not part of
 *   anyone's name. See the format note in chat.js and the roster note in
 *   identity.js; this world has gotten that wrong three times already.
 * @param {{ cause?: string, fallDistance?: number }} [detail]  the payload
 *   survival.js publishes on death, passed through untouched.
 */
export function deathMessage(name, { cause = 'generic', fallDistance = 0 } = {}) {
  switch (cause) {
    /*
     * Fall is the one cause with two strings, and the split is by DISTANCE,
     * not by anything about the landing. Over five blocks you get
     * death.fell.accident.generic; five or under you get death.attack.fall,
     * which is the key vanilla falls back to when the drop was not far enough
     * to be worth describing as a height.
     *
     * The short one looks unreachable and is not: damage is floor(d - 3), so a
     * four-block drop costs one half-heart, and it kills anyone already down
     * to their last one. It is rare, which is exactly why it is written down
     * instead of left to be discovered as a wrong message later.
     */
    case 'fall':
      return fallDistance > FALL_HIGH_BLOCKS
        ? `${name} fell from a high place`   // death.fell.accident.generic
        : `${name} hit the ground too hard`  // death.attack.fall

    case 'void':   return `${name} fell out of the world`   // death.attack.outOfWorld
    case 'drown':  return `${name} drowned`                 // death.attack.drown
    case 'lava':   return `${name} tried to swim in lava`    // death.attack.lava

    /*
     * onFire, not inFire. survival.js only ever ignites you from lava
     * (lavaBurn calls ignite for BURN_SECONDS), so the fire that kills you
     * here is always fire you are CARRYING, which is death.attack.onFire.
     * "went up in flames" is death.attack.inFire and belongs to standing in a
     * fire block -- a block this world does not have.
     */
    case 'onFire': return `${name} burned to death`         // death.attack.onFire

    // Reachable only if HUNGER_DRAIN_ENABLED is flipped on in survival.js.
    // Listed anyway: the cause string already exists in that file, and a table
    // that silently says "died" the day someone flips the flag is worse than
    // one row of dead code.
    case 'starve': return `${name} starved to death`        // death.attack.starve

    /*
     * /kill. Vanilla stopped saying "fell out of the world" for this in 1.16 --
     * Entity.kill() used to use the out-of-world damage source, and the
     * message really was the void one -- and it now has its own key. Worth
     * knowing which vintage you are copying: the old behaviour is a real
     * Minecraft behaviour, just not the current one.
     */
    case 'command': return `${name} was killed`             // death.attack.genericKill

    default: return `${name} died`                          // death.attack.generic
  }
}
