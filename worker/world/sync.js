import { getVisitor, json, visitorStub } from '../account/session.js'
import { invalidSave, MAX_SAVE_BYTES } from './save.js'

/*
 * GET /api/world   -> { rev, save }
 * PUT /api/world   { baseRev, save } -> { ok, rev } | 409 { conflict, rev, save }
 *
 * Accounts only. A guest's world is local (IndexedDB) and costs the server
 * nothing; signing in is what turns on sync. That split is most of the cost
 * argument in docs/decisions.md, since most visitors never sign in.
 */
export async function handleWorld(request, env) {
  const visitor = await getVisitor(request, env)
  if (!visitor) return json({ error: 'no session' }, 401)
  if (!visitor.account) return json({ error: 'sign in to sync your world' }, 403)
  if (!env.VISITOR) return json({ error: 'storage not configured' }, 503)
  const stub = visitorStub(env, visitor.id)

  if (request.method === 'GET') return json(await stub.getSave())
  if (request.method !== 'PUT') return json({ error: 'GET or PUT' }, 405)

  const len = Number(request.headers.get('content-length') ?? 0)
  if (len > MAX_SAVE_BYTES) return json({ error: 'save too large' }, 413)
  const text = await request.text()
  if (text.length > MAX_SAVE_BYTES) return json({ error: 'save too large' }, 413)
  let req
  try { req = JSON.parse(text) } catch { return json({ error: 'bad json' }, 400) }
  if (!Number.isInteger(req?.baseRev) || req.baseRev < 0) return json({ error: 'baseRev missing' }, 400)
  const why = invalidSave(req.save)
  if (why) return json({ error: `bad save: ${why}` }, 400)

  const res = await stub.putSave(req.baseRev, req.save)
  return json(res, res.ok ? 200 : 409)
}
