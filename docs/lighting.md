# Lighting

Diagnosis and a plan.

> **STATUS, 2026-09-16: the block half of this plan is BUILT** —
> `src/blockLight.js`. This document is now **partly historical**. It remains
> the best account of what noa 0.33 does and does not offer, and §6 is still
> live, but two of its conclusions were overtaken by the implementation: the
> mesher turned out to be reachable **on the noa instance** so nothing had to
> be vendored, and the engine rides vertex colour **alpha** rather than the
> AO-premultiplied RGB lane proposed here. **Sky light is still not built**,
> which is why caves are bright. See `docs/REPORTED.md` 5, 5a and 5b.

When it was written, the only code changed alongside it was the face-shading
fix in §6, and no light engine existed.

Reported from play (`docs/REPORTED.md` items 5 and 6):

> "glowstone emits no light when placed."

> "the east edge of blocks has weirdly more lighting than the rest, even at
> night. Isnt dynamic but should be I guess."

Item 6 is fixed and is written up last, because it is small and because the
one hook it could not reach is the same hook item 5 needs.

---

## 1. One missing feature, four symptoms

Glowstone is not broken. Nothing in this engine has ever had a light value.
The same gap is already on record in three other places, each filed as its own
small disappointment:

| Symptom | Where it was met |
| --- | --- |
| Glowstone lights nothing | `docs/REPORTED.md` item 5 |
| Torches would light nothing either, if torches land | `docs/REPORTED.md` item 3 |
| A player in a cave is lit as if outdoors | `src/entityLight.js`, "WHAT THIS DOES NOT DO" |
| F3 has no Client Light / Server Light lines | `src/debugScreen.js` |

Fixing any one of them means building all of it. That is the single biggest
thing not on the roadmap, and the reason this document exists is that the
estimate matters more than the enthusiasm.

---

## 2. What noa 0.33 actually offers

Checked in `node_modules/noa-engine/src/lib/`, not from memory.

**The registry has no light concept.** `registerBlock` reads exactly these
options (`registry.js:97-160`): `solid`, `opaque`, `fluid`, `blockMesh`,
`material`, `fluidDensity`, `viscosity`, and the five `onLoad`/`onUnload`/
`onSet`/`onUnset`/`onCustomMeshCreate` handlers. `registerMaterial`
(`registry.js:175-205`) reads `textureURL`, `color`, `atlasIndex`,
`texHasAlpha`, `renderMaterial`. There is no emission field, no opacity-to-light
field, and nothing that would carry a light level in either direction.

**A chunk stores block ids and nothing else.** `Chunk.voxels` is one ndarray of
ids (`chunk.js:36`). Everything else on the object is bookkeeping -- dirty
flags, neighbour pointers, a mesh list. There is no second array to put a light
value in, and no API that would let a caller add one.

**The mesher has no hook.** `terrainMesher.js` is a closed module: greedy
meshing, AO computed inline, vertex data assembled and handed to Babylon. It
takes no callbacks and exposes no extension point. Injecting per-voxel data
means editing that file, which means vendoring noa rather than depending on it.

**There IS a free per-vertex channel, and this is the good news.** AO is
premultiplied into vertex colour RGB (`terrainMesher.js`, `pushAOColor`):

```js
function pushAOColor(colors, ix, baseCol, ao, aoVals, revAoVal) {
    var mult = (ao === 0) ? revAoVal : aoVals[ao - 1]
    colors[ix] = baseCol[0] * mult
    colors[ix + 1] = baseCol[1] * mult
    colors[ix + 2] = baseCol[2] * mult
    colors[ix + 3] = 1          // <-- never anything but 1
}
```

The alpha lane is written once, as a constant, and never read: Babylon only
compiles `VERTEXALPHA` into the shader when a mesh sets `hasVertexAlpha`, and
noa never does. So a per-vertex light value has somewhere to live that costs no
extra attribute, no extra buffer and no extra bandwidth. Smooth lighting --
vanilla's per-vertex average of the four voxels touching a corner -- would come
out of the same interpolator AO already rides on.

**The fragment shader is reachable.** `terrainMaterials.js` already ships a
`MaterialPluginBase` that rewrites the atlas sampling line, and `docs/water.md`
§3 costed a copy of it at a couple of hours for the animated-texture layer
remap. Reading `vColor.a` and multiplying it into the final colour is smaller
than that -- one `CUSTOM_FRAGMENT_MAIN_END` string, no new uniform, no new
sampler.

So the shader end is cheap and the data end is not. That asymmetry is the whole
estimate.

---

## 3. What a real light engine costs here

Vanilla's model, for reference: two independent 4-bit channels per voxel, sky
light and block light. Sky light falls 1 per block downward-and-outward except
straight down through transparent blocks, where it does not fall at all. Block
light falls 1 per block from each emitter, `glowstone 15`, `torch 14`,
`lava 15`, `sea lantern 15`. A voxel renders at `max(blockLight,
skyLight * daylight)`.

What it would take, in the order the work actually has to happen:

1. **A per-voxel store.** A `Uint8Array` beside `Chunk.voxels`, one nibble per
   channel. At the current view distance -- `chunkSize: 32`,
   `chunkAddDistance: [4, 3]` in `src/main.js`, so 9 x 9 x 7 = 567 chunks of
   32768 voxels -- that is **18.6 million voxels, 18.6 MB** of light data
   resident. Not fatal, but it doubles the terrain's memory footprint, and it
   has to be allocated and freed in step with chunk lifecycle.
2. **A per-block emission and opacity table.** Two numbers per block id.
   `src/blocks.js` is where they belong and **this document does not add
   them** -- see §5.
3. **The initial flood fill.** BFS from every emitter and every sky column when
   a chunk is generated, seeded across chunk borders, which means it cannot run
   until neighbours exist. noa already has the neighbour-count machinery for
   meshing and it would have to be reused.
4. **Incremental invalidation, which is the hard part.** Minecraft does removal
   before addition: pulling a torch out means walking the region that *might*
   have been lit by it, clearing it, then re-propagating from every emitter on
   the boundary. A radius-15 edit reaches up to 31 blocks across, which at
   chunkSize 32 touches up to **8 chunks**, every one of which must be remeshed.
   Today placing a block remeshes one. That is an 8x worst case on the single
   most expensive operation in the game, and it fires on every torch placed and
   every wall sealed.
5. **The mesher writing light into vertex alpha**, per corner, averaged the way
   AO already is. Free in bandwidth, and it is the fork of `terrainMesher.js`.
6. **The shader reading it.** Small. See §2.
7. **Entity light.** `src/entityLight.js` is already built to take a level from
   one place; it would read `max(skyLight * daylight, blockLight)` at the
   entity's voxel instead of the sky's level, and caves would go dark. This is
   the one piece that is genuinely easy, because the seam was left for it.
8. **F3.** Two lines come back.

**Honest total: a vendored fork of noa's mesher and chunk store, plus a
propagation system, plus invalidation.** Two to four days, most of it in step 4,
and the ongoing cost is that noa can no longer be upgraded by bumping a version.
The per-frame budget is fine -- the shader work is a multiply -- but the
per-edit budget is not obviously fine and would need measuring before anyone
commits.

**Rejected: point lights.** Babylon caps `maxSimultaneousLights` at 4 by
default, they do not respect walls, and a room with six torches in it is a
normal room. It looks like lighting for about ten seconds.

---

## 4. The smaller honest version

There is one, it is genuinely small, and it is not a lie provided the
limitation is said out loud: **an emitter can light its own faces.**

`registerMaterial` accepts `renderMaterial`, a Babylon material used verbatim
for that block's faces (`registry.js:201`, `terrainMaterials.js:130`). A
`StandardMaterial` with `emissiveTexture` set to the block's own texture and
`disableLighting = true` renders glowstone at full brightness at midnight,
exactly as vanilla's fullbright texture does, and costs nothing per frame
because the material already exists per texture.

What that buys: glowstone, sea lantern, lava and a torch flame stop going grey
at night, which is most of what "it emits no light" looks like from three
blocks away. What it does not buy: the floor in front of them stays dark, and
so does the player. **Anyone shipping this has to say so** -- in the block's
tooltip or in `README.md` -- because a glowing block that lights nothing is the
kind of half-truth that gets rediscovered as a bug later.

Rejected as dishonest: faking a falloff by tinting the *neighbouring blocks'*
materials. Materials are per texture, not per position, so every stone block in
the world would brighten at once.

---

## 5. What `src/blocks.js` would need

Not edited here -- `src/blocks.js` belongs to another agent this session. The
request, stated so it can be handed over:

- A per-block `light` field on the block table, 0-15, vanilla values:
  `glowstone 15`, `sea_lantern 15`, `lava 15`, `torch 14`, `redstone_torch 7`,
  `magma_block 3`. Dead data until §3 lands, and the point of adding it early
  is that it is a data edit rather than an engine one.
- A per-block `lightOpacity`, 0 for air/glass/leaves-as-vanilla-treats-them,
  15 for solids. Same shape, same reason.
- For §4 only: an `emissive: true` flag on the material registration for those
  same blocks, which is the whole of the small version on the blocks side.

---

## 6. Item 6, which is fixed

**The premise in the report is wrong, and it matters, because "make it dynamic"
would have moved away from Minecraft rather than toward it.**

Minecraft's face shading is a constant table. From
`BlockModelRenderer.EnumNeighborInfo` in the decompiled client
([MCP-919](https://raw.githubusercontent.com/Marcelektro/MCP-919/main/src/minecraft/net/minecraft/client/renderer/BlockModelRenderer.java)):

| Face | Multiplier |
| --- | --- |
| UP | 1.0 |
| NORTH / SOUTH | 0.8 |
| EAST / WEST | 0.6 |
| DOWN | 0.5 |

Those scale the light level. At night the whole table darkens together and the
ordering never moves; the sun's position never enters into it.

The real bug was that **the table is symmetric and a directional light cannot
be.** `max(0, dot(n, -L))` is antisymmetric by construction, so any `L` with a
horizontal component lights one vertical face and leaves the one facing it on
the ambient term alone. With the old `lightVector: [0.6, -1, -0.4]` the
measured difference between opposite faces of the same stone column was
**0.493 against 0.350 in rendered pixels, a 41% split** -- something vanilla
renders as two identical 0.6 faces. That is the bright edge in the report, and
"even at night" is right: it is a ratio, so it survives the dimming.

The fix is to take the horizontal component out. `LIGHT_VECTOR` is now
`[0, -1, 0]`, exported from `src/sky.js` so `main.js` and the per-tick update
cannot disagree, and the scene ambient moved from `level * 0.5` to
`level * SIDE_SHADE`, where `SIDE_SHADE` is the mean of vanilla's 0.8 and 0.6.
The Nether's `[0, -1, -0.15]` had the same bug more quietly and went the same
way.

**What this does not buy, and why it is here rather than in a commit message:**
one directional light plus one scene-wide ambient term can express exactly two
values, "faces the light" and "does not". So the four sides collapse to a
single 0.7 and the bottom collapses into it too. Getting the real five-value
table needs per-face shading in the terrain fragment shader, reading the face
normal -- **the same plugin hook §2 wants for block light**, four lines of GLSL
next to it. Which is why it is worth doing the two together rather than either
alone.

Rejected: five directional lights, one per face direction, which does express
the table exactly. Babylon lights are scene-wide, so all five would also land
on every entity, and entity shading is a tuned model that `src/entityLight.js`
exists specifically to stop people retuning by accident. Per-mesh exclusion
lists over dynamically created chunk meshes is a worse problem than the one
being solved.

Measured in `test/36-face-shading.spec.js`, which samples the rendered pixels
of all four sides of a free-standing stone column at noon and at midnight, and
fails on the old light vector.

---

## 7. Recommendation

1. **Done:** item 6, above.
2. **Cheap and worth it next:** §4, the fullbright emitter faces, with the
   limitation written into the README. Roughly an hour, and it needs the
   `src/blocks.js` edit in §5.
3. **Cheap and worth it next:** the per-face shading plugin from §6, since it
   shares the hook with §3 and pays off immediately.
4. **Only with a decision behind it:** §3. It is a fork of noa, not a feature on
   top of it, and the honest number is days. The invalidation cost in step 4 is
   the thing to prototype first, because it is the one that could make the game
   stutter every time a torch is placed.
