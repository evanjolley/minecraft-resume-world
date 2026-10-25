import { BLOCK_TYPES } from './blocks.js'
import { ITEMS } from './items.js'
import { GAMEMODE_NAMES } from './gamemode.js'
import { GAMERULES } from './authority.js'
import { WEATHER_KINDS } from './weather.js'
import { EFFECTS, DEFAULT_SECONDS, INFINITE, MAX_SECONDS } from './effects.js'

/*
 * The command set. Vanilla syntax, vanilla wording, vanilla failure modes.
 *
 * Every one of these is a thin shell: parse the arguments, ask authority.js,
 * print what it says. None of them touch the world, none of them check who you
 * are, and none of them know what an operator is -- they hand `permission` to
 * chat.js as a predicate and let authority.js answer it. That is the whole
 * point: when the Durable Object in docs/FUTURE.md starts making these
 * decisions instead, this file does not change.
 *
 * Messages are lifted from Java Edition's en_us.json wherever one exists,
 * because a command that reports success in its own words is the tell that
 * something is a Minecraft-flavoured web page rather than Minecraft.
 */

/* key -> block definition. `key` is this world's block namespace (blocks.js),
 * so /give planks, not /give oak_planks -- the ids are ours, not Mojang's. */
const BLOCK_BY_KEY = new Map(BLOCK_TYPES.map(b => [b.key, b]))

/*
 * /give takes ITEMS -- `/give iron_pickaxe` has to work, and a pickaxe is not
 * a block. /setblock and /fill deliberately keep the block map: naming an item
 * that places nothing is a mistake worth reporting, not a silent no-op.
 */
const ITEM_BY_KEY = new Map(ITEMS.map(i => [i.key, i]))

/* Minecraft's four named times, in ticks. */
const NAMED_TIMES = { day: 1000, noon: 6000, night: 13000, midnight: 18000 }

/*
 * Minecraft's time argument: a bare number is ticks, and d/s/t are days,
 * seconds and ticks. /weather rain 1d is the form anyone who has played will
 * try first, and rejecting it as "invalid time" for want of three lines would
 * be the sort of near-miss that reads as a knockoff.
 */
function ticksFrom(token, min = 1) {
  const m = /^(\d+(?:\.\d+)?|\.\d+)([dst]?)$/.exec(token ?? '')
  if (!m) return null
  const n = Number(m[1])
  const scale = m[2] === 'd' ? 24000 : m[2] === 's' ? 20 : 1
  // TimeArgument rounds, it does not floor: /time set 0.5d is 12000.
  const ticks = Math.round(n * scale)
  return ticks >= min ? ticks : null
}

/*
 * One coordinate of vanilla's Vec3Argument. `~` is relative to `base`; a bare
 * INTEGER on x or z is the block's center (WorldCoordinate's centerCorrect),
 * so `/tp 10 64 10` lands at 10.5, 64, 10.5, standing in the middle of the
 * block rather than on its corner. y is never centered, and a number written
 * with a decimal point is taken exactly as written.
 */
function vecCoord(token, base, center) {
  if (token === undefined) return null
  if (token.startsWith('~')) {
    const offset = token.length === 1 ? 0 : Number(token.slice(1))
    return Number.isFinite(offset) ? base + offset : null
  }
  const n = Number(token)
  if (!Number.isFinite(n)) return null
  return center && /^-?\d+$/.test(token) ? n + 0.5 : n
}

/* Java's String.format("%f"), which is how TeleportCommand prints a position. */
const f6 = (v) => v.toFixed(6)

/**
 * Minecraft's tilde notation: `~` is here, `~5` is five along from here.
 * Worth the twenty lines -- without it /setblock means reading your own
 * coordinates off the HUD and doing arithmetic in your head.
 * @returns {number|null} null if the token is not a number at all.
 */
function coord(token, base) {
  if (token === undefined) return null
  if (token.startsWith('~')) {
    const offset = token.length === 1 ? 0 : Number(token.slice(1))
    return Number.isFinite(offset) ? base + offset : null
  }
  const n = Number(token)
  return Number.isFinite(n) ? n : null
}

export function installCommands(chat, authority, { noa, playerName, mobs = null }) {
  const say = (text) => chat.addMessage({ text, kind: 'system' })
  const fail = (text) => chat.addMessage({ text, kind: 'error' })

  /** Print whatever authority.js decided, in the right colour. */
  const report = (res) => {
    if (res.ok) { if (res.message) say(res.message) }
    else fail(res.error)
  }

  const opOnly = { permission: () => authority.isOperator() }

  const playerPos = () => noa.ents.getPositionData(noa.playerEntity).position

  /** Three coordinates, tilde-relative to the player. */
  const coords3 = (args, at = 0) => {
    const p = playerPos()
    const out = [
      coord(args[at], p[0]),
      coord(args[at + 1], p[1]),
      coord(args[at + 2], p[2]),
    ]
    return out.every(v => v !== null) ? out : null
  }

  // Accept the namespace vanilla prints even though nothing here uses it.
  const bare = (name) => name?.replace(/^minecraft:/, '')

  const lookupBlock = (name) => (name ? BLOCK_BY_KEY.get(bare(name)) ?? null : null)
  const lookupItem = (name) => (name ? ITEM_BY_KEY.get(bare(name)) ?? null : null)

  /*
   * Target selectors and names. Single player, so every selector that can
   * mean the player means the player, and so does the player's own name.
   * Anything else matches nothing, which vanilla reports as below.
   */
  const SELF = new Set(['@s', '@p', '@a', '@r', '@e', '@n'])
  const isTarget = (token) => token !== undefined
    && (SELF.has(token.split('[')[0]) || token.toLowerCase() === String(playerName()).toLowerCase())
  const NO_ENTITY = 'No entity was found'

  /**
   * Vanilla's Vec3Argument, all three forms: absolute, `~` relative and `^`
   * local (left, up, forward from where you are looking, which cannot be
   * mixed with the other two). Returns null on a malformed position.
   */
  const position3 = (args, at = 0) => {
    const t = args.slice(at, at + 3)
    if (t.length < 3 || t.some(v => v === undefined)) return null
    const p = playerPos()
    const local = t.filter(v => v.startsWith('^')).length
    if (local === 0) {
      const out = [vecCoord(t[0], p[0], true), vecCoord(t[1], p[1], false), vecCoord(t[2], p[2], true)]
      return out.every(v => v !== null) ? out : null
    }
    if (local !== 3) return null
    const n = t.map(v => (v.length === 1 ? 0 : Number(v.slice(1))))
    if (!n.every(Number.isFinite)) return null
    /*
     * LocalCoordinates.getPosition, in Minecraft's axes. Minecraft's yaw is
     * this camera's heading in degrees (0 faces south, +90 west), and its
     * pitch is this camera's pitch (positive looks down). Minecraft's +x is
     * east and this world's +X is west, so x flips on the way back.
     */
    const yaw = noa.camera.heading
    const pitch = noa.camera.pitch
    const f = Math.cos(yaw + Math.PI / 2), g = Math.sin(yaw + Math.PI / 2)
    const h = Math.cos(-pitch), i = Math.sin(-pitch)
    const j = Math.cos(-pitch + Math.PI / 2), k = Math.sin(-pitch + Math.PI / 2)
    const fwd = [f * h, i, g * h]
    const up = [f * j, k, g * j]
    // left = -(forward x up)
    const left = [
      -(fwd[1] * up[2] - fwd[2] * up[1]),
      -(fwd[2] * up[0] - fwd[0] * up[2]),
      -(fwd[0] * up[1] - fwd[1] * up[0]),
    ]
    const mc = [0, 1, 2].map(a => fwd[a] * n[2] + up[a] * n[1] + left[a] * n[0])
    return [p[0] - mc[0], p[1] + mc[1], p[2] + mc[2]]
  }

  /* ---------------- open to everyone ---------------- */

  /*
   * /op is the door, so it cannot be behind the door. See the long comment on
   * OP_PASSPHRASE in authority.js for exactly how much this is worth (not
   * much) and when that starts to matter (the day this is multiplayer).
   */
  chat.command('op', 'Grants yourself operator status', async ([passphrase]) => {
    if (!passphrase) return chat.parseError('/op')
    report(await authority.requestOp(passphrase))
  })

  chat.command('deop', 'Gives up your operator status', async () => {
    report(await authority.requestDeop())
  }, opOnly)

  /*
   * Self only, and there is deliberately no /kill <player> form. The day this
   * is multiplayer, a stranger who can kill other visitors is a griefing tool
   * with no upside on a resume site.
   */
  chat.command('kill', 'Kills yourself, or the mobs an @e selector names (operators)', async ([target]) => {
    /*
     * `@e` and `@e[type=cow]` reach the passive mobs (src/mobs.js), and that
     * form is an operator's, as every selector beyond yourself is in
     * vanilla. Vanilla's @e includes you too; this one does not, because a
     * single player typing /kill @e to clear the cows does not mean to die.
     */
    if (target?.startsWith('@e')) {
      if (!authority.isOperator() || !mobs) return chat.parseError(`/kill ${target}`)
      const m = /type=(?:minecraft:)?([a-z_]+)/.exec(target)
      const hit = mobs.list.filter(x => x.health > 0 && (!m || x.kind === m[1]))
      if (hit.length === 0) return fail(NO_ENTITY)
      for (const x of hit) { x.invulnerable = 0; mobs.hurt(x, Infinity) }
      return say(hit.length === 1
        ? `Killed ${mobs.SPECIES[hit[0].kind] ? hit[0].kind[0].toUpperCase() + hit[0].kind.slice(1) : hit[0].kind}`
        : `Killed ${hit.length} entities`)
    }
    if (target !== undefined && !isTarget(target)) return fail(NO_ENTITY)
    report(await authority.requestKill())
  })

  /*
   * /summon <entity> [x y z]: vanilla's, for the four passive mobs. "Summoned
   * new Cow" is en_us.json's commands.summon.success.
   */
  if (mobs) {
    chat.command('summon', `Summons a mob: ${Object.keys(mobs.SPECIES).join(', ')} [x y z]`,
      async (args) => {
        const kind = bare(args[0])
        if (!kind || !mobs.SPECIES[kind]) return fail('Unable to summon entity')
        const p = playerPos()
        const at = args.length >= 4 ? position3(args, 1) : [p[0], p[1], p[2]]
        if (!at) return chat.parseError(`/summon ${args.join(' ')}`)
        mobs.summon(kind, at[0], at[1], at[2])
        say(`Summoned new ${kind[0].toUpperCase()}${kind.slice(1)}`)
      }, opOnly)
  }

  /* ---------------- operators ---------------- */

  chat.command('gamemode', `Sets your game mode: ${GAMEMODE_NAMES.join(', ')}`,
    async ([mode]) => {
      if (!mode) return chat.parseError('/gamemode')
      report(await authority.requestGamemode(mode))
    }, opOnly)

  /*
   * /time, vanilla's TimeCommand. `set` and `add` take the time argument with
   * its units (`/time set 0.5d`, `/time add 100s`); `query` answers daytime,
   * gametime or day. `set` reports the number it was given, `add` reports
   * the resulting time of day, both as "Set the time to N", as vanilla does.
   */
  chat.command('time', 'Sets, adds to or queries the time: set <day|noon|night|midnight|time>, add <time>, query <daytime|gametime|day>',
    async ([verb, arg]) => {
      if (verb === 'set') {
        const t = arg in NAMED_TIMES ? NAMED_TIMES[arg] : ticksFrom(arg, 0)
        if (t === null) return fail(`Invalid time: ${arg ?? ''}`)
        return report(await authority.requestTime({ set: t }))
      }
      if (verb === 'add') {
        const t = ticksFrom(arg, 0)
        if (t === null) return fail(`Invalid time: ${arg ?? ''}`)
        return report(await authority.requestTime({ add: t }))
      }
      if (verb === 'query' && ['daytime', 'gametime', 'day'].includes(arg)) {
        return report(await authority.requestTime({ query: arg }))
      }
      chat.parseError(`/time ${[verb, arg].filter(Boolean).join(' ')}`.trimEnd())
    }, opOnly)

  /*
   * /tp, vanilla's forms that make sense with one player in the world:
   *
   *   /tp <x> <y> <z> [<yaw> <pitch>]
   *   /tp <target> <x> <y> <z> [<yaw> <pitch>]     target: @s, @p, your name
   *   /tp <target>                                  yourself: no-op, vanilla's
   *
   * Positions take ~ and ^, and a bare integer x or z means the block's
   * center. The message prints the landing position the way vanilla does,
   * with Java's %f.
   */
  chat.command('tp', 'Teleports you: /tp [target] <x y z> [yaw pitch]', async (args) => {
    const typed = `/tp ${args.join(' ')}`.trimEnd()
    let rest = args
    if (isTarget(rest[0])) rest = rest.slice(1)
    else if (rest.length === 1 || (rest[0] && !/^[~^\-.\d]/.test(rest[0]))) {
      return fail(NO_ENTITY)
    }
    if (rest.length === 0) {
      // Teleporting yourself to yourself.
      const p = playerPos()
      return report(await authority.requestTeleport(p[0], p[1], p[2]))
    }
    const hats = rest.slice(0, 3).filter(v => v.startsWith('^')).length
    if (hats > 0 && hats < 3) {
      return fail('Cannot mix world & local coordinates (everything must either use ^ or not)')
    }
    const at = position3(rest)
    if (!at || (rest.length !== 3 && rest.length !== 5)) return chat.parseError(typed)
    let rot = null
    if (rest.length === 5) {
      const yaw = coord(rest[3], noa.camera.heading * 180 / Math.PI)
      const pitch = coord(rest[4], noa.camera.pitch * 180 / Math.PI)
      if (yaw === null || pitch === null) return chat.parseError(typed)
      rot = [yaw, Math.max(-90, Math.min(90, pitch))]
    }
    const res = await authority.requestTeleport(at[0], at[1], at[2])
    if (res.ok && rot) {
      noa.camera.heading = rot[0] * Math.PI / 180
      noa.camera.pitch = rot[1] * Math.PI / 180
    }
    report(res)
  }, opOnly)

  /*
   * /give <target> <item> [count], vanilla's form, plus the old
   * /give <item> [count] that this world shipped with first. Vanilla caps a
   * single /give at 100 stacks, and what does not fit in the inventory is
   * dropped at your feet rather than refused.
   */
  chat.command('give', 'Gives you an item: /give [target] <item> [count]', async (args) => {
    let [name, rawCount] = args
    if (isTarget(args[0]) && args[1] !== undefined && !/^\d+$/.test(args[1])) {
      [, name, rawCount] = args
    } else if (args.length >= 2 && !/^\d+$/.test(args[1]) && lookupItem(args[1])) {
      // A target that is not you: EntityArgument's "No player was found".
      return fail('No player was found')
    }
    // Items, not blocks -- /give iron_pickaxe has to work, and a pickaxe has
    // no block. /setblock and /fill keep the block map on purpose.
    const def = lookupItem(name)
    if (!def) return fail(`Unknown item '${name ?? ''}'`)
    const count = rawCount === undefined ? 1 : Number(rawCount)
    if (!Number.isInteger(count) || count < 1) return fail(`Invalid count: ${rawCount}`)
    report(await authority.requestGive(def.id, count))
  }, opOnly)

  chat.command('setblock', 'Sets one block: /setblock <x> <y> <z> <block>', async (args) => {
    const at = coords3(args)
    const def = lookupBlock(args[3])
    if (!at) return chat.parseError(`/setblock ${args.join(' ')}`.trimEnd())
    if (!def) return fail(`Unknown block type '${args[3] ?? ''}'`)
    const res = await authority.requestBlockChange({
      id: def.id, position: at, cause: 'command',
    })
    if (!res.ok) return fail(res.error)
    say(`Changed the block at ${at[0]}, ${at[1]}, ${at[2]}`)
  }, opOnly)

  chat.command('fill', 'Fills a box: /fill <x1> <y1> <z1> <x2> <y2> <z2> <block>',
    async (args) => {
      const from = coords3(args, 0)
      const to = coords3(args, 3)
      const def = lookupBlock(args[6])
      if (!from || !to) return chat.parseError(`/fill ${args.join(' ')}`.trimEnd())
      if (!def) return fail(`Unknown block type '${args[6] ?? ''}'`)
      report(await authority.requestFill({
        from: from.map(Math.floor), to: to.map(Math.floor), id: def.id,
      }))
    }, opOnly)

  chat.command('gamerule', `Sets a game rule: ${Object.keys(GAMERULES).join(', ')}`,
    async ([rule, value]) => {
      if (!rule) return chat.parseError('/gamerule')
      report(await authority.requestGamerule(rule, value))
    }, opOnly)

  /*
   * /effect, in vanilla's grammar with vanilla's one-target simplification.
   *
   *   /effect give <effect> [<seconds>|infinite] [<amplifier>] [<hideParticles>]
   *   /effect clear [<effect>]
   *
   * THE MISSING ARGUMENT IS <targets>, and dropping it is the same decision
   * /kill and /tp already made in this file: there is no selector grammar
   * here, and the day this is multiplayer a stranger who can hand out
   * Levitation V is a griefing tool. So every form targets you. It is stated
   * in the help text rather than silently different, because a command whose
   * arity does not match the wiki is worse when it pretends otherwise.
   *
   * THE BOOLEAN IS INVERTED IN VANILLA AND THAT IS NOT A BUG HERE EITHER.
   * EffectCommands passes `!getBool("hideParticles")` into the SHOW-particles
   * slot of the MobEffectInstance, so `true` means hide. Omitted means shown.
   */
  const EFFECT_KEYS = EFFECTS.map(e => e.key)

  chat.command('effect',
    'Gives or clears a status effect on yourself: give <effect> [seconds|infinite] [amplifier] [hideParticles], clear [effect]',
    async (args) => {
      const [verb, name, rawSeconds, rawAmp, rawHide] = args
      const typed = `/effect ${args.join(' ')}`.trimEnd()

      if (verb === 'clear') {
        if (name === undefined) return report(await authority.requestEffectClear(null))
        return report(await authority.requestEffectClear(bare(name)))
      }

      if (verb !== 'give') return chat.parseError(typed)
      if (!name) return chat.parseError('/effect give')

      /*
       * Vanilla's bounds, not ours: seconds is integer(1, 1000000) and
       * amplifier is integer(0, 255). The upper bound on seconds is the one
       * worth keeping -- without it `/effect give speed 1e30` stores an
       * Infinity that never counts down and cannot be distinguished from the
       * `infinite` keyword.
       */
      let seconds = DEFAULT_SECONDS
      if (rawSeconds !== undefined) {
        if (rawSeconds === 'infinite') seconds = INFINITE
        else {
          const n = Number(rawSeconds)
          if (!Number.isInteger(n) || n < 1 || n > MAX_SECONDS) {
            return fail(`Integer must be between 1 and ${MAX_SECONDS}, found ${rawSeconds}`)
          }
          seconds = n
        }
      }

      let amplifier = 0
      if (rawAmp !== undefined) {
        const n = Number(rawAmp)
        if (!Number.isInteger(n) || n < 0 || n > 255) {
          return fail(`Integer must be between 0 and 255, found ${rawAmp}`)
        }
        amplifier = n
      }

      if (rawHide !== undefined && rawHide !== 'true' && rawHide !== 'false') {
        return fail(`Invalid boolean, expected 'true' or 'false' but found '${rawHide}'`)
      }
      const hidden = rawHide === 'true'

      report(await authority.requestEffect(bare(name), seconds, amplifier, hidden))
    }, opOnly)

  /*
   * /weather, which used to report honestly that there was no weather to set.
   * There is now: weather.js owns the state, the authority owns the decision,
   * and this stays what every other command here is -- parse, ask, print.
   *
   * The duration argument is vanilla's, including the unit suffixes, and
   * leaving it off does what vanilla does: samples the same random duration
   * the natural cycle uses (10-20 minutes of rain, 3-13 of thunder), rather
   * than the fixed 6000 ticks everyone assumes.
   *
   * If nothing wired weather.js in, requestWeather does not exist and this
   * falls back to the old refusal. A command that claims to have changed
   * something nothing rendered would be worse than one that admits the truth,
   * and that was true before this shipped and is still true if it is unwired.
   */
  chat.command('weather', `Sets the weather: ${WEATHER_KINDS.join(', ')} [duration]`,
    async ([wkind, rawDuration]) => {
      if (!WEATHER_KINDS.includes(wkind)) {
        return chat.parseError(`/weather ${wkind ?? ''}`.trimEnd())
      }
      if (!authority.requestWeather) {
        fail('Weather is not implemented in this world: the sky has a day/night')
        fail('cycle and no precipitation. Nothing was changed.')
        return
      }
      let duration = null
      if (rawDuration !== undefined) {
        duration = ticksFrom(rawDuration, 1)
        if (duration === null) return fail(`Invalid time: ${rawDuration}`)
      }
      report(await authority.requestWeather(wkind, duration))
    }, opOnly)

  /*
   * /dimension -- the way you get to the Nether, for now.
   *
   * NOT A VANILLA COMMAND, and the wording is the only place in this file
   * that admits it. Vanilla's spelling is `/execute in minecraft:the_nether
   * run tp ~ ~ ~`, which is correct, unguessable, and would mean implementing
   * /execute's selector grammar to deliver one destination. The honest
   * alternative is a command that says plainly what it does, in vanilla's
   * VOICE even though it is not vanilla's vocabulary -- the house style is
   * "looks and behaves like Minecraft", and a command that lies about being
   * vanilla is worse than one that is clearly an addition.
   *
   * Portals are the real answer and are out of scope; the accounting for what
   * one would still need is at the top of src/dimensions.js.
   *
   * OPERATOR-ONLY, and this went the other way first.
   *
   * The argument for opening it to everyone was decent: it moves you and
   * nobody else, it cannot destroy anything, and the reason to visit the
   * Nether is to look at it -- so gating sightseeing behind op reads like
   * gating the feature behind the feature.
   *
   * It lost to an existing spec. test/11-commands.spec.js asserts that the
   * command list a guest can see is EXACTLY help, op and kill, and it says
   * why: /help and the dispatcher share one predicate so the two can never
   * disagree, and an operator command must not even be advertised. That list
   * is a designed property of what a visitor is shown, not an incidental
   * count -- so a fourth entry in it is a decision about the front door of
   * the site, and it is not one to make in passing while building a
   * dimension. Recorded rather than quietly reverted, because the open
   * version is the better default the day that list is deliberately reopened.
   *
   * /tp is the honest precedent anyway: it also only moves you, it also
   * destroys nothing, and it is op-gated.
   */
  /*
   * TWO NAMES, ONE IMPLEMENTATION, and the second name is the point.
   *
   * `mountains` is not a dimension. It is an overworld -- a 256-block cut of
   * seed 434533485056755 -- and asking someone to type `/dimension mountains`
   * to reach it teaches them a wrong word about their own world. But
   * `/dimension nether` is the spelling that already exists, is already
   * documented, and is what anyone who has played would guess for the Nether.
   *
   * So `/world` is the general switcher and `/dimension` stays as an alias.
   * Rejected: renaming /dimension outright (it is in the docs and in
   * test/34-nether.spec.js, and breaking a working command to fix a noun is a
   * bad trade), and adding `mountains` only to /dimension (cheapest, and it
   * leaves the vocabulary wrong permanently).
   *
   * BOTH ARE opOnly, unchanged. test/11-commands.spec.js asserts the command
   * list a guest sees is EXACTLY help, op and kill -- see the long note this
   * replaced for why that list is a designed property of the front door and
   * not something to grow in passing. Two op-gated commands add zero entries
   * to it.
   */
  if (authority.requestDimension) {
    const go = async ([name], typed) => {
      if (name === undefined) return chat.parseError(typed)
      report(await authority.requestDimension(name))
    }
    const list = authority.dimensionNames.join(', ')
    chat.command('world', `Moves you to another world: ${list}`,
      async (args) => go(args, '/world'), opOnly)
    chat.command('dimension', `Moves you to another dimension: ${list}`,
      async (args) => go(args, '/dimension'), opOnly)
  }

  return {
    /** For the tests and for a future tab-complete. */
    get names() { return chat.visibleCommands },
    /** Every effect /effect will accept, for the same future tab-complete. */
    effectKeys: EFFECT_KEYS,
  }
}
