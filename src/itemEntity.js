import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
/*
 * Thin instances are a Babylon prototype EXTENSION, not part of Mesh. Import
 * the module for its side effect or `mesh.thinInstanceSetBuffer` is undefined
 * at runtime -- with a stack trace that points at our call, not at the missing
 * import. noa pulls in Mesh but never this.
 */
import '@babylonjs/core/Meshes/thinInstanceMesh.js'

import { BLOCK_BY_ID } from './blocks.js'
import { createHeldBlockMesh, blockTextureUrl } from './heldItem.js'
import { item, isBlockItem, stackMax, dropFor } from './items.js'

/*
 * Dropped item entities: the little spinning cube a broken block leaves behind.
 *
 * Before this, mining teleported the block into your inventory. That is the
 * single most conspicuous way this world did not feel like Minecraft -- in
 * Minecraft a break produces an OBJECT, which falls, settles, lies on the
 * ground for five minutes, and is collected by walking over it. The gap
 * between "the block vanished and the number went up" and "the block fell out
 * and I went to get it" is most of what mining feels like.
 *
 * WHERE A DROP COMES FROM. authority.js's `requestBlockChange` is the one
 * function through which any block ever changes, and it already carries a
 * `cause` of 'break' or 'place'. So the spawn hangs off THAT -- the decoration
 * is under "THE break seam" below -- rather than off interact.js's handler.
 * Rejected: calling spawn() from interact.js, which is where the break is
 * noticed today. It works, and it is wrong the day a second thing breaks a
 * block -- an explosion, a server telling us a neighbour mined something --
 * because each of those would have to remember to drop too. The authority is
 * the seam precisely because it cannot be gone around.
 *
 * HOW THEY ARE SIMULATED, and what was rejected. These are NOT noa entities.
 * noa will happily give each drop an ECS entity with a real swept-AABB body,
 * and for a handful that is the better answer -- it is the same solver the
 * player uses. It was rejected for two reasons: a noa body per drop also wants
 * a mesh component per drop, which is one draw call each and defeats the
 * instancing below; and Minecraft's ItemEntity does not use the player's
 * physics anyway. Its tick is eight lines (gravity 0.04, drag 0.98, ground
 * friction 0.6) and reproducing those eight lines exactly is both cheaper and
 * MORE faithful than handing the problem to a solver tuned for a 0.6x1.8
 * player box. Fifty drops cost one pass over a flat
 * array and a few getBlock calls each.
 *
 * HOW THEY ARE DRAWN. One Babylon mesh per item type, thin-instanced: a
 * Float32Array of 4x4 matrices rewritten each frame, one draw call per type no
 * matter how many drops. particles.js rejected thin instances for its chips
 * and that reasoning does not carry over -- a particle needs its own random
 * texture crop, so it must own its vertex buffer, while every cobblestone drop
 * is the same cube and only its transform differs. Which is exactly the case
 * thin instances exist for.
 *
 * The block cube itself is heldItem.js's, reused rather than rebuilt: it
 * already maps the pre-baked [side | top | bottom] atlas onto Babylon's six
 * faces, and a dropped grass block showing dirt on its sides is the same fact
 * as a held one doing it.
 *
 * SUBTLE, and it is the trap that catches everything drawn in this engine:
 * noa rebases the world origin as you travel, so instance matrices hold WORLD
 * coordinates and the base mesh is offset by `globalToLocal` once per frame.
 * Writing world coordinates and never offsetting looks perfect near spawn and
 * drifts the further you walk. The other trap is one line further down --
 * a mesh not registered with `noa.rendering.addMeshToScene()` is silently
 * never drawn, because noa renders from its own selection octree.
 */

/* ------------------------------------------------------------------ *
 * Minecraft's ItemEntity, in its own numbers.
 *
 * Vanilla runs at 20 ticks/sec and this engine at 30, so everything below is
 * converted to per-second at the point of definition rather than in the
 * integrator -- a per-tick constant used at 30 Hz is a 1.5x error that looks
 * like "items feel floaty" instead of like a bug.
 * ------------------------------------------------------------------ */

const TPS = 20

/** ItemEntity gravity: 0.04 blocks/tick^2. */
const GRAVITY = 0.04 * TPS * TPS

/** Air drag, per tick, applied on all three axes. */
const DRAG_PER_TICK = 0.98

/**
 * Ground friction. Vanilla multiplies the drag by the friction of the block
 * BELOW (0.6 for almost everything, 0.98 on ice), so a drop slides to a stop
 * rather than stopping dead. Every block in this palette is ordinary ground.
 */
const GROUND_FRICTION = 0.6

/** EntityType.ITEM's bounding box, and the render scale of the cube. */
const SIZE = 0.25

/** ItemEntity.setDefaultPickUpDelay(): 10 ticks before a drop can be taken. */
const PICKUP_DELAY = 10 / TPS

/** Player.drop(): 40 ticks, so a thrown item does not bounce straight back. */
const THROW_DELAY = 40 / TPS

/** 6000 ticks. The five minutes every Minecraft player has raced. */
export const DESPAWN_SECONDS = 6000 / TPS

/** ItemEntity's spawn kick: +-0.1 horizontally, 0.2 up, per tick. */
const SPAWN_SPREAD = 0.1 * TPS
const SPAWN_LIFT = 0.2 * TPS

/** Player.drop()'s throw: 0.3 forward, +0.1 up, per tick. */
const THROW_SPEED = 0.3 * TPS
const THROW_LIFT = 0.1 * TPS
const THROW_SPREAD = 0.02 * TPS

/**
 * Pickup reach. Vanilla inflates the player's own box by (1, 0.5, 1) and
 * collects anything touching it -- so this is genuinely "walk over it", not a
 * radius around the eyes.
 */
const REACH = [1, 0.5, 1]

/** Vanilla merges drops whose boxes are within half a block. */
const MERGE_RADIUS = 0.5

/**
 * The fly-toward-you animation, in seconds.
 *
 * Vanilla removes the entity the instant it is collected and the CLIENT keeps
 * drawing it for a few ticks, sliding it into the player. Same idea here, one
 * object: the stack lands in the inventory immediately (so the hotbar count
 * and the sound are in the same frame as the pickup, which is what vanilla
 * looks like) and the record lingers, uncollidable, purely to be drawn.
 */
const COLLECT_TIME = 0.2

/**
 * A sanity cap, not a Minecraft rule -- vanilla has no limit.
 *
 * Fifty is the stated performance target and this is five times that. Past it
 * the OLDEST drop is dropped rather than the newest refused, so a player
 * frantically emptying their inventory always sees the thing they just threw.
 */
const MAX_DROPS = 256

const rand = (a, b) => a + Math.random() * (b - a)

export function installItemEntities(noa, deps = {}) {
  const { inventory, authority, sounds, inputLock } = deps
  const scene = noa.rendering.getScene()

  /*
   * Every live drop, in one flat array. Order matters here in a way it does
   * not for particles: MAX_DROPS evicts the oldest, so removal is a splice
   * rather than the swap-with-last particles.js uses. At these counts the
   * memmove is nothing and keeping the array in spawn order is worth more.
   */
  const drops = []

  /* ------------------------------------------------------------------ *
   * Rendering: one thin-instanced mesh per item type
   * ------------------------------------------------------------------ */

  const systems = new Map()

  function systemFor(id) {
    let sys = systems.get(id)
    if (sys) return sys

    const def = item(id)
    if (!def) return null

    let mesh
    if (isBlockItem(id)) {
      const block = BLOCK_BY_ID.get(def.places)
      if (!block) return null
      mesh = createHeldBlockMesh(noa, `drop-${def.key}`)
      mesh.material.diffuseTexture = textureFor(blockTextureUrl(block))
    } else {
      /*
       * A non-block item is a flat sprite in Minecraft too -- the ground
       * display transform of an `item/generated` model is a quad, extruded a
       * pixel deep. The extrusion is dropped here: at 0.25 scale, from player
       * height, a double-sided plane and a 1/16-thick slab are the same
       * handful of pixels, and the plane is a quarter of the geometry.
       */
      mesh = CreatePlane(`drop-${def.key}`, { size: 1, sideOrientation: 2 }, scene)
      mesh.material = noa.rendering.makeStandardMaterial(`drop-${def.key}-mat`)
      const tex = textureFor(`/textures/item/${def.texture}.png`)
      tex.hasAlpha = true
      mesh.material.diffuseTexture = tex
      // Item sprites are cut-outs. Without this the transparent margin renders
      // as an opaque black square, which is unmistakable and was.
      mesh.material.useAlphaFromDiffuseTexture = true
      mesh.material.backFaceCulling = false
      mesh.isPickable = false
      // See the file header: noa renders from its own octree, and a mesh it
      // has never been handed does not exist as far as that octree is concerned.
      noa.rendering.addMeshToScene(mesh)
    }

    mesh.material.specularColor = new Color3(0, 0, 0)
    /*
     * The instance matrices carry world coordinates, so the base mesh's own
     * bounding box says nothing about where the drops are. Skip the octree's
     * culling test rather than recompute the bounds every frame.
     */
    mesh.alwaysSelectAsActiveMesh = true
    mesh.setEnabled(false)

    sys = { mesh, matrices: new Float32Array(0), capacity: 0, n: 0, drawn: 0 }
    systems.set(id, sys)
    return sys
  }

  const textures = new Map()
  function textureFor(path) {
    if (!textures.has(path)) {
      // NEAREST, like every other texture here: a 16x16 sprite filtered
      // bilinearly is a smudge.
      textures.set(path, new Texture(path, scene, true, false, Texture.NEAREST_SAMPLINGMODE))
    }
    return textures.get(path)
  }

  /** Grow a system's matrix buffer. Doubling, so a busy floor reallocates
   *  a handful of times ever rather than once per new drop. */
  function reserve(sys, need) {
    if (need <= sys.capacity) return
    let cap = Math.max(8, sys.capacity)
    while (cap < need) cap *= 2
    sys.matrices = new Float32Array(cap * 16)
    sys.capacity = cap
    // A new backing array means a new GPU buffer, so this is a set, not an
    // update. `false` marks it dynamic -- a static buffer would be uploaded
    // once and every later frame silently ignored.
    sys.mesh.thinInstanceSetBuffer('matrix', sys.matrices, 16, false)
  }

  const ORIGIN = [0, 0, 0]
  const originLocal = [0, 0, 0]

  noa.on('beforeRender', () => {
    for (const sys of systems.values()) sys.n = 0
    if (!drops.length && !systems.size) return

    // Where world (0,0,0) sits in Babylon's rebased frame, read once.
    noa.globalToLocal(ORIGIN, null, originLocal)

    for (const d of drops) {
      const sys = systemFor(d.id)
      if (!sys) continue
      reserve(sys, sys.n + 1)

      /*
       * Vanilla's ItemEntityRenderer, verbatim:
       *   bob   = sin(age/10 + bobOffs) * 0.1 + 0.1
       *   spin  = (age/20 + bobOffs) radians
       * with age in ticks, which is a full turn every 6.3 seconds and a bob
       * that never quite touches the floor. Both are offset per drop by
       * bobOffs, which is why a pile of items is not a chorus line.
       */
      const ticks = d.age * TPS
      const bob = Math.sin(ticks / 10 + d.bobOffs) * 0.1 + 0.1
      const spin = ticks / 20 + d.bobOffs

      // The collect animation: slide into the player and shrink out of sight.
      let s = SIZE
      let x = d.x, y = d.y + bob, z = d.z
      if (d.collecting > 0) {
        const t = Math.min(1, d.collecting / COLLECT_TIME)
        const p = noa.ents.getPositionData(noa.playerEntity).position
        x += (p[0] - x) * t
        y += (p[1] + 0.6 - y) * t
        z += (p[2] - z) * t
        s *= 1 - t
      }

      const c = Math.cos(spin) * s, sn = Math.sin(spin) * s
      const o = sys.n++ * 16
      const m = sys.matrices
      m[o] = c; m[o + 1] = 0; m[o + 2] = -sn; m[o + 3] = 0
      m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0
      m[o + 8] = sn; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = 0
      m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1
    }

    for (const sys of systems.values()) {
      if (!sys.n) {
        sys.mesh.setEnabled(false)
        sys.drawn = 0
        continue
      }
      sys.mesh.position.set(originLocal[0], originLocal[1], originLocal[2])
      sys.mesh.thinInstanceCount = sys.n
      sys.mesh.thinInstanceBufferUpdated('matrix')
      sys.mesh.setEnabled(true)
      sys.drawn = sys.n
    }
  })

  /* ------------------------------------------------------------------ *
   * Spawning
   * ------------------------------------------------------------------ */

  /**
   * Put an item in the world.
   * @param {number} id item id
   * @param {number} count
   * @param {number[]} at world position of the drop's CENTRE
   * @param {number[]} vel blocks/second
   * @param {number} delay seconds before it can be picked up
   */
  function spawn(id, count, at, vel = [0, 0, 0], delay = PICKUP_DELAY) {
    if (!count || !item(id)) return null
    if (drops.length >= MAX_DROPS) drops.shift()
    const d = {
      id, count,
      x: at[0], y: at[1], z: at[2],
      vx: vel[0], vy: vel[1], vz: vel[2],
      age: 0,
      delay,
      onGround: false,
      collecting: 0,
      // Vanilla's `bobOffs = random * PI * 2`, which desynchronises the bob
      // AND the spin, since the renderer adds it to both.
      bobOffs: rand(0, Math.PI * 2),
    }
    drops.push(d)
    return d
  }

  /**
   * What a broken block leaves behind. Vanilla's Block.popResource: the drop
   * appears at a random point inside the block, not at its centre, with a
   * small upward kick.
   */
  function popResource(id, count, [bx, by, bz]) {
    return spawn(id, count,
      [bx + rand(0.25, 0.75), by + rand(0.25, 0.75), bz + rand(0.25, 0.75)],
      [rand(-SPAWN_SPREAD, SPAWN_SPREAD), SPAWN_LIFT, rand(-SPAWN_SPREAD, SPAWN_SPREAD)])
  }

  /**
   * THE break seam. Decorates authority.requestBlockChange so that any granted
   * break drops its block, wherever the break came from.
   *
   * The tool is read out of the hotbar HERE rather than carried in the
   * request. Vanilla passes the tool down to playerDestroy explicitly, and the
   * day a server confirms someone else's break that is what this will have to
   * do too -- but today there is exactly one miner and the break resolves at
   * most a microtask after they swung, so the held stack is still the stack
   * that did it. The alternative (threading a tool id through a request object
   * the authority does not read) buys a field nothing consumes yet.
   */
  const inner = authority.requestBlockChange.bind(authority)
  authority.requestBlockChange = async (req) => {
    /*
     * Read the block BEFORE the change is applied: the request carries the id
     * being written (0, for a break), never the one being replaced, and by the
     * time the promise resolves the world says air.
     */
    const [x, y, z] = req.position
    const was = req.cause === 'break' ? noa.getBlock(x, y, z) : 0

    const res = await inner(req)
    if (!res.ok || req.cause !== 'break' || !was) return res

    // Creative's Abilities.instabuild, the same rule that stops a place from
    // consuming the stack: you already have every block, so nothing drops.
    if (authority.caps().infiniteResources) return res

    const held = inventory.selectedStack()
    const drop = dropFor(was, held ? held.id : 0)
    // 0 means the tier was too low. Vanilla drops NOTHING for stone punched by
    // hand or diamond ore hit with a wooden pickaxe, and that is a rule, not a
    // failure -- the block is still gone.
    if (drop) popResource(drop, 1, [x, y, z])
    return res
  }

  /* ------------------------------------------------------------------ *
   * Throwing: Q and Ctrl+Q
   * ------------------------------------------------------------------ */

  /**
   * Throw the held item. Vanilla's Player.drop: forward at 0.3/tick with a
   * slight lift and a random scatter, from just below eye level.
   * @param {boolean} all Ctrl+Q's whole stack rather than Q's single item
   */
  function dropHeld(all = false) {
    /*
     * The one mode that cannot throw anything is spectator, and `visible` is
     * what identifies it: a spectator is not IN the world, which is exactly
     * why putting an object into it makes no sense. Deliberately NOT the
     * mayBuild/mayBreak pair it looks like it should be -- vanilla lets
     * adventure mode drop items, and adventure is this world's default, so
     * gating on building would take Q away from every visitor. There is no
     * mayDrop capability to read because nothing has ever needed one.
     */
    if (!authority.caps().visible) return null
    const stack = inventory.takeSelected(all)
    if (!stack) return null

    const p = noa.ents.getPositionData(noa.playerEntity)
    const [px, py, pz] = p.position
    const heading = noa.camera.heading
    const pitch = noa.camera.pitch

    // noa's heading gives forward = (sin h, cos h) and its pitch is positive
    // looking DOWN, which is why the y term is negated where vanilla's is not.
    const cp = Math.cos(pitch)
    const fx = Math.sin(heading) * cp
    const fz = Math.cos(heading) * cp

    return spawn(stack.id, stack.count,
      // Vanilla throws from eyeY - 0.3. Minecraft's eye is at 1.62.
      [px, py + 1.62 - 0.3, pz],
      [
        fx * THROW_SPEED + rand(-THROW_SPREAD, THROW_SPREAD),
        -Math.sin(pitch) * THROW_SPEED + THROW_LIFT + rand(-THROW_SPREAD, THROW_SPREAD),
        fz * THROW_SPEED + rand(-THROW_SPREAD, THROW_SPREAD),
      ],
      THROW_DELAY)
  }

  /*
   * Q is a document listener rather than a noa binding for one reason: the
   * whole-stack variant is Ctrl+Q, and noa's input system reports which ACTION
   * fired, not which modifiers were down when it did. Same shape as
   * installHotbarControls, including the inputLock guard -- without it, typing
   * "q" into the chat box throws your pickaxe on the floor.
   */
  const onKey = (e) => {
    if (e.code !== 'KeyQ' || e.repeat) return
    if (inputLock?.locked || inventory.open) return
    dropHeld(e.ctrlKey || e.metaKey)
  }
  document.addEventListener('keydown', onKey)

  /*
   * Closing a crafting screen with items still in the grid now throws them on
   * the floor, which is what vanilla does. inventory.js used to hand them back
   * to the inventory and say in a comment that it was a stand-in until drops
   * existed; this is the hook it was waiting for.
   */
  inventory.dropper = (id, count) => {
    const p = noa.ents.getPositionData(noa.playerEntity).position
    spawn(id, count, [p[0], p[1] + 1.0, p[2]],
      [rand(-2, 2), 2, rand(-2, 2)], THROW_DELAY)
  }

  /* ------------------------------------------------------------------ *
   * Simulation
   *
   * All of it on `tick`, none of it on `beforeRender`. Gravity, pickup,
   * merging and despawn are game state: run at the frame rate they would make
   * items fall faster on a 144 Hz monitor than on a 30 Hz one, and turn the
   * five minute despawn into a function of the graphics card. particles.js
   * integrates on render and is right to -- a chip that lives half a second
   * and affects nothing is pure decoration. A drop is an object with a stack
   * in it.
   *
   * The render pass reads `age` and derives the spin and bob from it, so those
   * update at 30 Hz rather than at the refresh rate. At one radian a second
   * nobody can see the difference, and a second clock advancing on render
   * would have to be kept in step with this one for no visible gain.
   * ------------------------------------------------------------------ */

  const solid = (x, y, z) => {
    const id = noa.getBlock(x, y, z)
    return id !== 0 && noa.registry.getBlockSolidity(id)
  }

  /** Does a drop's box at this centre overlap terrain? */
  function blocked(cx, cy, cz) {
    // A hair inside the box, so a drop resting exactly on y=64.125 does not
    // read as intersecting the block it is standing on.
    const h = SIZE / 2 - 1e-4
    for (let x = Math.floor(cx - h); x <= Math.floor(cx + h); x++) {
      for (let y = Math.floor(cy - h); y <= Math.floor(cy + h); y++) {
        for (let z = Math.floor(cz - h); z <= Math.floor(cz + h); z++) {
          if (solid(x, y, z)) return true
        }
      }
    }
    return false
  }

  /*
   * Axis-separated sweep. Move on one axis, and if that lands the box inside
   * terrain, undo it and kill that component of the velocity. Substepped so no
   * single step is longer than the box is wide: a drop at terminal velocity
   * covers 1.3 blocks per tick and would otherwise pass clean through the
   * floor, which is the classic tunnelling bug and is very hard to see coming.
   */
  const MAX_STEP = SIZE * 0.8

  function move(d, dt) {
    const dist = Math.max(Math.abs(d.vx), Math.abs(d.vy), Math.abs(d.vz)) * dt
    const steps = Math.max(1, Math.ceil(dist / MAX_STEP))
    const h = dt / steps

    d.onGround = false
    for (let i = 0; i < steps; i++) {
      if (d.vx) {
        const nx = d.x + d.vx * h
        if (blocked(nx, d.y, d.z)) d.vx = 0
        else d.x = nx
      }
      if (d.vz) {
        const nz = d.z + d.vz * h
        if (blocked(d.x, d.y, nz)) d.vz = 0
        else d.z = nz
      }
      if (d.vy) {
        const ny = d.y + d.vy * h
        if (blocked(d.x, ny, d.z)) {
          // Snap to the surface rather than stopping a fraction above it, or
          // a resting drop hovers by however far the last substep overshot.
          if (d.vy < 0) d.y = Math.floor(ny - SIZE / 2) + 1 + SIZE / 2
          else d.y = Math.ceil(ny + SIZE / 2) - 1 - SIZE / 2
          d.onGround = d.vy < 0
          /*
           * NO BOUNCE, and vanilla's source is why. ItemEntity.tick ends with
           *   if (onGround && delta.y < 0) delta = (x, -delta.y * 0.5, z)
           * which reads as a half-speed bounce and is dead code: move() has
           * already zeroed delta.y against the floor, so -0 * 0.5 is 0. Items
           * in Minecraft land and stop. Implementing the line as written gives
           * a drop that vibrates on the spot forever, because at 30 Hz each
           * tick's gravity is larger than the residual it bounces back.
           */
          d.vy = 0
        } else {
          d.y = ny
        }
      }
    }
    // A drop that came to rest this tick is standing on something even though
    // the sweep above never touched it.
    if (!d.onGround && Math.abs(d.vy) < 0.05) d.onGround = blocked(d.x, d.y - 0.02, d.z)
  }

  /** Player box, inflated by vanilla's pickup reach. */
  const pickupBox = () => {
    const p = noa.ents.getPositionData(noa.playerEntity)
    const w = p.width / 2 + REACH[0]
    const [px, py, pz] = p.position
    return [px - w, py - REACH[1], pz - w, px + w, py + p.height + REACH[1], pz + w]
  }

  const overlaps = (d, [x0, y0, z0, x1, y1, z1]) => {
    const h = SIZE / 2
    return d.x + h > x0 && d.x - h < x1 &&
      d.y + h > y0 && d.y - h < y1 &&
      d.z + h > z0 && d.z - h < z1
  }

  /*
   * Merging. Vanilla's ItemEntity.mergeWithNeighbours runs every tick against
   * anything within half a block and folds the smaller stack into the bigger.
   * Without it, mining a wall leaves sixty individual cubes on the floor, each
   * one a pickup and each one an instance to draw.
   *
   * O(n^2) over live drops, which at the 256 cap is 32k cheap comparisons a
   * tick -- and is only reached by a player deliberately carpeting the ground.
   * A spatial hash would be the answer if drops were ever a thousand.
   */
  function merge() {
    for (let i = 0; i < drops.length; i++) {
      const a = drops[i]
      if (a.collecting > 0) continue
      const max = stackMax(a.id)
      if (a.count >= max) continue
      for (let j = i + 1; j < drops.length; j++) {
        const b = drops[j]
        if (b.id !== a.id || b.collecting > 0) continue
        if (Math.abs(a.x - b.x) > MERGE_RADIUS ||
            Math.abs(a.y - b.y) > MERGE_RADIUS ||
            Math.abs(a.z - b.z) > MERGE_RADIUS) continue
        const take = Math.min(max - a.count, b.count)
        if (!take) continue
        a.count += take
        b.count -= take
        /*
         * Vanilla's ItemEntity.merge, and both halves are the conservative
         * choice: the merged stack keeps the LONGER pickup delay, so folding a
         * fresh break into the stack you just threw does not let you walk
         * straight back into it, and the YOUNGER age, so merging never
         * shortens anything's five minutes.
         */
        a.delay = Math.max(a.delay, b.delay)
        a.age = Math.min(a.age, b.age)
        if (b.count <= 0) { drops.splice(j, 1); j-- }
        if (a.count >= max) break
      }
    }
  }

  noa.on('tick', (dtMs) => {
    if (!drops.length) return
    // A tab-switch stall must not teleport a hundred drops through the floor.
    const dt = Math.min(0.1, dtMs / 1000)
    const drag = Math.pow(DRAG_PER_TICK, dt * TPS)
    const box = pickupBox()

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i]
      d.age += dt

      if (d.collecting > 0) {
        d.collecting += dt
        if (d.collecting > COLLECT_TIME) { drops.splice(i, 1); i-- }
        continue
      }

      if (d.delay > 0) d.delay = Math.max(0, d.delay - dt)

      if (d.age >= DESPAWN_SECONDS) { drops.splice(i, 1); i--; continue }

      d.vy -= GRAVITY * dt
      move(d, dt)

      // Drag is air resistance on all three axes; on the ground the horizontal
      // pair also takes the block's friction, which is what stops a drop
      // skating forever after it lands.
      const h = d.onGround ? Math.pow(DRAG_PER_TICK * GROUND_FRICTION, dt * TPS) : drag
      d.vx *= h; d.vz *= h; d.vy *= drag
      // Below a millimetre a second it is stopped, and the multiply below that
      // is just denormal arithmetic nobody can see.
      if (Math.abs(d.vx) < 0.001) d.vx = 0
      if (Math.abs(d.vz) < 0.001) d.vz = 0
      if (d.onGround && Math.abs(d.vy) < 0.05) d.vy = 0

      if (d.delay > 0) continue
      if (!overlaps(d, box)) continue

      /*
       * Collect. The stack goes in FIRST and only what fits: vanilla picks up
       * the part of a stack a full inventory can take and leaves the rest on
       * the floor, rather than refusing the whole thing or eating it.
       */
      const left = inventory.add(d.id, d.count)
      if (left === d.count) {
        // Nothing fit. Back off rather than retrying every tick against a full
        // inventory, which would be an add() and a change event 30 times a second.
        d.delay = 0.5
        continue
      }
      d.count = left
      sounds?.play('pickup')
      if (left > 0) continue
      d.collecting = 1e-6 // non-zero: "being drawn on its way to the player"
    }

    merge()
  })

  return {
    spawn,
    popResource,
    dropHeld,
    /**
     * The live drops themselves, not a copy. Exposed for the debugger and for
     * the test suite, which has no other way to ask "did that break leave
     * something on the floor" -- and which cannot wait out a five minute
     * despawn without being able to age a drop by hand.
     */
    get list() { return drops },
    get count() { return drops.length },
    /** Meshes built so far: one per item type ever dropped, pooled for the
     *  lifetime of the page. This is the number that must NOT track `count`. */
    get meshes() { return systems.size },
    dispose() {
      document.removeEventListener('keydown', onKey)
      authority.requestBlockChange = inner
      inventory.dropper = null
    },
  }
}
