import { BLOCK_BY_ID } from './blocks.js'

/*
 * Minecraft's block sounds, played through Web Audio.
 *
 * The samples come out of your own Minecraft install via
 * `npm run sounds`, into public/sounds/ -- which is gitignored, because
 * Mojang's audio is no more redistributable than their textures. If that
 * script was never run there is no manifest, and everything here degrades to
 * silence rather than throwing. A world with no sound is fine; a world that
 * dies on startup because someone skipped a build step is not.
 *
 * Not everything here hangs off a block. The player's own sounds -- hurt,
 * death, the two fall-damage thumps -- and the GUI click come from a flat list
 * of samples rather than the block grid, and are wired to survival.js's hurt
 * and death events. Same manifest, same voices, different lookup.
 *
 * FIDELITY. Minecraft doesn't give blocks individual sounds, it gives them a
 * SoundType -- one of about a dozen families, six of which this palette can
 * reach. Each family has a handful of numbered samples and the game picks one
 * at random, which is the entire reason footsteps don't sound like a metronome.
 * The same samples get reused across events at different pitch and volume:
 * `step` covers footsteps, the mining hit tick AND the landing thud, while
 * `dig` covers both breaking and placing. That reuse is Minecraft's design,
 * not a corner cut here.
 *
 * AUTOPLAY. Browsers refuse to start an AudioContext without a user gesture,
 * so the context is created on the first click/keypress rather than at
 * install time. Everything before that point is safe to call and does nothing.
 */

/*
 * Block key -> Minecraft SoundType family.
 *
 * DIRT IS GRAVEL. That looks like a bug and isn't: `Blocks.DIRT` is declared
 * with `SoundType.GRAVEL` in Minecraft, so dirt crunches rather than rustles.
 * Only the grass BLOCK gets SoundType.GRASS.
 *
 * Everything absent falls through to stone, which is right for all three
 * stone variants, cobblestone, bedrock and every ore -- and is also the least
 * wrong default for whatever gets added to blocks.js later.
 */
const GROUP_BY_KEY = {
  grass: 'grass',
  dirt: 'gravel',
  gravel: 'gravel',
  planks: 'wood',
}
const DEFAULT_GROUP = 'stone'

/** The SoundType family for a block id, or null for air. */
export function groupForBlock(id) {
  if (!id) return null
  const def = BLOCK_BY_ID.get(id)
  if (!def) return null
  return GROUP_BY_KEY[def.key] ?? DEFAULT_GROUP
}

/*
 * Minecraft's per-family volume. Grass is the quiet one at 0.6; everything
 * else in this palette is 1.0. Sand and snow are here because the build script
 * extracts them and a future block palette will want them, not because
 * anything places them today.
 */
const GROUP_VOLUME = { grass: 0.6, gravel: 1.0, wood: 1.0, stone: 1.0, sand: 1.0, snow: 1.0 }

/*
 * Event -> which sample set, and Minecraft's mix for it.
 *
 * The pitch numbers are Minecraft's exactly: break and place at 0.8, the
 * mining hit tick at 0.5 (which is what makes mining sound heavier than
 * walking on the same block), landing at 0.75.
 *
 * The VOLUMES are lifted. Minecraft plays footsteps at volume * 0.15, which is
 * judged against music, ambience and mobs; as the only sound in an otherwise
 * silent world that lands somewhere near inaudible. The ratios between events
 * are kept, the absolute floor is raised.
 */
const MIX = {
  step: { set: 'step', volume: 0.34, pitch: 1.0 },
  hit: { set: 'step', volume: 0.22, pitch: 0.5 },
  land: { set: 'step', volume: 0.55, pitch: 0.75 },
  break: { set: 'dig', volume: 0.8, pitch: 0.8 },
  place: { set: 'dig', volume: 0.8, pitch: 0.8 },

  /*
   * `shared` marks the sets that aren't keyed by block family -- there is one
   * hurt sound for the whole game, not one per material -- so play() looks
   * them up in manifest.sets and ignores whatever block it was handed.
   *
   * hurt and death deliberately name the SAME set. Vanilla's
   * entity.player.death and entity.player.hurt both list damage/hit1-3; they
   * are two events over one set of samples, and inventing a distinct death
   * sample to make them differ would be less faithful, not more.
   *
   * `vary` is Minecraft's getVoicePitch: (rand - rand) * 0.2 + 1.0. Two rolls
   * subtracted, not one scaled, which gives a triangular spread clustered near
   * 1.0. It matters far more here than on a footstep -- three samples heard
   * back to back while something is chewing through your hearts read as a
   * three-note loop without it.
   */
  hurt: { set: 'hurt', shared: true, volume: 0.85, pitch: 1.0, vary: 0.2 },
  death: { set: 'hurt', shared: true, volume: 0.85, pitch: 1.0, vary: 0.2 },

  /*
   * Vanilla plays both fall thumps at full volume and lets the samples carry
   * the difference, and that's kept -- but they sit under the hurt sound here
   * rather than level with it. A damaging fall fires three sounds into the
   * same frame (fall thump, landing thud, hurt) and three voices near 0.85
   * into a 0.9 master is a sum that clips. That's a mix decision, not a
   * fidelity claim.
   */
  fallBig: { set: 'fallBig', shared: true, volume: 0.7, pitch: 1.0 },
  fallSmall: { set: 'fallSmall', shared: true, volume: 0.7, pitch: 1.0 },

  // Minecraft's GUI clicks are quiet on purpose: SimpleSoundInstance.forUI
  // hardcodes volume 0.25 while everything else in this table plays at 1.0.
  // Lifted with the rest of the mix, kept the quietest thing in it.
  uiClick: { set: 'uiClick', shared: true, volume: 0.35, pitch: 1.0 },
}

// Minecraft's LivingEntity.getFallDamageSound: more than 4 half-hearts of fall
// damage is a "big" fall. Not a distance -- the damage number is what's tested,
// which is why a fall onto slime or with feather falling stays quiet.
const BIG_FALL_DAMAGE = 4

// Minecraft plays the mining hit sound every 4 ticks while you hold the button.
const HIT_INTERVAL = 0.2

// Downward blocks/sec below which a ground contact isn't really a landing.
const LAND_MIN_SPEED = 3

/*
 * Voices. An AudioBufferSourceNode is one-shot by spec -- it cannot be
 * restarted -- so the source itself is unavoidably per-play. What IS poolable
 * is everything downstream, and that's the expensive part: a PannerNode
 * allocation per footstep would mean a few hundred per minute of walking.
 *
 * Two pools rather than one, because a "non-positional" sound routed through a
 * panner sitting exactly on the listener is undefined-ish territory in the
 * spec, and the workaround costs more than a second four-entry array.
 */
const POSITIONAL_VOICES = 16
const FLAT_VOICES = 8

export function installSounds(noa, deps = {}) {
  const { interaction, movement, survival } = deps

  let ctx = null
  let master = null
  let manifest = null
  let encoded = null      // logical name -> ArrayBuffer, fetched before the gesture
  let buffers = new Map() // logical name -> AudioBuffer, decoded after it
  let decodeErrors = []
  let positional = []
  let flat = []
  let nextPositional = 0
  let nextFlat = 0

  /*
   * The manifest is fetched immediately, long before there's a context to play
   * through, for two reasons: it's the "were sounds ever built?" check, and
   * fetching the samples on the click itself would put a few hundred KB of
   * network between the click and the first sound.
   */
  const loading = fetch('/sounds/manifest.json')
    .then(r => (r.ok ? r.json() : null))
    .then(async (m) => {
      if (!m) return
      manifest = m
      encoded = new Map()
      const jobs = []
      const grab = (name) => jobs.push(fetch(`/sounds/${name}.ogg`)
        .then(r => (r.ok ? r.arrayBuffer() : null))
        .then(buf => { if (buf) encoded.set(name, buf) })
        .catch(() => {}))

      for (const [group, sets] of Object.entries(m.groups)) {
        for (const [set, count] of Object.entries(sets)) {
          for (let i = 1; i <= count; i++) grab(`${set}/${group}${i}`)
        }
      }
      // `sets` is the non-block half of the manifest, and it names its samples
      // by their real vanilla path (`damage/hit1`) instead of deriving one from
      // a count -- fallbig and fallsmall aren't numbered, so there is nothing to
      // count. Optional so a public/sounds built before these existed still
      // loads its block sounds instead of throwing.
      for (const paths of Object.values(m.sets ?? {})) paths.forEach(grab)

      await Promise.all(jobs)
      if (ctx) await decodeAll()
    })
    .catch(() => { /* no sounds built; stay silent */ })

  async function decodeAll() {
    if (!ctx || !encoded) return
    const jobs = []
    for (const [name, data] of encoded) {
      if (buffers.has(name)) continue
      // decodeAudioData detaches the ArrayBuffer, so each one gets a copy --
      // without it a second decode pass (context recreated after a suspend)
      // throws on an already-detached buffer.
      jobs.push(ctx.decodeAudioData(data.slice(0))
        .then(buf => buffers.set(name, buf))
        .catch(err => decodeErrors.push(`${name}: ${err.message}`)))
    }
    await Promise.all(jobs)
  }

  function buildGraph() {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return false
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(ctx.destination)

    for (let i = 0; i < POSITIONAL_VOICES; i++) {
      const panner = ctx.createPanner()
      /*
       * equalpower, not HRTF. HRTF convolves per node and we may have a dozen
       * live at once during a mining burst; for a game that only needs "which
       * side is that on, and how far", the cheap model is the right trade.
       */
      panner.panningModel = 'equalpower'
      panner.distanceModel = 'inverse'
      // Minecraft's block sounds carry about 16 blocks. refDistance is the
      // radius inside which there's no falloff at all -- roughly arm's reach.
      panner.refDistance = 3
      panner.rolloffFactor = 1.2
      panner.maxDistance = 48
      const gain = ctx.createGain()
      gain.connect(panner)
      panner.connect(master)
      positional.push({ gain, panner })
    }
    for (let i = 0; i < FLAT_VOICES; i++) {
      const gain = ctx.createGain()
      gain.connect(master)
      flat.push({ gain })
    }
    return true
  }

  /*
   * The gesture gate. The listener stays attached until the context is
   * actually running, because a context can also be created suspended (Chrome
   * does this when the page loads without interaction) and because switching
   * tabs can suspend it again later.
   */
  const unlock = () => {
    if (!ctx && !buildGraph()) return
    if (ctx.state !== 'running') ctx.resume().catch(() => {})
    decodeAll()
    if (ctx.state === 'running') {
      for (const ev of ['mousedown', 'touchstart', 'keydown']) {
        window.removeEventListener(ev, unlock, true)
      }
    }
  }
  for (const ev of ['mousedown', 'touchstart', 'keydown']) {
    // Capture phase, because menus and the chat box stop propagation on some
    // of these and the gate would never fire for a player who types first.
    window.addEventListener(ev, unlock, true)
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

  /**
   * Pick one variant at random, the way Minecraft does, and return its logical
   * name rather than its buffer -- the name is what `lastPlayed` reports, and a
   * decoded AudioBuffer tells a caller nothing about which sample it is.
   *
   * @param group a SoundType family, or null for one of the shared sets.
   */
  function sampleName(set, group) {
    if (!manifest) return null
    if (!group) {
      const paths = manifest.sets?.[set]
      return paths?.length ? pick(paths) : null
    }
    const count = manifest.groups[group]?.[set]
    return count ? `${set}/${group}${1 + Math.floor(Math.random() * count)}` : null
  }

  const local = [0, 0, 0]
  let lastPlayed = null

  /**
   * @param event one of MIX's keys
   * @param group a SoundType family name, or a block id to derive one from.
   *              Ignored for the `shared` events, which have no block.
   * @param worldPos [x,y,z] to play it at, or null for a non-positional sound
   */
  function play(event, group = null, worldPos = null) {
    if (!ctx || ctx.state !== 'running') return false
    const mix = MIX[event]
    if (!mix) return false
    if (mix.shared) group = null
    else {
      if (typeof group === 'number') group = groupForBlock(group)
      // No family means air, or a block id blocks.js has never heard of.
      if (!group) return false
    }
    const name = sampleName(mix.set, group)
    const buf = name && buffers.get(name)
    if (!buf) return false

    const voice = worldPos
      ? positional[nextPositional = (nextPositional + 1) % positional.length]
      : flat[nextFlat = (nextFlat + 1) % flat.length]

    const src = ctx.createBufferSource()
    src.buffer = buf
    // Minecraft pitches by resampling, so playbackRate is the faithful knob --
    // a lower pitch is genuinely a longer sound, which is why the mining tick
    // at 0.5 reads as a heavy thunk rather than a clipped one.
    src.playbackRate.value = mix.vary
      ? mix.pitch * (1 + (Math.random() - Math.random()) * mix.vary)
      : mix.pitch
    voice.gain.gain.value = mix.volume * (group ? GROUP_VOLUME[group] ?? 1 : 1)

    if (worldPos) {
      /*
       * Panner coordinates are LOCAL, not world. noa rebases the world origin
       * as you travel and the listener is fed from the Babylon camera, which
       * lives in that rebased frame -- mixing the two puts every sound
       * hundreds of blocks off once you've walked far enough.
       */
      noa.globalToLocal(worldPos, null, local)
      const p = voice.panner
      if (p.positionX) {
        p.positionX.value = local[0]
        p.positionY.value = local[1]
        p.positionZ.value = local[2]
      } else {
        p.setPosition(local[0], local[1], local[2])
      }
    }

    src.connect(voice.gain)
    src.start()
    // Sources are garbage once played; dropping the connection keeps a
    // stopped node from pinning the pooled gain in the graph.
    src.onended = () => { try { src.disconnect() } catch { /* already gone */ } }
    lastPlayed = { event, set: mix.set, name }
    return true
  }

  /*
   * The listener follows the RENDER camera rather than the player entity, so
   * third person hears from where you're actually looking rather than from
   * inside your own head. Its basis vectors come straight out of the camera's
   * world matrix -- noa.camera.getDirection() is only recomputed under pointer
   * lock, so it goes stale the moment a menu opens.
   */
  noa.on('beforeRender', () => {
    if (!ctx || ctx.state !== 'running') return
    const cam = noa.rendering.camera
    if (!cam) return
    const m = cam.getWorldMatrix().m
    const l = ctx.listener
    if (l.positionX) {
      l.positionX.value = m[12]; l.positionY.value = m[13]; l.positionZ.value = m[14]
      l.forwardX.value = m[8]; l.forwardY.value = m[9]; l.forwardZ.value = m[10]
      l.upX.value = m[4]; l.upY.value = m[5]; l.upZ.value = m[6]
    } else {
      l.setPosition(m[12], m[13], m[14])
      l.setOrientation(m[8], m[9], m[10], m[4], m[5], m[6])
    }
  })

  /* ---- wiring ---- */

  const center = (p) => [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5]
  const unsubscribe = []

  if (interaction) {
    unsubscribe.push(interaction.onBlockBreak(({ id, position }) => {
      play('break', id, center(position))
    }))
    unsubscribe.push(interaction.onBlockPlace(({ id, position }) => {
      play('place', id, center(position))
    }))

    /*
     * The mining tick. Progress arrives every frame, so this rate-limits to
     * Minecraft's every-four-ticks rather than firing sixty times a second.
     * The timer resets on release, not on completion, so tapping the button
     * repeatedly can't machine-gun the sound.
     */
    let sinceHit = HIT_INTERVAL
    unsubscribe.push(interaction.onBreakProgress(({ id, position, dt }) => {
      if (!position) { sinceHit = HIT_INTERVAL; return }
      sinceHit += dt
      if (sinceHit < HIT_INTERVAL) return
      sinceHit = 0
      play('hit', id, center(position))
    }))
  }

  if (survival) {
    /*
     * Vanilla plays EITHER the hurt sound or the death sound on a hit, never
     * both -- LivingEntity.hurt branches on isDeadOrDying() and the killing
     * blow gets only the death sound. survival emits hurt and then death, so
     * the hurt handler is the one that has to stand down.
     */
    unsubscribe.push(survival.onHurt(({ amount, health, cause }) => {
      /*
       * The fall thump is its OWN event, on top of the hurt sound, and it is
       * not the landing thud already wired below: that one is the block you
       * hit, played on every landing, and this one is your legs, played only
       * when the landing cost you hearts.
       */
      if (cause === 'fall') play(amount > BIG_FALL_DAMAGE ? 'fallBig' : 'fallSmall')

      /*
       * Every cause this world can produce -- fall, starve, void, generic --
       * takes the plain hurt sound. Vanilla only swaps it for damage types
       * carrying a DamageEffects other than HURT, which is fire, drowning,
       * freezing and sweet berry bushes, none of which exist here. There are
       * samples for all four in the asset index; wiring them to causes that
       * can't happen would be inventing fidelity.
       */
      if (health > 0) play('hurt')
    }))

    /*
     * Death goes through a latch rather than straight off onDeath, because
     * there are two ways to die here and only one of them emits. Falling into
     * the void -- the death every visitor finds first, on purpose -- runs
     * survival.onVoidFall(), which zeroes health and calls changed() without
     * ever going through damage(), so an onDeath-only wiring would leave the
     * signature death of this world silent.
     *
     * The latch is also the dedupe. On a lethal hit changed() runs BEFORE
     * died.emit, so both paths fire for one death; whichever arrives first
     * makes the sound and the other is a no-op until reset() clears the flag.
     */
    let announced = false
    const announceDeath = () => {
      if (announced) return
      announced = true
      play('death')
    }
    unsubscribe.push(survival.onDeath(announceDeath))
    unsubscribe.push(survival.onChange((s) => {
      if (s.dead) announceDeath()
      else announced = false
    }))
  }

  /*
   * ui.button.click, delegated off the document instead of wired per button.
   * The pause menu builds its rows at runtime and the death screen's button is
   * static markup -- neither file is this module's to edit, and a listener
   * that goes looking for .mc-button when the click happens needs no
   * cooperation from either.
   *
   * Capture phase for the same reason the gesture gate uses it: screens that
   * stop propagation would otherwise swallow their own click sound.
   */
  const onUiClick = (e) => {
    if (e.target instanceof Element && e.target.closest('.mc-button')) play('uiClick')
  }
  document.addEventListener('click', onUiClick, true)
  unsubscribe.push(() => document.removeEventListener('click', onUiClick, true))

  if (movement) {
    // Non-positional: it's your own feet. A panner would put them a fraction of
    // a block below the listener and pan them as you look down.
    unsubscribe.push(movement.onFootstep(({ blockId }) => play('step', blockId)))
    unsubscribe.push(movement.onLand(({ blockId, speed }) => {
      // Below this you didn't fall, you brushed the ground -- resting against
      // a ledge or stepping down a fraction of a block re-fires the contact.
      // A real jump lands at ~8.9 b/s, so this only filters the noise.
      if (speed > LAND_MIN_SPEED) play('land', blockId)
    }))
  }

  return {
    play,
    groupForBlock,
    /** 'off' until the gesture gate fires, then the real AudioContext state. */
    get state() { return ctx ? ctx.state : 'off' },
    get context() { return ctx },
    get manifest() { return manifest },
    get decoded() { return buffers.size },
    get decodeErrors() { return decodeErrors },
    /*
     * Which sample the last play() actually reached for, as
     * { event, set, name }. Here because the graph can't answer it: a started
     * AudioBufferSourceNode exposes a decoded buffer, not the file it came
     * from, and hurt and death share a sample set -- so "did dying make a
     * different sound than getting hit" is otherwise unanswerable from
     * outside. Null until something plays.
     */
    get lastPlayed() { return lastPlayed },
    /** Resolves once the samples are fetched; decoding still waits on a gesture. */
    ready: () => loading,
    dispose() { unsubscribe.forEach(fn => fn()) },
  }
}
