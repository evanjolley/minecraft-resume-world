import {
  advanceStride, attachCape, createPlayerModel, createSkinMaterial, poseModel,
} from './playerModel.js'
import { createNametag } from './nametag.js'
import { createAgentSession, createToolRegistry } from './agent.js'
import { MC } from './physics.js'

/*
 * A CHARACTER IN THE WORLD THAT ISN'T YOU.
 *
 * Generic on purpose. "AI Evan" is this file plus the tools and backend in
 * aiEvan.js plus a position, and none of the three is named in here -- because
 * the next thing that needs a model, a nametag and a chat voice is a remote
 * player (docs/FUTURE.md 2b), and that is this file with the agent left out.
 *
 * IT HAS A BODY NOW, and this file used to say at length that it must not.
 * The old paragraph was: no noa entity, no physics body, no collision, it
 * stands where it is put -- on the grounds that a body is the first step
 * toward needing a pathfinder (docs/FUTURE.md section 2).
 *
 * That held until the terrain asset stopped being mirrored in X, his column
 * moved out from under him, and he spent a while standing in a treetop. A
 * character nothing simulates has nothing to catch a bad position: the fix
 * was a ground scan in main.js, and a scan is a guess that has to be right
 * the first time. A body is not -- he is DROPPED into the world and the
 * collision solver decides where he stops, so "Evan is inside a tree" stops
 * being a class of bug rather than being fixed once.
 *
 * So: a real noa entity with a `physics` body and a `movement` component --
 * the SAME two components the player has, driven by the same solver with the
 * same calibrated jump impulse, rather than a hand-rolled integrator. The
 * road not taken is itemEntity.js's: it reimplements Minecraft's eight-line
 * ItemEntity tick because a drop is not a player and the player solver would
 * be wrong for it. Evan is 0.6 x 1.8 and walks, so for him the player solver
 * is exactly right and reproducing it would be the error.
 *
 * What is still NOT here, deliberately: a pathfinder. `walkTo` steers at a
 * point and hops over what is in the way. It does not search. docs/FUTURE.md
 * settles that the tour's navigation is A* with jump-aware movement rules,
 * and this is the body that A* would eventually drive, not a down payment on
 * one.
 */

/** How close you have to get before he says anything. */
const GREET_RADIUS = 3.5
/*
 * And how far you have to get for the conversation to end. Wider than
 * GREET_RADIUS on purpose: with one threshold, standing exactly on the line
 * re-greets you every time the walk bob crosses it.
 */
const LEAVE_RADIUS = 7

/** Minecraft lets the head lead the body by ~50 degrees. Same rule as perspective.js. */
const MAX_HEAD_TURN = (50 * Math.PI) / 180

/*
 * How far above the given position he is dropped in.
 *
 * The caller hands over a column, not a height. 2.5 blocks is chosen against
 * Minecraft's own number rather than picked: fall damage starts after three
 * (MC.FALL_SAFE_BLOCKS), so this is the tallest drop that is unambiguously
 * harmless, and it is far enough that you can SEE him land if you happen to
 * be looking. Rejected: dropping him from the sky, which proves the same
 * thing and makes his arrival a twenty-block plummet nobody asked for.
 */
const SPAWN_DROP = 2.5

/** Close enough to a `walkTo` target to call it arrived. Half a block: he is
 *  0.6 wide, so anything tighter is a target he can stand on and still miss. */
const ARRIVE_RADIUS = 0.5

/*
 * How long he may make no progress before `walkTo` gives up.
 *
 * This is the whole obstacle story, and it is deliberately the cheap half.
 * He steers at the point and hops a one-block step; anything else -- a wall,
 * a two-block ledge, a target inside a hill -- shows up as not getting any
 * closer, and the tool says so and the model gets to pick somewhere else.
 * The alternative is A* (docs/FUTURE.md settles that it is the right answer
 * for the tour) and a search that is started and not finished is worse than
 * a straight walk that reports failure honestly.
 */
const STALL_SECONDS = 1.5

/** Progress smaller than this over STALL_SECONDS is not progress. */
const PROGRESS_EPSILON = 0.05

/** A hard ceiling so a walk always terminates, sized off Minecraft's walking
 *  speed plus generous slack for the hopping and the turning. */
const walkBudgetSeconds = (distance) => 5 + (distance / MC.WALK_SPEED) * 3

/** How far in front of his own box to look for something to hop over. */
const STEP_PROBE = MC.PLAYER_WIDTH / 2 + 0.35

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * @param {object} opts
 * @param {object} opts.roster        identity.js
 * @param {string} opts.id            roster id for this character
 * @param {[number,number,number]} opts.position  where he is DROPPED IN, feet
 *   coordinates. The y is a hint at the ground, not an assertion about it --
 *   he is released a little above it and the collision solver picks the
 *   altitude he actually ends up at. Read `npc.position` for where he IS.
 * @param {string} opts.skin          skin png url
 * @param {string} [opts.cape]        cape png url -- omit for no cape
 * @param {object} opts.chat          chat.js api
 * @param {object} [opts.agent]       { backend, tools } -- omit for a mute NPC
 * @param {object} [opts.script]      { greet }  what to say on approach
 */
export function installNPC(noa, {
  roster, id, position, skin, cape = null, chat, agent = null, script = {},
}) {
  const entry = roster.get(id)
  if (!entry) throw new Error(`installNPC: no roster entry ${id}`)

  /*
   * Its own skin material, not the player's. One line, and it is the
   * difference between "the NPC is Evan" and "the NPC is whoever you are" --
   * playerModel.js already takes the material as an argument precisely so
   * this is a parameter rather than a fork.
   */
  const material = createSkinMaterial(noa, skin, `skin-${id}`)
  const model = createPlayerModel(noa, material)
  // Optional, and optional at the DEPLOY level too -- a build that ships no
  // cape image leaves this attached but textureless, so attachCape removes
  // itself when the image 404s. See playerModel.js.
  if (cape) attachCape(noa, model, cape, `cape-${id}`)

  /* ---- the body ---- */

  /*
   * A noa entity with the player's two components: `physics` (a rigid body in
   * voxel-physics-engine, which is what makes gravity and terrain collision
   * happen to him) and `movement` (noa's own walk/jump controller, which is
   * what turns a heading into a force).
   *
   * No mesh component. noa would happily parent the model to the entity and
   * keep it there, and that is the obvious thing to do -- it is rejected
   * because the mesh component places on the TICK and this model is placed on
   * the RENDER, off `_renderPosition`, for the reason perspective.js writes
   * up: ticks are slower than frames, so a tick-placed model steps forward in
   * visible jumps while the camera glides. Same reason the player's model is
   * not a mesh component either.
   *
   * He is DROPPED. The y he was handed is a column, not an altitude; the
   * solver picks the altitude.
   */
  const drop = [position[0], position[1] + SPAWN_DROP, position[2]]
  const entity = noa.entities.add(
    drop, MC.PLAYER_WIDTH, MC.PLAYER_HEIGHT,
    null, null, /* doPhysics */ true, /* shadow */ false)

  const body = noa.ents.getPhysics(entity).body

  /*
   * FROZEN UNTIL THERE IS A WORLD TO LAND ON.
   *
   * This is the trap, and it is invisible until it bites. Chunks are meshed
   * asynchronously, installNPC runs during boot, and voxel-physics-engine
   * reads terrain through noa's live voxel arrays -- which answer AIR for
   * every chunk that has not arrived yet. Release him at construction and he
   * falls through the island and keeps going, at 32 b/s^2, while the ground
   * he was supposed to land on loads in above him.
   *
   * gravityMultiplier 0 rather than removing the physics component: the body
   * stays in the simulation, so a rebase or a collision still moves it
   * correctly, it simply is not pulled down. The gate is in the tick handler.
   */
  body.gravityMultiplier = 0

  /*
   * The movement tuning is COPIED FROM THE PLAYER rather than restated.
   *
   * physics.js owns these numbers and `jumpImpulse` in particular is 9.585 --
   * a figure binary-searched in a browser until the apex came out at
   * Minecraft's 1.2522, because noa applies the impulse and a full step of
   * gravity in the same frame and the closed form is wrong by that much. A
   * second copy of a calibrated constant is a second copy that silently stops
   * matching. Reading it off the player's own component at install time is
   * the cheapest way to have exactly one.
   *
   * Rejected: exporting JUMP_IMPULSE from physics.js. Better, and physics.js
   * is not this pass's file to change.
   *
   * maxSpeed is the one thing set rather than copied, because the player's is
   * mutated at runtime by sprint and sneak and an NPC who walks should walk.
   */
  const playerMove = noa.ents.getMovement(noa.playerEntity)
  noa.ents.addComponent(entity, noa.ents.names.movement, {
    maxSpeed: MC.WALK_SPEED,
    moveForce: playerMove.moveForce,
    responsiveness: playerMove.responsiveness,
    standingFriction: playerMove.standingFriction,
    runningFriction: playerMove.runningFriction,
    airMoveMult: playerMove.airMoveMult,
    jumpImpulse: playerMove.jumpImpulse,
    // One jump, from the ground, no hold-to-go-higher. Minecraft's rules, and
    // the same three lines installPhysics writes for the player.
    jumpForce: 0,
    jumpTime: 0,
    airJumps: 0,
  })
  const move = noa.ents.getMovement(entity)

  /** Where he actually is, live, in world coordinates. Everything that used to
   *  read the `position` argument reads this -- it is the same array noa keeps
   *  up to date, so a caller holding it sees him walk. */
  const at = () => noa.ents.getPosition(entity)

  /** The column he was dropped into, kept so a test (or a lost NPC) can be
   *  put back without re-deriving the ground scan in main.js. */
  const home = [position[0], position[1], position[2]]
  const floorX = Math.floor(home[0])
  const floorZ = Math.floor(home[2])

  /** The last position at which he was resting on real ground. See the gate. */
  let lastRest = null

  /*
   * The NAME, with nothing in front of it. `[Admin]` is a chat rank and it
   * belongs to chat.js's line format -- see identity.js for which of
   * Minecraft's two prefix mechanisms this is, and why the composition does
   * not happen in the roster, where both callers could have shared it. The
   * spec asserts the split both ways, because one string serving both is
   * exactly how the rank got above his head the first time.
   */
  const nametag = createNametag(noa, {
    text: roster.displayName(entry), height: MC.PLAYER_HEIGHT, name: `nametag-${id}`,
  })
  roster.onChange((changed) => {
    if (changed.id === id) nametag.setText(roster.displayName(changed))
  })

  /* ---- the agent ---- */

  const tools = createToolRegistry()
  if (agent) for (const [def, run] of agent.tools) tools.register(def, run)
  const session = agent
    ? createAgentSession({ backend: agent.backend, tools, system: agent.system })
    : null

  /** Everything this character says goes through here, so it always looks the
   *  same in chat. The entry carries his rank; chat.js is what turns an entry
   *  into `[Admin] <Evan> ...`, and this file never formats a name. */
  const say = (text) => chat.addMessage({ text, from: entry })

  const handle = (ev) => {
    if (ev.type === 'say') say(ev.text)
    // Tool calls are not shown to the player -- Minecraft has no UI for "the
    // NPC is thinking" and inventing one is the latency problem in
    // docs/FUTURE.md section 2, not this slice. They go to the console so the
    // seam is observable while it is being built.
    else if (ev.type === 'tool_use') console.log(`[${id}] tool_use`, ev.name, ev.input)
    else if (ev.type === 'tool_result') console.log(`[${id}] tool_result`, ev.name, ev.content)
    else if (ev.type === 'error') console.warn(`[${id}] ${ev.text}`)
  }

  let talking = false

  /**
   * Say something TO this character. Wired to chat's transport in main.js, so
   * anything you type while in range reaches him.
   *
   * Returns false if he is not listening, which is how main.js knows to leave
   * your message as an ordinary chat line instead.
   */
  const hear = (text) => {
    if (!talking || !session) return false
    session.send(text, handle)
    return true
  }

  /* ---- presence ---- */

  /*
   * NO INPUT LOCK. Walking up to him does not open a screen, does not take
   * the mouse, and does not stop you walking away mid-sentence -- you talk to
   * him through the chat box you already have, with T, and Escape still does
   * what it always did. That is a deliberate rejection of the obvious design
   * (a dialogue screen with the world frozen behind it): inputLock.js exists
   * to gate gameplay while a SCREEN is open, and "there is a person near you"
   * is not a screen. A conversation you can be trapped in is the single
   * easiest way to make a walkable world stop being walkable.
   */
  const playerPos = () => noa.ents.getPosition(noa.playerEntity)

  const distanceTo = () => {
    const [x, , z] = playerPos()
    const here = at()
    return Math.hypot(x - here[0], z - here[2])
  }

  /* ---- walking ---- */

  /*
   * ONE PRIMITIVE: go to a point on the ground, and stop.
   *
   * What it does: turns to face the target, walks at Minecraft's walking
   * speed, hops a one-block step that is in the way, arrives, stops, and
   * resolves. What it does NOT do: route around anything. If the straight
   * line is blocked it stops making progress and the promise REJECTS with
   * why, which is the behaviour the tool layer wants -- agent.js turns a
   * throw into `is_error` and the model gets to choose somewhere else.
   *
   * A promise rather than a callback or a fire-and-forget, because the
   * caller that matters is a tool: `run(input)` is awaited and its return
   * value becomes the tool_result the model reads. "I walked there" and "I
   * could not get there" have to be answers to the same call.
   */
  let walk = null

  const endWalk = (err, value) => {
    const pending = walk
    walk = null
    move.running = false
    move.jumping = false
    if (!pending) return
    if (err) pending.reject(err)
    else pending.resolve(value)
  }

  /**
   * @param {[number, number]} target  x and z. The GROUND picks the y.
   * @returns {Promise<{x:number,z:number,blocks:number}>}
   */
  const walkTo = ([x, z]) => new Promise((resolve, reject) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      reject(new Error('walk target needs a finite x and z'))
      return
    }
    // A second walk replaces the first rather than queueing behind it. He has
    // one pair of legs, and a model that changes its mind mid-walk should not
    // have to wait out the old destination to do it.
    endWalk(new Error('interrupted by a new destination'))
    const here = at()
    walk = {
      x, z, resolve, reject,
      elapsed: 0,
      budget: walkBudgetSeconds(Math.hypot(x - here[0], z - here[2])),
      best: Math.hypot(x - here[0], z - here[2]),
      stalled: 0,
    }
  })

  /** Is the thing one step ahead a single block he can hop onto? */
  const stepIsHoppable = (here, heading) => {
    const ax = Math.floor(here[0] + Math.sin(heading) * STEP_PROBE)
    const az = Math.floor(here[2] + Math.cos(heading) * STEP_PROBE)
    // +0.1 rather than the raw y: resting exactly on a voxel boundary floors
    // to the block BELOW his feet, which is always solid, which would read as
    // "blocked" every single tick and make him hop the whole way there.
    const fy = Math.floor(here[1] + 0.1)
    const solid = (y) => noa.registry.getBlockSolidity(noa.getBlock(ax, y, az))
    // Blocked at shin height, and two blocks of air above it to land in.
    return solid(fy) && !solid(fy + 1) && !solid(fy + 2)
  }

  const steer = (secs) => {
    if (!walk) {
      move.running = false
      move.jumping = false
      return
    }
    const here = at()
    const dx = walk.x - here[0]
    const dz = walk.z - here[2]
    const distance = Math.hypot(dx, dz)

    if (distance <= ARRIVE_RADIUS) {
      endWalk(null, { x: here[0], z: here[2], blocks: distance })
      return
    }

    const heading = Math.atan2(dx, dz)
    move.heading = heading
    move.running = true
    // Only from the ground. airJumps is 0 so noa would refuse anyway, but
    // asking to jump in mid-air every tick means the frame he lands is spent
    // on a jump he did not decide to make.
    move.jumping = body.atRestY() < 0 && stepIsHoppable(here, heading)

    walk.elapsed += secs
    if (distance < walk.best - PROGRESS_EPSILON) {
      walk.best = distance
      walk.stalled = 0
    } else {
      walk.stalled += secs
    }
    if (walk.stalled > STALL_SECONDS) {
      endWalk(new Error(
        `stuck ${distance.toFixed(1)} blocks short -- something is in the way `
        + 'that is taller than one block'))
    } else if (walk.elapsed > walk.budget) {
      endWalk(new Error(`gave up after ${walk.elapsed.toFixed(0)}s, still `
        + `${distance.toFixed(1)} blocks away`))
    }
  }

  let bodyYaw = 0
  /** The stride clock. Distance travelled, not time -- playerModel.js. */
  const stride = { swing: 0, amount: 0 }

  noa.on('tick', (dt) => {
    const secs = dt / 1000

    /*
     * THE GATE: he does not fall while the solver has no floor to stop him.
     *
     * One question, asked of the PHYSICS ENGINE rather than of the world, and
     * it turns out to be the same question twice.
     *
     *   1. Boot. Chunks mesh asynchronously and installNPC runs during boot,
     *      so terrain that has not arrived reads as AIR. Release him at
     *      construction and he falls through the island at 32 b/s^2 while the
     *      ground he was aimed at loads in above him.
     *   2. Spectator. gamemode.js noclips by replacing `noa.physics.testSolid`
     *      with `() => false` -- GLOBALLY, because voxel-physics-engine has no
     *      per-body override, and physics.js wrote that up as safe on the
     *      grounds that there was exactly one body in the world. There are two
     *      now. Without this, pressing into spectator sinks Evan through the
     *      planet, and leaving it drops him back into whatever he ended up
     *      inside.
     *
     * So the release condition is `testSolid` on his own floor: the solver's
     * own answer to "would this stop him". Absent chunk, false. Noclip, false.
     * Real ground, true. It re-arms as well as releases, which is what makes
     * the spectator case recover instead of just not-starting.
     *
     * Rejected: reading `noa.getBlock` and the registry, which was the first
     * version. It answers the boot case and is blind to the second, because
     * the block is still solid -- it is the SOLVER that has stopped caring.
     *
     * AND THE TRAP: `testSolid` takes OFFSET coordinates, not world ones. The
     * physics engine runs in noa's rebased frame and noa's own block getter
     * adds `worldOriginOffset` back on before it looks anything up, so a
     * world coordinate passed in here gets the offset applied twice and asks
     * about a voxel 138 blocks away. It does not error; it answers about
     * somewhere else, which is worse.
     */
    const offset = noa.worldOriginOffset
    if (!noa.physics.testSolid(
      floorX - offset[0], home[1] - 1 - offset[1], floorZ - offset[2])) {
      body.gravityMultiplier = 0
      body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
      move.running = false
      move.jumping = false
      /*
       * PUT HIM BACK, and this is the part that is not obvious.
       *
       * Freezing is a tick late by construction -- the flag flips outside
       * this handler, so one physics step has already run without a floor and
       * he is 0.035 blocks low. Harmless while frozen, and fatal on the way
       * out: 0.035 low means his feet are INSIDE the block he was standing
       * on, and a sweep that starts inside solid voxels does not stop at
       * them. He fell straight through and landed a block down, every time
       * someone toggled spectator.
       *
       * So he is held at the last place he actually had ground under him
       * rather than wherever the flip left him. Before his first landing
       * there is no such place and nothing is asserted -- that is the boot
       * case, where standing still at the release point is already right.
       */
      if (lastRest) noa.ents.setPosition(entity, lastRest[0], lastRest[1], lastRest[2])
      return
    }
    body.gravityMultiplier = 1
    if (body.atRestY() < 0) lastRest = [...at()]

    steer(secs)
    const near = distanceTo()
    if (!talking && near < GREET_RADIUS) {
      talking = true
      /*
       * The greeting is emitted locally rather than routed through the agent.
       * A model turn to produce "hi" costs a round trip before the player has
       * said anything, and the one thing docs/FUTURE.md is most worried about
       * is a character that pauses before it reacts.
       */
      if (script.greet) say(script.greet)
    } else if (talking && near > LEAVE_RADIUS) {
      talking = false
      session?.reset()
    }

    /*
     * THE LEGS. This was the whole of the bug: `limbSwing` was declared here,
     * passed to poseModel, and never incremented, so the full Minecraft walk
     * cycle in playerModel.js has been sitting behind a number that was
     * always zero. It is driven off his ACTUAL speed -- read from the physics
     * body, not from whether `walk` is set -- so he also animates when
     * something else moves him, and stands still the instant he is stopped by
     * a wall rather than pedalling against it.
     *
     * Same cadence as the player's, from the same function, for the reason
     * that function's comment gives: a second stride constant is a second
     * stride constant that drifts.
     */
    const speed = Math.hypot(body.velocity[0], body.velocity[2])
    advanceStride(stride, speed, secs)

    /*
     * He looks at you. Same 50-degree head/body split perspective.js uses for
     * the player, for the same reason: a model whose whole body snaps to face
     * you reads as a turret, and the head alone reads as a person.
     *
     * WALKING CHANGES WHO LEADS, exactly as it does for the player. Standing,
     * the body is anchored and the head turns to you. Walking, the body turns
     * to face TRAVEL -- the same `min(1, secs * 12)` chase perspective.js
     * uses -- and the head keeps tracking you within its 50 degrees, which is
     * how a person walking past you looks at you.
     */
    const here = at()
    const [px, py, pz] = playerPos()
    const toPlayer = Math.atan2(px - here[0], pz - here[2])
    if (speed > 0.1) {
      bodyYaw += angleDelta(bodyYaw, Math.atan2(body.velocity[0], body.velocity[2]))
        * Math.min(1, secs * 12)
    } else {
      const off = angleDelta(bodyYaw, toPlayer)
      if (Math.abs(off) > MAX_HEAD_TURN) bodyYaw += off - Math.sign(off) * MAX_HEAD_TURN
    }

    // Eye-to-eye rather than eye-to-feet, or he stares at your shoes.
    const rise = (py + MC.EYE_HEIGHT) - (here[1] + MC.EYE_HEIGHT)
    const flat = Math.hypot(px - here[0], pz - here[2])

    poseModel(model.parts, {
      limbSwing: stride.swing, limbSwingAmount: stride.amount, crouching: false,
      // Model pitch shares a sign with camera pitch: positive is DOWN.
      headPitch: -Math.atan2(rise, Math.max(flat, 0.001)),
      headYaw: angleDelta(bodyYaw, toPlayer),
    })
    model.root.rotation.y = bodyYaw
  })

  /*
   * On render, not tick, and off `_renderPosition`.
   *
   * Two separate reasons, and they used to be one. The old one: noa REBASES
   * the Babylon scene origin as you travel, so a world position placed once
   * at construction put this model 138 blocks up in the air, invisible and
   * perfectly correct according to every assertion that did not involve a
   * camera. The new one, which only arrived with the body: ticks are slower
   * than frames, so a model placed from the tick position steps forward in
   * discrete jumps while the camera glides -- the judder perspective.js
   * writes up for the player.
   *
   * `_renderPosition` answers both at once. It is the entity's position
   * interpolated for THIS frame and already in local coordinates, so the
   * globalToLocal call this used to make is gone with it.
   */
  noa.on('beforeRender', () => {
    const rpos = noa.ents.getPositionData(entity)._renderPosition
    model.root.position.set(rpos[0], rpos[1], rpos[2])
    nametag.update(rpos)
  })

  return {
    id, entry, model, nametag, hear, entity, walkTo,
    get talking() { return talking },
    get distance() { return distanceTo() },
    get session() { return session },
    /** Live feet position, world coordinates. A getter and not the `position`
     *  argument, because the argument is now only where he was DROPPED. */
    get position() { return at() },
    /** Is he on the way somewhere. */
    get walking() { return walk !== null },
    /** The stride clock, for the console and for a spec that needs to prove
     *  the legs advance with DISTANCE rather than with time -- which is the
     *  one thing a screenshot of a walking model cannot show you. */
    get stride() { return { ...stride } },
    /** The column he was dropped into. */
    get home() { return [...home] },
    /**
     * Standing on something, as against falling.
     *
     * The body's own answer FIRST, and then a second clause that exists
     * because the body's own answer goes stale. voxel-physics-engine puts a
     * resting body to SLEEP -- it stops stepping it entirely, which means it
     * also stops writing `resting`, which means a man who has been standing
     * still for a second reports exactly what a man in free fall reports.
     * That is the whole of `bodyAsleep` in that library, and it cost an
     * afternoon: spectator was correctly leaving him on the ground and this
     * getter was correctly saying he was not.
     *
     * So the sleeping case is asked directly: nothing moving him vertically,
     * gravity on, and a solid voxel under his feet. Offset coordinates,
     * because `testSolid` runs in noa's rebased frame -- see the gate.
     */
    get grounded() {
      if (body.atRestY() < 0) return true
      if (body.velocity[1] !== 0 || body.gravityMultiplier === 0) return false
      const o = noa.worldOriginOffset
      const p = at()
      return !!noa.physics.testSolid(
        Math.floor(p[0]) - o[0], Math.floor(p[1]) - 1 - o[1], Math.floor(p[2]) - o[2])
    },
    /** The tools he actually has, in Anthropic's format. For the console. */
    get toolSchemas() { return tools.schemas },
    /** Force a conversation from a test or the console, without walking. */
    _setTalking(v) { talking = !!v; if (!v) session?.reset() },
    /** Put him back where he started, and drop him again. For the console and
     *  for a spec that walked him off and has to leave the world as it found
     *  it -- resetWorld restores the player, and he is not the player. */
    _reset() {
      endWalk(new Error('reset'))
      body.velocity[0] = 0
      body.velocity[1] = 0
      body.velocity[2] = 0
      /*
       * SUBTLE, and it cost a confused half hour. `resting` is what the
       * solver wrote on the last step it took, and teleporting a body does
       * not take a step -- so `grounded` goes on answering TRUE for the frame
       * after he is lifted 2.5 blocks into the air, and anything waiting for
       * him to land is told he already has. Clearing it makes the flag mean
       * what its name says: it is set again the moment he actually touches
       * something.
       */
      body.resting[0] = body.resting[1] = body.resting[2] = 0
      lastRest = null
      noa.ents.setPosition(entity, home[0], home[1] + SPAWN_DROP, home[2])
    },
  }
}
