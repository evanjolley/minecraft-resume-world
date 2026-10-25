/*
 * The passive mobs' loot tables, as pure data, so that something with no
 * renderer can ask what a mob drops: src/mobs.js rolls them, and
 * test/102-recipe-reachability.spec.js counts them as a way to obtain an item.
 *
 * Each row is [item key, min, max], vanilla 1.21's entity loot tables with no
 * Looting: cow 0-2 leather and 1-3 beef, pig 1-3 porkchop, sheep its wool and
 * 1-2 mutton, chicken 0-2 feathers and 1 raw chicken. A sheep's wool row is
 * its own color; `wool` defaults to white for a caller that has no sheep.
 */
export const MOB_LOOT = {
  cow: () => [['leather', 0, 2], ['beef', 1, 3]],
  pig: () => [['porkchop', 1, 3]],
  sheep: ({ wool = 'white' } = {}) => [[`${wool}_wool`, 1, 1], ['mutton', 1, 2]],
  chicken: () => [['feather', 0, 2], ['chicken', 1, 1]],
}

/** Plus the egg a chicken lays. Every item key a living mob can give you. */
export const MOB_ITEMS = [...new Set([
  ...Object.values(MOB_LOOT).flatMap(f => f({}).map(([k]) => k)),
  'egg',
])]
