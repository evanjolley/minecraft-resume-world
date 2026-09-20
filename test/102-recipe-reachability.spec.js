import { test, expect } from '@playwright/test'
import { RECIPES, SMELTING, TAGS } from '../src/recipes.js'
import { ITEMS, item, itemId, dropFor } from '../src/items.js'

/*
 * "A RECIPE WHOSE INGREDIENT CAN NEVER EXIST IS WORSE THAN NO RECIPE."
 *
 * That sentence is the last line of recipes.js's header. It is the file's own
 * justification for leaving out everything that needs a furnace it does not
 * have, a dye it cannot make, or a smithing table nobody built -- and the file
 * broke it twice, in the recipes closest to the sentence.
 *
 * `smelt('netherite_scrap', 'ancient_debris')` was in the smelting table and
 * NOTHING CONSUMED THE SCRAP. The only producer of netherite_ingot was
 * unpacking a netherite_block, which costs nine netherite_ingots, so the ingot
 * was a closed loop with no way in and the two recipes that wanted one -- the
 * block and the lodestone -- could never be crafted by anybody. Every item
 * existed, every recipe parsed, every spec was green.
 *
 * WHICH IS WHY THIS FILE IS A CLOSURE AND NOT A LIST. Asserting "netherite
 * ingot has a recipe" would have been satisfied by a recipe made of
 * netherite ingots. The only question worth asking is the transitive one:
 * starting from what a player can dig up, what can they eventually hold?
 *
 * No browser. This is a statement about two data files and it runs in node in
 * a few milliseconds, which is also why it can say something this broad --
 * a booted-world version of it would cost a minute to assert one recipe.
 */

/* An ingredient is an item key or a "#tag" standing for a set of them. */
const expand = (ing) => (ing.startsWith('#') ? (TAGS[ing.slice(1)] ?? []) : [ing])

const ingredientsOf = (r) => (r.type === 'shaped' ? Object.values(r.key) : r.ingredients)

/**
 * The storage blocks: a 3x3 of one ingredient that unpacks back into nine of
 * it. `packed9` writes both halves, and the PAIR IS THE TRAP -- on its own it
 * is a perfect little cycle that makes its own ingredient look obtainable.
 */
const STORAGE_BLOCKS = new Set(RECIPES
  .filter(r => r.type === 'shaped' && r.pattern.join('') === 'XXXXXXXXX'
    && Object.keys(r.key).length === 1)
  .map(r => r.result))

/**
 * Everything a player can get with a pickaxe and no crafting table: every
 * placeable block, plus everything those blocks drop when broken.
 *
 * MINUS THE STORAGE BLOCKS, and without that line this whole file is a lie.
 * The first version counted every placeable block as diggable, which put
 * netherite_block in the starting set -- so unpacking it "produced" the ingot
 * and the closure reported the chain closed WITH OR WITHOUT the recipe this
 * test exists to protect. It was caught by deleting the recipe and watching
 * the test stay green, which is the only reason to ever do that. A storage
 * block is crafted, not generated; none of the fifteen occurs in the world.
 *
 * A PICKAXE IN HAND, not an empty one. `dropFor(id, 0)` is the bare-handed
 * table and ores drop NOTHING to a bare hand, so the first version of this
 * also reported raw_iron, raw_gold and raw_copper as impossible -- three false
 * alarms that would have been three exemptions nobody could explain.
 *
 * DROPS MATTER TOO. `dropFor` returns an array of POOLS, each pool an array of
 * entries; iterating it one level deep walks the pools and never reaches an
 * id, which reported flint and clay as impossible. Every one of these three
 * mistakes was found by the exact-list assertion below rather than by reading
 * the code, which is the argument for asserting the list exactly.
 */
function minableWithoutCrafting() {
  const pick = itemId('diamond_pickaxe')
  const have = new Set()
  for (const i of ITEMS) {
    if (!i.places || STORAGE_BLOCKS.has(i.key)) continue
    have.add(i.key)
    for (const pool of dropFor(i.places, pick) ?? []) {
      for (const entry of pool) {
        const dropped = item(entry.id)
        if (dropped) have.add(dropped.key)
      }
    }
  }
  return have
}

/** Everything reachable from `base` by crafting and smelting, to a fixed point. */
function closure(base) {
  const producers = [
    ...RECIPES.map(r => ({ result: r.result, ings: ingredientsOf(r) })),
    ...SMELTING.map(s => ({ result: s.result, ings: [s.from] })),
  ]
  const have = new Set(base)
  // Fixed point rather than one pass: netherite is four links deep (debris ->
  // scrap -> ingot -> block), and a single sweep in table order would call the
  // block unreachable purely because it is written above its own ingredient.
  for (let changed = true; changed;) {
    changed = false
    for (const p of producers) {
      if (have.has(p.result)) continue
      if (!p.ings.every(i => expand(i).some(k => have.has(k)))) continue
      have.add(p.result)
      changed = true
    }
  }
  return { have, producers }
}

/*
 * The items this world genuinely cannot produce, each with the reason, because
 * an exemption list without one is a snooze button.
 *
 * Most are ENTITY drops. There are no mobs here -- ai-evan and the npcs do not
 * die and do not drop -- so leather, string, feather and gunpowder have no
 * source, and the recipes wanting them (leather armor, the bow, arrows, the
 * fishing rod) are in recipes.js's "deliberately absent" paragraph already.
 *
 * TWO OF THEM ARE THE SAME BUG NETHERITE HAD AND THEY ARE STILL HERE.
 * `packed9('hay_block', 'wheat')` and `packed9('slime_block', 'slime_ball')`
 * each write a pair whose unit has no other source in this world -- no wheat
 * crop, no slimes -- so both blocks are closed loops exactly like the ingot
 * was, and both violate the same header rule. They are LISTED rather than
 * fixed because fixing them is a judgement about what this world contains
 * (add a crop, add a mob, or delete two recipes) and not a missing recipe
 * anyone can look up. The netherite one was: vanilla has the recipe, this file
 * had left it out.
 */
const CANNOT_EXIST = [
  'amethyst_shard', // no amethyst cluster block to break
  'bow',            // needs string
  'feather',        // a chicken drop, and there are no mobs
  'gunpowder',      // a creeper drop, and there are no mobs
  'hay_block',      // needs wheat; a closed pair, see above
  'leather',        // a cow drop, and there are no mobs
  'paper',          // needs sugar_cane
  'slime_ball',     // a slime drop, and there are no mobs
  'slime_block',    // needs slime_ball; a closed pair, see above
  'string',         // a spider drop, and there are no mobs
  'sugar_cane',     // an item with no block anyone can break
  'wheat',          // no crop block, so the hay pair has no way in
]

test.describe('every recipe can actually be made', () => {
  test('the netherite chain closes, from ancient debris to a lodestone',
    () => {
      const { have } = closure(minableWithoutCrafting())

      // The instrument first. If the base set were empty this whole file would
      // report that nothing is craftable and pass nothing.
      expect(have.size, 'the closure is empty -- nothing below means anything')
        .toBeGreaterThan(300)
      expect(have.has('ancient_debris'), 'there is no ancient debris in this'
        + ' world at all, so the chain below starts nowhere').toBe(true)

      /*
       * Every link, named, because each one failed for a different reason and
       * a single assertion on the lodestone would not say which. The scrap was
       * always makeable -- it was the only link that was -- and it went
       * nowhere.
       */
      expect(have.has('netherite_scrap')).toBe(true)
      expect(have.has('netherite_ingot'), 'netherite_scrap smelts and nothing'
        + ' consumes it -- the scrap is still a dead end').toBe(true)
      expect(have.has('netherite_block'), 'netherite_block needs an ingot that'
        + ' can only come from unpacking a netherite_block').toBe(true)
      expect(have.has('lodestone'), 'the lodestone still wants an ingot nobody'
        + ' can make').toBe(true)
    })

  test('and no recipe asks for an ingredient that can never exist', () => {
    const { have, producers } = closure(minableWithoutCrafting())

    const impossible = new Set()
    for (const p of producers) {
      for (const ing of p.ings) {
        if (!expand(ing).some(k => have.has(k))) impossible.add(ing)
      }
    }

    /*
     * EXACT, not "does not contain netherite". A subset assertion goes green
     * the day someone adds a recipe for a thing nobody can hold, which is the
     * entire failure this file exists to catch -- and it is how the scrap sat
     * in the smelting table unconsumed through several passes over this code.
     * If this fails with a new name, the choice is the same one recipes.js's
     * header states: give the ingredient a source, or delete the recipe.
     */
    expect([...impossible].sort(),
      'the set of impossible ingredients changed -- either a recipe now wants'
      + ' something unobtainable, or something became obtainable and this list'
      + ' should shrink').toEqual(CANNOT_EXIST)
  })

  test('the netherite ingot is vanilla 1.21.8: shapeless, four scrap and four gold',
    () => {
      /*
       * The SHAPE, because getting the chain to close is not the same as
       * getting it right, and the plausible wrong version here is a smithing
       * recipe. It is not one: SmithingTransformRecipeBuilder is used for the
       * nine diamond-to-netherite gear upgrades and nothing else, and the
       * ingot is this, from VanillaRecipeProvider.java in the 1.21.8 decompile:
       *
       *     this.shapeless(RecipeCategory.MISC, Items.NETHERITE_INGOT)
       *         .requires(Items.NETHERITE_SCRAP, 4)
       *         .requires(Items.GOLD_INGOT, 4)
       */
      const made = RECIPES.filter(r => r.result === 'netherite_ingot')
      // Two: this one and unpacking a block. Neither is optional and neither
      // is the other one.
      expect(made.length).toBe(2)

      const fromScrap = made.find(r => ingredientsOf(r).includes('netherite_scrap'))
      expect(fromScrap, 'no recipe turns scrap into an ingot').toBeTruthy()
      expect(fromScrap.type).toBe('shapeless')
      expect(fromScrap.count).toBe(1)
      const counts = {}
      for (const i of fromScrap.ingredients) counts[i] = (counts[i] ?? 0) + 1
      expect(counts).toEqual({ netherite_scrap: 4, gold_ingot: 4 })

      const fromBlock = made.find(r => ingredientsOf(r).includes('netherite_block'))
      expect(fromBlock, 'a netherite block no longer unpacks').toBeTruthy()
      expect(fromBlock.count).toBe(9)
    })

  test('the lodestone takes an IRON ingot, which changed in 25w02a', () => {
    /*
     * 1.16 through 1.21.4 wanted a netherite ingot in the middle and 25w02a
     * swapped it for iron -- "making them renewable". This world is 1.21.8
     * everywhere else it cites a source, and 1.21.8's recipe JSON is
     * `"key": { "#": "minecraft:iron_ingot", "S": "minecraft:chiseled_stone_bricks" }`.
     * The old version is the one anyone would write from memory, which is why
     * it is asserted rather than left to a comment.
     */
    const lodestone = RECIPES.find(r => r.result === 'lodestone')
    expect(lodestone.type).toBe('shaped')
    expect(lodestone.pattern).toEqual(['SSS', 'SNS', 'SSS'])
    expect(lodestone.key).toEqual({ S: 'chiseled_stone_bricks', N: 'iron_ingot' })
  })
})
