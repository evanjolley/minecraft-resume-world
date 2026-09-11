import { Engine } from 'noa-engine'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'

import { registerBlocks } from './blocks.js'
import { getVoxelID, SPAWN } from './island.js'
import { installPhysics, installSpeedModes } from './physics.js'
import { createSurvival } from './survival.js'
import { createInventory, installInventoryScreen } from './inventory.js'
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
import { createArmorReduction } from './armor.js'
import { itemName, itemId } from './items.js'
import { itemModelStats } from './itemModel.js'
import { installSounds } from './sounds.js'
import { installParticles } from './particles.js'
import { installWeather } from './weather.js'
import { installItemEntities } from './itemEntity.js'
import { installHighlightStyle } from './highlight.js'
import { createAuthority } from './authority.js'
import { installGamemode } from './gamemode.js'
import { installCommands } from './commands.js'
import { BLOCK_BY_ID } from './blocks.js'

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
  playerHeight: 1.8,
  playerWidth: 0.6,

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
 * Identity. Lives here rather than in chat.js because it is exactly what a
 * network layer will want to own, and half the command messages quote it.
 */
const PLAYER_NAME = 'Evan'

const move = installPhysics(noa)

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
const movement = installSpeedModes(noa, move, survival)

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

const perspective = installPerspective(noa, { skinMaterial, inputLock, inventory, swing })

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
const authority = createAuthority({
  world: {
    playerName: PLAYER_NAME,
    applyGamemode: (mode) => gamemode.apply(mode),
    setBlock: (id, x, y, z) => noa.setBlock(id, x, y, z),
    getTime: () => sky.getTime(),
    setTime: (t) => { sky.setTime(t); pinnedTime = null },
    teleport: (x, y, z) => {
      noa.ents.setPosition(noa.playerEntity, [x, y, z])
      const body = noa.ents.getPhysics(noa.playerEntity).body
      body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
      // Same trap as respawn.js: without this you land at the destination and
      // are immediately billed for the height you were teleported from.
      survival.clearFallTracking()
    },
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
 * sky.js owns the clock and advances it on its own tick, and it is not this
 * agent's file to change, so the rule is enforced by pinning the clock back
 * each tick instead of by stopping it. That reads as a hack and half is: the
 * honest version is a `running` flag inside sky.js. It is observably correct
 * -- getTime() does not move -- and it costs one comparison a tick.
 *
 * Registered after installSky, which matters: noa fires tick listeners in
 * registration order, so this runs after the clock has advanced and puts it
 * back, rather than before and being immediately overwritten.
 */
let pinnedTime = null
noa.on('tick', () => {
  if (authority.gamerule('doDaylightCycle')) { pinnedTime = null; return }
  if (pinnedTime === null) pinnedTime = sky.getTime()
  sky.setTime(pinnedTime)
})

installHotbarControls(noa, inventory, inputLock)
const inventoryScreen = installInventoryScreen(noa, inventory, inputLock)
installRespawn(noa, survival, inputLock)
installHUD(noa, { inventory, survival })

/*
 * Feedback listens to interact.js and physics.js rather than reaching into the
 * world itself, so it installs after both. Sounds need `npm run sounds` to
 * have been run; without a manifest they stay silent rather than throwing.
 */
const sounds = installSounds(noa, { interaction, movement, survival })
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

const menu = installMenu(noa, { inputLock, inventory, inventoryScreen, survival })

/*
 * Chat. Local only for now -- there is no transport, so your messages come
 * straight back to you.
 */
const chat = installChat(noa, {
  inputLock, inventory, menu, survival,
  name: PLAYER_NAME,
  // Chat has to give the mouse back so you can see what you type, and take it
  // again on close. requestLockPersistently is menu.js's workaround for the
  // browser cooldown that follows an Escape -- reused rather than reinvented.
  requestPointerLock: () => requestLockPersistently(noa),
})

// The whole command set is one call. /tp <plot> for the resume plots goes in
// commands.js once the plots exist.
const commands = installCommands(chat, authority, { noa, playerName: PLAYER_NAME })

// The join notice, yellow, exactly as a server would announce it. Emitting it
// locally keeps that path real rather than something to be written later.
chat.announceJoin(PLAYER_NAME)

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

window.noa = noa
window.game = {
  inventory, survival, move, sky, menu, chat, inputLock, perspective,
  skinMaterial, sounds, particles, drops, weather,
  /*
   * The viewmodel and the extrusion counters, for the console and the test
   * suite. `held` was not exposed before because nothing outside main.js
   * needed it; asserting that a tool is actually drawn needs to reach the
   * meshes, and `itemModelStats` is how a test proves the geometry cache is
   * real rather than rebuilt every frame.
   */
  held, itemModelStats,
  authority, gamemode, commands, interaction, flight: movement.flight,
  // Key -> item id, for the console and for the test suite. Item ids above
  // ITEM_BASE are positional, so anything outside this module that wants an
  // iron pickaxe has to ask rather than hardcode 1040-something.
  itemId,
}
