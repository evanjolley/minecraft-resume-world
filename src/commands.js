import { BLOCK_TYPES } from './blocks.js'
import { ITEMS } from './items.js'
import { GAMEMODE_NAMES } from './gamemode.js'
import { GAMERULES } from './authority.js'

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

const WEATHER_KINDS = ['clear', 'rain', 'thunder']

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
   * /weather, and it does NOT lie.
   *
   * There is no weather in this world -- no precipitation, no thunder, no
   * wet-block state -- and the honest options were to build one or to say so.
   * Building one is not a small job done properly: rain in Minecraft is a
   * camera-following particle volume that skips sheltered columns, a sky and
   * light-level change, an ambient loop, and a thunder timer, and it would
   * have eaten the time that gamemodes and the authority boundary actually
   * needed. A /weather that flipped a boolean nothing rendered would be worse
   * than this: it would report success and change nothing.
   *
   * So the argument is still parsed exactly as vanilla parses it -- a typo
   * gets the real error -- and a valid one gets told the truth.
   */
  chat.command('weather', 'Reports on weather (not implemented in this world)',
    ([kind]) => {
      if (!WEATHER_KINDS.includes(kind)) {
        return chat.parseError(`/weather ${kind ?? ''}`.trimEnd())
      }
      fail('Weather is not implemented in this world: the sky has a day/night')
      fail('cycle and no precipitation. Nothing was changed.')
    }, opOnly)

  return {
    /** For the tests and for a future tab-complete. */
    get names() { return chat.visibleCommands },
  }
}
