/*
 * WHAT A VISITOR MAY CALL THEMSELVES.
 *
 * One pure function, imported by BOTH sides: the browser runs it for instant
 * feedback, and the Worker (worker/account/profile.js) runs the same code as
 * the authority for any name it is asked to store. Shared rather than written
 * twice, because two filters that agree today are two filters that disagree
 * after the first edit.
 *
 * WHY A CLIENT COPY IS ACCEPTABLE NOW. identity.js used to argue that a
 * wordlist cannot live in the client being filtered, and in a shared world
 * that is right. This world is single player (docs/SPRINT-1.md item 6): a
 * visitor's nickname is shown to that visitor and to AI Evan, nobody else.
 * Getting around the client copy therefore only changes what a person sees
 * in their own tab. What still matters is the copy that reaches the SERVER,
 * which is the name an account stores and the name AI Evan is told, and the
 * Worker runs this same function on it.
 *
 * THREE RULES, in the order they are checked, each with its own message so
 * the screen can say which one you hit:
 *
 *   1. syntax       vanilla's username shape, 1-16 of [A-Za-z0-9_]. Keeps a
 *                   nametag from being a paragraph of RTL override marks.
 *   2. impersonation  nothing that reads as Evan himself, or as staff. The
 *                   NPC is "[Admin] Evan" in chat, and a visitor called
 *                   "Evan" or "EvanJolley" makes a screenshot of the chat log
 *                   indistinguishable from Evan saying something. Plain
 *                   "EvanK" stays legal: plenty of visitors are called Evan.
 *   3. slurs        a short list, matched after undoing the usual leetspeak.
 */

export const MAX_NAME_LENGTH = 16
const LEGAL_SHAPE = /^[A-Za-z0-9_]{1,16}$/

/*
 * The lists are base64 so that the repo's source view on GitHub does not
 * display slurs in plain text. That is the only reason. It is not secrecy:
 * anyone can decode it, and the filter does not depend on it being hidden.
 *
 *   SUBSTRING  matched anywhere in the normalized name. Only stems that are
 *              not part of ordinary words or common names belong here.
 *   EXACT      matched against the whole normalized name, with trailing
 *              digits dropped ("word123"). For short stems that would hit
 *              innocent names as substrings (Nazir, torpedo, raccoon).
 */
const decode = (b64) => atob(b64).split(',')
const SUBSTRING = decode('bmlnZyxuaWdyLGZhZ2dvdCxmYWdvdCxyZXRhcmQsY2hpbmssd2V0YmFjayx0cmFubnksY3VudCx3aG9yZSxyYXBpc3QsaGl0bGVyLHRvd2VsaGVhZCxyYWdoZWFkLHNoZW1hbGUscG9ybixwZW5pcyx2YWdpbmEscHVzc3ksc2x1dCxiaXRjaCxmdWNrLHNoaXQsa2trLG1vbGVzdCxraWxseW91cnNlbGY=')
const EXACT = new Set(decode('ZmFnLGZhZ3Msc3BpYyxnb29rLGR5a2UsY29vbixraWtlLHBha2ksYmVhbmVyLGN1bSxjb2NrLGRpY2sscmFwZSxzaWVnLG5pZyxuaWdhLGFuYWwsYW51cyxzZXgsaml6eix0d2F0LG5hemksaGVpbCxwZWRvLGt5cw=='))

/* Raw-digit patterns checked before leetspeak mapping turns them into letters. */
const RAW = ['1488', '88h', 'h88']

/*
 * Names that read as Evan, or as someone with authority over this world.
 * Matched against the normalized name with trailing digits dropped, so
 * "Evan_Jolley", "3van" and "Admin2" all land here.
 */
const STAFF = new Set(['admin', 'administrator', 'mod', 'moderator', 'owner', 'op',
  'operator', 'server', 'console', 'system', 'staff', 'dev', 'developer', 'herobrine'])
const EVAN_EXACT = new Set(['evan', 'evanj', 'aievan', 'realevan', 'theevan',
  'evanreal', 'evanofficial', 'officialevan', 'notevan', 'evanai', 'evanbot', 'evanadmin'])

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', 2: 'z', 6: 'g' }

/** Lowercase, leetspeak undone, underscores gone. */
export function normalizeName(name) {
  return String(name).toLowerCase().replace(/[0-9]/g, (d) => LEET[d] ?? d).replace(/_/g, '')
}

/** Runs of a letter collapsed to one: "fuuuck" -> "fuck"-shaped. */
const collapse = (s) => s.replace(/(.)\1+/g, '$1')

/**
 * @returns {{ ok: true, name: string } | { ok: false, reason: 'empty'|'shape'|'evan'|'staff'|'blocked', message: string }}
 */
export function checkNickname(raw) {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) return { ok: false, reason: 'empty', message: 'Pick a name first.' }
  if (!LEGAL_SHAPE.test(name)) {
    return { ok: false, reason: 'shape',
      message: `Names are 1-${MAX_NAME_LENGTH} letters, digits or underscores.` }
  }

  const lower = name.toLowerCase()
  const norm = normalizeName(name)
  // Trailing digits dropped from the ORIGINAL before mapping, so "Admin2"
  // is "admin" and not "adminz".
  const base = normalizeName(name.replace(/[0-9_]+$/, '')) || norm

  if (EVAN_EXACT.has(base) || norm.includes('jolley')) {
    return { ok: false, reason: 'evan', message: 'That name belongs to Evan. Pick another?' }
  }
  if (STAFF.has(base)) {
    return { ok: false, reason: 'staff', message: 'That name is reserved. Pick another?' }
  }

  const squashed = collapse(norm)
  const blocked = RAW.some((r) => lower.includes(r))
    || EXACT.has(base) || EXACT.has(norm) || EXACT.has(collapse(base))
    || SUBSTRING.some((s) => norm.includes(s)
      || (collapse(s).length >= 3 && squashed.includes(collapse(s))))
  if (blocked) return { ok: false, reason: 'blocked', message: 'That name is not allowed here.' }

  return { ok: true, name }
}

export const isAllowedNickname = (name) => checkNickname(name).ok
