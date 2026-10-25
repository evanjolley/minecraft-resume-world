import { getVisitor, json, visitorStub } from './session.js'
import { checkNickname } from '../../src/nickname.js'

/*
 * PUT /api/profile { nickname }
 *
 * The server half of the nickname filter. The browser runs the same
 * src/nickname.js first for instant feedback; this is the copy a modified
 * client cannot skip, and it guards the only names that leave the browser:
 * the one an account stores, and (through the AI EVAN side) the one the
 * model is told.
 *
 * For a guest the name is checked and echoed but not stored, because a guest
 * has no server-side record and creating one per rename would be a write per
 * visitor for nothing. Their name lives in localStorage.
 */
export async function handleProfile(request, env) {
  const visitor = await getVisitor(request, env)
  if (!visitor) return json({ error: 'no session' }, 401)
  if (request.method === 'GET') {
    if (!visitor.account || !env.VISITOR) return json({ nickname: null, account: visitor.account })
    const profile = await visitorStub(env, visitor.id).getProfile()
    return json({ nickname: profile?.nickname ?? null, account: true })
  }
  let req
  try { req = await request.json() } catch { return json({ error: 'bad json' }, 400) }
  const check = checkNickname(req?.nickname)
  if (!check.ok) return json({ ok: false, reason: check.reason, error: check.message }, 422)
  if (visitor.account && env.VISITOR) await visitorStub(env, visitor.id).setNickname(check.name)
  return json({ ok: true, nickname: check.name, stored: visitor.account })
}
