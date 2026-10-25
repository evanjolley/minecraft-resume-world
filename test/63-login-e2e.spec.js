import { test, expect } from '@playwright/test'
import { bootWorld, waitForWorld, chatCommand, waitTicks } from './helpers/world.js'

/*
 * SIGN IN ON ONE DEVICE, PICK UP THE SAME WORLD ON ANOTHER.
 *
 * The whole loop through the real Worker: guest session, nickname, a block
 * edit, upgrading to an account with a passkey, syncing, then a second
 * browser context (a second device) that signs in with the same passkey and
 * finds the name and the block waiting.
 *
 * NEEDS A RUNNING WORKER, so it is skipped unless WORLD_API_E2E=1. Run it as:
 *
 *   npm run prompt:ci       # the Worker imports the generated prompt
 *   mkdir -p dist           # wrangler.toml's [assets] directory must exist
 *   npx wrangler@4 dev --port 8797 \
 *     --var SESSION_SECRET:local-dev-secret-at-least-32-characters \
 *     --var PASSKEY_RP_ID:localhost --var PASSKEY_ORIGIN:http://localhost:5173
 *   WORLD_API_PROXY=http://localhost:8797 VITE_WORLD_API=1 npm run dev
 *   WORLD_API_E2E=1 npx playwright test -c test/playwright.config.js \
 *     test/63-login-e2e.spec.js --project=chromium
 *
 * Nothing here creates a Cloudflare resource: `wrangler dev` runs the Worker
 * and its Durable Object in a local workerd, with state under .wrangler/.
 *
 * CHROMIUM ONLY, because the passkey is Chromium's virtual authenticator
 * driven over CDP. The same credential is copied into the second context,
 * which is exactly what a synced passkey (iCloud Keychain, Google Password
 * Manager) does between a person's devices.
 */

test.skip(!process.env.WORLD_API_E2E, 'needs wrangler dev; see the header')
test.skip(({ browserName }) => browserName !== 'chromium', 'virtual authenticator is CDP')

async function device(browser) {
  const context = await browser.newContext()
  await context.addInitScript(() => localStorage.setItem('world:persist', '1'))
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } })
  return { context, page, cdp, authenticatorId }
}

const state = (page) => page.evaluate(() => ({ ...window.game.account.state,
  name: window.game.roster.displayNameOf(window.game.LOCAL_ID) }))

test('a passkey carries the name and the world to a second device', async ({ browser }) => {
  test.setTimeout(180_000)

  /* ---- device A: a guest who names themselves, builds, and signs up ---- */
  const a = await device(browser)
  await bootWorld(a.page)
  await a.page.waitForFunction(() => window.game.account.state.online, null, { timeout: 10_000 })
  const guest = await state(a.page)
  expect(guest).toMatchObject({ account: false, login: true, name: 'Guest' })
  expect(guest.visitor).toMatch(/^v_/)

  await chatCommand(a.page, '/nick Casey')
  const key = await a.page.evaluate(() => {
    const g = window.game
    const k = g.blockKey(g.voxelAt(3, 137, 3)) === 'stone' ? 'dirt' : 'stone'
    window.noa.setBlock(g.ids[k], 3, 137, 3)
    return k
  })
  await waitTicks(a.page, 2)

  await a.page.evaluate(() => window.game.menu.open())
  await a.page.click('#profile-open')
  await a.page.getByRole('button', { name: 'Create Passkey' }).click()
  await expect(a.page.locator('#profile-status')).toContainText('Signed in', { timeout: 15_000 })
  const signedUp = await state(a.page)
  expect(signedUp).toMatchObject({ account: true, visitor: guest.visitor, nickname: 'Casey' })
  const synced = await a.page.evaluate(() => window.game.persist.sync())
  expect(synced.ok).toBe(true)

  const { credentials } = await a.cdp.send('WebAuthn.getCredentials', { authenticatorId: a.authenticatorId })
  expect(credentials).toHaveLength(1)

  /* ---- device B: a stranger's browser, until the same passkey signs in ---- */
  const b = await device(browser)
  await b.cdp.send('WebAuthn.addCredential', { authenticatorId: b.authenticatorId, credential: credentials[0] })
  await bootWorld(b.page)
  await b.page.waitForFunction(() => window.game.account.state.online, null, { timeout: 10_000 })
  expect((await state(b.page)).visitor).not.toBe(guest.visitor)
  expect(await b.page.evaluate(() => window.game.blockKey(window.noa.getBlock(3, 137, 3)))).not.toBe(key)

  await b.page.evaluate(() => window.game.menu.open())
  await b.page.click('#profile-open')
  // Signing in as someone else reloads the page into their world.
  await Promise.all([
    b.page.waitForEvent('load', { timeout: 30_000 }),
    b.page.getByRole('button', { name: 'Sign In' }).click(),
  ])
  await waitForWorld(b.page)
  await b.page.waitForFunction(() => window.game.account.state.online, null, { timeout: 10_000 })
  expect(await state(b.page)).toMatchObject({ account: true, visitor: guest.visitor, name: 'Casey' })
  expect(await b.page.evaluate(() => window.game.blockKey(window.noa.getBlock(3, 137, 3)))).toBe(key)

  /* ---- and a forged token is not anyone ---- */
  const forged = await b.page.evaluate(async () => {
    const token = localStorage.getItem('world:v1:session')
    const [v, payload, mac] = token.split('.')
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    const evil = btoa(JSON.stringify({ ...claims, v: 'v_AAAAAAAAAAAAAAAAAAAAAA' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const res = await fetch('/api/world', { headers: { authorization: `Bearer ${v}.${evil}.${mac}` } })
    return res.status
  })
  expect(forged).toBe(401)

  await a.context.close()
  await b.context.close()
})
