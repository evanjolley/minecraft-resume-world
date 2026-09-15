# Reported from play, not yet diagnosed

Eleven things Evan hit in one session on 2026-09-15 and called out on the way
out the door. **Nothing here has been investigated.** Where a cause is guessed
it is marked as a guess — this file exists so the reports survive, not so
anybody acts on a hunch written down at speed.

`docs/FUTURE.md` is the curated roadmap and stays that way. Items here get
triaged into it, or fixed, or dismissed with a reason. Several of these are
probably one root cause wearing different clothes; see the note at the bottom.

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

**2. Hovering a block in the inventory should name it.**
> "When I hover over a block in inv i think it should say the name of it? I
> believe this is true minecraft behavior."

It is. Vanilla shows a tooltip with the item name on hover in every container.
The creative picker got tooltips; check whether the survival inventory and the
hotbar did too, and match vanilla's styling rather than inventing one.

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

**5. Glowstone emits no light.**
Not a glowstone bug. **noa has no light engine at all** — ambient occlusion plus
one directional vector, no per-voxel light value to read or write. This was
established twice already: the F3 screen had to cut its Client/Server Light
lines, and entity lighting can track daylight but not block light, so a player
in a cave stays lit as if outdoors. Placing a light source and expecting
darkness to retreat needs light propagation, which is a real engine feature and
the largest single item on this page.

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

**11. A code cleanup pass, after all of the above.**
A two-phase health sweep already ran once and is worth repeating the same way:
dead code and export surface first, then duplication and efficiency. It must run
alone — it touches every file, and the one time something else was live
concurrently, a commit swallowed another agent's staged work.

---

## The thread running through several of these

**5 and 6 are the same missing feature**, and **2 and 1 are the same missing
affordance.** Worth triaging together rather than one at a time:

- No light engine means no glowstone (5), no torch light if torches land (3),
  no cave darkness for entities, and no F3 light readout. That is one feature
  behind four symptoms, and it is the biggest thing not on the roadmap.
- An item needs to show what it *is* — its name on hover (2) and its real shape
  as an icon (1). One answer covers both.

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
