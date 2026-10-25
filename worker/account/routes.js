import { handleSession, handleLogout, json } from './session.js'
import { registerOptions, registerVerify, loginOptions, loginVerify } from './passkey.js'
import { handleProfile } from './profile.js'
import { handleWorld } from '../world/sync.js'

/*
 * Every accounts and world route, behind one function so worker/index.js
 * needs a single line to mount them:
 *
 *   const res = await routeAccount(request, env); if (res) return res
 *
 * Returns null for any path it does not own.
 */

const ROUTES = {
  '/api/session': { POST: handleSession },
  '/api/session/logout': { POST: handleLogout },
  '/api/profile': { GET: handleProfile, PUT: handleProfile },
  '/api/world': { GET: handleWorld, PUT: handleWorld },
  '/api/auth/passkey/register/options': { POST: registerOptions },
  '/api/auth/passkey/register/verify': { POST: registerVerify },
  '/api/auth/passkey/login/options': { POST: loginOptions },
  '/api/auth/passkey/login/verify': { POST: loginVerify },
}

export async function routeAccount(request, env) {
  const url = new URL(request.url)
  const route = ROUTES[url.pathname]
  if (!route) return null
  const handler = route[request.method]
  if (!handler) return json({ error: `${Object.keys(route).join(' or ')} only` }, 405)

  /*
   * Same-origin for anything that changes state. The session cookie is
   * SameSite=Strict already; this is the second lock on the same door, and
   * it costs one comparison. A request with no Origin (curl, a test) passes:
   * it cannot be carrying a victim's cookie from another site.
   */
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin')
    if (origin && origin !== url.origin) {
      const allowed = env.PASSKEY_ORIGIN && origin === env.PASSKEY_ORIGIN
      if (!allowed) return json({ error: 'cross-origin' }, 403)
    }
  }

  try {
    return await handler(request, env)
  } catch (e) {
    console.error('account route', url.pathname, e?.stack ?? e)
    return json({ error: 'internal error' }, 500)
  }
}
