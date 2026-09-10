/*
 * The four-line event emitter the rest of the codebase kept re-typing.
 *
 * survival.js grew one of these inline for `onChange`, and interact.js and
 * physics.js both need the same shape now that sounds and particles listen to
 * them. Three inline copies is where a shared helper stops being overhead.
 *
 * `on` returns its own unsubscribe rather than taking an `off(fn)`, because
 * the listeners here are mostly arrow functions defined at the call site and
 * there is nothing to hand back to an `off`. That's the same contract
 * survival.onChange already uses.
 *
 * Listeners are copied before dispatch. Without that, a listener that
 * unsubscribes itself while being called mutates the Set mid-iteration.
 */
export function createEmitter() {
  const listeners = new Set()
  return {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    emit(payload) { for (const fn of [...listeners]) fn(payload) },
    get size() { return listeners.size },
  }
}
