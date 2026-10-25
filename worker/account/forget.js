import { getVisitor, json, sessionResponse, newVisitorId, visitorStub } from './session.js'
import { memoryClient } from '../agent/visitorMemory.js'

/*
 * POST /api/account/forget -- "Forget me", from the Profile screen.
 *
 * Everything the server holds about the visitor in the signed session, in
 * one request:
 *
 *   - their Visitor object (passkeys, nickname, saved world), if they signed in
 *   - AI Evan's memory of them (VisitorMemory.forget, which deletes the
 *     transcript and the summary)
 *
 * and then a brand new guest session, so the next request is a stranger.
 * The browser clears its own copies (IndexedDB, localStorage) itself; see
 * forgetEverything in src/profileScreen.js.
 *
 * Keyed ONLY by the signed session. There is no body: a request cannot name
 * whom to forget, so it can only ever forget the person sending it.
 *
 * A passkey still saved on the visitor's device is harmless afterwards: its
 * public key is gone, so login with it answers "unknown passkey".
 */
export async function handleForget(request, env) {
  const visitor = await getVisitor(request, env)
  if (!visitor) return json({ error: 'no session' }, 401)

  const forgot = { account: false, memory: false }
  if (env.VISITOR) {
    await visitorStub(env, visitor.id).forget()
    forgot.account = true
  }
  if (env.VISITOR_MEMORY) {
    await memoryClient(env.VISITOR_MEMORY.get(env.VISITOR_MEMORY.idFromName(visitor.id))).forget()
    forgot.memory = true
  }
  return sessionResponse(env, newVisitorId(), false, { forgot })
}
