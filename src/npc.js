import { attachCape, createPlayerModel, createSkinMaterial, poseModel } from './playerModel.js'
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
 * WHAT IT IS NOT: an entity. No noa entity, no physics body, no collision. It
 * stands where it is put. docs/FUTURE.md section 2 argues at length that the
 * MVP has no pathfinding, and giving it a body now would be the first step
 * toward needing some.
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
 * @param {[number,number,number]} opts.position  FEET, world coordinates
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

  /*
   * WORLD COORDINATES ARE NOT SCENE COORDINATES.
   *
   * noa REBASES the Babylon scene origin as you travel, so that vertex
   * positions stay small and float precision stays honest -- at spawn the
   * offset is already [0, 138, 0], because the island's surface is 136 blocks
   * up. Placing this model at its world position once, at construction, put
   * it 138 blocks in the air above the island, where it was perfectly
   * invisible and perfectly correct according to every assertion that did not
   * involve a camera. (The nametag caught it: 138 blocks is past the 64-block
   * cull, so it switched itself off.)
   *
   * So the conversion runs EVERY FRAME rather than once. The offset changes
   * at runtime, and a character that was placed correctly at spawn would
   * otherwise drift away from its own feet the first time the player walked
   * far enough to trigger a rebase. perspective.js never had to think about
   * this because _renderPosition is already local.
   */
  const local = [0, 0, 0]
  const toLocal = () => noa.globalToLocal(position, null, local)

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
   *  same in chat: vanilla's `<%s> %s`, with the team prefix inside the
   *  brackets exactly as PlayerTeam.formatNameForTeam puts it. */
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
    return Math.hypot(x - position[0], z - position[2])
  }

  let bodyYaw = 0
  let limbSwing = 0

  noa.on('tick', () => {
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
     * He looks at you. Same 50-degree head/body split perspective.js uses for
     * the player, for the same reason: a model whose whole body snaps to face
     * you reads as a turret, and the head alone reads as a person.
     */
    const [px, py, pz] = playerPos()
    const toPlayer = Math.atan2(px - position[0], pz - position[2])
    const off = angleDelta(bodyYaw, toPlayer)
    if (Math.abs(off) > MAX_HEAD_TURN) bodyYaw += off - Math.sign(off) * MAX_HEAD_TURN

    // Eye-to-eye rather than eye-to-feet, or he stares at your shoes.
    const rise = (py + MC.EYE_HEIGHT) - (position[1] + MC.EYE_HEIGHT)
    const flat = Math.hypot(px - position[0], pz - position[2])

    poseModel(model.parts, {
      limbSwing, limbSwingAmount: 0, crouching: false,
      // Model pitch shares a sign with camera pitch: positive is DOWN.
      headPitch: -Math.atan2(rise, Math.max(flat, 0.001)),
      headYaw: angleDelta(bodyYaw, toPlayer),
    })
    model.root.rotation.y = bodyYaw
  })

  /*
   * On render, not tick -- he does not move, but the CAMERA does, and both
   * the nametag's orientation and the scene origin are functions of where the
   * camera is. Doing this on tick would leave him a frame behind a rebase.
   */
  noa.on('beforeRender', () => {
    toLocal()
    model.root.position.set(local[0], local[1], local[2])
    nametag.update(local)
  })

  return {
    id, entry, model, nametag, hear,
    get talking() { return talking },
    get distance() { return distanceTo() },
    get session() { return session },
    /** The tools he actually has, in Anthropic's format. For the console. */
    get toolSchemas() { return tools.schemas },
    /** Force a conversation from a test or the console, without walking. */
    _setTalking(v) { talking = !!v; if (!v) session?.reset() },
  }
}
