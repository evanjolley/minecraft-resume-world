# Reported from play, not yet diagnosed

Fifteen things Evan hit while playing on 2026-09-15, called out on the way out
the door and added to over two more passes. It opened as a list nothing had
been investigated on. **That is no longer true**: as of `3b8ef66` nine are
closed, one is triaged-and-waiting, and five are open. Where a cause is still a
guess it is marked as a guess — this file exists so the reports survive, not so
anybody acts on a hunch written down at speed.

**Updated 2026-09-16.** The counts above are as of `3b8ef66` and one has moved
since: **5 is built.** The light engine exists, which also means 3 is no longer
waiting on it and the four-symptoms note at the bottom of this file needed
rewriting. Two new reports from play arrived with it and are recorded under 5
rather than opened as fresh numbers, because they are consequences of that
build rather than independent finds.

Status at `3b8ef66`, which is where every claim below was checked:

| | | |
| --- | --- | --- |
| 1 icon shows the wrong shape | FIXED | `blockIcon.js` draws the real boxes |
| 2 hover should name the block | FIXED | a real tooltip, not `el.title` |
| 3 torches | TRIAGED, and 5 no longer blocks it | waits on `blockMesh` |
| 4 Escape leaves the cursor | **OPEN, and not testable here** | needs a human; three defects under it fixed |
| 5 glowstone emits no light | **BUILT** (`src/blockLight.js`) | see the new report under it |
| 6 the east face is brighter | FIXED (`56d40d2`) | it was a frozen uniform |
| 7 Evan should fall and walk | BUILT | and he falls when you mine under him |
| 8 boats | OPEN, untouched | |
| 9 buckets | FIXED | |
| 10 Nether portals | BUILT | |
| 11 a cleanup pass | OPEN, and still wants to run alone | |
| 12 end-session flow | OPEN — mechanism, no behaviour | |
| 13 request-time flow | OPEN | |
| 14 furnaces | FIXED except the lit texture | |
| 15 fluids do not flow | FIXED — geometry deferred | |

`docs/FUTURE.md` is the curated roadmap and stays that way. Items here get
triaged into it, or fixed, or dismissed with a reason. Several of these were
one root cause wearing different clothes; see the note at the bottom, which has
been rewritten now that two of the four threads it named are cut.

---

## Bugs and fidelity gaps

**1. Prismarine in the creative menu is stairs wearing a block's face.**
> "clicked a prismarine block in creative menu, started placing them down: its
> stairs! Texture in inv is full block. When I place down, upside down stairs?
> And when I rotate over them in inv it says stairs."

Partly a consequence of Evan's own call — every one of the 280 slab and stair
variants got its own slot, so a family contributes ten entries that share a name
and a texture, and the tooltip carries the block key. He clicked one, and the
`_top` variant places inverted.

The decision stands; what does not work is that **the icon shows a full cube for
a block that is not one**. The tooltip is doing the disambiguating and the
picture is actively lying. Either the icon renders the real shape, or the
variants collapse to one entry with orientation chosen on placement (vanilla's
answer, and the thing the one-slot decision deliberately rejected).

FIXED 2026-09-15, by the first of those two. `src/blockIcon.js` reads the same
`shape` key `blocks.js` puts on every non-cube and draws the boxes
`SHAPE_BOXES` gives back, so a top slab is a plate at eye level and a stair is
a stair. It generalises to all ten shapes rather than the two that are reachable
from a slot today, and it reads `SHAPE_BOXES` directly rather than
`shapeBoxesFor()` — the table installed at world load answers for the world's
state, which would let this bug come back wearing a timing bug's clothes.
`el.dataset.shape` records which shape was drawn, which is what a spec asserts
against.

**2. Hovering a block in the inventory should name it.**
> "When I hover over a block in inv i think it should say the name of it? I
> believe this is true minecraft behavior."

It is. Vanilla shows a tooltip with the item name on hover in every container.
The creative picker got tooltips; check whether the survival inventory and the
hotbar did too, and match vanilla's styling rather than inventing one.

FIXED 2026-09-15. What the survival inventory had was `el.title` — the
BROWSER's tooltip, with the browser's delay, the browser's font and the
browser's position. `src/inventory.js` draws a real one now, off the pixels in
`tooltip/background.png` and `tooltip/frame.png` rather than off a colour
somebody matched by eye, positioned in GUI pixels next to the cursor the way
vanilla positions it.

**3. Torches cannot be placed.**
Probably never implemented rather than broken. A torch is a non-cube attached to
a face, and `src/blockMeshes.js` covers slabs and stairs only — its own notes
record that connected and attached shapes are a structural problem, because noa
draws a custom block mesh as a thin instance and every voxel of an id shares one
geometry. Unverified guess; read those notes before starting.

TRIAGED 2026-09-15, and the verdict is WAIT FOR LIGHT. Never implemented, as
guessed: `torch` is in `UNPLACEABLE` in `src/items.js` with the reasoning
already written there, there is no torch in `src/blocks.js`, and the texture
build emits `item/torch.png` only. Nothing is broken.

The guess about WHY is wrong in an interesting direction, so it is worth
correcting rather than deleting. A wall torch is not a fence. A fence needs
different geometry per neighbour and no transform relates the cases; a wall
torch IS a transform of a floor torch, and `blockMeshes.js` already ships four
horizontal facings per stair with `installPlacementOrientation` choosing one at
placement time. Five ids -- floor plus four walls -- and the machinery exists.

What actually stands in the way, cheapest first:

  - No alpha. Every non-cube material here is an opaque frozen
    `StandardMaterial` (createMaterialCache). A torch is a 16x16 sprite that is
    mostly transparent, so it needs a cutout material, which is a change to a
    cache shared by all 280 slab and stair variants.
  - Collision is the same box list as the mesh, by design, and that is the
    invariant the whole file exists to protect. A torch has to be walked
    through, so it needs to opt out of the thing that keeps the two in step.
  - The 22.5-degree tilt. Shapes here are axis-aligned boxes. A wall torch
    leans; an axis-aligned approximation reads as a stick glued to a wall.
  - Attachment. Mine the wall and the torch has to pop, which is the first
    neighbour-dependent BEHAVIOUR in this world (as against neighbour-dependent
    geometry, which is the fence problem).

And then the reason to do none of it yet: **5**. A torch that lights nothing is
the glowstone complaint arriving a second time, from a player who has just
mined coal and crafted the thing specifically to see in a cave. Build the light
engine, then the torch is worth building; build the torch first and it ships as
a decoration that reads as broken.

Rejected: a floor-only torch as a cheap first half. It is not cheap -- it needs
three of the four items above -- and it is not useful, because floor-only is
exactly the half that has nowhere to go in a cave.

STILL WAITING, and the thing it waits on is costed now rather than estimated:
`docs/lighting.md` scopes the light engine at two to four days and names the
free per-vertex lane it would ride on. Nothing about this entry changed; what
changed is that "build the light engine first" is now a plan rather than a
deferral.

**UNBLOCKED 2026-09-16, and still not built.** The light engine shipped, so
the reason to do none of it yet is gone: `EMISSION.torch` is **14** in
`src/blockLight.js` and has been since that landed, which means a placed torch
would light its surroundings the moment it can exist at all. Evan reported
this a second time from play on 2026-09-16 — a torch in the hotbar that places
nothing reads as broken whether or not it would glow.

**The four obstacles above are untouched and all four still apply**, and they
are now the whole of the work rather than the second half of it. The honest
read is that this is a `blockMesh` job, which is the same missing piece the
build importer waits on and the same class of problem flowing water hit, where
giving a block a `shape` costs it the category it was registered under. Nothing
about the cutout material, the collision opt-out, the 22.5-degree tilt or the
pop-on-neighbour-break got cheaper; they just stopped being blocked.

**4. Returning from the Escape menu leaves the cursor on screen.**
> "when I press esc or back to game on the esc menu, my cursor should not be
> visible, should go back to the crosshair."

Adjacent to the pointer-lock race fixed in `f1fa89d`, and possibly caused by its
secondary half: `requestLockPersistently` became cancellable in that change.
Browsers impose a cooldown after the *user* presses Escape, which is why the
retry loop exists at all. **Check whether the fix made it give up too early.**
Unverified, but this is the first place to look, and it is a regression risk
from a fix landed the same day.

TRIAGED 2026-09-15: NOT REPRODUCED, and NOT caused by `f1fa89d`. That change
made the retry loop cancellable and refused to run two of them at once; neither
shortens it. The budget is still 14 tries at 150 ms, still ~2.1 s, and the only
caller that cancels it is death.

Driven three ways. Headed, with `page.bringToFront()` so the grant is real:
closing the menu by Escape and by Back to Game both take the lock back, in two
milliseconds -- because Playwright's Escape does not start the browser cooldown
the retry loop exists for, so a headed run proves the loop works in a world
where it is never needed. Then with the cooldown faked at Chrome's documented
1.25 s (`test/37-menu-cursor.spec.js`): both paths win, with seven of the
fourteen tries still unspent.

So the loop has margin, and something outside this repo is eating it. What is
left un-ruled-out, in order:

  - A cooldown longer than ~2.3 s. Then the loop loses, gives up silently, and
    the cursor sits over a live menu-less world until you click -- which is
    the report exactly. The budget is a guessed number racing a browser timer
    it cannot see, and it fails closed with no second attempt.
  - Not Chrome. Nothing here has been run in Safari or Firefox; only Chromium
    is installed for the suite.

Next step is a number, not a patch: get the browser and version, and what the
console says when the menu closes (a refused request logs). 37 pins the
behaviour meanwhile and fails loudly if the budget is ever cut -- dropping it
to two tries fails both cases with the cursor still on screen.

**2026-09-16, and the news is worse rather than better.** Both open ends above
have been worked and neither closed, and a third path opened.

  - **"Not Chrome" is half answered.** The suite runs WebKit now as well as
    Chromium (`docs/browsers.md`, `5634bde`) and Safari works. That does not
    reach this. `docs/browsers.md` §5 is explicit that **no headless browser
    grants pointer lock or real user activation in EITHER engine**, so
    mouse-look, the cursor handover and the first sound after a click are
    untested in both, structurally rather than for want of a spec. Adding a
    second engine proved the renderer and could not prove the feel.
  - **A third path, and it would reproduce the symptom exactly.** The pause
    menu does not open on a keydown at all -- `main.js` opens it from
    `lostPointerLock`, because Chrome eats the Escape that exits pointer lock.
    `src/inventory.js` (the note above its capture-phase Escape handler)
    records that **Firefox DOES deliver that keydown**, which means Firefox
    runs the synchronous handler first and main.js's async lock guard
    afterwards, against a flag the first one already cleared. That is unfixed;
    the fix is a wider guard in `main.js`, which that file did not own. Read
    from the source comment rather than reproduced -- nothing here has ever
    been run in Firefox, and it is not in the suite's projects.

**2026-09-16, later: the engineering under this entry landed and this entry is
still OPEN.** Three things were found by reading and all three were fixed
(`8fe9274`, `8d2fce5`, `9230d22`), and none of them closes this:

  - **Chat never cancelled the re-lock loop the inventory cancels.** Every
    screen hands the cursor back on close through a ~2.1 s retry loop, and
    every screen but chat killed a running one on the way in. Escape out of the
    inventory, press T inside two seconds, and the loop captured the mouse with
    the chat bar open. Real, one line, `test/59-chat-lock-handoff.spec.js`.
    It is the chat-window half of what Evan asked about and it is NOT this.
  - **"Which screens are open" was hand-kept in five conditions** that
    enumerated each other, and they had already drifted -- menu.js named the
    inventory and death and not chat. `src/inputLock.js` already knew and was
    not being asked; it answers all five now. This is the one that stops the
    class of bug recurring, and it changes no behaviour a player can see.
  - **The Firefox double-handle has a guard, and the guard is UNVERIFIED.**
    main.js now returns for 250 ms after any screen closes, so a lock change
    that arrives behind a delivered Escape keydown cannot open the pause menu
    on top of the close. That is the third path named below. It is written
    against a browser nothing here has ever run in. **Do not read it as a fix
    for this report.** If Evan plays in Firefox it is the first thing to check;
    if he does not, it is dead code doing no harm.

So the honest status is **UNRESOLVED and NOT REPRODUCIBLE BY AN AGENT.** It
needs ten minutes in a real browser window with this entry open, and the first
question is STILL which browser Evan was in -- asked four times now, and the
Firefox guard above is the fourth time it has decided what an agent could do. Note the sibling report that DID
land: Escape out of the *inventory* used to open the pause menu instead of
giving the crosshair back, fixed in `98c3e86` with `test/50-inventory-escape.spec.js`.
That is a different keypress on a different screen and it does not close this.

**5. Glowstone emits no light.**
> **SUPERSEDED — this is BUILT as of 2026-09-16.** The two paragraphs that
> follow are the original diagnosis and are kept because two of their claims
> turned out to be wrong in instructive ways. Read them as history, not as the
> state of the engine; the update is below them.

Not a glowstone bug. **noa has no light engine at all** — ambient occlusion plus
one directional vector, no per-voxel light value to read or write. This was
established twice already: the F3 screen had to cut its Client/Server Light
lines, and entity lighting can track daylight but not block light, so a player
in a cave stays lit as if outdoors. Placing a light source and expecting
darkness to retreat needs light propagation, which is a real engine feature and
the largest single item on this page.

COSTED 2026-09-15, NOT BUILT. `docs/lighting.md` is the whole diagnosis and a
plan: noa 0.33's registry has no emission field, a chunk stores block ids and
nothing else, and the mesher takes no callbacks -- all read out of
`node_modules/noa-engine/src/lib/` rather than assumed. The good news it found
is a **free per-vertex channel**: AO is premultiplied into vertex colour RGB,
so a light term can ride the same lane without a second attribute. Estimate is
two to four days. That document is now the entry point for this item, for 3,
and for the entity half in `src/entityLight.js`.

**BUILT 2026-09-16, `src/blockLight.js`.** Glowstone lights the world. Sea
lanterns, lava and magma too, by flooding a BFS out over the voxel data and
writing the result into the vertex colour alpha channel.

**Two claims in the paragraphs above turned out to be wrong**, and they are
left standing rather than edited because the corrections are the useful part.

  - "The mesher takes no callbacks" — so a light engine "means editing that
    file", i.e. vendoring noa. **It does not.** `meshChunk` is reachable **on
    the noa instance**, so it can be wrapped, the finished vertex buffers read
    back and rewritten, and `npm update` still works. Nothing was vendored.
    That was read out of `node_modules/` too, which is worth noting: reading
    the source proved the hard part was reachable *and* produced a wrong
    conclusion about how to reach it.
  - The "free per-vertex channel" was going to ride the **RGB** lane AO is
    premultiplied into. The shipped engine uses **alpha** instead, which
    leaves AO alone rather than sharing with it.

**Two new reports from play, both consequences of this build.**

**5a. Glowstone lights directionally rather than radially.** Evan, 2026-09-16 —
it does not diffuse out evenly in all directions.

**CONFIRMED 2026-09-16 by experiment, and the hypothesis below was right.** It
is written out in full first, because it was recorded as a hypothesis and the
point of the record is that it survived a test rather than that it sounded
good. The hypothesis was: the BFS is not the culprit — it floods all six
neighbours symmetrically and `test/56-block-light.spec.js` covers the falloff —
and the mesher is. noa merges faces greedily and its merge predicate
(`node_modules/noa-engine/src/lib/terrainMesher.js`, `maskCompare`) compares
the material id and the AO mask and **nothing else**, because noa has no light
to compare. So a flat floor becomes a handful of enormous quads, light is
sampled only at their corners, and the GPU interpolates linearly across the
whole span. Vanilla avoids this by refusing to merge faces whose light levels
differ.

`test/58-glowstone-radial.spec.js` is the cheap test that 5a named and never
ran: a glowstone on a 25x25 flat pad, and the same pad chequered so that no two
top faces are coplanar and greedy merging has nothing to merge. It reads the
finished Babylon buffers back and reports each up-facing quad's span in blocks
and its four corner light levels. The numbers, and they are not close:

```
[flat]    up-facing quads over the 25x25 pad: 17    widest quad: 13 blocks
[flat]      quad at (-12,-12) 12x11  corners 0 / 2 / 13 / 1
[flat]      quad at (-12,  0) 13x11  corners 2 / 0 /  1 / 13
[flat]      quad at ( -1,  2) 11x5   corners 12 / 1 / 0 / 10
[chequer] up-facing quads over the 25x25 pad: 624   widest quad: 1 block
[chequer]   quad at (-10,-1) 1x1  corners 2 / 3 / 4 / 3
```

625 floor blocks become **seventeen quads**, one of them thirteen blocks wide
with corner values 2, 0, 1 and 13. That last quad *is* the report: the GPU is
drawing a straight ramp from 13 down to 0 across thirteen blocks, so the light
leans toward whichever corner happens to be nearest the glowstone instead of
falling off around it. Which corner that is depends on where the emitter sits
relative to the **chunk-origin-relative greedy sweep**, not on anything about
the light — which is exactly why it reads as a direction. Chequer the same pad
and every quad is 1x1, every corner carries its own BFS value, and the falloff
goes round. Screenshots: `test/screenshots/glowstone-flat-top.png` against
`glowstone-chequer-top.png`.

Worth recording because it is worse than 5a guessed: on a pad large enough that
no quad corner is within 15 blocks of the emitter, the floor gets **no light at
all**. The first run of this probe reported zero lit vertices and a visible
glow, and the glow turned out to be the night fog vignette. A glowstone on a
big open floor is not dimly lit from one side; it is unlit, and only the
broken-up floor of a small room lights at all — which is why
`test/56-block-light.spec.js` passes. Its 7x7 walled room is too small and too
chopped up by AO for the mesher to eat.

**The fix does not need a fork, and that is the one thing 5a got wrong.** 5a
said the fix "sits *inside* noa's greedy mesher, below the instance-level wrap
this engine uses to stay off a fork". The merge predicate does, but the fix
need not live there. noa's `MeshBuilder` lays its buffers out perfectly
regularly — four vertices per quad in a fixed order (`addPositionValues`: v0 =
corner, v1 = corner + width, v3 = corner + height), six indices per quad, and
UVs linear in width and height — so `writeVertexLight` can read a quad's span
straight off the buffer, which is what the probe above already does.

**FIXED 2026-09-16, entirely inside `src/blockLight.js`, no fork and no
vendoring.** `writeVertexLight` now splits every quad light reaches back into
unit sub-quads in the readback, interpolating position, UV, ambient occlusion
and atlas index off the parent and sampling light fresh at each new corner.
The falloff on the flat pad is now 12.5 / 10.5 / 8.5 / 6.5 at two, four, six
and eight blocks, identical in all four directions to within 0.01 of a light
level. Before the fix the same four numbers read 12.25 / 12.06 / 10.91 / 10.91
at r = 2 — a lean of over a level between +x and +z at every radius, and a
perfectly straight ramp of 0.96 levels per block, which is a GPU interpolating,
not light falling off.

Three things were decided along the way and all three are argued out in the
`writeVertexLight` docblock rather than here:

- **Which quads get split: only the ones light reaches, and only the part of
  them it reaches.** The split is clipped to the lit lattice points' bounding
  box widened by one cell, so one torch on a chunk-wide floor shatters the disc
  it lights and not the whole 32×32 quad. On a 41×41 pad the merged quads
  survive up to 22 blocks wide right next to the split region.
- **The T-junction objection is answered, not accepted.** Widening by one cell
  guarantees the split region's outer lattice ring is zero, so every quad left
  merged is uniformly dark across its whole surface and has no value for a seam
  to disagree about. It is asserted rather than argued: the last test in
  `test/58-glowstone-radial.spec.js` checks that **every** quad wider than one
  block carries zero light at all four corners. `glowstone-wide-top.png` is the
  boundary photographed.
- **AO is carried through the parent's own triangulation, not bilinearly.** The
  GPU draws two triangles with the diagonal `decideTriDir` chose, and inside a
  triangle a colour is linear over three corners. Sampling the parent that way
  makes any sub-quad lying inside one parent triangle come out identical to the
  unsplit parent; only sub-quads straddling the diagonal move, and only by that
  fold. `test/36-face-shading.spec.js` stayed 5/5 green on both engines.

**A second bug fell out of it, and it was older.** `flushDirty` queued dirty
chunks through noa's `_queueChunkForRemesh`, which opens with
`if (!(chunk._terrainDirty || chunk._objectsDirty)) return` — it assumes the
only reason to rebuild a mesh is that its voxels changed. A chunk that a
neighbour's glowstone had just lit was therefore dropped from the queue
silently. It was invisible while the old readback rewrote light on every mesh
for every reason, because a chunk edited for any other cause picked the light
up on the way past. The new radial spec found it in one line: the falloff came
out symmetric in three directions and dead zero in the fourth, and the fourth
was the far side of x = 64, a chunk boundary.

**The cost, measured.** Roughly 1,980 terrain vertices per emitter on open
ground (three glowstones on the island: 536 → 6,484 across 28 meshes). As a
percentage that is +1,110%, and the percentage is not a useful number here: a
superflat world greedy-meshes to a few hundred vertices total, so any per-block
lighting is four figures against it, including a correct one. The per-emitter
figure is the one that is bounded — a glowstone lights a Manhattan disc about
31 blocks across, and four vertices per unit cell over half of a 31×31 box is
about what you get. The vertex-light pass costs 1.9ms on a chunk that actually
splits and is now skipped entirely on chunks with no light near them, which is
most of the world; end to end the block-light engine costs about 0.6 fps
against 0.1 before.

**5b. Sky light is not built, so caves are still bright.** The block half is
what shipped. Vanilla seeds sky light at 15 in every column open to the sky,
propagates it DOWN with no decay at all, sideways at the usual 1 per block, and
renders a voxel at `max(skyLight * daylight, blockLight)` — only the first term
following `src/sky.js`. That asymmetry is the whole feature: it is what makes a
torch matter at midnight and not at noon. Until it exists, a cave is lit as if
the roof were not there, and the entity half in `src/entityLight.js` stays
wrong underground for the same reason. `docs/FUTURE.md` carries both.

**6. The east face of every block is brighter, and the lighting does not move.**
> "the east edge of blocks has weirdly more lighting than the rest, even at
> night. Isnt dynamic but should be I guess."

`src/main.js` passes noa a fixed `lightVector: [0.6, -1, -0.4]`, so face shading
is baked to one direction and never follows the sun. Vanilla's face shading is
also fixed — it does **not** rotate with the sun — so "should be dynamic" is
worth checking against real Minecraft before changing. What is more likely wrong
is the *magnitude*: vanilla dims faces by fixed per-direction multipliers
(top brightest, north/south, east/west, bottom darkest) that scale with the
light level, so at night everything gets darker together. Unverified.

FIXED 2026-09-15 (`56d40d2`), and the guess above was pointed at the wrong
half. The fixed `lightVector` is vanilla-correct and was not the bug. The bug
was the second sentence: **everything did NOT get darker together**, because
the ambient term had been baked into a frozen uniform buffer at boot and never
written again. So the faces kept their daytime relationship to each other at
midnight, which is what "even at night" in the report is describing.
`test/36-face-shading.spec.js`. The full write-up is `docs/lighting.md` §6,
which is also where it is recorded that the one hook that fix could not reach
is the same hook item 5 needs.

**Not fixed, and nothing measures it:** the same stale ambient is still carried
by every NON-cube material -- slabs, stairs, the item models -- which go through
`createMaterialCache` rather than through the terrain shader the fix corrected.
Nobody has looked at whether they drift from the terrain at dusk.

---

## Features

**7. Evan should fall, and then walk.**
> "Evan npc should experience gravity, maybe time to allow him movement etc."

The NPC is placed, not simulated. Movement is already on the roadmap as the
guided tour — Evan notices you, you agree what to talk about, he walks you to
the build for that resume point. Gravity is the smaller prerequisite and worth
doing first. Note `limbSwing` in `src/npc.js` is declared, passed to
`poseModel`, and never incremented: the walk cycle already exists and has never
been asked to run.

BUILT 2026-09-15, in three pieces, and the third one stops where the roadmap
says to stop.

**Gravity.** He is a real noa entity now with the player's own two components
-- a `physics` body in voxel-physics-engine and noa's `movement` controller --
and he is DROPPED into his column rather than asserted into it: released 2.5
blocks up, settled by the collision solver. The leaf-aware ground scan in
`main.js` stays, because gravity cannot tell a leaf from a floor and a drop
into a canopy lands on the canopy. What changed is what its answer MEANS. It
is a column, not an altitude, and a column that is wrong by a block no longer
leaves him hovering or buried. `EVAN_POS` on `window.game` is a getter now;
the frozen array went stale the moment he could walk.

One thing that is only obvious once: a body created during boot must not be
released until its chunk has loaded. noa answers AIR for an absent chunk, so
an NPC released at construction falls through the island at 32 b/s^2 while
the ground he was aimed at meshes in above him. He is held at
`gravityMultiplier = 0` until there is something solid under the column.

**The legs.** `limbSwing` is incremented now, off his real speed read from the
physics body, through `advanceStride` in `playerModel.js` -- the same
distance-based cadence `perspective.js` drives the player with, which is why
sprinting quickens a stride and standing still stops one. `perspective.js`
still has those three lines inline and should be moved onto the shared
function; that file belonged to another pass.

**`walk_to`**, and nothing past it. A third tool on the seam beside
`set_player_name` and `get_player_state`, and the first that moves a body
rather than a roster entry -- async, seconds long, and able to fail, which is
a better test of the registry than either of the first two. He steers at the
point, hops a one-block step, and rejects with a sentence when something
taller is in the way. NO PATHFINDER: section 2 settles that the tour's
navigation is A* with jump-aware movement rules, and a search started and not
finished would be worse than a straight walk that reports failure honestly.

The tour itself is deliberately NOT built. `walk_to(plot)` is this tool plus a
table of named destinations, and there is nothing to walk to yet -- a tour to
nowhere is a coordinate table pretending to be content. Evidence in
`test/38-npc-body.spec.js` and `test/screenshots/npc-evan-walking-*.png`.

And since: **mine the floor out from under him and he falls** (`f36116b`). The
gravity above was a drop at boot into a column that was already solid; this is
the same body reacting to the world changing under it afterwards, which is the
case a static placement would have survived by accident.

**8. Boats.**

**9. Buckets — water, lava, and the mechanics.**
Fluids already exist properly (`src/fluids.js`, real viscosity, drowning,
burning). Buckets are the interaction: pick up a source block, place it back,
and the consequences. Note `items.js` already has a `bucket` item and vanilla
has no water *item*, only the bucket — which is why fluids are filtered out of
the block-item list.

FIXED 2026-09-15. `src/bucket.js`, with `water_bucket` and `lava_bucket` as
items. It carries its own fluid raycast because noa's crosshair deliberately
cannot see a fluid, which is the same problem vanilla solves with
`ClipContext.Fluid.SOURCE_ONLY` — and only the two SOURCE ids can be picked
up, so a flow level from `fluids.js` is refused by the same comparison that
refuses stone. The lava bucket is in `FUELS` at its real 20000 ticks now and
leaves the empty bucket in the slot. `test/45-buckets.spec.js`, and
`test/screenshots/45-bucket-pours-a-source.png`.

**10. Nether portals.**
The Nether exists and is reachable by `/dimension nether`. Portals are recorded
as out of scope at the top of `src/dimensions.js`, and what they still need is
written there: the animated 32-frame texture (`docs/water.md` §3 sizes the
layer-remap shader work — water justifies it and the portal comes along free),
obsidian frame detection, a trigger volume, the four-second dwell, and a
destination mapping. That last one is an open design question: vanilla's 8:1
coordinate scale is meaningless across two patches that share one 128×128 frame.

BUILT 2026-09-15. Build an obsidian frame, light it with flint and steel, walk
through it (`1ee5c53`, nine specs in `test/44-portals.spec.js` plus two
sabotages). The animated 32-frame texture arrived on its own account -- the
layer-remap work `docs/water.md` §3 sized was funded by water and the portal
came along free, as that document predicted -- and it landed with the discovery
that **the animation uniform had never been declared in any shader, ever**
(`ac4d5d3`). Who may light a portal is settled and written down in `5601711`:
it is not the visitor.

**11. A code cleanup pass, after all of the above.**
A two-phase health sweep already ran once and is worth repeating the same way:
dead code and export surface first, then duplication and efficiency. It must run
alone — it touches every file, and the one time something else was live
concurrently, a commit swallowed another agent's staged work.

---

## The thread running through several of these

**5 and 6 are the same missing feature**, and **2 and 1 are the same missing
affordance.** Worth triaging together rather than one at a time:

- No light engine meant no glowstone (5), no torch light if torches land (3),
  no cave darkness for entities, and no F3 light readout. One feature behind
  four symptoms. **HALF CUT, 2026-09-16.** `src/blockLight.js` shipped the
  block half: glowstone lights the world and 3 is unblocked. The other two
  symptoms did NOT fall with it, and it is worth being exact about why, because
  the prediction that one feature covered all four was only half right.
  **BOTH WIRED, 2026-09-16** (`27d29de` and the commit that follows it), and
  the "small job" costing was right. `src/entityLight.js` reads
  `getBlockLight` at the entity's feet and `max`es it with the daylight term,
  so a glowstone now lights the player and Evan the NPC where before a man in
  a pitch-dark cave was lit as if he were outdoors; F3 draws `Client Light`
  off the same call. Neither was a missing feature by the time it was done —
  each was a call nobody had made. What is
  genuinely still missing is **sky light** — the reason a cave is still lit as
  if the roof were not there — and that is a second channel through a pipe that
  is now laid rather than a new feature. See 5a and 5b under report 5.
- An item needs to show what it *is* — its name on hover (2) and its real shape
  as an icon (1). One answer covers both. **CUT.** Both shipped, and it is
  worth saying they shipped as two answers rather than one: `inventory.js` drew
  the tooltip and `blockIcon.js` drew the shape. The prediction that one fix
  would cover both was wrong, and harmlessly so — they turned out to be the
  same *class* of bug rather than the same bug.

---

## Added 2026-09-15 — two features Evan specified while filling in the quiz

Both are answers to questions in `corpus/` that turned out to describe scope
rather than describe him. Neither is built. Neither is urgent, and they belong
together because one is the other's escape hatch.

**12. End-session flow.** When a visitor is rude, tries to jailbreak the agent,
or fishes for something damaging, Evan leaves the game and the visitor is cut
off — he floated an IP block. His own words end "to be scoped", and it is:
an IP block is weak (shared and rotating addresses), it punishes a household
rather than a person, and the session token the operations research already
recommends is a better handle. **Still unanswered and needed first: what the
agent actually says and what tone it takes before it goes.** Right now there is
a mechanism with no behaviour.

**13. Request-time flow.** A visitor asks for time with the real Evan and a
request reaches him, by email or similar. This is the downstream half of two
things the agent already promises: its fallback when it does not know, and how
it treats recruiters. Today both point at a door that does not open.

Design them together. `docs/ai-evan/02-operations.md` covers the session
machinery both need, and the booking tools (`check_availability`, `book_meeting`)
were already named as the next slice after the Worker lands.

---

## Added 2026-09-15, second pass — two more from play

**14. Furnaces do nothing, and the inventory icon shows the wrong face.**
The icon half went to the agent already rewriting `src/blockIcon.js`; it is the
same class as items 1 and 2 (an item not showing what it is) and generalises to
every block with a distinguished `front` — blast furnace, smoker, crafting
table, dispenser, dropper, observer, loom, barrel.

**Smelting itself is unbuilt and is a real feature.** It needs a container UI
with three slots (input, fuel, output), a fuel table with burn durations, a
smelting recipe table, per-tick progress with the two arrows, the lit/unlit
block swap, and the fact that a furnace keeps burning while you are not looking
at it. `src/crafting.js` and `src/recipes.js` are the precedent for the recipe
half, and `src/inventory.js` already knows how to be a container screen with
Minecraft's shift-click rules. **Queued behind the icon work**, which currently
owns `inventory.js` and `items.js`.

FIXED 2026-09-15, except the lit swap. Breaking one drops its contents as of
the same day: `authority.js` announces every block that stops existing
(`onBlockDestroyed`) because it is the one function every block change passes
through, and `installFurnaceDrops` in `furnace.js` is the subscriber — a
coordinate no longer haunts the next furnace built in it, and `/setblock` over
one voids the contents the way vanilla does rather than dropping them.
Smelting is real: `src/furnace.js` is
vanilla's `TileEntityFurnace.update` with the fuel and recipe tables in
`recipes.js`, the screen is a fourth container in `inventory.js` drawn in CSS
(the CE pack has no furnace GUI, same call the creative picker made), and
`test/42-furnace.spec.js` asserts the times and quantities. Furnaces tick off
`noa.on('tick')` whether or not anything is open.

**THE LIT BLOCK SWAP IS STILL OPEN**, and it needs an edit to `src/blocks.js`,
which that change did not own. What it needs, precisely: a block whose `front`
is `furnace_front_on` and whose other three faces are the unlit furnace's
(`furnace_top` / `furnace_side`), plus the same for `blast_furnace` and
`smoker`. The texture EXISTS in the vanilla jar
(`assets/minecraft/textures/block/furnace_front_on.png`) and `MATERIALS` is
derived from blocks.js, so naming it there is all the extraction needs -- but
it does NOT exist in the CE pack, whose `block/` has only
`furnace_front{,_side,_top}`. So CE also needs a `CE_SUBSTITUTES` entry
deriving it from `furnace_front`, the same way every post-1.16 block is
handled. `furnaceTick()` already returns true on the tick the lit state flips,
which is the hook to hang the `authority` block write on.

STILL OPEN at `3b8ef66`, checked rather than assumed: `furnace_front_on`
appears nowhere in `src/` or `scripts/`, and `blocks.js:521` still gives the
furnace a plain `furnace_front`. The spec above is two lines of block table
plus one `CE_SUBSTITUTES` entry and it has deliberately not been half-built --
it is the cheapest item anywhere in this file and it is waiting on nothing but
`blocks.js` being free.

**15. Fluids do not flow. Neither water nor lava.**
> "see a random block of lava in a cave, but it isnt flowing down. Do fluids
> flow?" ... "water doesnt either"

**Correct, and deliberate.** `src/fluids.js:155` lists it among the things
vanilla does that this does not: *"Flowing fluids. Every fluid voxel here is a
full still block: no levels."* It was declared a non-goal when fluids were built
alongside sprint-swimming, enchantments and sneak-to-sink — and sneak-to-sink
has since been built, so the list is a backlog rather than a settled boundary.

What it costs here is worth knowing before anyone starts. Minecraft models flow
as **levels 0-7 plus a falling flag**, held in block metadata. **This engine has
no block metadata** — that is the same constraint that produced 280 separate
slab and stair ids, because noa draws a custom block mesh as a thin instance and
every voxel of an id shares one geometry. So each flow level is another block
id: roughly sixteen more for water and sixteen for lava, plus the spread
algorithm, the update scheduling (vanilla ticks water every 5 ticks and lava
every 30 in the Overworld), source-block rules, and what happens where they
meet.

Not small, and not on the critical path, but it is the difference between water
that exists and water that behaves. **Blocked on `src/blocks.js`**, which the
torch work currently owns.

FIXED 2026-09-15, and the costing above was right about the price and paid it.
Water and lava both flow (`ddc9997`, `test/41-fluid-flow.spec.js`). The
sixteen-ids-per-fluid estimate is what shipped: `flowSet` in `blocks.js` emits
levels 1-7 plus a falling column per fluid, vanilla's 5-tick water and 30-tick
lava scheduling is real, and `FLUID_FLOW` exports what a level MEANS so
`fluids.js` can read the shape of one without importing the block table. Two
things the estimate did not see coming: `fluids.ids` had meant the source block
and eighteen new ids made it mean the last one (`f95fc3d`), and one regex in
`items.js` had to learn that a flow level has no item either (`d7289a4`).

**The geometry is deliberately deferred**, with the reason written into
`blocks.js` above `flowSet`: every flow block is a FULL CUBE, because in this
file a `shape` takes the block off noa's terrain mesher entirely -- which costs
it the `fluid` flag's buoyancy, puts it back into `blockTargetIdCheck` as
something minable, and hands it to `installNonCubeCollision` as something
solid. Three regressions in the hard-won part of `fluids.js` to buy a cosmetic
slope. *The spread is the feature; the profile is the follow-up.* Sloped
surfaces, per-level heights and `water_flow.png` are carried in
`docs/FUTURE.md` rather than here.

IN FLIGHT as this was written: water renders opaque and spreads sideways over
empty air instead of falling. An agent owns `src/fluids.js` and
`test/46-water-look.spec.js` for both. Not a new report -- it is the first half
of this one not being finished.
