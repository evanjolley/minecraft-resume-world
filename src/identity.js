/*
 * WHO IS IN THE WORLD.
 *
 * A roster of named characters, not "the player" plus some NPCs. Every
 * consumer below -- nametags, chat, the agent's tools -- takes an entry id,
 * so none of them contains the assumption that there is exactly one of you.
 * That is the whole reason this file exists instead of a `let playerName`
 * in main.js: main.js had one, and it was already wrong, because the moment
 * an NPC has a name there are two names in the world and neither is "the"
 * name.
 *
 * Rejected: hanging the name off the noa entity as a component. noa's ECS is
 * for things that tick, and a name does not; more importantly the roster has
 * to be able to hold a character with NO entity (a player who has connected
 * but not spawned, an NPC rendered as a plain mesh), which a component cannot.
 *
 * SINGLE PLAYER, AND WHAT THAT SETTLED
 * ------------------------------------
 * Multiplayer presence is cancelled (docs/SPRINT-1.md item 6), so the roster
 * never becomes a cache of a server's room: it is you and the NPCs, forever.
 * `setName` stays local and synchronous. What the server does own is the
 * name an ACCOUNT stores, which src/account.js sends to /api/profile after a
 * local rename; the Worker re-runs the same nickname.js filter there. A
 * refusal from the server reverts the local name, which in practice only
 * happens to someone who edited the client to get past the local check.
 */

import { checkNickname, MAX_NAME_LENGTH } from './nickname.js'

/** What a visitor is called before the conversation gets their real name. */
export const GUEST_NAME = 'Guest'

/*
 * localStorage, versioned in the key. A stored name is user-supplied text
 * that will one day be run past a filter, and a filter that changes needs a
 * way to reject everything it let through before.
 */
const STORAGE_KEY = 'world:v1:player-name'

/*
 * The rule itself lives in nickname.js, shared with the Worker: vanilla's
 * 1-16 characters of [A-Za-z0-9_] (minimum relaxed to 1, since plenty of
 * people are called "Al"), plus the impersonation and wordlist checks. This
 * file only asks it. Re-exported under the old names so the callers
 * (aiEvan.js's set_player_name tool among them) did not have to move.
 *
 * The wordlist being in the client is fine now and nickname.js says why:
 * single player means a name is only ever shown to its owner, and the copy
 * that reaches the server is checked again there.
 */
export { MAX_NAME_LENGTH }

/** Is this something we are willing to write above someone's head? */
export function isLegalName(name) {
  return typeof name === 'string' && name === name.trim() && checkNickname(name).ok
}

/**
 * The roster.
 *
 * @param {{ storage?: Storage }} opts  storage defaults to localStorage, and
 *   is injectable so a test can drive a roster with no browser attached.
 */
export function createRoster({ storage = globalThis.localStorage } = {}) {
  const entries = new Map()
  const listeners = new Set()

  const emit = (entry) => { for (const fn of listeners) fn(entry, api) }

  /*
   * A NAME IS A NAME. `[Admin]` is not part of it.
   *
   * This used to concatenate `entry.prefix.text + entry.name` and hand the
   * result to everything -- the chat line, the floating nameplate, the
   * command feedback -- and that one string being reused is how `[Admin]`
   * ended up above Evan's head, where no chat rank belongs. So the rank stays
   * on the entry as data and NOBODY here composes it. chat.js applies it,
   * because a rank is part of a CHAT FORMAT (see the format note there), and
   * chat is the only place a format exists.
   *
   * Two mechanisms get a tag in front of a name on a real server, and it is
   * worth writing down which one this is:
   *
   *   - A SCOREBOARD TEAM prefix. PlayerTeam.formatNameForTeam builds
   *     prefix + name + suffix, Player.getDisplayName() returns it, and
   *     EntityRenderer.render passes getDisplayName() to renderNameTag -- so
   *     a team prefix really does show above the head as well as in chat.
   *   - A CHAT PLUGIN prefix. EssentialsX/LuckPerms rewriting the chat format
   *     string. It is on the chat line and nowhere else, because nothing has
   *     touched the entity's display name.
   *
   * This world's `[Admin]` is the second kind, which is the one people
   * picture. Rejected: the team reading. It is equally faithful to some
   * server, it is not the look being asked for, and it is the one that makes
   * this function a place where two concerns can silently merge again.
   */
  const displayName = (entry) => (entry ? entry.name : '')

  const api = {
    /**
     * @param {object} spec
     * @param {string} spec.id     stable handle; a server would use a uuid
     * @param {string} spec.name
     * @param {'player'|'npc'} [spec.kind]
     * @param {{ text: string, color: number }} [spec.prefix]  team prefix
     * @param {boolean} [spec.local]  true for the one you are controlling
     * @param {boolean} [spec.persist]  remember the name across reloads
     */
    add({ id, name, kind = 'player', prefix = null, local = false, persist = false }) {
      const stored = persist ? api.stored() : null
      const entry = {
        id, kind, prefix, local, persist,
        name: stored && isLegalName(stored) ? stored : name,
      }
      entries.set(id, entry)
      emit(entry)
      return entry
    },

    remove(id) {
      const entry = entries.get(id)
      if (!entry) return
      entries.delete(id)
      emit({ ...entry, removed: true })
    },

    get(id) { return entries.get(id) ?? null },
    list() { return [...entries.values()] },
    /** The character this browser is driving. There is exactly one, today. */
    get local() { return [...entries.values()].find((e) => e.local) ?? null },

    /**
     * Rename. Returns false and changes nothing if the name is unusable --
     * the caller decides what to say about that, because "the agent misheard
     * you" and "you typed /nick <<<" deserve different messages.
     *
     * The server version of this is a round trip; see the header.
     */
    setName(id, name) {
      const entry = entries.get(id)
      /*
       * The nickname filter is for VISITORS. An NPC's name is written by this
       * codebase, and the one NPC there is is called Evan, which is the first
       * name the impersonation rule exists to refuse. NPCs get the shape check.
       */
      const legal = entry?.kind === 'npc'
        ? typeof name === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(name)
        : isLegalName(name)
      if (!entry || !legal || entry.name === name) return false
      entry.name = name
      if (entry.persist) {
        // Wrapped: localStorage throws outright in Safari private mode, and
        // failing to REMEMBER a name must not fail to SET it.
        try { storage?.setItem(STORAGE_KEY, name) } catch { /* not fatal */ }
      }
      emit(entry)
      return true
    },

    /** The remembered name, or null. Exposed so a test can assert on it. */
    stored() {
      try { return storage?.getItem(STORAGE_KEY) ?? null } catch { return null }
    },

    /** Forget the remembered name -- what a "log out" would call. */
    forget() {
      try { storage?.removeItem(STORAGE_KEY) } catch { /* not fatal */ }
    },

    displayName,
    /** Convenience: the name for an id, or '' if it is gone. Undecorated. */
    displayNameOf(id) { return displayName(entries.get(id)) },

    /**
     * Fires for every add, rename and remove, with the entry that changed.
     * Deliberately one channel rather than three: a nametag does not care
     * WHY the name it is drawing is different, and a subscriber that has to
     * handle three events to stay correct will eventually handle two.
     */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }

  return api
}
