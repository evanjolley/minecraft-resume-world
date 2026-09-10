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
import { installSounds } from './sounds.js'
import { installParticles } from './particles.js'
import { installHighlightStyle } from './highlight.js'

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
const move = installPhysics(noa)

// survival is created before installSpeedModes because sprinting depends on
// the food level: Minecraft refuses to sprint at 6 food or less.
const survival = createSurvival(noa)
const movement = installSpeedModes(noa, move, survival)

// One material shared by the third-person model and the first-person arm, so
// a custom skin later only has to be swapped in one place. Declared before
// anything that uses it -- const is not hoisted.
const skinMaterial = createSkinMaterial(noa, '/skins/default.png')
const inputLock = createInputLock(noa)

// One swing drives both the first-person arm and the third-person model.
const swing = createSwing()

const inventory = createInventory()

const sky = installSky(noa)
installHighlightStyle(noa)
const crack = installCrackOverlay(noa)
const held = installHeldItem(noa, inventory, skinMaterial, swing)
const interaction = installInteraction(noa, inventory, { crack, held, swing, inputLock })

const perspective = installPerspective(noa, { skinMaterial, inputLock, inventory, swing })

installHotbarControls(noa, inventory, inputLock)
const inventoryScreen = installInventoryScreen(noa, inventory, inputLock)
installRespawn(noa, survival, inputLock)
installHUD(noa, { inventory, survival })

/*
 * Feedback listens to interact.js and physics.js rather than reaching into the
 * world itself, so it installs after both. Sounds need `npm run sounds` to
 * have been run; without a manifest they stay silent rather than throwing.
 */
const sounds = installSounds(noa, { interaction, movement })
const particles = installParticles(noa, { interaction, movement })

const menu = installMenu(noa, { inputLock, inventory, inventoryScreen, survival })

/*
 * Chat. Local only for now -- there is no transport, so your messages come
 * straight back to you. The name lives here rather than in chat.js because it
 * is identity, which is what a network layer will want to own.
 */
const PLAYER_NAME = 'Evan'
const chat = installChat(noa, {
  inputLock, inventory, menu, survival,
  name: PLAYER_NAME,
  // Chat has to give the mouse back so you can see what you type, and take it
  // again on close. requestLockPersistently is menu.js's workaround for the
  // browser cooldown that follows an Escape -- reused rather than reinvented.
  requestPointerLock: () => requestLockPersistently(noa),
})

// Registering a command is one line. These two are the useful ones today;
// /tp <plot> for the resume plots goes here once the plots exist.
chat.command('time', 'Sets the time of day: day, night, or a tick count', ([arg]) => {
  const t = arg === 'day' ? 1000 : arg === 'night' ? 13000 : Number(arg)
  if (!Number.isFinite(t)) {
    chat.addMessage({ text: 'Expected "day", "night" or a tick count', kind: 'error' })
    return
  }
  sky.setTime(t)
  chat.addMessage({ text: `Set the time to ${Math.floor(t)}`, kind: 'system' })
})

chat.command('tp', 'Teleports you to x y z', (args) => {
  const [x, y, z] = args.map(Number)
  if (![x, y, z].every(Number.isFinite)) {
    chat.addMessage({ text: 'Expected three numbers: /tp x y z', kind: 'error' })
    return
  }
  noa.ents.setPosition(noa.playerEntity, x, y, z)
  chat.addMessage({ text: `Teleported ${PLAYER_NAME} to ${x}, ${y}, ${z}`, kind: 'system' })
})

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
window.game = { inventory, survival, move, sky, menu, chat, inputLock, perspective, skinMaterial, sounds, particles }
