# world

Walkable voxel island for world.evanjolley.com. Resume builds + parkour, with
concurrent visitors able to see each other.

## Run it

    npm install
    npm run dev      # http://localhost:5173

Click to enter (that click is what grants pointer lock).

    WASD        move            ctrl    sprint
    space       jump            shift   sneak
    left click  mine (hold)     E       inventory
    right click place           F5      camera perspective
    1-9 / scroll  hotbar slot   esc     release cursor

## Stack, and what we passed on

**noa-engine** for the voxel runtime. Gives us chunking, meshing, swept-AABB
collision and player physics. Passed on raw three.js, which is current and
maintained, but we'd be hand-writing greedy meshing and collision, and collision
feel is exactly what decides whether parkour is any good.

Known tradeoff: noa's last commit is May 2023 and it pins Babylon `^6`, while
Babylon ships 9.x. It boots clean on Node 24 / Vite 8 with no errors, and voxel
collision isn't a domain that rots, but we own it if we hit a bug.

**Pixel Perfection** for textures, by Hugh "XSSheep" Rutland, CC-BY-SA-4.0.
Mojang's own assets can't be redistributed, so this is one of the few genuinely
open 16x packs. Attribution is on the entry overlay because the license requires
it wherever the work is distributed. See `public/textures/NOTICE.txt`, which also
records that `grass_side.png` is our derivative.

Passed on ProgrammerArt (CC-BY, but rougher art) and on generating pixel art
procedurally, which dodges licensing but never looks as good as drawn art.

## Minecraft fidelity

Movement uses real Java Edition constants, verified by measuring in-browser
rather than by trusting the arithmetic:

| thing            | Minecraft | measured here |
|------------------|-----------|---------------|
| jump apex        | 1.2522 b  | 1.2521 b      |
| walk speed       | 4.317 b/s | 4.288 b/s     |
| sprint speed     | 5.612 b/s | 5.575 b/s     |
| sneak speed      | 1.295 b/s | 1.286 b/s     |
| player box       | 0.6x1.8   | 0.6x1.8       |
| fall damage      | >3 blocks | >3 blocks     |

The apex is the number that matters most: it's why you clear a 1-block step
and never a 2-block one, and every parkour jump is designed around it.

Two traps found while calibrating, both worth knowing if you retune:

- `debug: true` runs a block noa itself labels "temp hacks for development",
  and one of those hacks sets `airJumps = 999`. That was the infinite jump,
  not a physics setting.
- noa ships the player body with `gravityMultiplier = 2`, so the global
  gravity silently doubles. Jump impulse is therefore *calibrated*, not
  derived; re-run the binary search if you change gravity or air drag.

The world is 80x80 (5x5 Minecraft chunks) running from grass at y=64 down to
bedrock at y=0, with 1.16-era strata. Ore rarity is solved against Minecraft's
real frequencies rather than hand-tuned -- coal 1.0%, iron 0.7%, redstone
0.15%, gold 0.1%, diamond 0.08%, lapis 0.05% of the stone region.

The strata are 1.16-era because Pixel Perfection CE predates Caves & Cliffs.
The palette now reaches past that: 95 of 427 materials have no CE original
(copper, deepslate, tuff, sculk, the newer wood sets), so the build derives
those by colour-shifting the nearest CE texture rather than dropping the
blocks. Dropping them would make block ids mean different things depending on
which texture source you happened to build with, and ids are world data.

Sprint follows Minecraft's real rules: double-tap forward within 7 ticks, or
hold Ctrl, cancelled by releasing forward / sneaking / dropping to 6 food.
Base FOV is Minecraft's 70 degrees, kicking to 77 while sprinting -- without
that cue a 30% speed change is nearly imperceptible.

Day/night runs Minecraft's clock: 24000 ticks at 20/sec, measured at 19.95,
so a 20.1 minute day against Minecraft's 20.

Also implemented: hold-to-break with per-block times and the destroy-stage
crack overlay, Minecraft's drop rules (grass gives dirt, stone gives
cobblestone), placement blocked when it would trap the player, stack-merging
inventory with left/right click semantics, hearts and hunger in half-units,
XP bar, fall damage, void death with a proper death screen, sneak
edge-protection, first-person held item with view bob and swing, a geometry
cloud layer, the sun, Minecraft's black wireframe block outline, and the
Monocraft typeface.

Deliberately NOT implemented: mobs, crafting, tool tiers and durability,
day/night, block crack overlays, armor slots. Hunger *drain* is written but
switched off via `HUNGER_DRAIN_ENABLED` in `survival.js`, because a visitor
reading a resume plot shouldn't starve while doing it.

Not yet done: resume content (the whole point -- the island is still empty),
multiplayer presence, sounds, and block-breaking particles.

The block palette is 355 full cubes on a paged texture atlas (128 layers per
page, 5 pages) -- paged because WebGL2 only guarantees 256 array layers, so a
single page would cap the palette. Stairs, slabs and other non-cube geometry
are still missing; noa supports them via blockMesh but nothing here uses it. Fog was
investigated and rejected: noa's terrain shader has no fog handling at all,
so Babylon scene fog would tint the sky and leave the world untouched.

## Layout

- `island.js` — pure `(x,y,z) => blockID`. Pure because noa requests chunks in
  arbitrary order, possibly twice, possibly off-thread.
- `blocks.js` — one table driving registration, icons, names, hardness, drops.
- `physics.js` — Minecraft movement constants and the calibrated jump.
- `survival.js` — health, hunger, XP, fall damage, death.
- `inventory.js` — 36-slot model plus the inventory screen.
- `interact.js` — mining, placing, hotbar and camera controls.
- `hud.js` — hotbar, hearts, hunger, XP, coordinates.
- `blockIcon.js` — CSS-cube inventory icons.
- `respawn.js` — void death and respawn.
- `main.js` — engine options, chunk callback, wiring.

## Gotcha for the scripted flythrough

`noa.camera.getDirection()` is only recomputed inside `applyInputsToCamera()`,
which early-returns when there's no pointer lock. Setting `noa.camera.pitch`
programmatically therefore does nothing until an input tick runs under lock.
The mobile flythrough will hit this. Workaround is
`noa.camera.sensitivityMultOutsidePointerlock = 1`.

## Next

1. Resume plots laid out on the grid.
2. Build in real Minecraft, export litematic, import via deepslate/prismarine-nbt.
3. Multiplayer presence: Cloudflare Durable Object, WebSocket hibernation,
   position + yaw at ~10Hz, client-side interpolation.
4. Mobile fallback: fixed camera flythrough, since pointer lock doesn't exist there.
