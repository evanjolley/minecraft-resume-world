import { GAMEMODES, DEFAULT_GAMEMODE } from './gamemode.js'
import { createEmitter } from './emitter.js'

/*
 * The trust boundary. One module decides what the player is allowed to do;
 * everything else asks it and reacts to the answer.
 *
 * This world is going to be multiplayer (docs/FUTURE.md: a Cloudflare Durable
 * Object fronting a WebSocket room). The moment that lands, "may I break this
 * block" stops being a question the browser can answer, because the browser is
 * the thing you cannot trust. So it is written that way NOW: no command
 * assigns state, no call site calls noa.setBlock behind this module's back,
 * and no caller assumes the answer arrives in the same turn it asked.
 *
 * The split that makes the server swap cheap is DECIDE vs APPLY:
 *
 *   decide -- the request* methods below. Today they check isOperator() and
 *             the gamemode table locally. Tomorrow they post to the room and
 *             await its verdict. This half is what gets replaced.
 *   apply  -- the `world` adapter passed in by main.js: setBlock, teleport,
 *             give, applyGamemode. Untouched by the swap, because a confirmed
 *             change has to be applied locally either way -- the difference is
 *             only whether the confirmation came from here or from the room.
 *
 * WHY PROMISES rather than a request/confirm callback pair: `await` reads the
 * same whether the answer is a local branch or a round trip, so no call site
 * has to be rewritten when one becomes the other, and a refusal has exactly
 * one shape (`{ ok: false, error }`) instead of two paths that drift apart.
 * The cost is that a locally-granted request now lands one microtask late,
 * which is why interact.js clears its own mining state before awaiting rather
 * than after -- see the comment there.
 *
 * Deliberately NOT here: any netcode. No socket, no protocol, no
 * reconnection, no prediction. That is a separate job; this is the seam it
 * plugs into.
 */

/* ------------------------------------------------------------------ *
 * Operator status
 * ------------------------------------------------------------------ */

/*
 * THE PASSPHRASE, AND WHY IT IS NOT SECURITY.
 *
 * This string ships in the JavaScript bundle. Anyone can read it out of
 * devtools in about ten seconds, and anyone who cannot be bothered can skip
 * the passphrase entirely and set the localStorage key below by hand. This is
 * obfuscation. It is not authentication, and it must never be described as
 * authentication anywhere in this repo.
 *
 * That is tolerable today for one reason and one reason only: nothing is
 * shared. There is no server and no persistence, so a visitor who grants
 * themselves creative mode is redecorating a world that exists inside their
 * own tab and dies with it. There is nothing to protect.
 *
 * It stops being tolerable the moment multiplayer and persistence land,
 * because then one griefer with creative can damage a world every other
 * visitor sees. At that point the fix is not a longer passphrase or a hash --
 * both are equally readable in the bundle. The fix is that the Durable Object
 * holds a real secret, `requestOp` posts to it, and it returns a signed token
 * this module stores instead of the boolean below. Every request* method then
 * carries that token and the SERVER decides. No command changes.
 *
 * The architecture above already assumes an untrusted client. This constant
 * is the one place that currently does not.
 */
export const OP_PASSPHRASE = 'diamond-pickaxe'

/** Where OP survives a reload. Also, obviously, where a visitor forges it. */
const OP_STORAGE_KEY = 'world.operator'

/* ------------------------------------------------------------------ *
 * Game rules
 * ------------------------------------------------------------------ *
 *
 * Vanilla game rules are SERVER state, which is why they live here and not
 * next to the systems that read them. Three real ones, each actually wired to
 * something: a rule that reports a value nobody consults is a lie with a nice
 * error message.
 */
export const GAMERULES = {
  doDaylightCycle: { type: 'boolean', value: true },
  fallDamage: { type: 'boolean', value: true },
  naturalRegeneration: { type: 'boolean', value: true },
}

/* Minecraft's /fill volume cap. Vanilla refuses rather than freezing. */
const FILL_LIMIT = 32768

const allow = (message = null) => ({ ok: true, message })
const deny = (error) => ({ ok: false, error })

/*
 * Vanilla does not tell you a command exists if you may not run it -- the
 * dispatcher never registers it for you, so /gamemode as a non-op gives the
 * ordinary parse failure. Refusals therefore reuse that exact wording rather
 * than inventing a "no permission" line, and /help hides the same commands for
 * the same reason.
 */
const NOT_ALLOWED = deny('Unknown or incomplete command, see below for error')

/**
 * @param {object} world  the APPLY half: how a granted change reaches the game.
 * @param {Storage} storage  injectable so a test can run without localStorage.
 */
export function createAuthority({ world, storage = globalThis.localStorage } = {}) {
  let operator = false
  try {
    operator = storage?.getItem(OP_STORAGE_KEY) === '1'
  } catch {
    // Safari in private mode throws on localStorage access. Not being an
    // operator is the correct thing to fall back to.
  }

  /*
   * THE SEAM. Everything that gates on privilege calls this and nothing else.
   *
   * Server version, in full:
   *   const isOperator = () => token !== null && token.exp > Date.now()
   * with `token` set by a /op that round-tripped through the Durable Object.
   * Nothing outside this file learns that it changed.
   */
  const isOperator = () => operator

  const setOperator = (next) => {
    operator = next
    try {
      if (next) storage?.setItem(OP_STORAGE_KEY, '1')
      else storage?.removeItem(OP_STORAGE_KEY)
    } catch { /* see above */ }
  }

  /* ---- gamemode is GRANTED, not assigned ---- */

  let gamemode = DEFAULT_GAMEMODE

  /**
   * The one question every gate asks about the world's current rules.
   * Read-only on purpose: a caller that wants a different mode must request one.
   */
  const caps = () => GAMEMODES[gamemode].caps

  /* ------------------------------------------------------------------ *
   * "A block was destroyed here."
   * ------------------------------------------------------------------ *
   *
   * WHY IT IS IN THIS FILE. A block that holds something -- a furnace today, a
   * chest and a dispenser later -- keeps that something in a side table keyed
   * by coordinate, because a voxel in this engine is an integer with nowhere
   * to hang a tile entity. Side tables like that go stale the instant the
   * block under them changes, and the failure is silent and delightful: break
   * a furnace with eight iron in it, put a fresh one back in the hole, and the
   * iron is still in there.
   *
   * So somebody has to say "the block at 4,70,-3 is gone". The only place that
   * can honestly say it is the place every block change already passes
   * through, which is requestBlockChange -- mining, placing, /setblock and
   * /fill all end up here, and nothing else in the codebase calls
   * noa.setBlock. A hook anywhere else is a hook with holes in it.
   *
   * REJECTED: a furnace-shaped branch in here (`if (FURNACE_BLOCKS.has(was))`
   * ...), which would have been six lines instead of twenty. The authority
   * would then have to import furnace.js, know what a smelting slot is, and
   * grow another branch per container -- and the trust boundary is the last
   * file that should know what a chest is. It announces a COORDINATE and an
   * id; whoever cared about that coordinate does the caring.
   *
   * ALSO REJECTED: hanging it off interact.js's existing blockBreak event,
   * which already exists and already fires on a break. It fires on a PLAYER
   * break only -- /setblock over a furnace, a future explosion, and a server
   * telling us someone else mined it all go around it.
   *
   * `cause` rides along because the subscriber needs it and this module
   * already knows it: vanilla drops a container's contents when the block is
   * BROKEN and silently voids them when /setblock replaces it, which is one
   * `if` at the subscriber and no extra events here.
   */
  const destroyed = createEmitter()

  /**
   * Emit for a change that actually removed something.
   *
   * The `was !== next` guard is what stops the event firing when a block is
   * written over itself -- /fill'ing a stone box with stone destroys nothing,
   * and a furnace re-placed at its own coordinate by an orientation swap must
   * not lose its contents.
   */
  const announceDestroyed = (was, next, position, cause) => {
    if (!was || was === next) return
    destroyed.emit({ id: was, position, cause })
  }

  const api = {
    isOperator,
    /**
     * A block stopped existing at this coordinate.
     * @param fn ({ id, position, cause }) => void  `id` is the block that was
     *   there, never the one that replaced it -- by the time this fires the
     *   world already says otherwise.
     */
    onBlockDestroyed: destroyed.on,
    get gamemode() { return gamemode },
    caps,
    gamerule: (name) => GAMERULES[name]?.value,

    /**
     * Become an operator. Open to everyone by necessity -- it is the door.
     * @returns {Promise<{ok: boolean, message?: string, error?: string}>}
     */
    async requestOp(passphrase) {
      if (passphrase !== OP_PASSPHRASE) {
        // Vanilla's wording for a player it cannot op.
        return deny('Could not op player: wrong passphrase')
      }
      setOperator(true)
      return allow('Opped yourself')
    },

    async requestDeop() {
      if (!isOperator()) return NOT_ALLOWED
      setOperator(false)
      // Dropping op must drop the powers op granted, or a deopped visitor
      // keeps flying around in creative with no command left to fix it.
      if (gamemode !== DEFAULT_GAMEMODE) {
        gamemode = DEFAULT_GAMEMODE
        world.applyGamemode(gamemode)
      }
      return allow('De-opped yourself')
    },

    async requestGamemode(mode) {
      if (!isOperator()) return NOT_ALLOWED
      if (!GAMEMODES[mode]) return deny(`Unknown game mode: ${mode}`)
      if (mode === gamemode) return deny('Nothing changed. That player already had that game mode')
      gamemode = mode
      world.applyGamemode(mode)
      return allow(`Set own game mode to ${GAMEMODES[mode].label}`)
    },

    /**
     * THE one path by which a block ever changes. Mining, placing, /setblock.
     *
     * Adventure mode's refusal lives here rather than at the three call sites
     * because it is an authority question, not a UI one -- and because a
     * server will validate exactly this function, so anything it does not see
     * is a hole. interact.js still checks the same capability before starting
     * a break, but only so the crack overlay doesn't animate a break that is
     * going to be refused.
     *
     * @param {{id: number, position: number[], cause: 'break'|'place'|'command'}} req
     */
    async requestBlockChange({ id, position, cause }) {
      const c = caps()
      if (cause === 'break' && !c.mayBreak) return deny('You cannot break blocks in this game mode')
      if (cause === 'place' && !c.mayBuild) return deny('You cannot place blocks in this game mode')
      if (cause === 'command' && !isOperator()) return NOT_ALLOWED
      const was = world.getBlock?.(position[0], position[1], position[2]) ?? 0
      world.setBlock(id, position[0], position[1], position[2])
      announceDestroyed(was, id, position, cause)
      return allow()
    },

    /**
     * Separate from requestBlockChange rather than a loop over it, because a
     * server has to validate a volume as ONE request -- 32768 round trips to
     * fill a modest box is not a thing that can be made to work later.
     */
    async requestFill({ from, to, id }) {
      if (!isOperator()) return NOT_ALLOWED
      const min = from.map((v, i) => Math.min(v, to[i]))
      const max = from.map((v, i) => Math.max(v, to[i]))
      const count = (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1)
      if (count > FILL_LIMIT) {
        return deny(`Too many blocks in the specified area (maximum ${FILL_LIMIT}, specified ${count})`)
      }
      for (let x = min[0]; x <= max[0]; x++) {
        for (let y = min[1]; y <= max[1]; y++) {
          for (let z = min[2]; z <= max[2]; z++) {
            const was = world.getBlock?.(x, y, z) ?? 0
            world.setBlock(id, x, y, z)
            // /fill destroys tile entities too. It is the same announcement,
            // with the same `cause`, which is the whole point of putting it
            // here rather than in interact.js -- see the note above.
            announceDestroyed(was, id, [x, y, z], 'command')
          }
        }
      }
      return allow(`Successfully filled ${count} block${count === 1 ? '' : 's'}`)
    },

    async requestTime({ set = null, add = null }) {
      if (!isOperator()) return NOT_ALLOWED
      const t = set !== null ? set : world.getTime() + add
      world.setTime(t)
      return allow(`Set the time to ${world.getTime()}`)
    },

    async requestTeleport(x, y, z) {
      if (!isOperator()) return NOT_ALLOWED
      world.teleport(x, y, z)
      return allow(`Teleported ${world.playerName} to ${x}, ${y}, ${z}`)
    },

    async requestGive(id, count) {
      if (!isOperator()) return NOT_ALLOWED
      const left = world.give(id, count)
      if (left > 0) return deny(`No space to give ${count} of ${world.blockName(id)}`)
      return allow(`Gave ${count} [${world.blockName(id)}] to ${world.playerName}`)
    },

    async requestGamerule(name, raw) {
      const rule = GAMERULES[name]
      if (!rule) return deny(`Unknown game rule: ${name}`)
      if (raw === undefined) {
        return allow(`Game rule ${name} is currently set to: ${rule.value}`)
      }
      if (!isOperator()) return NOT_ALLOWED
      if (raw !== 'true' && raw !== 'false') {
        return deny(`Invalid boolean for game rule ${name}: ${raw}`)
      }
      rule.value = raw === 'true'
      return allow(`Game rule ${name} is now set to: ${rule.value}`)
    },

    /**
     * /kill. Open to everyone because it only ever targets the caller -- there
     * is no player-argument form, deliberately: the day this becomes
     * multiplayer, a stranger being able to kill other visitors is a griefing
     * tool with no upside.
     */
    async requestKill() {
      world.kill()
      return allow(`Killed ${world.playerName}`)
    },
  }

  return api
}
