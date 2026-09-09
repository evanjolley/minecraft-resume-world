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

  // WARNING: `debug: true` runs a block noa itself labels "temp hacks for
  // development", and one of those hacks sets airJumps = 999 on the player.
  // physics.js resets it. If jumping ever goes infinite again, look here first.
  debug: true,
  showFPS: true,

  // noa's chunk size is unrelated to Minecraft's 16. It's just how many
  // voxels get meshed into one draw call. The "3x3 chunks" footprint lives
  // in island.js as a count of blocks, which is the part that has to match
  // when we import real Minecraft builds later.
  chunkSize: 32,
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
installSpeedModes(noa, move)

const survival = createSurvival(noa)
const inventory = createInventory()

installSky(noa)
installHighlightStyle(noa)
const crack = installCrackOverlay(noa)
const held = installHeldItem(noa, inventory)
installInteraction(noa, inventory, { crack, held })

installHotbarControls(noa, inventory)
installInventoryScreen(noa, inventory)
installRespawn(noa, survival)
installHUD(noa, { inventory, survival })

// Starter kit. Minecraft survival starts you empty-handed, but this world is
// meant to be poked at within seconds of arriving, so seed the hotbar.
inventory.add(ids.planks, 64)
inventory.add(ids.cobblestone, 64)
inventory.add(ids.dirt, 32)

/* Pointer lock. noa never requests this itself, and browsers only grant it
 * from a real user gesture, so it has to hang off an actual click. */
const overlay = document.getElementById('overlay')
overlay.addEventListener('click', () => noa.container.setPointerLock(true))
noa.container.on('gainedPointerLock', () => overlay.classList.add('hidden'))
noa.container.on('lostPointerLock', () => {
  // Two cases intentionally release the lock and must NOT get the
  // click-to-enter curtain thrown back up on top of them: opening the
  // inventory, and dying (the death screen needs a visible cursor so the
  // Respawn button is clickable).
  if (!inventory.open && !survival.dead) overlay.classList.remove('hidden')
})

window.noa = noa
window.game = { inventory, survival, move }
