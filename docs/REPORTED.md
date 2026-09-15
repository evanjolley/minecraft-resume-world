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

**4. Returning from the Escape menu leaves the cursor on screen.**
> "when I press esc or back to game on the esc menu, my cursor should not be
> visible, should go back to the crosshair."

Adjacent to the pointer-lock race fixed in `f1fa89d`, and possibly caused by its
secondary half: `requestLockPersistently` became cancellable in that change.
Browsers impose a cooldown after the *user* presses Escape, which is why the
retry loop exists at all. **Check whether the fix made it give up too early.**
Unverified, but this is the first place to look, and it is a regression risk
from a fix landed the same day.

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

**8. Boats.**

**9. Buckets — water, lava, and the mechanics.**
Fluids already exist properly (`src/fluids.js`, real viscosity, drowning,
burning). Buckets are the interaction: pick up a source block, place it back,
and the consequences. Note `items.js` already has a `bucket` item and vanilla
has no water *item*, only the bucket — which is why fluids are filtered out of
the block-item list.

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
