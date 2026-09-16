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

**FIXED, partly.** `npm run smoke` now exists (`package.json`) and runs exactly
those two files on chromium: **13 tests, 8.1 seconds.** No new framework, no new
assertion, no new file — it just makes an existing guard cheap enough to have no
excuse.

What I did **not** do is require it. Wiring it into a pre-commit hook or into
`CLAUDE.md`'s instructions to agents changes the committing workflow, and that
is the owner's call. My recommendation is that every agent brief in this repo
should end with "run `npm run smoke` before you commit" — today's briefs
correctly said *don't run the full suite*, and the gap between "don't run 2
hours of tests" and "run 8 seconds of tests" is where an invisible world lived
for three commits.

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

## 4. FIXED — the three-way meshChunk contract is written down (`64c8828`)

`src/blockLight.js` and `src/fluidGeometry.js` both wrap noa's `meshChunk`, they
stack, **order matters**, and all of them decode noa's 4-vertices/6-indices per
quad layout with the same two lines — `pos.length / 12` and `idx[f*6+i] - f*4`,
written independently twice (`fluidGeometry.js:382,412`,
`blockLight.js:1387,1586`). The quad splitter gave up vertex sharing — about a
third cheaper — specifically to preserve this, and an earlier version of it
would have silently fed `fluidGeometry` garbage. Decoded wrong, not crashed.

Now `docs/lighting.md` §9: the stack order as a table, where each layer is
installed and why `main.js:191`'s *position* is load-bearing (each wrap captures
whatever `meshChunk` is at install time, so the install order **is** the nesting
order), the layout invariant, why vertex sharing is refused, and five rules for
adding a layer. The three wrap sites and the `main.js` install line all point
at it.

Rule 5 in that list is the §0 trap, generalised: never let Babylon write a
uniform declaration for you. Both routes that offer to — `getUniforms().ubo`
with size/type, and `getUniforms().fragment` — inject at tokens Babylon 6's
shaders do not contain, and both fail silently. That is now written down in the
place someone will be standing when they are about to do it again.

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

---

# Deployed payload

Run 2026-09-16 against `9ae3b7f`, in an isolated worktree, which is the only
reason any of this could be measured: **`npm run build:deploy` was actually
run.** Every number below comes off the real deploy artifact, not off
`npm run build`.

## 0. The headline, before anything else

**`npm run build:deploy` was broken and had been for some time.** It threw
before reaching vite. The deploy was red, and nobody knew, because
build:deploy is the one command every agent brief in this repo forbids — so
the guard that was correctly screaming had no audience. Fixed in `9ba9eef`
(five torch blocks added in `8b4227b` had no SoundType family, and
`build-sounds.mjs` treats that as fatal on purpose).

That is the finding. Everything after it is arithmetic.

Note for the next brief: §0 of this document is about a regression test nobody
ran because it was expensive. This is the same failure with the sign flipped —
a check nobody ran because it was *forbidden*. `npm run smoke` fixed the first
one. The second needs `build:deploy` to be runnable somewhere, and an isolated
worktree is that somewhere.

## 1. The premise of the brief was wrong, and by a lot

The task came with `dist` at **15M**, textures at **4.8M**, sounds at **2.7M**.
Those numbers are real but they are not the deploy:

- **15M was `npm run build`**, which keeps `terrain/` (5.5M, deleted by
  build:deploy) and whatever sound set happens to be installed locally —
  vanilla, 181 files, 2.7M. The deploy pins `sounds:free`: **45 files, 448 KB.**
- **"4.8M of textures" is filesystem block overhead, not bytes.** 1,198 texture
  files averaging **391 bytes** each, every one rounded up to a 4 KB block.
  `du` reports 4.7M. The actual bytes are **458 KB**.

The real artifact, measured with `stat`, not `du`:

| | before | after | |
|---|---|---|---|
| **dist, real bytes** | 2,677,591 (2.55 MB) | **2,471,869 (2.36 MB)** | 1,279 files |
| `du -sh dist` says | 7.1M | 6.9M | ignore this number |

**`du` overstates this artifact by ~2.8x.** Quote bytes here, never `du`.

## 2. What a visitor actually downloads

Shipping 1,279 files and fetching 1,279 files are very different things. Under
Playwright against the real `dist/`, booting to a standing player and opening
the inventory:

**103 requests. 101 files. 1,931,220 bytes raw → 824,973 brotli.**

Before this work: 2,138,764 raw → 1,032,517 brotli. **The over-the-wire boot
payload dropped 20.1%.**

The composition is the whole story:

| | raw | over the wire | note |
|---|---|---|---|
| `assets/index-*.js` | 1,401,389 | **295,574** br | 73% of raw, 36% of the wire |
| `sounds/` (43 files) | ~458,000 | ~458,000 | ogg — compression does nothing |
| `textures/` (39 files) | ~90,000 | ~90,000 | png — same |
| `fonts/Monocraft.woff2` | 2,648 | 2,648 | **was 210,192** |
| `index.html` | 28,488 | 9,206 br | |

## 3. Ranked by bytes saved

**1. Monocraft: 210,192 → 2,648 bytes. −207,544 (−98.7%).** `6b374d1`.

The only cut worth making, and it was worth making twice over, because a font
is already-compressed binary — it arrives at full size no matter what the
server does. At 210 KB it was **21% of the entire over-the-wire boot payload**
and larger than every texture in the game combined. It is now 0.3%.

Two separate wins, worth not conflating: dropping 1,298 codepoints the game
cannot draw is 210 KB → 12.4 KB, and WOFF2 instead of TTF is 12.4 KB → 2.6 KB.
The first is the real one.

Licence checked, not assumed: OFL 1.1 bars a derivative from using a Reserved
Font Name, and **Monocraft declares none** — its copyright line carries no
"with Reserved Font Name" clause. So the subset keeps the family name, which
is why `index.html` and the canvas font specs in `nametag.js`, `chat.js`,
`hud.js` and `tabList.js` all needed no change. `OFL.txt` still ships
untouched and the font's `name` table is preserved. **DECISIONS.md #3 — whether
the page carries attribution — is untouched and still open.**

Metrics verified byte-identical (advance exactly 720/1080 = the 2/3 em that
`chat.js:48` and `hud.js:29` hardcode), and `document.fonts.check()` confirms
in **both chromium and webkit** that the face really loaded rather than
`font-display: swap` leaving us on the fallback.

**2. There is no second item.** That is the honest answer.

## 4. What was deliberately not cut

**The 1,198 texture files — all of them.** The brief's hypothesis was that
hundreds ship unreachable. They do not, and cutting them would have been the
exact regression the brief warned about.

`build-textures.mjs` emits **one `held/<key>.png` per non-invisible block**
(658) and **one `<material>.png` per material** (430), generated from the same
`BLOCK_TYPES` / `MATERIALS` tables the runtime reads. The counts reconcile
exactly: 440 loose PNGs = 430 materials + 5 atlas pages + 5 sprites
(crack, sun, moon, cloud, hand). **Zero orphans, by construction.**

A default session fetches ~39 of them because they are demand-loaded —
`blockIcon.js` sets `url(/textures/<name>.png)` as a CSS background when an
inventory slot is drawn, `heldItem.js` fetches `held/<key>.png` when you hold
something. But `src/creative.js` puts essentially every block in the picker
(its own reachability check reports only water, lava and the barrier as
unreachable), so **every one of those files is one creative-menu scroll away.**
Unrequested is not unreachable.

And it would not have mattered: all 1,198 come to **458 KB**, less than a
third of the JS bundle.

**The 43 sounds.** Every single one is fetched at boot — the free set is
eagerly loaded. 448 KB, 0 files cuttable. The brief's 2.7M / 181-file figure
and `underwater_ambience.ogg` at 384K are the **vanilla** set, which
build:deploy never ships. The free build log even lists
`ambient/underwater/underwater_ambience` under "no sample for".

**The JS bundle.** 1.37 MB → 296 KB brotli, and it is 73% of raw bytes. I
checked for the obvious sin and it is not there: Babylon is imported deeply
(`@babylonjs/core/Maths/math.color`, etc.), never as a barrel. The weight is
`noa-engine` and what it pulls in. **Nothing egregious. Left alone**, and
code-splitting a single-page game into waterfalls would make the boot worse.

## 5. Two things that are still wrong

**`/skins/evan-cape.png` 404s on every deploy boot.** `--no-cape` deliberately
omits it, `main.js:688` still requests it, and `playerModel.js` handles the
miss — so it is a wasted round trip, not a broken render. Worth knowing
anyway: **`test/01`'s "no failed requests or 404s" assertion has never run
against a deploy build**, so it would fail there today. Deciding whether the
request should be suppressed when the cape is absent is a two-line change I
did not make, because it is a behaviour question.

**`vite preview` masks 404s.** It answered that missing cape with **200 and
index.html**. `wrangler.toml` deliberately sets `not_found_handling` to a real
404 for precisely this reason — so measure against the Worker, not against
preview, or a missing asset looks fine.

## 6. Serving — one thing to confirm at deploy time

`deploy/_headers` is sound. `/assets/*` immutable is unconditionally correct
(vite content-hashes). `/textures/*` at one day and *not* immutable is right
and the comment explaining why is right.

`/fonts/*` needed a correction and got one (`9ae3b7f`). Its immutable was
justified by "a pinned third-party drop… a different file with a different
name" — true of upstream `Monocraft.ttf`, **false now that the deployed font
is a subset this repo cuts at a fixed name.** Still immutable, because
revalidating 2.6 KB costs more than it saves, but the rule that makes it safe
(**re-cutting means renaming**) is now written in `deploy/_headers` and
`fonts-src/NOTICE.txt`.

**Not verified, because it cannot be from here:** whether the host actually
serves compressed responses. Cloudflare should compress `application/javascript`
automatically, and if it does not, the bundle is a **1.37 MB** download instead
of 296 KB — which would dwarf every other number in this document. One command
at deploy time settles it:

```
curl -sI -H 'Accept-Encoding: br' https://<host>/assets/index-<hash>.js | grep -i content-encoding
```

Anything other than `br` or `gzip` there is the largest remaining problem.

## 7. Runtime — no numbers, on purpose

I did not measure frame rate, and I am not repeating the ≈30 fps figure this
repo quotes. That came from headless chromium under SwiftShader and is a
statement about a software rasteriser, not about a GPU. Quoting it as
performance is worse than quoting nothing.

I read for allocation-per-frame and per-tick scans and **found nothing worth
reporting** — `src/sounds.js` resolving all 638 blocks once at module load
rather than per footstep is the pattern done right, and it is commented as
such. No speculative micro-optimisation follows.

## 8. Also done

`src/entityLight.js`'s three exports — `entityRig`, `getEntityLight`,
`trackedEntityMaterials`, two commented as seams "the suite needs" — are
**deleted** (§5 of this document). Zero importers, zero references in `test/`.
Deleted rather than wired up, because publishing them meant either a second
`window.X =` global (the drift §7 objects to) or importing the module into
`main.js` to hang a debug handle off `window.game`. The replacement comment
records that choice so nobody re-adds them thinking it was an oversight.

**Still open from §5, not done here:** `ENTITY_FLOOR` is still exported and
specs 25 and 67 still hardcode `0.4` — they agree by luck. The fix is for
those specs to import it, which is a `test/` change whose verification runs
into the known-fossil failures in spec 25 (§3). `blockLight.js:207`
`getTerrainLight` and the three internal-only `fluids.js` exports are
untouched. None of them are payload; they are all correctness smells.
