/*
 * The launch flags, in one place, because getting them wrong doesn't fail
 * loudly -- the page loads, noa constructs, and then WebGL context creation
 * returns null and you get a black canvas with a vague Babylon warning.
 *
 * Headless Chromium's default GL path has no rasteriser, so:
 *   --use-gl=angle + --use-angle=swiftshader  route WebGL to the CPU backend
 *   --enable-unsafe-swiftshader              Chrome 119+ refuses swiftshader
 *                                            for WebGL without it
 *
 * Rejected alternative: `headless: false` under Xvfb. It works and is faster,
 * but it needs a display server nobody on macOS has, and this suite has to run
 * on whatever laptop the next agent is holding.
 */
export const GL_FLAGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
]
