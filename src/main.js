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
import { installHeldItem } from './heldItem.js'
import { installCrackOverlay } from './crackOverlay.js'
import { installSky } from './sky.js'
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

/* Player body. Invisible in first person, visible once F5 pulls the camera out. */
const scene = noa.rendering.getScene()
const pos = noa.ents.getPositionData(noa.playerEntity)
const body = CreateBox('player', {}, scene)
body.scaling.set(pos.width, pos.height, pos.width)
body.material = noa.rendering.makeStandardMaterial()
noa.ents.addComponent(noa.playerEntity, noa.ents.names.mesh, {
  mesh: body,
  // noa anchors entities at their feet, Babylon anchors a box at its centre,
  // so without this the body renders half-buried in the ground.
  offset: [0, pos.height / 2, 0],
})
noa.camera.zoomDistance = 0
noa.on('tick', () => {
  // Hide our own body when the camera is inside it, otherwise first person
  // is spent staring at the inner faces of a white box.
  body.setEnabled(noa.camera.zoomDistance > 0.5)
})

/* ---- systems ---- */
const move = installPhysics(noa)

// survival is created before installSpeedModes because sprinting depends on
// the food level: Minecraft refuses to sprint at 6 food or less.
const survival = createSurvival(noa)
installSpeedModes(noa, move, survival)

const inventory = createInventory()

const sky = installSky(noa)
installHighlightStyle(noa)
const crack = installCrackOverlay(noa)
const held = installHeldItem(noa, inventory)
installInteraction(noa, inventory, { crack, held })

const inputLock = createInputLock(noa)

installHotbarControls(noa, inventory)
const inventoryScreen = installInventoryScreen(noa, inventory, inputLock)
installRespawn(noa, survival, inputLock)
installHUD(noa, { inventory, survival })

const menu = installMenu(noa, { inputLock, inventory, inventoryScreen, survival })

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
  if (inventory.open || menu.isOpen || survival.dead) return
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
  if (inventory.open || survival.dead || menu.isOpen) return
  menu.open()
})

window.noa = noa
window.game = { inventory, survival, move, sky, menu, inputLock }
