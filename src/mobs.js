import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Vector4 } from '@babylonjs/core/Maths/math.vector'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { trackEntityLight } from './entityLight.js'
import { itemId, item } from './items.js'
import { MC } from './physics.js'
import { MOB_LOOT } from './mobLoot.js'

/*
 * PASSIVE MOBS: cows, pigs, sheep and chickens, as Java Edition 1.21 has them.
 *
 * What is vanilla here, and where it comes from:
 *
 *   models    CowModel, PigModel, SheepModel + SheepFurModel, ChickenModel,
 *             part for part, in model units, on the classic 64x32 skins. The
 *             skins are Pixel Perfection CE's (CC-BY-SA-4.0), built into
 *             public/textures/entity/ by scripts/build-textures.mjs.
 *   sizes     EntityType dimensions (cow 0.9 x 1.4, pig 0.9 x 0.9, sheep
 *             0.9 x 1.3, chicken 0.4 x 0.7), health (10, 10, 8, 4).
 *   AI        the goals that make an animal look alive: RandomStrollGoal (a
 *             1-in-120 chance a tick to wander up to 10 blocks, preferring
 *             grass), PanicGoal (run at the panic speed for 5 seconds after
 *             being hurt), TemptGoal (cows and sheep follow wheat),
 *             LookAtPlayerGoal (6 blocks) and RandomLookAroundGoal.
 *   speeds    MoveControl sets zza = speedModifier * movement_speed, and
 *             travel() applies it through the same friction as the player's
 *             input, so ground speed in blocks/s is 43.17 * (mod * speed)^2.
 *             A cow ambles at 1.7 b/s and bolts at 6.9.
 *   sounds    Mob.ambientSoundTime (a sound every ~6 s on average), hurt and
 *             death sounds, the chicken's egg plop.
 *   combat    the 1.9 attack cooldown, weapon damage, knockback 0.4, 10 ticks
 *             of hurt time (the red flash) and invulnerability, the 20-tick
 *             death roll onto the side.
 *   drops     the loot tables: cow 0-2 leather and 1-3 beef, pig 1-3
 *             porkchop, sheep 1 wool and 1-2 mutton, chicken 0-2 feathers and
 *             1 chicken. A chicken lays an egg every 6000 to 12000 ticks.
 *   spawning  in herds of four on grass with sky light 9 or more, as the
 *             world's chunks first load, and topped up every 400 ticks.
 *
 * NOT here: breeding and babies, shearing, sheep eating grass, saddles,
 * leads, milk, mob-to-mob collision. Named so nobody mistakes a gap for a
 * decision.
 *
 * Natural spawning is OFF under automation (navigator.webdriver), for the
 * reason main.js gives for DEV_SPAWN_AS_OPERATOR: a cow wandering into a
 * physics spec changes the thing that spec measures. Specs summon the mobs
 * they test.
 */

const TPS = MC.TICKS_PER_SECOND
const SCALE = 1 / 16
const SHEET_W = 64
const SHEET_H = 32

/* ---------------- models ---------------- */

/*
 * One cube of a vanilla model: texOffs(u, v).addBox(x, y, z, w, h, d) on a
 * part posed at `pivot` with x rotation `rx`, in Minecraft's model space
 * (y down, the animal facing -z). `inflate` is CubeDeformation.
 */
const cube = (u, v, x, y, z, w, h, d, inflate = 0) => ({ u, v, x, y, z, w, h, d, inflate })

/* QuadrupedModel's legs, shared by three of the four. */
const legs = (u, v, h, x, y, zBack, zFront, inflate = 0) => ({
  rightHindLeg: { pivot: [-x, y, zBack], cubes: [cube(u, v, -2, 0, -2, 4, h, 4, inflate)] },
  leftHindLeg: { pivot: [x, y, zBack], cubes: [cube(u, v, -2, 0, -2, 4, h, 4, inflate)] },
  rightFrontLeg: { pivot: [-x, y, zFront], cubes: [cube(u, v, -2, 0, -2, 4, h, 4, inflate)] },
  leftFrontLeg: { pivot: [x, y, zFront], cubes: [cube(u, v, -2, 0, -2, 4, h, 4, inflate)] },
})

const HALF_PI = Math.PI / 2

export const MODELS = {
  cow: {
    head: { pivot: [0, 4, -8], cubes: [
      cube(0, 0, -4, -4, -6, 8, 8, 6),
      cube(22, 0, -5, -5, -4, 1, 3, 1), // right horn
      cube(22, 0, 4, -5, -4, 1, 3, 1), // left horn
    ] },
    body: { pivot: [0, 5, 2], rx: HALF_PI, cubes: [
      cube(18, 4, -6, -10, -7, 12, 18, 10),
      cube(52, 0, -2, 2, -8, 4, 6, 1), // udder
    ] },
    ...legs(0, 16, 12, 4, 12, 7, -6),
  },
  pig: {
    head: { pivot: [0, 12, -6], cubes: [
      cube(0, 0, -4, -4, -8, 8, 8, 8),
      cube(16, 16, -2, 0, -9, 4, 3, 1), // snout
    ] },
    body: { pivot: [0, 11, 2], rx: HALF_PI, cubes: [cube(28, 8, -5, -10, -7, 10, 16, 8)] },
    ...legs(0, 16, 6, 3, 18, 7, -5),
  },
  sheep: {
    head: { pivot: [0, 6, -8], cubes: [cube(0, 0, -3, -4, -6, 6, 6, 8)] },
    body: { pivot: [0, 5, 2], rx: HALF_PI, cubes: [cube(28, 8, -4, -10, -7, 8, 16, 6)] },
    ...legs(0, 16, 12, 3, 12, 7, -5),
  },
  // SheepFurModel: the same parts, inflated, on sheep_fur.png and tinted.
  sheepFur: {
    head: { pivot: [0, 6, -8], cubes: [cube(0, 0, -3, -4, -4, 6, 6, 6, 0.6)] },
    body: { pivot: [0, 5, 2], rx: HALF_PI, cubes: [cube(28, 8, -4, -10, -7, 8, 16, 6, 1.75)] },
    ...legs(0, 16, 6, 3, 12, 7, -5, 0.5),
  },
  chicken: {
    head: { pivot: [0, 15, -4], cubes: [
      cube(0, 0, -2, -6, -2, 4, 6, 3),
      cube(14, 0, -2, -4, -4, 4, 2, 2), // beak
      cube(14, 4, -1, -2, -3, 2, 2, 2), // wattle
    ] },
    body: { pivot: [0, 16, 0], rx: HALF_PI, cubes: [cube(0, 9, -3, -4, -3, 6, 8, 6)] },
    rightLeg: { pivot: [-2, 19, 1], cubes: [cube(26, 0, -1, 0, -3, 3, 5, 3)] },
    leftLeg: { pivot: [1, 19, 1], cubes: [cube(26, 0, -1, 0, -3, 3, 5, 3)] },
    rightWing: { pivot: [-4, 13, 0], cubes: [cube(24, 13, 0, 0, -3, 1, 4, 6)] },
    leftWing: { pivot: [4, 13, 0], cubes: [cube(24, 13, -1, 0, -3, 1, 4, 6)] },
  },
}

/*
 * Minecraft's box unwrap for a cube at texOffs(u, v), as UV rects, mapped onto
 * Babylon's face order [+Z, -Z, +X, -X, +Y, -Y] the way playerModel.js does:
 * the model faces +Z here, its right side is +X. See the note there.
 */
function faceUVs({ u, v, w, h, d }) {
  const r = (x, y, ww, hh) => new Vector4(x / SHEET_W, 1 - (y + hh) / SHEET_H,
    (x + ww) / SHEET_W, 1 - y / SHEET_H)
  const top = r(u + d, v, w, d)
  const bottom = r(u + d + w, v, w, d)
  const right = r(u, v + d, d, h)
  const front = r(u + d, v + d, w, h)
  const left = r(u + d + w, v + d, d, h)
  const back = r(u + 2 * d + w, v + d, w, h)
  return [front, back, right, left, top, bottom]
}

/*
 * Model space to this world's: x -> -x, y -> 24 - y, z -> -z. That is a point
 * inversion plus the 1.5-block offset vanilla's renderer applies, and it is
 * why a part's x rotation carries over unchanged: Babylon's RotationX in a
 * left-handed frame is the same matrix as JOML's in a right-handed one, and
 * the inversion commutes with every rotation.
 */
function buildTemplates(scene, defs, name) {
  const out = {}
  for (const [part, def] of Object.entries(defs)) {
    out[part] = def.cubes.map((c, i) => {
      const box = CreateBox(`${name}-${part}-${i}`, {
        width: c.w + c.inflate * 2, height: c.h + c.inflate * 2, depth: c.d + c.inflate * 2,
        faceUV: faceUVs(c), wrap: true,
      }, scene)
      box.position.set(-(c.x + c.w / 2), -(c.y + c.h / 2), -(c.z + c.d / 2))
      box.isPickable = false
      box.setEnabled(false)
      return box
    })
  }
  return out
}

/* ---------------- species ---------------- */

const WHEAT = () => itemId('wheat')

export const SPECIES = {
  cow: {
    width: 0.9, height: 1.4, health: 10, speed: 0.2, panic: 2.0, tempt: 1.25,
    temptItems: () => [WHEAT()], weight: 8, skin: 'cow',
    sounds: { say: 'cowSay', hurt: 'cowHurt', death: 'cowHurt' }, volume: 0.4,
    loot: MOB_LOOT.cow,
  },
  pig: {
    width: 0.9, height: 0.9, health: 10, speed: 0.25, panic: 1.25, tempt: 1.2,
    // Vanilla tempts pigs with carrots, potatoes and beetroot, none of which
    // exist here yet, so a pig follows nothing.
    temptItems: () => [], weight: 10, skin: 'pig',
    sounds: { say: 'pigSay', hurt: 'pigSay', death: 'pigDeath' }, volume: 1,
    loot: MOB_LOOT.pig,
  },
  sheep: {
    width: 0.9, height: 1.3, health: 8, speed: 0.23, panic: 1.25, tempt: 1.1,
    temptItems: () => [WHEAT()], weight: 12, skin: 'sheep',
    sounds: { say: 'sheepSay', hurt: 'sheepSay', death: 'sheepSay' }, volume: 1,
    loot: MOB_LOOT.sheep,
  },
  chicken: {
    width: 0.4, height: 0.7, health: 4, speed: 0.25, panic: 1.4, tempt: 1.0,
    // Seeds, in vanilla. There are none here.
    temptItems: () => [], weight: 10, skin: 'chicken',
    sounds: { say: 'chickenSay', hurt: 'chickenHurt', death: 'chickenHurt' }, volume: 1,
    loot: MOB_LOOT.chicken,
  },
}

/** Ground speed in blocks per second for a MoveControl speed modifier. */
export const groundSpeed = (attr, mod = 1) => 43.17 * (mod * attr) ** 2

/*
 * Sheep.getRandomSheepColor: 81.836% white, 5% each of black, gray and light
 * gray, 3% brown, 0.164% pink. DyeColor texture diffuse colors for the tint.
 */
const WOOL_ODDS = [['black', 5], ['gray', 5], ['light_gray', 5], ['brown', 3], ['pink', 0.164]]
const WOOL_COLOR = {
  white: [0xf9, 0xff, 0xfe], black: [0x1d, 0x1d, 0x21], gray: [0x47, 0x4f, 0x52],
  light_gray: [0x9d, 0x9d, 0x97], brown: [0x83, 0x54, 0x32], pink: [0xf3, 0x8b, 0xaa],
}
export function randomWool(random = Math.random) {
  let r = random() * 100
  for (const [c, p] of WOOL_ODDS) { if (r < p) return c; r -= p }
  return 'white'
}

/* ---------------- combat ---------------- */

/*
 * Attack damage (the player's base 1 included) and attacks per second, by
 * tool and tier, from the 1.21 item attributes. Anything else hits like a
 * fist: 1 damage, 4 attacks a second.
 */
const WEAPON = {
  sword: { damage: { wood: 4, stone: 5, iron: 6, gold: 4, diamond: 7, netherite: 8 }, speed: () => 1.6 },
  axe: { damage: { wood: 7, stone: 9, iron: 9, gold: 7, diamond: 9, netherite: 10 },
    speed: (t) => ({ wood: 0.8, stone: 0.8, iron: 0.9 }[t] ?? 1.0) },
  pickaxe: { damage: { wood: 2, stone: 3, iron: 4, gold: 2, diamond: 5, netherite: 6 }, speed: () => 1.2 },
  shovel: { damage: { wood: 2.5, stone: 3.5, iron: 4.5, gold: 2.5, diamond: 5.5, netherite: 6.5 }, speed: () => 1.0 },
  hoe: { damage: { wood: 1, stone: 1, iron: 1, gold: 1, diamond: 1, netherite: 1 },
    speed: (t) => ({ wood: 1, stone: 2, iron: 3, gold: 1, diamond: 4, netherite: 4 }[t]) },
}
export function weaponOf(id) {
  const def = id ? item(id) : null
  const w = def?.tool && WEAPON[def.tool]
  if (!w) return { damage: 1, speed: 4 }
  return { damage: w.damage[def.tier] ?? 1, speed: w.speed(def.tier) ?? 4 }
}

/* Entity interaction range, 1.21's attribute: 3 blocks, 5 in creative. */
const REACH = 3
const REACH_CREATIVE = 5
const HURT_TICKS = 10
const DEATH_TICKS = 20
const KNOCKBACK = 0.4 * TPS // blocks/s, from 0.4 blocks/tick

/* ---------------- spawning ---------------- */

const HERD = 4
const CAP = 12
const SPAWN_INTERVAL_TICKS = 400
const MIN_SPAWN_DIST = 12
const MAX_SPAWN_DIST = 56
const FREEZE_DIST = 100

export function installMobs(noa, { ids, inventory, authority, sounds = null, drops = null, survival = null }) {
  const scene = noa.rendering.getScene()
  const mobs = []
  let nextId = 1
  let natural = !navigator.webdriver
  // Vanilla's NoAI tag, world-wide: a spec that aims at a cow needs it to stay.
  let ai = true
  let worldName = noa.worldName
  let spawnClock = 0
  let initialPending = natural ? 60 : -1
  let attackTicks = 100 // ticks since the player last swung, for the cooldown
  const stats = { spawned: 0, killed: 0, attacks: 0 }

  /* ---- skins and templates, built once per species ---- */
  const skins = {}
  const skin = (file) => {
    if (!skins[file]) {
      const tex = new Texture(`/textures/entity/${file}.png`, scene, true, true, Texture.NEAREST_SAMPLINGMODE)
      tex.hasAlpha = true
      skins[file] = tex
    }
    return skins[file]
  }
  /*
   * Wool tints. The fur sheet is drawn in greys and multiplied by the dye
   * color, which is what SheepFurLayer does. Material diffuse is owned by
   * entityLight.js, so the tint is baked into a texture per color instead.
   */
  const woolTex = {}
  let furImage = null
  const furLoad = new Promise((resolve) => {
    const img = new Image()
    img.onload = () => { furImage = img; resolve() }
    img.onerror = () => resolve()
    img.src = '/textures/entity/sheep_fur.png'
  })
  const woolTexture = (color) => {
    if (woolTex[color]) return woolTex[color]
    if (color === 'white' || !furImage) return skin('sheep_fur')
    const c = document.createElement('canvas')
    c.width = furImage.width; c.height = furImage.height
    const g = c.getContext('2d')
    g.drawImage(furImage, 0, 0)
    const data = g.getImageData(0, 0, c.width, c.height)
    const [r, gg, b] = WOOL_COLOR[color]
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = data.data[i] * r / 255
      data.data[i + 1] = data.data[i + 1] * gg / 255
      data.data[i + 2] = data.data[i + 2] * b / 255
    }
    g.putImageData(data, 0, 0)
    const tex = new Texture(c.toDataURL(), scene, true, true, Texture.NEAREST_SAMPLINGMODE)
    tex.hasAlpha = true
    woolTex[color] = tex
    return tex
  }

  const templates = {}
  const templateFor = (name) => {
    if (!templates[name]) templates[name] = buildTemplates(scene, MODELS[name], name)
    return templates[name]
  }

  function buildModel(kind, mob) {
    const root = new TransformNode(`mob-${kind}-${mob.id}`, scene)
    const scaled = new TransformNode(`mob-${kind}-${mob.id}-scale`, scene)
    scaled.parent = root
    scaled.scaling.setAll(SCALE)
    const mats = []
    const layer = (modelName, texture) => {
      const mat = noa.rendering.makeStandardMaterial(`mob-${kind}-${mob.id}-${modelName}`)
      mat.diffuseTexture = texture
      mat.specularColor = new Color3(0, 0, 0)
      mat.backFaceCulling = true
      trackEntityLight(mat, () => noa.ents.getPosition(mob.entity))
      mats.push(mat)
      const parts = {}
      const defs = MODELS[modelName]
      const tpl = templateFor(modelName)
      for (const [part, def] of Object.entries(defs)) {
        const pivot = new TransformNode(`${root.name}-${modelName}-${part}`, scene)
        pivot.parent = scaled
        pivot.position.set(-def.pivot[0], 24 - def.pivot[1], -def.pivot[2])
        pivot.rotation.x = def.rx ?? 0
        for (const t of tpl[part]) {
          const m = t.clone(`${pivot.name}-box`)
          m.parent = pivot
          m.material = mat
          m.setEnabled(true)
          noa.rendering.addMeshToScene(m)
        }
        parts[part] = pivot
      }
      return parts
    }
    const parts = layer(kind, skin(SPECIES[kind].skin))
    let fur = null
    if (kind === 'sheep') fur = layer('sheepFur', woolTexture(mob.wool))
    return { root, parts, fur, mats }
  }

  /* ---- spawning ---- */

  const grassId = ids.grass
  const solid = (x, y, z) => noa.registry.getBlockSolidity(noa.getBlock(x, y, z))
  const isFluid = (x, y, z) => noa.registry.getBlockFluidity?.(noa.getBlock(x, y, z)) ?? false
  const skyLight = (x, y, z) => window.blockLight?.getSkyLight?.(x, y, z) ?? 15

  /** The y to stand at on column (x, z) near `yHint`, or null. */
  function standAt(x, z, yHint, range = 8) {
    for (let y = Math.floor(yHint) + range; y >= Math.floor(yHint) - range; y--) {
      if (solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z)
        && !isFluid(x, y, z) && !isFluid(x, y - 1, z)) return y
    }
    return null
  }

  /* Animal.checkAnimalSpawnRules: grass underneath and raw brightness > 8. */
  const canSpawnAt = (x, y, z) => noa.getBlock(x, y - 1, z) === grassId && skyLight(x, y, z) > 8

  function spawn(kind, x, y, z, opts = {}) {
    const sp = SPECIES[kind]
    if (!sp) return null
    const mob = {
      id: nextId++, kind, health: sp.health, hurtTime: 0, deathTime: 0, invulnerable: 0,
      bodyYaw: opts.yaw ?? Math.random() * Math.PI * 2, headYaw: 0, headPitch: 0,
      limbPos: 0, limbSpeed: 0, last: [x, y, z],
      ambient: -Math.floor(Math.random() * 80), goal: null, panic: 0, look: null,
      wool: kind === 'sheep' ? (opts.wool ?? randomWool()) : null,
      eggTime: kind === 'chicken' ? 6000 + Math.floor(Math.random() * 6000) : 0,
      flap: 0, flapSpeed: 0, fallStart: null, frozen: false,
    }
    mob.entity = noa.entities.add([x, y, z], sp.width, sp.height, null, null, true, true)
    const body = noa.ents.getPhysics(mob.entity).body
    mob.body = body
    const playerMove = noa.ents.getMovement(noa.playerEntity)
    noa.ents.addComponent(mob.entity, noa.ents.names.movement, {
      maxSpeed: groundSpeed(sp.speed),
      moveForce: playerMove.moveForce,
      responsiveness: playerMove.responsiveness,
      standingFriction: playerMove.standingFriction,
      runningFriction: playerMove.runningFriction,
      airMoveMult: playerMove.airMoveMult,
      jumpImpulse: playerMove.jumpImpulse,
      jumpForce: 0, jumpTime: 0, airJumps: 0,
    })
    mob.move = noa.ents.getMovement(mob.entity)
    mob.model = buildModel(kind, mob)
    mobs.push(mob)
    stats.spawned++
    return mob
  }

  function remove(mob) {
    const i = mobs.indexOf(mob)
    if (i >= 0) mobs.splice(i, 1)
    noa.entities.deleteEntity(mob.entity)
    for (const m of mob.model.mats) m.dispose()
    mob.model.root.dispose(false, false)
  }

  function clear() { for (const m of [...mobs]) remove(m) }

  const playerPos = () => noa.ents.getPositionData(noa.playerEntity).position

  /** One herd, around the player, if a spot passes the spawn rules. */
  function trySpawnHerd(random = Math.random) {
    const total = Object.values(SPECIES).reduce((n, s) => n + s.weight, 0)
    let pick = random() * total
    let kind = 'cow'
    for (const [k, s] of Object.entries(SPECIES)) { if (pick < s.weight) { kind = k; break } pick -= s.weight }
    const p = playerPos()
    const a = random() * Math.PI * 2
    const d = MIN_SPAWN_DIST + random() * (MAX_SPAWN_DIST - MIN_SPAWN_DIST)
    const cx = Math.floor(p[0] + Math.sin(a) * d)
    const cz = Math.floor(p[2] + Math.cos(a) * d)
    const cy = standAt(cx, cz, p[1], 24)
    if (cy === null || !canSpawnAt(cx, cy, cz)) return 0
    // SheepColor is chosen once per herd group in vanilla's group data, so a
    // herd of sheep matches. That is the 1.21 SheepGroupData behavior.
    const wool = kind === 'sheep' ? randomWool(random) : null
    let n = 0
    for (let tries = 0; tries < HERD * 3 && n < HERD && mobs.length < CAP; tries++) {
      const x = cx + Math.floor(random() * 7) - 3
      const z = cz + Math.floor(random() * 7) - 3
      const y = standAt(x, z, cy, 3)
      if (y === null || !canSpawnAt(x, y, z)) continue
      spawn(kind, x + 0.5, y, z + 0.5, { wool })
      n++
    }
    return n
  }

  /* ---- AI ---- */

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  const approach = (from, to, max) => {
    const d = wrap(to - from)
    return from + Math.max(-max, Math.min(max, d))
  }
  const holdingTempt = (sp) => {
    const s = inventory.selectedStack?.()
    return !!s && sp.temptItems().includes(s.id)
  }

  /** RandomStrollGoal's target: the best of 10 random spots, grass preferred. */
  function strollTarget(mob, here, range = 10, vertical = 7) {
    let best = null, bestScore = -Infinity
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(here[0] + (Math.random() * 2 - 1) * range)
      const z = Math.floor(here[2] + (Math.random() * 2 - 1) * range)
      const y = standAt(x, z, here[1], vertical)
      if (y === null) continue
      // Animal.getWalkTargetValue: 10 on grass, else brightness - 0.5.
      const score = noa.getBlock(x, y - 1, z) === grassId ? 10 : skyLight(x, y, z) / 15 - 0.5
      if (score > bestScore) { bestScore = score; best = [x + 0.5, y, z + 0.5] }
    }
    return best
  }

  /* Would one more step toward `heading` walk off a drop deeper than 3, or into fluid? */
  function unsafeAhead(here, heading) {
    const ax = Math.floor(here[0] + Math.sin(heading) * 0.8)
    const az = Math.floor(here[2] + Math.cos(heading) * 0.8)
    const fy = Math.floor(here[1] + 0.1)
    if (isFluid(ax, fy, az) || isFluid(ax, fy - 1, az)) return true
    for (let k = 1; k <= 4; k++) if (solid(ax, fy - k, az)) return false
    return true
  }
  function hopAhead(here, heading) {
    const ax = Math.floor(here[0] + Math.sin(heading) * 0.8)
    const az = Math.floor(here[2] + Math.cos(heading) * 0.8)
    const fy = Math.floor(here[1] + 0.1)
    return solid(ax, fy, az) && !solid(ax, fy + 1, az) && !solid(ax, fy + 2, az)
  }

  function think(mob, sp, here, secs) {
    const ticks = secs * TPS
    const p = playerPos()
    const dPlayer = Math.hypot(p[0] - here[0], p[2] - here[2])
    const grounded = mob.body.atRestY() < 0

    let speedMod = 1
    // PanicGoal outranks everything: 100 ticks after a hit.
    if (mob.panic > 0) {
      mob.panic -= ticks
      speedMod = sp.panic
      if (!mob.goal || mob.goal.kind !== 'panic') {
        const t = strollTarget(mob, here, 5, 4)
        mob.goal = t ? { kind: 'panic', at: t, stalled: 0, best: Infinity } : null
      }
    } else if (holdingTempt(sp) && dPlayer < 10) {
      // TemptGoal: follow the player, stop 2.5 blocks short.
      speedMod = sp.tempt
      mob.goal = dPlayer > 2.5 ? { kind: 'tempt', at: [p[0], p[1], p[2]], stalled: 0, best: Infinity } : null
      mob.look = { at: () => [p[0], p[1] + 1.62, p[2]], ticks: 2 }
    } else if (mob.goal?.kind === 'tempt' || mob.goal?.kind === 'panic') {
      mob.goal = null
    } else if (!mob.goal && Math.random() < ticks / 120) {
      const t = strollTarget(mob, here)
      if (t) mob.goal = { kind: 'stroll', at: t, stalled: 0, best: Infinity }
    }

    // Looking: at the player within 6 blocks, or around at random.
    if (mob.look) {
      mob.look.ticks -= ticks
      if (mob.look.ticks <= 0) mob.look = null
    } else if (dPlayer < 6 && Math.random() < 0.02 * ticks) {
      mob.look = { at: () => { const q = playerPos(); return [q[0], q[1] + 1.62, q[2]] }, ticks: 40 + Math.random() * 40 }
    } else if (Math.random() < 0.02 * ticks) {
      const a = Math.random() * Math.PI * 2
      mob.look = { at: () => [here[0] + Math.sin(a) * 4, here[1] + sp.height * 0.85, here[2] + Math.cos(a) * 4], ticks: 20 + Math.random() * 20 }
    }

    const move = mob.move
    if (!mob.goal) { move.running = false; move.jumping = false; return }
    const dx = mob.goal.at[0] - here[0]
    const dz = mob.goal.at[2] - here[2]
    const dist = Math.hypot(dx, dz)
    if (dist < 0.6) {
      // Arrived. A panicking mob picks its next spot on the next tick.
      mob.goal = null
      move.running = false
      return
    }
    const heading = Math.atan2(dx, dz)
    if (grounded && unsafeAhead(here, heading)) {
      mob.goal = null
      move.running = false
      return
    }
    move.heading = heading
    move.maxSpeed = groundSpeed(sp.speed, speedMod)
    move.running = true
    move.jumping = grounded && hopAhead(here, heading)
    if (dist < mob.goal.best - 0.05) { mob.goal.best = dist; mob.goal.stalled = 0 } else mob.goal.stalled += secs
    if (mob.goal.stalled > 3) { mob.goal = null; move.running = false }
  }

  /* ---- damage ---- */

  function hurt(mob, amount, from = null) {
    if (mob.health <= 0 || mob.invulnerable > 0) return false
    mob.health -= amount
    mob.hurtTime = HURT_TICKS
    mob.invulnerable = HURT_TICKS
    mob.panic = 100
    mob.goal = null
    const sp = SPECIES[mob.kind]
    const at = noa.ents.getPosition(mob.entity)
    if (from) {
      // LivingEntity.knockback(0.4, ...): halve the velocity, push away, hop.
      const dx = at[0] - from[0], dz = at[2] - from[2]
      const len = Math.hypot(dx, dz) || 1
      const v = mob.body.velocity
      v[0] = v[0] / 2 + (dx / len) * KNOCKBACK
      v[2] = v[2] / 2 + (dz / len) * KNOCKBACK
      // 0.4 up against the player's 0.42 jump, minus the apex the player's
      // calibrated jump gains over vanilla's (1.25 blocks for 1.25): a hop
      // of about 0.9 blocks, which is what 0.4 a tick buys a mob.
      const hop = (mob.move.jumpImpulse / mob.body.mass) * 0.85
      v[1] = Math.min(hop, v[1] / 2 + hop)
      // Off the ground NOW: a body noa still thinks is resting gets its
      // standing friction this step. And awake: a resting body is put to
      // sleep by the physics engine, and a sleeping one ignores its velocity
      // until a force or impulse wakes it.
      mob.body.resting[1] = 0
      mob.body.applyImpulse([0, 0, 0])
    }
    if (mob.health <= 0) die(mob)
    else play(sp.sounds.hurt, sp, at)
    return true
  }

  function die(mob) {
    const sp = SPECIES[mob.kind]
    const at = noa.ents.getPosition(mob.entity)
    mob.health = 0
    mob.deathTime = 0
    mob.move.running = false
    play(sp.sounds.death, sp, at)
    stats.killed++
    // Loot drops at death, as LivingEntity.die does; the body lingers 20 ticks.
    if (drops) {
      for (const [key, min, max] of sp.loot(mob)) {
        const n = min + Math.floor(Math.random() * (max - min + 1))
        const id = itemId(key)
        if (n > 0 && id) drops.spawn(id, n, [at[0], at[1] + 0.5, at[2]], [(Math.random() - 0.5) * 2, 4, (Math.random() - 0.5) * 2])
      }
    }
  }

  function play(event, sp, at) {
    if (!sounds?.play) return
    sounds.play(event, null, [at[0], at[1] + sp.height * 0.8, at[2]])
  }

  /* ---- the player's attack ---- */

  /** The mob under the crosshair within reach, nearer than any block, or null. */
  function targeted() {
    const p = playerPos()
    const follow = noa.ents.getState(noa.camera.cameraTarget, 'followsEntity')
    const eye = [p[0], p[1] + (follow?.offset?.[1] ?? 1.62), p[2]]
    const h = noa.camera.heading, pt = noa.camera.pitch
    const dir = [Math.sin(h) * Math.cos(pt), -Math.sin(pt), Math.cos(h) * Math.cos(pt)]
    const reach = authority.caps().instantBreak ? REACH_CREATIVE : REACH
    let best = null, bestT = reach
    // A block in the way stops the swing: vanilla picks the nearer hit.
    const blk = noa.targetedBlock
    if (blk) {
      const [bx, by, bz] = blk.position
      const t = rayBox(eye, dir, [bx, by, bz], [bx + 1, by + 1, bz + 1])
      if (t !== null && t < bestT) bestT = t
    }
    for (const mob of mobs) {
      if (mob.health <= 0) continue
      const sp = SPECIES[mob.kind]
      const at = noa.ents.getPosition(mob.entity)
      const w = sp.width / 2
      const t = rayBox(eye, dir, [at[0] - w, at[1], at[2] - w], [at[0] + w, at[1] + sp.height, at[2] + w])
      if (t !== null && t < bestT) { bestT = t; best = mob }
    }
    return best
  }

  function attack() {
    const mob = targeted()
    if (!mob) return false
    const held = inventory.selectedStack?.()
    const w = weaponOf(held?.id)
    // The 1.9 cooldown: damage scales with 0.2 + 0.8 * charge^2.
    const cooldown = TPS / w.speed
    const charge = Math.min(1, (attackTicks + 0.5) / cooldown)
    let dmg = w.damage * (0.2 + charge * charge * 0.8)
    // A falling full-strength hit is a critical, x1.5.
    const body = noa.ents.getPhysics(noa.playerEntity).body
    if (charge > 0.9 && body.velocity[1] < 0 && body.atRestY() >= 0) dmg *= 1.5
    attackTicks = 0
    stats.attacks++
    hurt(mob, dmg, playerPos())
    return true
  }

  noa.inputs.down.on('fire', () => {
    if (survival?.dead) return
    attack()
  })

  /* ---- tick ---- */

  noa.on('tick', (dtMs) => {
    const secs = dtMs / 1000
    const ticks = secs * TPS
    attackTicks += ticks

    if (noa.worldName !== worldName) {
      worldName = noa.worldName
      clear()
      initialPending = natural ? 60 : -1
    }
    if (initialPending > 0) {
      initialPending -= ticks
      if (initialPending <= 0) for (let i = 0; i < 8 && mobs.length < CAP; i++) trySpawnHerd()
    } else if (natural) {
      spawnClock += ticks
      if (spawnClock >= SPAWN_INTERVAL_TICKS) {
        spawnClock = 0
        if (mobs.length < CAP) trySpawnHerd()
      }
    }

    const p = playerPos()
    for (const mob of [...mobs]) {
      const sp = SPECIES[mob.kind]
      const here = noa.ents.getPosition(mob.entity)

      // Out of the loaded area: hold still rather than fall through the
      // unloaded chunk underneath.
      const far = Math.hypot(here[0] - p[0], here[2] - p[2]) > FREEZE_DIST
      if (far !== mob.frozen) {
        mob.frozen = far
        mob.body.gravityMultiplier = far ? 0 : 1
        mob.body.velocity[0] = mob.body.velocity[1] = mob.body.velocity[2] = 0
      }
      if (far) { mob.move.running = false; continue }

      if (here[1] < -70) { remove(mob); continue }

      if (mob.invulnerable > 0) mob.invulnerable -= ticks
      if (mob.hurtTime > 0) mob.hurtTime = Math.max(0, mob.hurtTime - ticks)

      if (mob.health <= 0) {
        mob.deathTime += ticks
        if (mob.deathTime >= DEATH_TICKS) remove(mob)
        continue
      }

      if (ai) think(mob, sp, here, secs)
      else { mob.move.running = false; mob.move.jumping = false }

      // Fall damage, vanilla's: floor(distance - 3). Chickens flap and take none.
      const grounded = mob.body.atRestY() < 0
      // Airborne after a hit, vanilla's air drag: 0.91 of the horizontal
      // speed survives each tick. noa's bodies keep it all, which sent a
      // punched cow four blocks instead of about two and a half.
      if (!grounded && mob.hurtTime > 0) {
        const k = 0.91 ** ticks
        mob.body.velocity[0] *= k
        mob.body.velocity[2] *= k
      }
      if (!grounded) {
        if (mob.fallStart === null || here[1] > mob.fallStart) mob.fallStart = here[1]
      } else if (mob.fallStart !== null) {
        const dist = mob.fallStart - here[1]
        mob.fallStart = null
        if (mob.kind !== 'chicken' && dist > 3) hurt(mob, Math.floor(dist - 3))
      }
      // Chicken.aiStep: a falling chicken's descent is slowed to a flutter.
      if (mob.kind === 'chicken') {
        if (!grounded && mob.body.velocity[1] < -2.3) mob.body.velocity[1] = -2.3
        mob.flapSpeed = Math.max(0, Math.min(1, mob.flapSpeed + (grounded ? -1 : 4) * 0.3 * ticks / 4))
        mob.flap += mob.flapSpeed * ticks
        mob.eggTime -= ticks
        if (mob.eggTime <= 0) {
          mob.eggTime = 6000 + Math.floor(Math.random() * 6000)
          if (drops) drops.spawn(itemId('egg'), 1, [here[0], here[1] + 0.3, here[2]], [0, 0, 0])
          play('chickenPlop', sp, here)
        }
      }

      // Mob.baseTick's ambient sound clock.
      mob.ambient += ticks
      if (Math.random() * 1000 < mob.ambient * ticks) {
        mob.ambient = -80
        play(sp.sounds.say, sp, here)
      }

      // Bodies push apart (Entity.push), the player and the mob both.
      const w = (sp.width + MC.PLAYER_WIDTH) / 2
      const ox = here[0] - p[0], oz = here[2] - p[2]
      if (Math.abs(ox) < w && Math.abs(oz) < w && Math.abs(here[1] - p[1]) < 1.8) {
        const d = Math.hypot(ox, oz) || 0.01
        const push = 0.05 * TPS * secs * 4
        mob.body.applyImpulse([(ox / d) * push * mob.body.mass, 0, (oz / d) * push * mob.body.mass])
      }

      // Walk animation: LivingEntity.calculateEntityAnimation.
      const moved = Math.hypot(here[0] - mob.last[0], here[2] - mob.last[2]) / Math.max(ticks, 1e-3)
      mob.last[0] = here[0]; mob.last[1] = here[1]; mob.last[2] = here[2]
      const target = Math.min(1, moved * 4)
      mob.limbSpeed += (target - mob.limbSpeed) * Math.min(1, 0.4 * ticks)
      mob.limbPos += mob.limbSpeed * ticks

      // Body turns toward where it is going, at MoveControl's pace.
      if (mob.move.running) mob.bodyYaw = approach(mob.bodyYaw, mob.move.heading, (30 * Math.PI / 180) * ticks)
    }
  })

  /* ---- render ---- */

  /*
   * After sky.js's tick has set every entity material's light, so the hurt
   * tint here is applied on top of it once a tick and holds between ticks.
   */
  noa.on('tick', () => {
    for (const mob of mobs) {
      const red = mob.hurtTime > 0 || mob.health <= 0
      for (const mat of mob.model.mats) {
        if (!red) continue
        // OverlayTexture's red: the hit flash, about 30% red.
        mat.diffuseColor.g *= 0.6; mat.diffuseColor.b *= 0.6
        mat.emissiveColor.r = Math.min(1, mat.emissiveColor.r + 0.3)
      }
    }
  })

  noa.on('beforeRender', () => {
    for (const mob of mobs) {
      const rpos = noa.ents.getPositionData(mob.entity)._renderPosition
      const { root, parts, fur } = mob.model
      root.position.set(rpos[0], rpos[1], rpos[2])
      // Head: look at whatever it is looking at, within vanilla's limits.
      if (mob.look) {
        const at = noa.ents.getPosition(mob.entity)
        const [tx, ty, tz] = mob.look.at()
        const sp = SPECIES[mob.kind]
        const yaw = Math.atan2(tx - at[0], tz - at[2])
        const pitch = -Math.atan2(ty - (at[1] + sp.height * 0.85), Math.hypot(tx - at[0], tz - at[2]))
        mob.headYaw = Math.max(-1.3, Math.min(1.3, wrap(yaw - mob.bodyYaw)))
        mob.headPitch = Math.max(-0.7, Math.min(0.7, pitch))
      } else {
        mob.headYaw *= 0.8
        mob.headPitch *= 0.8
      }
      root.rotation.y = mob.bodyYaw
      // The death roll: 90 degrees onto the side over the first ~13 ticks.
      root.rotation.z = mob.health <= 0
        ? Math.min(1, Math.sqrt(Math.max(0, (mob.deathTime - 1) / DEATH_TICKS * 1.6))) * HALF_PI
        : 0
      const swing = (phase) => Math.cos(mob.limbPos * 0.6662 + phase) * 1.4 * mob.limbSpeed
      for (const layer of fur ? [parts, fur] : [parts]) {
        // In this frame a positive x rotation pitches the head DOWN, as in
        // vanilla's model space, and yaw turns it with the body.
        layer.head.rotation.x = -mob.headPitch
        layer.head.rotation.y = mob.headYaw
        if (mob.kind === 'chicken') {
          layer.rightLeg.rotation.x = swing(0)
          layer.leftLeg.rotation.x = swing(Math.PI)
          const f = (Math.sin(mob.flap) + 1) * mob.flapSpeed
          layer.rightWing.rotation.z = f
          layer.leftWing.rotation.z = -f
        } else {
          layer.rightHindLeg.rotation.x = swing(0)
          layer.leftHindLeg.rotation.x = swing(Math.PI)
          layer.rightFrontLeg.rotation.x = swing(Math.PI)
          layer.leftFrontLeg.rotation.x = swing(0)
        }
      }
    }
  })

  return {
    get list() { return mobs },
    get count() { return mobs.length },
    stats,
    SPECIES,
    /** /summon's backend, and the specs'. */
    summon: (kind, x, y, z, opts) => spawn(kind, x, y, z, opts),
    remove,
    clear,
    hurt,
    attack,
    targeted,
    trySpawnHerd,
    canSpawnAt,
    /** Set a mob walking to `at`, as RandomStrollGoal would. For specs. */
    walkTo(mob, at) { mob.goal = { kind: 'stroll', at: [...at], stalled: 0, best: Infinity } },
    /** Pick a stroll target the way the goal does, and start walking. */
    stroll(mob) {
      const t = strollTarget(mob, noa.ents.getPosition(mob.entity))
      if (t) mob.goal = { kind: 'stroll', at: t, stalled: 0, best: Infinity }
      return t
    },
    get natural() { return natural },
    /** NoAI for every mob, for specs that need a mob to stay where it is. */
    setAI(on) { ai = !!on },
    /** Natural spawning on or off. Off under automation by default. */
    setNatural(on) { natural = !!on; if (natural && initialPending < 0) initialPending = 1 },
    ready: () => furLoad,
  }
}

/* Slab-method ray/box intersection: the entry distance along a unit ray, or null. */
function rayBox(o, d, min, max) {
  let t0 = 0, t1 = Infinity
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min[a] || o[a] > max[a]) return null
      continue
    }
    let ta = (min[a] - o[a]) / d[a]
    let tb = (max[a] - o[a]) / d[a]
    if (ta > tb) [ta, tb] = [tb, ta]
    t0 = Math.max(t0, ta)
    t1 = Math.min(t1, tb)
    if (t0 > t1) return null
  }
  return t0
}
