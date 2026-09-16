import { BLOCK_TYPES } from './blocks.js'
import { ITEMS } from './items.js'
import { GAMEMODE_NAMES } from './gamemode.js'
import { GAMERULES } from './authority.js'
import { WEATHER_KINDS } from './weather.js'

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
function ticksFrom(token) {
  const m = /^(\d+(?:\.\d+)?)([dst]?)$/.exec(token)
  if (!m) return null
  const n = Number(m[1])
  const scale = m[2] === 'd' ? 24000 : m[2] === 's' ? 20 : 1
  const ticks = Math.floor(n * scale)
  return ticks >= 1 ? ticks : null
}

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

export function installCommands(chat, authority, { noa, playerName }) {
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
  chat.command('kill', 'Kills yourself', async () => {
    report(await authority.requestKill())
  })

  /* ---------------- operators ---------------- */

  chat.command('gamemode', `Sets your game mode: ${GAMEMODE_NAMES.join(', ')}`,
    async ([mode]) => {
      if (!mode) return chat.parseError('/gamemode')
      report(await authority.requestGamemode(mode))
    }, opOnly)

  chat.command('time', 'Sets or advances the time: set <day|noon|night|midnight|N>, add <N>',
    async ([verb, arg]) => {
      if (verb === 'set') {
        const t = arg in NAMED_TIMES ? NAMED_TIMES[arg] : Number(arg)
        if (!Number.isFinite(t)) return fail(`Invalid time: ${arg ?? ''}`)
        return report(await authority.requestTime({ set: Math.floor(t) }))
      }
      if (verb === 'add') {
        const t = Number(arg)
        if (!Number.isFinite(t)) return fail(`Invalid time: ${arg ?? ''}`)
        return report(await authority.requestTime({ add: Math.floor(t) }))
      }
      chat.parseError(`/time ${verb ?? ''}`.trimEnd())
    }, opOnly)

  chat.command('tp', 'Teleports you to x y z', async (args) => {
    const at = coords3(args)
    if (!at) return chat.parseError(`/tp ${args.join(' ')}`.trimEnd())
    report(await authority.requestTeleport(at[0], at[1], at[2]))
  }, opOnly)

  chat.command('give', 'Gives you an item: /give <item> [count]', async ([name, rawCount]) => {
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
        duration = ticksFrom(rawDuration)
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
  }
}
