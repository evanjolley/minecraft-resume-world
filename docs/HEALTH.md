# Code health sweep

REPORTED #11, run 2026-09-16 against `13fe818`, alone.

A consolidation pass after ~25 commits from a dozen parallel agents. The brief
was "bias hard toward finding over changing." It turned into something else
about ten minutes in, because the world was not rendering.

**Scope note that matters for anyone reading this file as a health metric:**
`src/` is ~59% comments by design and that is not a finding. 10,772 lines of
code. Nothing below proposes cutting a comment, except the handful that are
factually wrong, which are called out as wrong.

---

## 0. FIXED — the world was invisible (`d9bb22e`)

The highest-severity item in this document, and it was not on the list. The
owner reported it mid-sweep: *"no blocks are rendering. I am standing on
something but everything is just the color of the sky."*

Collision worked because collision never asks the GPU anything. The console
said:

```
BJS: Unable to compile effect:
BJS: Error: FRAGMENT SHADER ERROR: 0:324: 'uDaylight' : undeclared identifier
```

Every terrain material failed to compile, so Babylon refused to draw terrain
and the skybox showed through the ground.

**Cause.** `src/blockLight.js:341` declared its uniform as
`ubo: [{ name: 'uDaylight', size: 1, type: 'float' }]`. An entry *with* `size`
and `type` routes the GLSL declaration into `_uboDeclaration`
(`materialPluginManager.js:204-213`), which is injected by replacing the token
`#define ADDITIONAL_UBO_DECLARATION`. These terrain materials never emit that
token — they compile plain uniforms (`uniform vec4 vDiffuseColor;`), not a
Material block. `String.replace` on a missing token returns the string
unchanged and reports nothing, so the *name* reached the effect's uniform list
while the *declaration* evaporated.

**This is the third variant of one trap, and the second one today.**
`src/terrainAnimation.js:377` hit it via `fragment:` and the token
`ADDITIONAL_FRAGMENT_DECLARATION`. `blockLight.js` hit it via `ubo:` and the
token `ADDITIONAL_UBO_DECLARATION`. Both tokens are absent from every shader in
Babylon 6. Neither route ever complains.

**Fix**, matching the pattern the file next door had already proven on this
exact material: register the name only (no `size`/`type`), declare
`uniform float uDaylight;` by hand in `CUSTOM_FRAGMENT_DEFINITIONS`, and bind
with `effect.setFloat` instead of `uniformBuffer.updateFloat` — which had no
block slot to write into and was silently doing nothing.

**Introduced by `c392ffc`** ("Every face of a block has its own brightness").
Two further commits landed on top of an invisible world.

### The part that should worry you more than the bug

**The regression test already existed and already worked. Nobody ran it.**

`test/43-browsers.spec.js:31` is literally named *"no terrain shader fails to
compile"* and greps boot errors for `/SHADER ERROR|Unable to compile effect/i`.
`test/01-world.spec.js:9` asserts boot errors are empty. The broken build
emitted console text those two match. They would have failed.

They cost **8.5 seconds together**. The suite is ~2 hours, so every agent
today — correctly, under instruction — ran only targeted specs, and the two
cheapest specs in the repo happen to be the ones that catch "the game does not
render."

**Recommendation, and I think it is the single highest-value process change
available:** add a `smoke` script and require it before every commit.

```json
"smoke": "playwright test -c test/playwright.config.js test/01-world.spec.js test/43-browsers.spec.js --project=chromium"
```

No new framework, no new assertion, no new file. It makes an existing guard
un-skippable. I did not add it myself because it changes the committing
workflow and that is the owner's call.

**Caveat I want to be honest about:** I confirmed this fix headlessly under
SwiftShader and by screenshot. The report was from a real GPU. The failure
mode was a hard compile error that reproduced identically headless, so I am
confident — but I did not verify on the owner's machine.

---

## 1. FIXED — `resetWorld` never restored `doWeatherCycle` (`e813b85`)

`test/helpers/world.js:69` hardcoded
`['doDaylightCycle', 'fallDamage', 'naturalRegeneration']`. That is the content
of `authority.js`'s *static* `GAMERULES` object, not the table at runtime:
`src/weather.js:101` registers `doWeatherCycle` at install time. A weather spec
failing between disabling and re-enabling it leaked a frozen weather clock into
every following spec.

Now derived from the live table via a new `authority.gameruleNames()`.

The asymmetry is worth keeping in mind: block ids and the OP passphrase in that
file stay duplicated *on purpose*, so a renumber breaks tests loudly. This one
had to be derived, because forgetting a new rule fails as invisible pollution
rather than as a red test.

Verified: `test/16-weather.spec.js` + `test/01-world.spec.js`, 22 passed.

---

## 2. Cross-spec world pollution — a class, and it is worse than reported

`resetWorld` restores: keys, mouse, open screens, OP/gamemode/gamerules,
survival, inventory, drops, the fluid-flow *queue*, position, camera, clock.

It does **not** restore: voxels (delegated to the `terrain` fixture),
`fluids.flow.setEnabled`, weather, dimension, NPC state, perspective,
`terrainAnim.setPaused`, furnaces, mid-air tick pins, `gravityMultiplier`.

Ranked by blast radius. **None of these are fixed** — each needs a spec run to
prove, and the brief's batch-size rule made that a poor use of the remaining
time. Ordered so the first one unblocks the known failure.

1. **`test/41-fluid-flow.spec.js:108`** — `flow.setEnabled(false)`, never
   re-enabled, no `afterEach`/`afterAll` in the file. Every later fluid spec
   (19, 30, 45, 46, 57, 62, 64, 69) gets a **dead flow engine**. Specs 39 and
   64 wrote explicit teardowns for exactly this reason and say so in comments;
   41 invented the pattern and never adopted it. **Biggest radius in the
   suite.**
2. **`test/41-fluid-flow.spec.js:95-140`** — `buildTray` leaves a 25×25 stone
   floor at y=239 **directly over spawn**, ~925 voxels plus poured fluids, in
   11 tests, never removed. A ceiling 104 blocks over the spawn column puts
   spawn in shadow — which is a sky-light input, so this plausibly feeds the
   same failure as #3.
3. **`test/58-glowstone-radial.spec.js:455`** — the reported one, confirmed
   exactly. That test destructures `{ page }` only; the six other tests in the
   file take the `terrain` fixture. Three glowstones at spawn ±6/±7 are never
   removed, shattering greedy-merged floor quads, and
   `test/65-sky-light.spec.js:428` blows its `verts < 3000` budget at 6,484.
   **Smallest, most contained fix: add `terrain` to the signature and a
   `terrain.keep` box. Do this one first.**
4. **`test/57-flowing-water.spec.js:65-90`** — `buildChannel` called from 8
   test bodies, never undone, no `terrain` fixture in the file; plus `:69`
   `setEnabled(false)` never re-enabled. This is very likely the cause of the
   reported order-dependent failure of *"standing in a run makes the water
   noise."*
5. **`test/62-flow-drag.spec.js:77-110`** — same channel rig over spawn; `:81`
   disables flow and re-enables only at **`:339`, inside the last test body**.
   Any earlier failure leaks a dead engine.
6. **`test/46-water-look.spec.js:52-122`** — `buildCliff` leaves a plateau and
   frozen waterfall at y≈236-250; `:56` disables flow, never re-enables. Its
   own comment at `:25` says the site was chosen not to share a chunk with
   41's tray — an admission that neither cleans up.
7. **`try/finally` gaps** — a block is placed, an assertion runs, the block is
   restored, and a failed assertion skips the restore:
   `test/38-npc-body.spec.js:137`, `:229`, `:619`;
   `test/11-commands.spec.js:342`.
8. **`test/42-furnace.spec.js:38`** — clears furnaces before its own tests,
   never after. `test/45-buckets.spec.js:271` defensively clears them, which is
   the tell.

**Not a problem, checked:** `resetWorld` wiring is consistent. It is in the
auto-used `page` fixture and no spec imports `@playwright/test` directly.

---

## 3. Fossils — the world changed underneath the suite, twice

The overworld is **no longer imported Minecraft terrain**. It is a generated
superflat (`src/flatworld.js`, Classic Flat: bedrock 132, dirt 133-134, grass
135, feet at `SURFACE_Y = 136`). `test/01-world.spec.js:134` asserts this.

So an entire layer of reasoning in the suite is fossil: **no canopy, no trees,
no peak at y=177, no bedrock at y=-64.**

### Live, failing or vacuous

- **`test/16-weather.spec.js:511`** — `teleport(page, 0, 68, 0)` in survival,
  64 blocks below the bedrock floor. The player is in the void and
  `shot(page, 'clouds-sunset')` photographs nothing. Same fossil family as the
  y=76 one fixed today.
- **`test/12-sounds.spec.js:351`** — places oak leaves at **x=+4**, then
  teleports to `DROP_X` = **−4.5** to land on them. `DROP_X` flipped sign when
  the terrain stopped being mirrored in X; this literal did not follow. The
  player lands on plain grass, `step/grass` plays anyway, **the test passes and
  can no longer fail.** Worst kind: green and meaningless.
- **`test/25-orientation.spec.js:113-121`, `:132-138`** — still asserts
  `east === 159`, `west === 143` ("frozen peaks east of spawn") and
  `surfaceY(0,0) === 140` ("dark oak leaves overhead"). A superflat returns 135
  everywhere. This matches the reported 2 failing tests. The bounds test at
  `:91-99` is genuinely fine.
- **`test/17-non-cube.spec.js:46-47`** — rigs at y=72 and y=76, the old
  sea-level band, now 60 blocks below the world floor in open void. Probably
  still passes (setBlock round-trips in an empty loaded chunk), so it has
  quietly stopped testing placement. Note `RIG` at `:59` *was* migrated to
  y=200 with a careful comment — the migration touched one of three constants.

### Fossil comments — factually wrong, safe to correct in place

Listed because the brief says wrong comments are the one welcome edit, and
because these actively mislead the next agent. I did not edit them; several
are load-bearing prose the owner may want to rewrite himself.

- `test/helpers/world.js:12-17` — "the world is now a 128x128 patch of real
  Minecraft terrain." It is a superflat.
- `test/helpers/world.js:32-48` — the whole `DROP_X` rationale ("spawn is under
  a dark forest canopy, leaves at y=139 and y=140"). Every column is now clear
  to the sky. The constant is still used widely; only its reason is dead.
- `test/helpers/world.js:145-151` — "bedrock is at y=-64." It is at 132.
- `test/helpers/world.js:732-760` — `usePad`'s justification ("real Minecraft
  terrain has no flat place… one packed-ice corridor"; "y=200 is 23 above the
  highest terrain at y=177"). **The world is now entirely flat, so `usePad`
  itself may be obsolete** — worth deciding deliberately rather than leaving.
- Repeats of the dead y=177 peak: `test/19-fluids.spec.js:65`,
  `test/41-fluid-flow.spec.js:55`, `test/46-water-look.spec.js:24`,
  `test/57-flowing-water.spec.js:58`, `test/17-non-cube.spec.js:51`.
- `test/38-npc-body.spec.js:680` — "he stands in dense forest… every spot that
  looks like a camera position is inside a trunk." No trunks.
- `test/58-glowstone-radial.spec.js:456` — "back on the island." (`:490` in the
  same file correctly says "superflat," so this one is half-migrated.)

### Checked and fine, so nobody re-chases them

`VOID_Y = -70` (08, 12, 30) matches `src/island.js:245`. The y=200-ish rigs in
19, 30, 42, 44, 17, 66, 39 and `PAD_Y` are all above a 136-high world and
restore themselves. `FLOOR = SURFACE_Y` in 25/36/56/65/67/68 is correctly
derived. `test/23-debug-screen.spec.js` reads position live rather than
asserting literals.

---

## 4. The undocumented three-way meshChunk contract — **still undocumented**

`src/blockLight.js` and `src/fluidGeometry.js` both wrap noa's `meshChunk`, they
stack, **order matters**, and all three depend on noa's 4-vertices/6-indices
per quad layout (`pos.length / 12`, `idx[f*6+i] - f*4`). The quad-split agent
gave up vertex sharing — a third cheaper — specifically to preserve this.

This is written down nowhere. The brief called it "the single highest-value
documentation act available" and **I did not get to it**, because the render
regression took the budget. It is the first thing I would do with another
hour. It wants a short section in `docs/lighting.md` that all three files point
at with a one-line docblock.

---

## 5. Dead code and orphans

**The clearest artifact of the parallel session:** `src/entityLight.js` exports
three symbols whose comments claim they are test seams —
`entityRig` (`:179`), `getEntityLight` (`:407`), `trackedEntityMaterials`
(`:412`), commented *"Test seam: the suite needs to know whether anything is
actually wired up."*

**No spec can reach any of them.** `entityLight.js` is never imported by
`main.js`, never self-publishes to `window`, and has no key in `window.game`.
Its importers pull only `setSunLight` / `trackEntityLight` / `bindEntityLight` /
`keepMaterialLive`. `blockLight.js` solved the same problem by self-publishing
at `:1693`; `entityLight.js` wrote the seam and forgot the plug. This is not a
deliberate seam for planned work — the comment asserts it already works.

Same file: `ENTITY_LIGHT_VECTORS` (`:118`) and `ENTITY_DIFFUSE` (`:75`) are
exported but used only internally. `ENTITY_FLOOR` (`:74`) *looks* used by specs
25 and 67 — it is not; both name it in prose and hardcode `0.4` instead. They
agree today by luck.

Other real ones:

- `src/blockLight.js:207` `getTerrainLight` — zero importers, and the same
  module publishes `terrainLight()` at `:1685` whose own comment says that is
  the only honest way to read it. Two exports, one value, one reachable.
- `src/fluids.js:671, 850, 1470` — `installFluidEffects`, `createFluidFlow`,
  `installFluidPush` are exported and called only from inside `fluids.js`.
  `installFluidFlow` at `:1311` does the same class of job and is *not*
  exported. Three agents each made their own entry point public.

**Deliberate, leave alone** (comments say so): `src/entityBox.js:127`
`entitiesInCell`, `src/crafting.js:256-257`, `src/items.js:806`,
`src/sounds.js:334`, `src/sky.js:68` re-export of `MC_FACE_SHADE`,
`src/npc.js:84`, `src/island.js:226`, `src/physics.js:407`,
`src/terrainAnimation.js:230`.

**Nothing here, checked:** no orphan files (`main.js` is the only file without
an importer and it is the entry point). **Zero** blocks of commented-out
source in `src/` — all seven grep hits are prose. Both always-same-value flags
(`src/survival.js:19` `HUNGER_DRAIN_ENABLED`, `src/main.js:982`
`DEV_SPAWN_AS_OPERATOR`) carry comments naming the flip condition. Clean.

---

## 6. Duplication — almost all of it is in `test/`, not `src/`

`src/` is in good shape. The specs are not.

- **Four byte-identical `drained` helpers** reaching into two *private* noa
  fields (`world._chunksToMesh`, `_chunksToMeshFirst`):
  `test/58:158`, `test/65:57`, `test/66:92`, `test/69:202`. Timeouts have
  already forked 15s/20s. One engine-internal rename breaks four specs in four
  places. Canonical home is `test/helpers/world.js`. **Highest-value
  consolidation in the repo.**
- **`setBlock` redefined verbatim five times** — `test/25:210`, `56:57`,
  `65:46`, `67:156`, `69:320` — when `test/helpers/world.js:359` exports it.
  Five agents, five identical arrow functions, one import away.
- **GPU readback, three implementations, no canonical home:**
  `test/36:100` and `test/68:91` (both named `faceBrightness`, near-identical)
  and `test/67:135` (`viewmodelPixels`). 36 is the best shape — it has the
  `'read no pixels at all -- this measurement proved nothing'` guard that 67
  omits. One `readbackMean()` in `test/helpers/shots.js` covers all three.
- **`topQuads` duplicated at ~40 lines** — `test/58:89`, `test/66:395`. Largest
  duplicated block in the suite.
- Brightness-from-screenshot, byte-identical: `test/56:35`, `test/65:63`. 65's
  comment points at spec 36, which has no such function. **The pointer is
  already rotten.**
- `totalTerrainVerts` (`58:429`, `65:400`), `pin`/`unpin` (`46:137`, `69:291` —
  69 renamed the global to `__pin69` rather than share), `setTime` (`65:82`,
  `69:319`), `atTime` (`25:56`, `67:79`), `settle` (`41:173`, `46:155`),
  `pour` (`57:93`, `62:122`, `64:85`), `buildChannel` (`57:65`, `62:77`).

**Latent bug inside that duplication:** `test/57-flowing-water.spec.js:93`
hardcodes `setBlock(636, ...)` where its two siblings pass a named
`WATER_SOURCE`/`WATER` in. It will silently pour the wrong block the day a
block is inserted ahead of water.

**`src/` duplication, small:** `clamp01` twice (`sky.js:134`,
`weather.js:72`). `overlaps` twice with different signatures
(`blockMeshes.js:623` is `EPS`-tolerant, `entityBox.js:75` is exact) —
defensible, but the epsilon-in-one-not-the-other deserves a cross-reference.
The five box-vs-voxel scans are **not** duplication; they iterate different
things and `fluids.js:321` explains why. **Entity iteration is clean** —
`everyBody` is the single query and the consolidation is documented at
`fluids.js:1460`.

---

## 7. Inconsistency

**`window.blockLight` vs `window.game`.** Complete list of `window.X =` in
`src/`: `main.js:830` (`noa`), `main.js:831` (`game`, ~25 documented keys), and
`blockLight.js:1693` (`blockLight`). One exception, and its own comment names
the reason:

> *"Self-published rather than routed through main.js's `window.game`, because
> main.js belongs to another agent this session and the specs need a handle."*

That is a merge-avoidance decision explicitly scoped to "this session." **The
session is over; the reason has expired.** It is drift, self-documented as
drift. The cost is already visible — specs must know which of two globals owns
which fact, sometimes twenty lines apart (`test/56:55` vs `:172`,
`test/65:41` vs `:82`, `test/69:388` vs `:155`). And `entityLight.js` picked
*neither*, which is §5. Three lighting modules, one day, three answers to "how
does a spec see me."

**Naming.** Four conventions for "value at a place": `getBlockLight`/
`getSkyLight` (`blockLight.js:1658`), `flowVectorAt` (`fluids.js:1346`),
`cornerHeight`/`ownHeight` (`fluidGeometry.js:78,109`), `terrainLight()`
(`blockLight.js:1685`). Sharpest case: `fluidGeometry.js:161` exports
`flowVector` and `fluids.js:1346` republishes the identical function as
`flowVectorAt`, forcing the comment at `fluidGeometry.js:447` to stop and
reconcile the two names. The single-sourcing is exemplary; it is just spelled
twice. Also `install*` vs `create*` used interchangeably in `fluids.js`, and
**`level` means three different units** (fluid depth 0-8, daylight scalar 0-1,
light level 0-15) across files that import each other.

**Error handling in `src/` is consistent and fine** — bare `catch { /* prose */
}` with a comment naming what is swallowed, four `console.*` calls in 30k
lines. One exception worth a guard: `src/terrainAnimation.js:347` calls the
*private* `texture._readPixelsSync()` with no guard and no version note, where
`debugScreen.js:547` probes for `getSkyLight` rather than assuming it.

---

## 8. Verified stale — nothing to do

- **`probe-tmp.mjs` does not exist.** Someone cleaned it up. No other stray
  scratch/probe/tmp/.orig/.bak files anywhere outside `.wrangler/tmp`, which is
  gitignored and correct.
- **`.gitignore` is accurate**, well-commented, and every entry still
  corresponds to something real. `corpus/` and `public/terrain/` are both
  ignored. Not read, per instruction.

## 9. Not investigated — ran out of budget

Stated plainly rather than papered over. All from the original brief:

- The **meshChunk contract doc** (§4). The one I most regret.
- **Sky light depends on build order** — sealed room reads sky 8 instead of 0
  when something is built 16 blocks away afterwards. Not reproduced.
- **~37% dimming at altitude** (y=240 photographs 0.2925 vs ground at noon),
  pre-existing at `e705a96`. Not reproduced. Note this interacts badly with §2
  and §3: `test/57`'s rig sits at y=240, so **specs may be photographing
  wrong-looking scenes and passing** — which is exactly what §0 turned out to
  be, at a larger scale.
- **The deferred outer wrap in `blockLight.js`** that drops a stale-length sky
  attribute, and whether it is still needed. Not determined.
- **MCP-919 (1.8.9) decompile citations** vs the 1.21.8 target. Not sampled.
- **`docs/REPORTED.md` / `docs/FUTURE.md`** contradictions after a day of
  multi-agent edits. Not reviewed.
- **`scripts/check-deploy-assets.mjs`** guard still holding. Not re-run (it is
  reachable only through `build:deploy`, which is forbidden).

## Housekeeping

`preview-*.png` (7 files) and `docs/water/*.png` (6 files) are modified in the
working tree and were **not** committed — they are on the do-not-touch list.
They appear to be regenerated screenshot artifacts. Worth deciding whether
they should be `git checkout`'d or committed deliberately; leaving them dirty
means the next agent is told "the tree is clean" when it is not, which is how
this sweep started.
