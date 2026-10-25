/*
 * THE WORKER'S ENTRY POINT. Routing and Durable Object classes, nothing else.
 *
 * WHY THIS FILE EXISTS, AND WHY wrangler.toml POINTS HERE AND NOT AT index.js.
 * workerd treats EVERY named export of the main module as an entrypoint and
 * refuses to start if one is not a function, a class or a handler object.
 * worker/index.js exports `PROMPT_IS_STUB` (a boolean) and `CAPS` for its
 * spec, so with index.js as `main` the runtime died at startup:
 *
 *   Uncaught TypeError: Incorrect type for map entry 'PROMPT_IS_STUB':
 *   the provided value is not of type 'function or ExportedHandler'.
 *
 * `wrangler deploy --dry-run` bundles without starting the runtime, so it
 * never saw it; `wrangler dev` does. Keeping the entry module to a default
 * export and the Durable Object classes means index.js and worker/agent/ can
 * export whatever their tests need.
 *
 * Other routes (accounts, world persistence) belong here too: one line each.
 */
import legacy, { handleAgent } from './index.js'
import { handleEvan } from './agent/route.js'
// Sessions, passkeys, nicknames and saved worlds (worker/account, worker/world).
import { routeAccount } from './account/routes.js'

export { VisitorMemory } from './agent/visitorMemory.js'
export { Visitor } from './world/visitor.js'

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/evan') return handleEvan(request, env)
    if (pathname === '/api/agent') return handleAgent(request, env)
    const account = await routeAccount(request, env)
    if (account) return account
    return legacy.fetch(request, env, ctx)
  },
}
