/*
 * Arm swing state, shared by the first-person viewmodel and the third-person
 * player model.
 *
 * It lives on its own because both need the SAME swing: in Minecraft, other
 * players see your arm swing at the moment you see it swing. Keeping two
 * timers would let them drift apart, which is exactly the kind of thing
 * nobody notices until multiplayer exists and then cannot unsee.
 */
export function createSwing() {
  let t = 0

  return {
    /** Start a swing, restarting one already in progress. */
    trigger() { t = 1 },
    /** Start a swing only if the arm is at rest, for held-down mining. */
    triggerIfIdle() { if (t <= 0) t = 1 },
    update(secs) { if (t > 0) t = Math.max(0, t - secs * 3.2) },
    get active() { return t > 0 },
    /** Raw 1 -> 0 countdown. Minecraft's swingProgress is 1 - this. */
    get value() { return t },
    /** 0 -> 1 -> 0 over the swing, which is the shape both animations want. */
    get arc() { return Math.sin(t * Math.PI) },
  }
}
