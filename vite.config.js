/*
 * WORLD_API_PROXY=http://localhost:8787 points /api at a running
 * `wrangler dev`, so the game served by vite can talk to the real Worker
 * (sessions, passkeys, saved worlds). Pair it with VITE_WORLD_API=1, which
 * tells src/account.js the API exists. Off by default: plain `npm run dev`
 * and the test suite stay fully offline, exactly as before.
 */
const apiProxy = process.env.WORLD_API_PROXY
  ? { '/api': { target: process.env.WORLD_API_PROXY, changeOrigin: false } }
  : undefined

export default {
  server: { port: 5173, proxy: apiProxy },
  // es2022 rather than es2020 for TOP-LEVEL AWAIT, which main.js uses to gate
  // boot on the terrain asset. Every browser that can run WebGL2 has it.
  build: { target: 'es2022' },
}
