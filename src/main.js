import { Engine } from 'noa-engine'

import { registerBlocks, BLOCK_TYPES } from './blocks.js'
import { getVoxelID, loadTerrain, terrainInfo, SPAWN } from './island.js'
import { installPhysics, installSpeedModes, MC } from './physics.js'
import { createSurvival } from './survival.js'
import { createFluids, installFluids } from './fluids.js'
import { createInventory, installInventoryScreen } from './inventory.js'
import {
  TABS as creativeTabs, CATEGORY_TABS as creativeCategoryTabs, PICKER_ITEMS as pickerItems,
  tabItems, ruleFor as creativeRuleFor, creativeListClick, uncategorisedItems,
  blocksWithoutEntry,
} from './creative.js'
import { installInteraction, installHotbarControls } from './interact.js'
import { installRespawn } from './respawn.js'
import { installHUD } from './hud.js'
import { createInputLock } from './inputLock.js'
import { installMenu, requestLockPersistently } from './menu.js'
import { installChat } from './chat.js'
import { installHeldItem } from './heldItem.js'
import { createSkinMaterial } from './playerModel.js'
import { createSwing } from './swing.js'
import { installPerspective } from './perspective.js'
import { installCrackOverlay } from './crackOverlay.js'
import { installSky } from './sky.js'
import { installUnderwater } from './underwater.js'
import { createArmorReduction } from './armor.js'
import { itemName, itemId, dropFor, rollDrops, unmappedDrops } from './items.js'
import { itemModelStats } from './itemModel.js'
import { installSounds } from './sounds.js'
import { installParticles } from './particles.js'
import { installWeather } from './weather.js'
import { installItemEntities } from './itemEntity.js'
import { installHighlightStyle } from './highlight.js'
import { createAuthority } from './authority.js'
import { installGamemode } from './gamemode.js'
import { installCommands } from './commands.js'
import { installDimensions } from './dimensions.js'
import { createRoster, GUEST_NAME } from './identity.js'
import { installNPC } from './npc.js'
import { installDebugScreen } from './debugScreen.js'
import { installTabList } from './tabList.js'
import { createEvanTools, stubBackend, LINES } from './aiEvan.js'

/*
 * THE BOOT GATE.
 *
 * island.js is a lookup into a 981KB asset that arrives over the network, and
 * getVoxelID is synchronous -- noa asks for chunks within a tick of the Engine
 * existing and expects an answer on the spot. So the fetch has to finish
 * first, and this is a top-level await: nothing below runs until the terrain
 * is resident. The loading card in index.html is the page's initial state and
 * is torn down at the bottom of this file, so the gap is covered rather than
 * blank.
 *
 * REJECTED -- answer air, then invalidate and re-mesh once the data lands.
 * This is the tempting one and it is the wrong one, twice over. noa CACHES the
 * chunk you hand it; a chunk answered "all air" is, as far as the engine is
 * concerned, correct, and getting it back means walking every loaded chunk
 * through invalidateVoxelsInAABB and paying for the mesh a second time. Worse,
 * it costs the property the whole design rests on: getVoxelID would answer air
 * for (0, 135, 0) at t=0 and grass at t=1. Purity is not a nicety here -- it
 * is why the future persistence layer can be a diff against generation, and
 * why noa may ask for a chunk twice in any order. A generator that changes its
 * mind is not a generator.
 *
 * REJECTED -- a synchronous XHR. It would preserve purity, and it freezes the
 * main thread for the length of a network round trip on a file this size,
 * which is the one thing a browser is entitled to shout at you about.
 *
 * REJECTED -- inlining the asset into the bundle as base64. No fetch, no gate,
 * no loading screen. It also adds ~1.3MB to a 1.27MB bundle, moves the cost
 * from a cacheable asset to a parse, and puts Mojang generator output straight
 * into dist/ -- which is precisely what .gitignore and the deploy check are
 * currently keeping it out of while the licence question is open.
 */
const terrainT0 = performance.now()
await loadTerrain()
console.log(`terrain: ${JSON.stringify(terrainInfo())} in `
  + `${Math.round(performance.now() - terrainT0)}ms`)

const noa = new Engine({
  // Without this noa builds its own fixed-position container and appends it
  // to <body>, which then paints over the crosshair and HUD.
  domElement: document.getElementById('game'),

  // Prefixed onto every material's textureURL. Vite serves public/ at root.
  texturePath: '/textures/',

  // Minecraft's daytime sky. noa's default is a paler blue that reads as fog.
  clearColor: [0.47, 0.655, 1.0],

  // Dev only, both of them.
  //
  // `debug: true` runs a block noa itself labels "temp hacks for development",
  // and one of those hacks sets airJumps = 999 on the player -- that was the
  // original infinite-jump bug. physics.js resets it either way, but shipping
  // noa's dev hacks to visitors is asking for the next one to go unnoticed.
  // `showFPS: true` draws a counter in the corner, which visitors don't want.
  //
  // import.meta.env.DEV is replaced with a literal at build time, so the
  // production bundle gets `false` and the branches vanish.
  debug: import.meta.env.DEV,
  showFPS: import.meta.env.DEV,

  // noa's chunk size is unrelated to Minecraft's 16. It's just how many
  // voxels get meshed into one draw call. The "5x5 chunks" footprint lives
  // in island.js as a count of blocks, which is the part that has to match
  // when we import real Minecraft builds later.
  chunkSize: 32,
  // Horizontal 4 chunks = 128 blocks, comfortably past the 80-block island.
  // Vertical 3 = 96, enough to hold the whole surface-to-bedrock column so
  // the underside never pops in as you fly around it.
  chunkAddDistance: [4, 3],
  chunkRemoveDistance: [6, 5],

  playerStart: SPAWN,

  // Minecraft's exact player box. These also happen to be noa's defaults.
  // From physics.js rather than written out again: the collision box and
  // the eye height that rides on it are one set of numbers, and noa gets
  // told the box here while physics.js is the only file that reasons about
  // it. Two copies that agree today is how they stop agreeing.
  playerHeight: MC.PLAYER_HEIGHT,
  playerWidth: MC.PLAYER_WIDTH,

  // Minecraft's step height is 0.6, so you can walk onto a slab but never
  // onto a full block. Autostep would let you climb the parkour course by
  // walking into it.
  playerAutoStep: false,

  useAO: true,
  AOmultipliers: [0.92, 0.8, 0.5],
  reverseAOmultiplier: 1.0,

  lightVector: [0.6, -1, -0.4],
  blockTestDistance: 5, // Minecraft's survival reach is about 4.5 blocks
})

/*
 * noa's Engine is an EventEmitter, and Node's default warning threshold of ten
 * listeners is a leak detector for handlers added in a loop. Every listener
 * here is added exactly once at startup by a different system, and there are
 * about fifteen of them, so the warning is a false positive -- and a
 * misleading one, because it names whichever system happened to be the
 * eleventh rather than anything actually wrong.
 */
noa.setMaxListeners?.(32)

const ids = registerBlocks(noa)

// noa asks for chunk contents whenever its loader decides it needs them and
// expects setChunkData in response. Forget that call and the chunk simply
// never appears, with no error.
noa.world.on('worldDataNeeded', (id, data, x, y, z) => {
  for (let i = 0; i < data.shape[0]; i++) {
    for (let j = 0; j < data.shape[1]; j++) {
      for (let k = 0; k < data.shape[2]; k++) {
        data.set(i, j, k, getVoxelID(x + i, y + j, z + k, ids))
      }
    }
  }
  noa.world.setChunkData(id, data)
})

/*
 * The player is drawn by perspective.js as a real Minecraft model wearing a
 * skin. It replaced a plain white box.
 */
noa.camera.zoomDistance = 0

/* ---- systems ---- */

/*
 * WHO IS IN THE WORLD. See identity.js -- a roster, not a name, because there
 * are already two characters here and one of them is not you.
 *
 * You arrive as Guest. That is the visible half of docs/FUTURE.md 1b: a
 * visitor gets into the world without an account, under a name that is
 * obviously a placeholder, and the way they stop being a placeholder is by
 * telling the NPC their name. The login half of that section is still
 * unbuilt; this is the guest path, and the rename is the nickname path
 * arriving through a conversation instead of a text box.
 *
 * It used to say `const PLAYER_NAME = 'Evan'`, which conflated the visitor
 * with the person whose resume this is -- a confusion that only became
 * visible once Evan was standing in the world as someone else.
 */
const LOCAL_ID = 'local'
const EVAN_ID = 'npc:evan'

const roster = createRoster()

roster.add({ id: LOCAL_ID, name: GUEST_NAME, local: true, persist: true })

/*
 * `[Admin]` is a CHAT RANK. It lives in the chat line's format and nowhere
 * else, so it renders as `[Admin] <Evan> ...` in chat and does NOT appear
 * above his head -- see chat.js for the format and for the one that was
 * tried and reverted, and identity.js for why the roster refuses to
 * concatenate it onto the name. Dark red is vanilla's `dark_red` (0xAA0000),
 * the colour an admin rank conventionally gets.
 */
roster.add({
  id: EVAN_ID, name: 'Evan', kind: 'npc',
  prefix: { text: '[Admin] ', color: 0xaa0000 },
})

const move = installPhysics(noa)

/*
 * Fluid sensing is split from fluid EFFECTS because nothing else can sit in
 * both places: installSpeedModes needs the sensor to know your swim speed, and
 * drowning needs survival, which needs to exist first. So the sensor is built
 * here and armed (block ids, damage) after survival, below.
 */
const fluids = createFluids(noa, move)

/*
 * survival is created before installSpeedModes because sprinting depends on
 * the food level: Minecraft refuses to sprint at 6 food or less.
 *
 * The two rules it is handed reach FORWARD to `authority`, which is built
 * about forty lines below. That is deliberate rather than sloppy ordering:
 * survival must not import the authority (it would then have an opinion about
 * game modes and operators), and the authority must be able to kill you, so
 * one of the two has to be a closure. Arrow functions read the binding when
 * they run, and neither runs before the first tick.
 */
// Declared before survival, which now reads armor out of it. Nothing else
// changed order; this is the only new dependency between the two.
const inventory = createInventory()

const survival = createSurvival(noa, {
  allowDamage: (cause) => {
    if (!authority.caps().damage) return false
    if (cause === 'fall' && !authority.gamerule('fallDamage')) return false
    return true
  },
  allowRegen: () => authority.gamerule('naturalRegeneration'),
  damageReduction: createArmorReduction(inventory),
})
const movement = installSpeedModes(noa, move, survival, fluids)
installFluids(noa, { blockIds: ids, fluids, survival })

/*
 * What being under water LOOKS like -- fog and the murk overlay. Installed
 * here, next to the rest of the fluid wiring, and not later: it sets
 * `scene.fogMode` once at construction, and it has to do that before noa
 * meshes its first chunk. noa's terrain materials are frozen the moment they
 * are built, and a frozen Babylon material never recompiles its shader, so a
 * fog mode set after the first mesh would never reach the world. See
 * underwater.js for the whole trap.
 */
const underwater = installUnderwater(noa, { fluids })

// One material shared by the third-person model and the first-person arm, so
// a custom skin later only has to be swapped in one place. Declared before
// anything that uses it -- const is not hoisted.
const skinMaterial = createSkinMaterial(noa, '/skins/default.png')
const inputLock = createInputLock(noa)

// One swing drives both the first-person arm and the third-person model.
const swing = createSwing()


const sky = installSky(noa)
installHighlightStyle(noa)
const crack = installCrackOverlay(noa)
const held = installHeldItem(noa, inventory, skinMaterial, swing)

const perspective = installPerspective(noa, { skinMaterial, inputLock, inventory, swing, roster })

/*
 * Game modes, then the authority, then everything that asks it for permission.
 *
 * gamemode.js only APPLIES a mode -- what flies, what collides, what is drawn.
 * It is installed first because the authority is what decides which mode you
 * are in, and it needs something to apply.
 */
const gamemode = installGamemode({ flight: movement.flight, perspective, held })

/*
 * THE trust boundary. See authority.js: this is the module a Cloudflare
 * Durable Object replaces the decision half of, and the object below is the
 * half that survives that swap -- how a change that has already been approved
 * actually reaches the game.
 */
/*
 * Moving the player, without asking permission.
 *
 * Lifted out of the authority adapter below because two callers now need the
 * same move and only one of them is a command: /tp is operator-gated by
 * authority.js, and arriving in a dimension is not (see the note on
 * /dimension in commands.js). Hoisting the closure rather than routing
 * dimensions.js through requestTeleport keeps the gate exactly where it was
 * -- on the command -- instead of forcing a second caller to be an operator
 * to be allowed to stand somewhere.
 */
const movePlayer = (x, y, z) => {
  noa.ents.setPosition(noa.playerEntity, [x, y, z])
  const body = noa.ents.getPhysics(noa.playerEntity).body
  body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
  // Same trap as respawn.js: without this you land at the destination and
  // are immediately billed for the height you were teleported from.
  survival.clearFallTracking()
}

const authority = createAuthority({
  world: {
    /*
     * A getter, not a copy. /tp and /give quote your name in their success
     * message, and yours changes the moment AI Evan calls set_player_name --
     * a value read here at construction would have been frozen at 'Guest'.
     */
    get playerName() { return roster.displayNameOf(LOCAL_ID) },
    applyGamemode: (mode) => gamemode.apply(mode),
    setBlock: (id, x, y, z) => noa.setBlock(id, x, y, z),
    getTime: () => sky.getTime(),
    setTime: (t) => sky.setTime(t),
    teleport: movePlayer,
    give: (id, count) => inventory.add(id, count),
    blockName: (id) => itemName(id),
    kill: () => survival.kill(),
  },
})

const interaction = installInteraction(noa, inventory,
  // useBlock is a thunk because inventoryScreen is declared further down; it
  // only ever runs on a right-click, long after everything is constructed.
  { crack, held, swing, inputLock, useBlock: (id, pos) => inventoryScreen.useBlock(id, pos) },
  authority)

/*
 * The doDaylightCycle game rule.
 *
 * WAS a hack, and the comment here said so: sky.js owned the clock, had no
 * off switch, and the rule was enforced by letting the clock advance and then
 * pinning it back from out here every tick. That comment named the honest
 * version -- a `running` flag inside sky.js -- and the flag now exists, so
 * this is that.
 *
 * The difference is not tidiness. Pinning from outside was correct only while
 * this tick listener ran AFTER sky.js's, which was true only because
 * installSky happens to be called earlier in this file. Registration order is
 * not a contract, and the failure mode of getting it wrong is a clock that
 * advances one tick per tick and is put back one tick late -- which looks
 * exactly like it working.
 *
 * Still a tick listener rather than a hook on /gamerule, because the rule can
 * change from anywhere (a command, the console, a future server message) and
 * GAMERULES is a plain table with no change event. One boolean comparison a
 * tick is cheaper than an event bus.
 */
noa.on('tick', () => { sky.setRunning(!!authority.gamerule('doDaylightCycle')) })

/*
 * The Nether, and the seam that made it possible.
 *
 * Installed after `sky` and `underwater` because it drives both, and handed
 * `authority` to decorate -- see the note in dimensions.js, and weather.js
 * for the same pattern. `teleport` is the one used by /tp, passed rather than
 * re-implemented so that arriving in a dimension clears fall tracking the way
 * arriving anywhere else does.
 */
const dimensions = installDimensions(noa, {
  sky, underwater, authority,
  teleport: movePlayer,
})

installHotbarControls(noa, inventory, inputLock)
// `gamemode` decides which screen E opens: the survival inventory or the
// creative item picker. See playerScreen() in inventory.js.
const inventoryScreen = installInventoryScreen(noa, inventory, inputLock, gamemode)
// The name is passed as a thunk, not a string: it changes while the page is
// open, and the death screen has to say whatever you are called NOW.
installRespawn(noa, survival, inputLock, {
  playerName: () => roster.displayNameOf(LOCAL_ID),
})
installHUD(noa, { inventory, survival })

/*
 * Feedback listens to interact.js and physics.js rather than reaching into the
 * world itself, so it installs after both. Sounds need `npm run sounds` to
 * have been run; without a manifest they stay silent rather than throwing.
 */
// `fluids` joins the list so sounds.js can hear the water. It reads the
// sensor directly rather than subscribing, because fluids.js emits nothing
// and giving it events is a change to a file this pass does not own.
const sounds = installSounds(noa, { interaction, movement, survival, fluids })
const particles = installParticles(noa, { interaction, movement })

/*
 * Weather. After `sounds` because the rain bed hangs off its AudioContext, and
 * before installCommands because it registers doWeatherCycle into GAMERULES --
 * /gamerule builds its help line from that table when the command registers.
 */
const weather = installWeather(noa, { sky, authority, sounds })

/*
 * Dropped items. Installed after `sounds` because it plays the pickup, and
 * after `interaction` for no reason at all -- it does not listen to breaks, it
 * decorates `authority.requestBlockChange`, which is the only place a break
 * can happen. That decoration is why nothing above had to change: interact.js
 * stopped adding to the inventory, and the drop appeared in the world instead.
 */
const drops = installItemEntities(noa, { inventory, authority, sounds, inputLock })

/*
 * F3. Installed after `drops` and `particles` because it counts both, and it
 * is handed `inputLock` to READ rather than to take: F3 is an overlay, not a
 * screen -- the world keeps ticking and you keep walking with it open. All the
 * lock does here is tell the key handler that the current keystroke belongs to
 * the chat bar rather than to the game, which is the same guard the hotbar
 * number keys use.
 */
const debug = installDebugScreen(noa, {
  particles, drops, inputLock,
  /*
   * The block's display name, so "Targeted Block" reads "Grass Block" rather
   * than an integer. items.js already owns the id -> name map the held-item
   * label uses, so this is the same answer rather than a second one.
   *
   * NOT vanilla's form: F3 prints the IDENTIFIER (minecraft:grass_block).
   * blocks.js keys blocks by a shorthand -- 'grass', 'planks' -- that is not
   * the Minecraft id, so `minecraft:${key}` would be confidently wrong for
   * every block whose shorthand was abbreviated. A real identifier field on
   * BLOCK_TYPES is what this wants, and that is blocks.js's call to make.
   */
  blockName: (id) => itemName(id),
})

/*
 * Tab. Like F3 it is an OVERLAY and reads `inputLock` rather than taking it --
 * you can walk while the player list is up, which is the whole point of it
 * being drawn in the HUD pass.
 *
 * `skinOf` and `pingOf` are passed in rather than looked up inside tabList.js,
 * because both are facts about THIS world that the widget has no business
 * knowing. Today skinOf answers with the same two files installNPC and
 * createSkinMaterial already use, and pingOf is the honest zero of a game with
 * no transport -- see the note on it in tabList.js for what replaces it.
 */
const tabList = installTabList(noa, {
  roster, inputLock,
  skinOf: (entry) => (entry.id === EVAN_ID ? '/skins/evan.png' : '/skins/default.png'),
})

const menu = installMenu(noa, { inputLock, inventory, inventoryScreen, survival })

/*
 * Chat. Local only for now -- there is no transport, so your messages come
 * straight back to you.
 */
const chat = installChat(noa, {
  inputLock, inventory, menu, survival,
  // Read at send time, so the echo follows a rename. See chat.js.
  speaker: () => roster.get(LOCAL_ID),
  /*
   * The transport, and the one place a typed line becomes two things.
   *
   * It echoes to the log exactly as the default loopback did, then offers the
   * line to AI Evan -- who takes it only if you are standing near him. So
   * chat is still chat: nothing is swallowed, nothing is intercepted, and
   * there is no second input box. When the real transport lands this becomes
   * `socket.send(text)` and the NPC hand-off moves to the server, which is
   * where a shared world has to do it anyway.
   */
  send: (text) => {
    chat.addMessage({ text, from: roster.get(LOCAL_ID) })
    aiEvan.hear(text)
  },
  // Chat has to give the mouse back so you can see what you type, and take it
  // again on close. requestLockPersistently is menu.js's workaround for the
  // browser cooldown that follows an Escape -- reused rather than reinvented.
  requestPointerLock: () => requestLockPersistently(noa),
})

/*
 * Death messages. The seam, stated plainly: survival publishes a CAUSE, the
 * roster answers WHO, and chat renders the sentence. None of the three knows
 * about the other two.
 *
 * This subscribes for the local player only because the local player is the
 * only one who can die yet. On a server the socket handler makes the same
 * call with the name of whoever died, and this line stays as the local case --
 * which is why announceDeath takes a name instead of reading the roster itself.
 *
 * It lives here rather than inside installChat because chat is a VIEW; wiring
 * it to survival there would make the overlay reach into game state, and the
 * only reason it currently holds `survival` at all is to know not to open
 * while you are dead.
 */
survival.onDeath((detail) => chat.announceDeath(roster.displayNameOf(LOCAL_ID), detail))

// The whole command set is one call. /tp <plot> for the resume plots goes in
// commands.js once the plots exist.
// `playerName` is gone from this call: commands.js never read it, and the
// roster is now the answer to that question anyway.
const commands = installCommands(chat, authority, { noa })

/* ------------------------------------------------------------------ *
 * AI Evan
 * ------------------------------------------------------------------ */

/*
 * Where he stands. Four blocks east of spawn, which is the nearest column
 * with open sky -- spawn itself is under a dark forest canopy, and a
 * character standing inside a leaf block is not a good first impression.
 * The ground is found by scanning rather than hardcoded, because the terrain
 * asset is a real Minecraft chunk import and "the surface is at 135" is a
 * fact about today's asset rather than about the code.
 *
 * He was at x = +4.5 until the terrain asset stopped being mirrored in X
 * (scripts/terrain/extract.mjs, MIRROR_X). Same column of the same Minecraft
 * world, and still four blocks east -- east is -X in this engine, so the
 * sentence above did not have to change, only the sign. The scan caught it
 * the way it was meant to: at +4.5 the ground is now six blocks higher, so
 * Evan stood at y=142 with his feet in a treetop.
 */
const EVAN_XZ = [-4.5, 0.5]

/*
 * LEAVES ARE NOT A FLOOR, and this is the one thing the scan below has to
 * know that "the first block that is not air" does not.
 *
 * It is the same blind spot `pickSpawn` in scripts/build-terrain.mjs writes up
 * at length: in a dark forest the first solid block from the top is a leaf, so
 * the obvious implementation stands its subject twenty blocks up in a canopy.
 * That function is not imported because it is the wrong side of the build --
 * it runs in node against `minecraft:` ids and this runs in the browser
 * against engine ids. Shared intent, not shared code; coupling main.js to a
 * build script to save four lines is a worse trade than saying it twice.
 */
const LEAF_IDS = new Set(
  Object.entries(ids).filter(([key]) => key.endsWith('_leaves')).map(([, id]) => id))

const evanY = (() => {
  for (let y = SPAWN[1] + 4; y > SPAWN[1] - 8; y--) {
    const under = getVoxelID(Math.floor(EVAN_XZ[0]), y - 1, Math.floor(EVAN_XZ[1]), ids)
    if (under !== 0 && !LEAF_IDS.has(under)) return y
  }
  return SPAWN[1]
})()
const EVAN_POS = [EVAN_XZ[0], evanY, EVAN_XZ[1]]

/** Minecraft's compass, from noa's heading (direction = sin h, cos h). */
const FACING = ['south', 'west', 'north', 'east']
const facingName = (heading) =>
  FACING[(Math.round(heading / (Math.PI / 2)) % 4 + 4) % 4]

const aiEvan = installNPC(noa, {
  roster,
  id: EVAN_ID,
  position: EVAN_POS,
  /*
   * Evan's real appearance, converted from his account's pre-1.8 64x32 sheet
   * by scripts/build-textures.mjs. Only HE wears it -- the player above
   * keeps /skins/default.png -- because this is one person's face, not the
   * skin of whoever happens to be standing here.
   *
   * The cape is a separate file for a licensing reason, not a technical one:
   * it is Mojang art granted to an account, a deploy may have to ship
   * without it, and `--no-cape` builds exactly that. A missing cape image is
   * handled at runtime rather than being an error (playerModel.js).
   */
  skin: '/skins/evan.png',
  cape: '/skins/evan-cape.png',
  chat,
  script: { greet: LINES.greet },
  agent: {
    /*
     * THE SWAP POINT. `stubBackend` is a deterministic state machine with no
     * model behind it; replacing this one line with a fetch to the Worker is
     * the whole of "make AI Evan real". See agent.js for the request shape
     * and for why the API key cannot be on this side of that fetch.
     */
    backend: stubBackend,
    tools: createEvanTools({
      playerId: () => LOCAL_ID,
      setName: (id, name) => roster.setName(id, name),
      nameOf: (id) => roster.displayNameOf(id),
      playerState: () => {
        const [x, y, z] = noa.ents.getPosition(noa.playerEntity)
        const target = noa.targetedBlock
        return {
          position: [x, y, z],
          facing: facingName(noa.camera.heading),
          lookingAt: target ? itemName(target.blockID) : null,
          distanceToEvan: Math.hypot(x - EVAN_POS[0], z - EVAN_POS[2]),
          yourName: roster.displayNameOf(LOCAL_ID),
        }
      },
    }),
  },
})

// The join notice, yellow, exactly as a server would announce it. Emitting it
// locally keeps that path real rather than something to be written later.
// Evan is announced too, because on a real server he would be a connected
// client and this is what you would see.
chat.announceJoin(roster.displayNameOf(EVAN_ID))
chat.announceJoin(roster.displayNameOf(LOCAL_ID))

// Starter kit. Minecraft survival starts you empty-handed, but this world is
// meant to be poked at within seconds of arriving, so seed the hotbar.
inventory.add(ids.planks, 64)
inventory.add(ids.cobblestone, 64)
inventory.add(ids.dirt, 32)

/*
 * Pointer lock. There is no entry screen -- you spawn straight into the live
 * world -- so the first click on it captures the mouse. A click is required
 * because browsers only grant pointer lock from a real user gesture; there is
 * no way to have it on page load.
 */
const gameEl = document.getElementById('game')
gameEl.addEventListener('mousedown', () => {
  if (inventory.open || menu.isOpen || survival.dead || chat.isOpen) return
  if (!noa.container.hasPointerLock) requestLockPersistently(noa)
})

// Keyboard events reach noa through its container, which has to be focused.
// Without this, WASD does nothing until the player happens to click.
gameEl.focus()

/*
 * Escape opens the pause menu. It cannot be done with a keydown listener:
 * the browser handles Escape itself to exit pointer lock and does NOT
 * deliver the key to the page. The resulting lostPointerLock is the only
 * signal we get, so the menu hangs off that.
 *
 * The guards matter -- the inventory, the menu and death all release pointer
 * lock deliberately, and without them each would immediately stack the pause
 * menu on top of itself.
 */
let wasLocked = false
noa.container.on('gainedPointerLock', () => { wasLocked = true })

noa.container.on('lostPointerLock', () => {
  // Only a real locked -> unlocked transition should open the menu. A FAILED
  // lock request also emits this, so without the guard the retry loop that
  // works around Chrome's post-Escape cooldown would keep popping the menu
  // back open while it retried.
  if (!wasLocked) return
  wasLocked = false
  // Chat is in this list for the same reason as the others: it releases the
  // lock on purpose, and without the guard opening chat would stack the pause
  // menu on top of it.
  if (inventory.open || survival.dead || menu.isOpen || chat.isOpen) return
  menu.open()
})

/*
 * Take the loading card down.
 *
 * On the first RENDER, not here and not on a timer: the systems above are all
 * constructed by now, but noa has not yet meshed a single chunk, so removing
 * the card synchronously hands you a blue void for the half second it takes to
 * build the first terrain meshes. One frame of rendering is the cheapest
 * signal that there is something behind the card.
 */
noa.on('beforeRender', function dropLoadingCard() {
  noa.off('beforeRender', dropLoadingCard)
  document.getElementById('loading')?.classList.add('hidden')
})

window.noa = noa
window.game = {
  // `fluids` is exposed for the same reason `move` is: the test suite asserts
  // measured swim speeds and breath durations, and both need to know which
  // fluid the player is actually registering as in.
  fluids,
  inventory, survival, move, sky, menu, chat, inputLock, perspective,
  skinMaterial, sounds, particles, drops, weather, underwater,
  /*
   * The viewmodel and the extrusion counters, for the console and the test
   * suite. `held` was not exposed before because nothing outside main.js
   * needed it; asserting that a tool is actually drawn needs to reach the
   * meshes, and `itemModelStats` is how a test proves the geometry cache is
   * real rather than rebuilt every frame.
   */
  held, itemModelStats,
  /*
   * The debug screen, for the console and for the test suite. `sample()` is
   * the numbers BEFORE they are formatted, which is how a spec asserts that
   * the position is live rather than that a div exists.
   */
  debug, tabList,
  authority, gamemode, commands, interaction, flight: movement.flight,
  /*
   * The container screens and the creative picker's tab rules, for the
   * console and for the test suite. `creative` is the RULES -- which tab
   * claims a key, what nothing claims, what a click on the list does -- all
   * of which are pure and answerable without opening anything;
   * `inventoryScreen.creative` is the open screen's state. Two different
   * questions, so two different handles.
   */
  inventoryScreen,
  creative: {
    TABS: creativeTabs, CATEGORY_TABS: creativeCategoryTabs, PICKER_ITEMS: pickerItems,
    tabItems, ruleFor: creativeRuleFor, listClick: creativeListClick,
    uncategorised: uncategorisedItems, blocksWithoutEntry,
  },
  /*
   * Identity and the agent, for the console and for the test suite. `roster`
   * is the only way to ask who anyone is; `aiEvan.session.transcript` is the
   * Anthropic message array the loop actually built, which is how a spec
   * proves the rename went through a TOOL CALL rather than through a regex
   * in a chat handler.
   */
  roster, aiEvan, LOCAL_ID, EVAN_ID, EVAN_POS,
  // Key -> item id, for the console and for the test suite. Item ids above
  // ITEM_BASE are positional, so anything outside this module that wants an
  // iron pickaxe has to ask rather than hardcode 1040-something.
  itemId,
  /*
   * The drop tables, for the console and for the test suite. `dropFor` is pure
   * and returns a distribution, so a spec can assert "lapis ore drops 4 to 9
   * lapis" outright instead of breaking ten thousand blocks and squinting at a
   * histogram; `roll` takes its generator, so a scripted one makes a 10% flint
   * deterministic. `unmapped` is every block no drop rule claims, which should
   * always be empty.
   */
  loot: { dropFor, roll: rollDrops, unmapped: unmappedDrops },
  // What actually loaded: size, palette, origin, and any palette key with no
  // block in blocks.js (which should always be empty).
  //
  // A GETTER now, not a value. It used to be `terrainInfo()` evaluated once
  // here, which was true for as long as there was one world; with a second
  // dimension a frozen snapshot would go on reporting the overworld's palette
  // from inside the Nether -- a debug handle that lies is worse than one that
  // is missing. A getter and not a function so that every existing reader
  // (`game.terrain.originX`) keeps working unchanged.
  get terrain() { return terrainInfo() },
  /*
   * The dimension switcher, for the console and for the test suite. `enter`
   * is the whole feature; `active`, `islandDimension` and `worldName` are the
   * three pieces of state that must agree, exposed separately so a spec can
   * catch them disagreeing rather than take dimensions.js's word for it.
   */
  dimensions,
  /*
   * The generator itself, for the console and the test suite.
   *
   * Deliberately NOT the same question as noa.getBlock: that reads the live
   * voxel array and answers 0 for any chunk that is not currently loaded,
   * which in a world 250 blocks tall is most of it. This answers what the
   * world IS at a coordinate, resident or not, mined or not.
   */
  voxelAt: (x, y, z) => getVoxelID(x, y, z, ids),
  /*
   * key -> engine block id, and the inverse. Exposed because a spec that wants
   * to know what it is standing on can otherwise only assert a NUMBER, and the
   * numbers are positional -- they change whenever blocks.js gains an entry,
   * which turns a real assertion into a landmine for whoever adds a block.
   * Doubly so across dimensions, where the same palette INDEX means different
   * things in each patch.
   */
  ids,
  blockKey: (id) => BLOCK_TYPES.find(b => ids[b.key] === id)?.key ?? 'air',
}
