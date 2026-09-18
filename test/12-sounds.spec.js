import { test, expect } from './fixtures.js'
import {
  ID, SURFACE_Y, aim, getBlock, setBlock, teleport, settleOnGround, waitTicks,
  useGamemode, DROP_X, DROP_Z, standOnBedrock,
} from './helpers/world.js'
import { armAudio } from './helpers/audio.js'

/*
 * Sound, asserted on the GRAPH rather than by listening: headless has no audio
 * device, so every check below is "did a source node actually start, carrying
 * which sample, at which gain and rate". helpers/audio.js explains how.
 *
 * Two things worth knowing before reading the expectations, both of which look
 * like bugs and are Minecraft:
 *
 *   - hurt and death play the SAME three samples. entity.player.hurt and
 *     entity.player.death both list damage/hit1-3 in vanilla's sounds.json.
 *     They are two events over one set, told apart by WHEN they fire.
 *   - the fall thump is chosen by DAMAGE, not distance. More than 4 half
 *     hearts takes fallbig (LivingEntity.getFallDamageSound).
 *
 * The numbers in these assertions are sounds.js's MIX table, spelled out here
 * rather than imported for the same reason the block ids are: a retune should
 * fail this file loudly instead of quietly redefining what it tests.
 */
const HURT_GAIN = 0.85
const FALL_GAIN = 0.7
const UI_GAIN = 0.35
const HIT_GAIN = 0.22    // the mining tick: volume 0.22 x stone's 1.0
const HIT_RATE = 0.5

const isHurtSample = (name) => /^damage\/hit[123]$/.test(name)

/* island.js kills you below this, same constant 08-death.spec.js uses. */
// Mirrors island.js: below the world floor at y=-64. See 08-death.spec.js.
const VOID_Y = -70

/* Straight down. noa clamps just short of a right angle. */
const DOWN = Math.PI / 2

const damage = (page, amount, cause = 'generic') =>
  page.evaluate(([a, c]) => window.game.survival.damage(a, c), [amount, cause])

const lastPlayed = (page) => page.evaluate(() => window.game.sounds.lastPlayed)

const waitForDeath = (page) =>
  page.waitForFunction(() => window.game.survival.dead, null, { timeout: 15_000, polling: 20 })

test.describe('sounds', () => {
  let audio

  /*
   * Armed once for the whole file and disposed after it, because the patch is
   * on AudioBufferSourceNode.prototype -- shared with every other spec in this
   * worker's page. Per-test arming would also mean rebuilding the fingerprint
   * table, which is 61 decodes.
   */
  test.beforeAll(async ({ world }) => { audio = await armAudio(world.page) })
  test.afterAll(async () => { await audio.dispose() })

  // resetWorld drops the player two blocks and lets them land, which is itself
  // a landing sound. Clearing here rather than in each test keeps that out.
  test.beforeEach(async ({ page }) => { await audio.clear() })

  test('a sample the manifest promises but never decodes plays as silence',
    async ({ page }) => {
      const names = await audio.names()
      const state = await page.evaluate(() => ({
        decoded: window.game.sounds.decoded,
        errors: window.game.sounds.decodeErrors,
        sets: Object.keys(window.game.sounds.manifest.sets ?? {}).sort(),
      }))

      expect(state.errors).toEqual([])
      expect(state.decoded, 'the manifest lists samples the client never decoded')
        .toBe(names.length)
      /*
       * The non-block half. Missing here means `npm run sounds` was run against
       * a build of this script that predates the player sounds.
       *
       * `arrayContaining`, not equality. This asserted the exact set until the
       * water work added ten more (`splash`, `swim`, the underwater bed), and an
       * exact list turns every future sound family into a failing test in a file
       * that has nothing to do with it. What this test is actually for is
       * catching a stale `npm run sounds` -- that these five are PRESENT. It was
       * never for pinning the total, and a list nobody owns is a list that rots.
       */
      expect(state.sets).toEqual(
        expect.arrayContaining(['fallBig', 'fallSmall', 'hurt', 'pickup', 'uiClick']))
    })

  test('two samples sharing a fingerprint would make every name below a guess',
    async () => {
      /*
       * The classification the rest of this file depends on. Two families
       * collide, and both are vanilla shipping ONE recording under two names:
       * step/snowN.ogg and dig/snowN.ogg are different files with different
       * asset hashes that decode to bit-identical PCM, and wool -- extracted
       * under its pre-1.13 asset name `cloth` -- does exactly the same.
       *
       * Nothing below names a snow or wool sample, so the ambiguity costs
       * nothing; what would cost is a THIRD family joining them unnoticed,
       * which is why this is pinned rather than filtered.
       */
      expect(await audio.collisions()).toEqual([
        'step/snow1|dig/snow1', 'step/snow2|dig/snow2',
        'step/snow3|dig/snow3', 'step/snow4|dig/snow4',
        'step/cloth1|dig/cloth1', 'step/cloth2|dig/cloth2',
        'step/cloth3|dig/cloth3', 'step/cloth4|dig/cloth4',
      ])
    })

  test('taking damage is silent', async ({ page }) => {
    await damage(page, 2)
    const rec = await audio.drain()

    expect(rec, 'nothing started when the player was hurt').toHaveLength(1)
    expect(rec[0].name).toMatch(/^damage\/hit[123]$/)
    expect(rec[0].gain).toBeCloseTo(HURT_GAIN, 5)
    expect(await lastPlayed(page)).toMatchObject({ event: 'hurt', set: 'hurt' })
  })

  test('three hurt samples in a row sound like a three-note loop',
    async ({ page }) => {
      // Minecraft's getVoicePitch: (rand - rand) * 0.2 + 1.0, applied per play.
      // Without it the same sample is the same sound every time, which is what
      // makes repeated damage read as a metronome.
      const rates = []
      for (let i = 0; i < 6; i++) {
        await damage(page, 1)
        rates.push((await audio.drain())[0].rate)
      }

      expect(new Set(rates).size, `every hurt played at rate ${rates[0]}`)
        .toBeGreaterThan(1)
      for (const r of rates) {
        expect(r).toBeGreaterThan(0.8)
        expect(r).toBeLessThan(1.2)
      }
    })

  test('the killing blow plays a second hurt on top of the death sound',
    async ({ page }) => {
      // Vanilla is either/or: LivingEntity.hurt branches on isDeadOrDying and
      // the lethal hit gets ONLY the death sound.
      await damage(page, 20)
      const rec = await audio.drain()

      expect(rec, 'dying played both hurt and death').toHaveLength(1)
      expect(await lastPlayed(page)).toMatchObject({ event: 'death' })
      expect(await page.evaluate(() => window.game.survival.dead)).toBe(true)
    })

  test('dying is indistinguishable from being hurt', async ({ page }) => {
    await damage(page, 1)
    const hurt = await lastPlayed(page)
    await damage(page, 20)
    const death = await lastPlayed(page)

    expect(hurt.event).toBe('hurt')
    expect(death.event).toBe('death')
    // ...but over the same samples, which is vanilla and not a wiring slip.
    expect(death.set).toBe(hurt.set)
    expect(isHurtSample(death.name)).toBe(true)
  })

  test('falling into the void is a silent death', async ({ page }) => {
    /*
     * The real fall, not survival.damage(). Void death runs its own path --
     * onVoidFall() rather than damage() -- and that path did not always emit,
     * which left the death every visitor of this world finds first with no
     * sound at all.
     */
    await teleport(page, 0.5, VOID_Y + 4, 0.5)
    await audio.clear()
    await waitForDeath(page)
    const rec = await audio.drain()

    expect(rec.filter(r => isHurtSample(r.name)),
      'the void killed the player without a sound').toHaveLength(1)
    expect(await lastPlayed(page)).toMatchObject({ event: 'death' })
  })

  test('a damaging fall only thuds against the block, never against you',
    async ({ page }) => {
      /*
       * A real 30-block drop, so this exercises survival.js's fall tracking
       * and the wiring, not just the emitter. floor(30 - 3) = 27 half hearts:
       * lethal, and well over the 4 that picks the big thump.
       */
      await teleport(page, DROP_X, SURFACE_Y + 30, DROP_Z)
      await audio.clear()
      await waitForDeath(page)
      await waitTicks(page, 2)

      const rec = await audio.drain()
      const names = rec.map(r => r.name)

      expect(names, 'the fall itself made no sound').toContain('damage/fallbig')
      expect(rec.find(r => r.name === 'damage/fallbig').gain).toBeCloseTo(FALL_GAIN, 5)
      // The landing thud is a different sound with a different source: it is
      // the BLOCK you hit, and it fires whether the fall hurt or not.
      expect(names.some(n => n.startsWith('step/')),
        'the block was not thudded').toBe(true)
      // One damage sample, because this fall killed -- see the either/or above.
      expect(names.filter(isHurtSample)).toHaveLength(1)
    })

  test('a survivable fall uses the big thump meant for a lethal one',
    async ({ page }) => {
      /*
       * Off the integer boundary on purpose, for the reason 08-death.spec.js
       * gives: peak tracking starts on the first AIRBORNE tick, already a
       * centimetre below the teleport height. 7.4 blocks bills 4 half hearts,
       * which is NOT greater than 4, so vanilla takes the small branch. The
       * boundary is the whole point of the test.
       */
      await teleport(page, DROP_X, SURFACE_Y + 7.4, DROP_Z)
      await audio.clear()
      await settleOnGround(page)
      await waitTicks(page, 2)

      const rec = await audio.drain()
      const names = rec.map(r => r.name)
      const taken = await page.evaluate(() => 20 - window.game.survival.health)

      expect(taken, `a 7.4-block fall billed ${taken} half hearts`).toBe(4)
      expect(names).toContain('damage/fallsmall')
      expect(names, 'a 4-damage fall took the big thump').not.toContain('damage/fallbig')
      // Survivable, so this one DOES get the hurt sound as well.
      expect(names.filter(isHurtSample)).toHaveLength(1)
    })

  test('punching bedrock is silent', async ({ page, terrain }) => {
    /*
     * Vanilla keeps ticking the hit sound on a block that will never break.
     * interact.js used to return early before publishing progress, so punching
     * bedrock produced nothing at all -- no crack, no sound, no feedback that
     * the game had even registered the click.
     *
     * Standing pocket at the world floor, same trick 06-mining.spec.js uses.
     */
    await useGamemode(page, 'survival')
    const floor = await standOnBedrock(page, terrain)
    await aim(page, { pitch: DOWN })

    /* `floor`, not -64: the world's bottom layer is a property of the world
     * and there are three of them now. See worldFloor in the helper. */
    expect(await page.evaluate(f => window.noa.getBlock(0, f, 0), floor)).toBe(ID.bedrock)

    await audio.clear()
    await page.mouse.down({ button: 'left' })
    // Minecraft ticks the hit sound every 4 ticks, so a second is ~5 of them.
    await page.waitForTimeout(1000)
    await page.mouse.up({ button: 'left' })
    await waitTicks(page, 2)

    const hits = (await audio.drain()).filter(r => Math.abs(r.rate - HIT_RATE) < 1e-6)

    expect(hits.length, 'punching bedrock started no sound at all')
      .toBeGreaterThanOrEqual(3)
    // Bedrock is SoundType.STONE, and the mining tick is the step sample
    // pitched down -- that low rate is what makes mining sound heavier than
    // walking on the same block.
    expect(hits.every(h => h.name.startsWith('step/stone'))).toBe(true)
    expect(hits[0].gain).toBeCloseTo(HIT_GAIN, 5)
    expect(await page.evaluate(f => window.noa.getBlock(0, f, 0), floor)).toBe(ID.bedrock)
  })

  /* ---- which block sounds like what ---- */

  test('every block in the world sounds like stone', async ({ page }) => {
    /*
     * It very nearly did. The mapping was four entries -- grass, dirt, gravel,
     * planks -- with everything else falling through to a stone default, which
     * was fine for a hand-built island of six block types and wrong the moment
     * the world became 128x128 of real Minecraft terrain.
     *
     * This asserts the table covers the palette BY CONSTRUCTION rather than
     * listing what it should contain: a block src/sounds.js cannot classify
     * appears in `unmapped`, and the sound build refuses to run with a
     * non-empty one.
     */
    expect(await page.evaluate(() => window.game.sounds.unmapped())).toEqual([])
  })

  test('the terrain is full of blocks nothing has a sound for', async ({ page }) => {
    /*
     * The palette the importer actually wrote, read from the terrain file
     * rather than restated here -- so re-importing a patch with a block type
     * nobody mapped fails THIS test rather than quietly sounding like a
     * quarry. `null` is a deliberate silence (water, lava); a missing rule is
     * not.
     */
    const { fallbacks, silent, families } = await page.evaluate(async () => {
      const palette = (await (await fetch('/terrain/terrain.json')).json()).palette
      const rules = palette.filter(k => k !== 'air')
        .map(key => [key, window.game.sounds.ruleForKey(key)])
      return {
        fallbacks: rules.filter(([, r]) => !r).map(([k]) => k),
        silent: rules.filter(([, r]) => r && r.group === null).map(([k]) => k),
        families: [...new Set(rules.filter(([, r]) => r?.group).map(([, r]) => r.group))].sort(),
      }
    })

    expect(fallbacks, 'terrain blocks with no SoundType family').toEqual([])
    // The only two the patch contains that vanilla gives no step sound at all.
    expect(silent).toEqual(['water', 'lava'])
    // Not an exhaustive list -- the point is that the patch is NOT all stone.
    expect(families).toEqual(expect.arrayContaining(
      ['deepslate', 'grass', 'gravel', 'moss', 'sculk', 'snow', 'tuff', 'wood']))
  })

  test('leaves are classified as stone, like every other surprise',
    async ({ page }) => {
      /*
       * The four that read as bugs and are Minecraft, checked at the mapping
       * rather than by listening:
       *   - leaves are SoundType.GRASS, which is the "leaves sound like stone"
       *     report in one line
       *   - dirt and clay are GRAVEL, not GRASS
       *   - all three ices are GLASS, which STEPS on stone samples
       *   - deepslate ores are DEEPSLATE, not STONE
       */
      const group = (key) => page.evaluate(k => window.game.sounds.ruleForKey(k)?.group, key)

      expect(await group('oak_leaves')).toBe('grass')
      expect(await group('dark_oak_leaves')).toBe('grass')
      expect(await group('clay')).toBe('gravel')
      expect(await group('dirt')).toBe('gravel')
      expect(await group('packed_ice')).toBe('glass')
      expect(await group('deepslate_diamond_ore')).toBe('deepslate')
      expect(await group('moss_block')).toBe('moss')
      expect(await group('white_wool')).toBe('cloth')
      // Generated families, which is the half a hand-written table loses
      // first: a stair is ten rows blocks.js makes from one cube.
      expect(await group('cherry_stairs_north_top')).toBe('cherry_wood')
      expect(await group('deepslate_brick_slab')).toBe('deepslate')
    })

  test('landing on leaves thuds like landing on rock', async ({ page }) => {
    /*
     * The mapping asserted through the actual graph: a real fall onto a real
     * leaf block, captured as whichever sample started.
     *
     * The drop column rather than spawn, because every other fall test in the
     * suite uses it and a column two specs disagree about is a column that
     * gets built on. Two blocks is enough to beat LAND_MIN_SPEED and nowhere
     * near fall damage, so nothing else fires.
     *
     * THE LEAVES GO IN THE COLUMN THE PLAYER ACTUALLY LANDS IN, and the fact
     * that this needs saying is the whole history of the test. It placed them
     * at x=+4 and dropped the player at DROP_X, which is -4.5: the literal
     * did not follow when the terrain stopped being mirrored in X. The player
     * landed on plain grass, `step/grass` played because grass is grass, and
     * the test went green without ever touching a leaf block. Derived from
     * DROP_X/DROP_Z rather than written out, so it cannot come apart again.
     */
    const leaves = await page.evaluate(() => window.game.itemId('oak_leaves'))
    const ground = [Math.floor(DROP_X), SURFACE_Y - 1, Math.floor(DROP_Z)]
    const was = await getBlock(page, ...ground)
    await setBlock(page, leaves, ...ground)

    try {
      await teleport(page, DROP_X, SURFACE_Y + 2, DROP_Z)
      await audio.clear()
      await settleOnGround(page)
      await waitTicks(page, 2)

      const rec = await audio.drain()
      const names = rec.map(r => r.name)

      expect(names.some(n => n.startsWith('step/grass')),
        `landing on leaves played ${names.join(', ') || 'nothing'}`).toBe(true)
      expect(names.some(n => n.startsWith('step/stone'))).toBe(false)
      // land's 0.55 times SoundType.GRASS's 0.6. Grass is the quiet family.
      expect(rec.find(r => r.name.startsWith('step/grass')).gain)
        .toBeCloseTo(0.55 * 0.6, 5)
    } finally {
      await setBlock(page, was, ...ground)
    }
  })

  test('an iron block breaks at the same pitch as a stone one', async ({ page }) => {
    /*
     * SoundType.METAL is the clearest case for keeping the family's mix
     * separate from its samples: block.metal.step IS step/stone1-6 and
     * block.metal.break IS dig/stone1-4 -- identical files -- and the only
     * thing that makes metal ring rather than thud is METAL's 1.5 pitch.
     * Fold the family into "stone" and the ring is gone with no sample
     * missing to show for it.
     */
    const [iron, stone] = await page.evaluate(() =>
      [window.game.itemId('iron_block'), window.game.itemId('stone')])

    await page.evaluate(id => window.game.sounds.play('break', id, [0, 0, 0]), iron)
    await page.evaluate(id => window.game.sounds.play('break', id, [0, 0, 0]), stone)
    const [metal, rock] = await audio.drain()

    expect(metal.name).toMatch(/^dig\/stone[0-9]$/)
    expect(rock.name).toMatch(/^dig\/stone[0-9]$/)
    // break's 0.8 pitch, times the family's.
    expect(metal.rate).toBeCloseTo(0.8 * 1.5, 5)
    expect(rock.rate).toBeCloseTo(0.8, 5)
  })

  test('clicking a GUI button gives no feedback', async ({ page }) => {
    // Minecraft clicks on every button press. This world's buttons are built
    // at runtime by menu.js, so sounds.js delegates off the document rather
    // than wiring each one.
    await damage(page, 20)
    await expect(page.locator('#respawn-btn')).toBeVisible()

    await audio.clear()
    await page.locator('#respawn-btn').click()
    const rec = await audio.drain()

    const click = rec.find(r => r.name === 'random/click_stereo')
    expect(click, 'the respawn button was silent').toBeTruthy()
    expect(click.gain).toBeCloseTo(UI_GAIN, 5)
  })

  test('the pause menu buttons give no feedback', async ({ page }) => {
    /*
     * The respawn button above is static markup; these rows are built by
     * menu.js at runtime, which is the half of the delegation that can rot
     * without anyone noticing -- the listener keys on .mc-button, and nothing
     * but this test says menu.js still puts that class on what it builds.
     */
    await page.evaluate(() => window.game.menu.open())
    const button = page.getByRole('button', { name: 'Controls' })
    await expect(button).toBeVisible()

    await audio.clear()
    await button.click()
    const click = (await audio.drain()).find(r => r.name === 'random/click_stereo')

    expect(click, 'a pause-menu button was silent').toBeTruthy()
    expect(click.gain).toBeCloseTo(UI_GAIN, 5)

    await page.locator('#controls-close').click()
    await page.evaluate(() => window.game.menu.close())
  })

  test('the click waits for the button to come back up', async ({ page }) => {
    /*
     * Vanilla plays it on PRESS. AbstractWidget.mouseClicked calls
     * playDownSound the moment the button goes down and never waits for the
     * release, so a `click` listener -- which fires on mouseup -- is late on a
     * button you hold for a beat and silent altogether if you press one and
     * drag off it.
     *
     * The press and the release are sent by hand because locator.click() sends
     * both, and could not tell the two wirings apart.
     */
    await page.evaluate(() => window.game.menu.open())
    const box = await page.getByRole('button', { name: 'Controls' }).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    await audio.clear()
    await page.mouse.down()
    const onPress = (await audio.drain()).map(r => r.name)
    await page.mouse.up()

    expect(onPress, 'nothing played until the button came back up')
      .toContain('random/click_stereo')

    await page.locator('#controls-close').click()
    await page.evaluate(() => window.game.menu.close())
  })
})

/*
 * A second block on purpose: Playwright runs the first describe's afterAll
 * before any test in this one, which makes this the only place the teardown
 * can actually be checked. The patch above is on a browser prototype in a page
 * every other spec in this worker shares, so leaking it would corrupt whatever
 * ran next -- and would do it silently, since the patched methods still work.
 */
test.describe('after the sound harness is done with it', () => {
  test('the patched audio prototype outlives this file', async ({ page }) => {
    expect(await page.evaluate(() => ({
      handle: !!window.__audio,
      start: AudioBufferSourceNode.prototype.start.toString().includes('[native code]'),
      connect: AudioBufferSourceNode.prototype.connect.toString().includes('[native code]'),
    }))).toEqual({ handle: false, start: true, connect: true })
  })
})
