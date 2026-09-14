# Open decisions — Evan's, parked until he wants them

Three things are waiting on a call from Evan rather than on engineering. They are
written out here so they are not lost and do not need re-explaining, and so
nobody has to keep raising them in conversation. Nothing in this file is a
suggestion to act now.

`docs/FUTURE.md` covers the engineering roadmap. This file is only the set of
things that need a human decision first.

---

## 1. Can the imported terrain be served publicly?

**The question.** `public/terrain/terrain.bin` is a 128×128 patch of real
Minecraft 1.21.8 terrain, seed 12345, produced by running Mojang's own world
generator locally. Serving it from a public site is redistribution of
*generator output*. That is a genuinely different question from redistributing
Mojang's textures or audio, which is settled and handled — and the answer is not
obvious in either direction.

**Current state.** Conservative default is in force and actually enforced, not
just documented:

- `public/terrain/` is gitignored.
- `build:deploy` drops it from `dist/`.
- `scripts/check-deploy-assets.mjs` fails the build outright if it appears.

A leak was already found and closed here: vite copies `public/` into `dist/`
wholesale, so gitignoring alone did not keep it out of the deploy artifact.

**Why it is upstream of everything else.** `loadTerrain` hard-gates on the asset
— `src/island.js` throws rather than degrading if it 404s. So if this resolves
conservatively, the public build cannot serve this patch at all, and any resume
content authored onto this terrain would have to be authored a second time onto
whatever replaces it. That is the expensive mistake currently available.

**Where the detail lives.** `docs/DEPLOYMENT.md` has three positions written out
honestly, with the argument for each.

**What resolving it looks like.** Either a decision to ship it as-is, or a
fallback plan for a public build that serves something else. Nobody has scoped
the fallback; it is unknown whether that is an afternoon or a real project.

---

## 2. Spawn is inside a closed canopy

**The problem.** You spawn at patch-local (40, 136, 56), on grass, under dark oak
leaves at y=139 and y=140 — directly overhead. 75 of the surrounding 81 columns
are roofed. An eye-level ray in all eight compass directions stops within 4 to 13
blocks. What a visitor sees on arrival is a tunnel of trunks and stepped grass.

It is atmospheric and unmistakably real Minecraft, and it shows none of what is
actually good about this patch. From the summit the view is genuinely striking —
snowy peak and packed ice on one side, dark forest and giant red mushrooms
rolling away, clouds at the right altitude. The spawn point delivers none of it.

**The cause, precisely.** `pickSpawn` has **no occlusion test at all**. It samples
biome and ground height at ring offsets `r = 8..48` and calls that "in sight",
which is why it credited this spot with four visible biomes and a mountain. Its
headroom check also explicitly accepts leaves as clear. So this is not a case of
a line-of-sight test that forgot about leaves; there is no line-of-sight test.

**Screenshots.** `test/screenshots/terrain-spawn.png` and `terrain-summit.png`
show the contrast.

**Scope.** Give `pickSpawn` a real occlusion test and re-score, or simply move
spawn toward the ridge. Self-contained, no dependency on anything else here.

**Worth knowing.** If the patch itself is the problem rather than the spawn
point, changing it is cheap — the runner-up seed is 987654321 at (−160, 128):
denser forest, 28 blocks of relief, no mountain. One `npm run terrain` away. The
`.mcgen/` cache (894MB, gitignored) is what keeps re-extraction at ~90 seconds
instead of a full regeneration; delete it freely once the patch is settled.

---

## 3. Nothing on the page carries the attribution

**The problem.** Pixel Perfection CE is CC BY-SA 4.0, Monocraft is SIL OFL 1.1,
and the sound set mixes CC0, CC BY and CC BY-SA. All except CC0 require credit
wherever the work is distributed, and a deployed page is a distribution.

The NOTICE files do ship and do resolve — `/textures/NOTICE.txt` on a CE build
and `/sounds/NOTICE.txt` — but **nothing on the page points at them**, and an
unadvertised file is not attribution. A Credits sheet used to exist in the pause
menu and was deliberately removed; the obligation did not leave with it.

Nothing is live, so nothing is out of compliance today. The day it goes live, it
is.

**Scope.** Small, and it need not be a pause-menu button. CC lets the condition
be met "in any reasonable manner based on the medium", explicitly including a
link to a resource carrying the details. A line in an F3-style debug screen, a
`/credits` chat command, a footer beside the canvas, or a link from the Controls
sheet would each do it. Cheapest is the chat command, since chat already renders
links.

**One correction worth keeping.** `docs/DEPLOYMENT.md` used to assert this was
already satisfied "because the attribution is on the entry overlay in
`index.html`". That was false — the only licence mention in that file is a CSS
comment, and the entry overlay itself was removed long ago. The doc was arguing
the opposite of the actual state. It has been fixed, but if that claim reappears
anywhere, it is wrong.
