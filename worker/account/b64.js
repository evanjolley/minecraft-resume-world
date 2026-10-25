/*
 * base64url, the encoding WebAuthn and the session token both speak.
 * Workers have atob/btoa and nothing for the url-safe alphabet, so these four
 * lines exist instead of a dependency.
 */

export function bytesToB64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlToBytes(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('bad base64url')
  const pad = str.length % 4 === 2 ? '==' : str.length % 4 === 3 ? '=' : ''
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const utf8 = (s) => new TextEncoder().encode(s)
export const fromUtf8 = (b) => new TextDecoder().decode(b)

export function randomB64url(n = 32) {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(n)))
}
