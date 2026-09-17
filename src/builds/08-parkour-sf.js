/*
 * Stage: Parkour + San Francisco.
 *
 * EMPTY ON PURPOSE, and this file is yours. Its row already exists in
 * src/builds/index.js, so you never have to edit a file anybody else is
 * editing -- fill this in and the world has your stage in it.
 *
 * Read docs/builds/README.md first, then src/builds/01-omaha.js, which is the
 * worked example this is meant to be a copy of the shape of.
 *
 * Your plot is the 'parkour' row in src/builds/plots.js. Every coordinate you
 * write here is PLOT-LOCAL: (0, 0, 0) is your north-west corner at ground
 * level, y = -1 is the grass, +x runs east toward the road, +z runs south.
 * The stamper throws if you write outside it, which is the whole reason eight
 * of these can be built at the same time.
 */

/** @param s a stamper bound to this plot -- see src/builds/stamp.js */
export function build(s) {
  // Nothing here yet. The visitor sees flat grass where this stage will be.
  void s
}
