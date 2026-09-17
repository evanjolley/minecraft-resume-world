/*
 * THE TWO WORLDS, PHOTOGRAPHED, AND THEN PHOTOGRAPHED AGAIN AFTER A SWITCH.
 *
 * test/01-world.spec.js already censuses both patches and proves the chunk
 * store really swaps. This file is the other instrument, and it exists for
 * the same reason test/51-worlds.spec.js ends with a photograph of the
 * mountains: the owner's request was not a number. It was "make the default a
 * fresh superflat and keep the built one under a name", and the only way to
 * check that is to look at both.
 *
 * WHY THE THIRD TEST IS NOT A REPEAT OF THE FIRST TWO. A world change
 * invalidates every chunk and re-emits worldDataNeeded for each; a chunk of
 * the other world surviving that is a rendering failure, not a data failure,
 * so it does not show up in any voxel probe -- only in a picture. The pairs
 * below are taken in ONE page, after switching in both directions, which is
 * the state a probe from a freshly booted world can never reach.
 *
 * Every shot asserts the block under the player first. A screenshot of an
 * unmeshed void passes silently otherwise, and this repo has shipped a probe
 * that measured nothing.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures.js'
import {
  SURFACE_Y, waitFrames, waitTicks, look, position,
  BUILT_WORLD, enterWorld, leaveWorld,
} from './helpers/world.js'

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

/** What is under the player's feet, by key, out of noa's chunk store -- so it
 *  is the meshed world and not the generator that answers. */
const underfoot = (page) => page.evaluate(() => {
  const noa = window.noa
  const [x, y, z] = noa.ents.getPositionData(noa.playerEntity).position.map(Math.floor)
  return window.game.blockKey(noa.getBlock(x, y - 1, z))
})

/** Look up the timeline and take one. The two worlds run OPPOSITE WAYS --
 *  claude-opus-5-1 spawns at the south end of its road and walks north, the
 *  overworld spawns at the north end of its path and walks south -- so the
 *  heading is per world rather than a constant. */
async function frame(page, name, heading = Math.PI) {
  await look(page, { heading, pitch: 0.05 })
  await waitFrames(page, 8)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

test.afterEach(async ({ page }) => { await leaveWorld(page) })

test('the default overworld: the path running south into the landscape',
  async ({ page }) => {
    await waitTicks(page, 10)
    const [, y] = await position(page)
    expect(y).toBeCloseTo(SURFACE_Y, 1)
    /*
     * IT WAS 'grass' HERE FOR A DAY, when the default world was the bare
     * superflat the owner asked to build in himself. He then asked for a
     * landscape to build IN, so spawn is the head of the path: the block
     * under your feet is worn ground, at the same height the grass was.
     * Which key exactly is a coordinate hash's business -- src/builds/land.js
     * mixes seven of them -- so this asserts the two things that are
     * properties of the world rather than of the noise.
     */
    const under = await underfoot(page)
    expect(under).not.toBe('grass')
    expect(under).not.toBe('air')
    await frame(page, '74-overworld-spawn', 0)
  })

test(`${BUILT_WORLD}: the road running north with the timeline on it`,
  async ({ page }) => {
    await enterWorld(page, BUILT_WORLD)
    // Paving, not grass: you arrive on the road, under the arch.
    expect(['polished_andesite', 'smooth_quartz']).toContain(await underfoot(page))
    await frame(page, '74-claude-opus-5-1-spawn')
  })

test('both of them again, after switching back and forth in one session',
  async ({ page }) => {
    test.setTimeout(120_000)

    await enterWorld(page, BUILT_WORLD)
    await leaveWorld(page)
    // Home, with the built world's chunks having been meshed a second ago.
    expect(await underfoot(page)).not.toBe('grass')
    expect(await underfoot(page)).not.toBe('air')
    await frame(page, '74-overworld-after-switch', 0)

    await enterWorld(page, BUILT_WORLD)
    expect(['polished_andesite', 'smooth_quartz']).toContain(await underfoot(page))
    await frame(page, '74-claude-opus-5-1-after-switch')
  })
