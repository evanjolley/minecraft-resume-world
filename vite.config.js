export default {
  server: { port: 5173 },
  // es2022 rather than es2020 for TOP-LEVEL AWAIT, which main.js uses to gate
  // boot on the terrain asset. Every browser that can run WebGL2 has it.
  build: { target: 'es2022' },
}
