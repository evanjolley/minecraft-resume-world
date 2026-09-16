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

**First fix (`56d40d2`), and it was right as far as it went.** Take the
horizontal component out: `LIGHT_VECTOR` became `[0, -1, 0]`, exported from
`src/sky.js` so `main.js` and the per-tick update could not disagree, and the
scene ambient moved to `level * SIDE_SHADE`, the mean of vanilla's 0.8 and 0.6.
The Nether's `[0, -1, -0.15]` had the same bug more quietly and went the same
way. Opposite faces agreed after it, and that is what was reported.

What it could not buy was the rest of the table. One directional light plus one
scene-wide ambient term expresses exactly two values -- "faces the light" and
"does not" -- so the four sides collapsed onto a single 0.7 and the bottom
collapsed into it too.

**Second fix (2026-09-16), which is the table itself.** It lives in
`src/blockLight.js`'s material plugin, off `vNormalW`, because that plugin was
already in the fragment shader for block light and this is the four lines §2
said it would be:

```glsl
vec3 noaN = normalize(vNormalW);
vec3 noaAxis = noaN * noaN;              // sums to 1 for a unit normal
float noaFace = noaAxis.x * 0.600        // east / west
              + noaAxis.z * 0.800        // north / south
              + noaAxis.y * (noaN.y >= 0.0 ? 1.000 : 0.500);
```

Weighting each axis's constant by the SQUARED component is an exact lookup on
an axis-aligned face and a smooth blend on anything else, which is what a stair
or a torch wants. It multiplies the light LAST, after the sky term, the block
term and the floor, which is vanilla's `texture * lightmap * shade` order and
is also what finally face-shades block light -- the underside of a
glowstone-lit ceiling is now dimmer than the floor under it.

The numbers were re-read against 1.21 rather than trusted from 1.8.9:
`ClientLevel.getShade(Direction, boolean)` in
[MCP-1.21](https://raw.githubusercontent.com/Yeet-Masta/MCP-1.21/main/src/main/java/net/minecraft/client/multiplayer/ClientLevel.java)
gives DOWN 0.5, UP 1.0, NORTH/SOUTH 0.8, WEST/EAST 0.6, unchanged since 1.8.9.
Its `constantAmbientLight()` branch -- the Nether and End flag -- replaces UP
and DOWN with 0.9 and leaves the sides alone; not implemented here.

**Terrain now reads no Babylon light at all.** The plugin overwrites `color.rgb`
outright rather than correcting it, and terrain's daylight arrives as a plugin
uniform, `uDaylight`, pushed by `sky.js` through `setTerrainLight`. It could
not be a material property: `scene.performancePriority` freezes the material
UBO after the first frame, so `scene.ambientColor` had not reached a terrain
shader since boot. Two traps in one line of setup, both measured rather than
reasoned about:

- `MaterialPluginBase.registerForExtraEvents` must be **true** or
  `hardBindForSubMesh` is never called, and
- it must be set **before** `_enable(true)`, because `_activatePlugin` reads it
  once, there and then.

With either wrong the shader compiles, the JavaScript is correct, and a GPU
readback of `uDaylight` in the red channel comes back **R = 0** -- which is
exactly what the first two runs measured.

Freeing the light is what lets `src/entityLight.js` give entities vanilla's
two-light rig; see §8.

Rejected: five directional lights, one per face direction, which does express
the table exactly. Babylon lights are scene-wide, so all five would also land
on every entity. Rejected: a per-face vertex attribute written by the mesher --
the normal already is that attribute, and a second lane carrying a function of
the first is a lane that can disagree with it. Rejected: `DISABLELIGHTING`,
which says the same thing as a define and also clears Babylon's `_needNormals`,
taking `vNormalW` with it.

Measured in `test/36-face-shading.spec.js`, which reads the rendered pixels of
all four sides of a free-standing stone column off the GPU with `gl.readPixels`
at noon and at midnight. N/S over E/W comes back **1.334** against vanilla's
1.333. The mutation that proves it discriminates is north/south 0.8 -> 0.6,
which takes the ratio to 1.000 and fails the spec.

**Not covered:** the UP and DOWN entries. Both were attempted with a
straight-down and a straight-up camera and gave top 0.2346 against underside
0.2745 -- the underside brighter, which the shader cannot be doing -- so the
views were not seeing what they were named for and the assertions were cut
rather than tuned until they passed.

---

## 7. Recommendation

1. **Done:** item 6, above.
2. **Cheap and worth it next:** §4, the fullbright emitter faces, with the
   limitation written into the README. Roughly an hour, and it needs the
   `src/blocks.js` edit in §5.
3. **Done:** the per-face shading plugin from §6, which landed with block light
   in the same shader hook, as predicted.
4. **Only with a decision behind it:** §3. It is a fork of noa, not a feature on
   top of it, and the honest number is days. The invalidation cost in step 4 is
   the thing to prototype first, because it is the one that could make the game
   stutter every time a torch is placed.

---

## 8. The other shading system: entities

Minecraft has **two** of these and this document only ever described one.
Terrain gets the constant table in §6. Entities get a **two-light diffuse rig**,
and the two systems share no code in vanilla and none here either.

Reported from play:

> "I notice when I walk in circles around Evan, his face is the same level of
> dimness. Then when I fly above him, his face is bright. It is day time in the
> world."

Both halves are one line. The scene had a single `DirectionalLight` pointing
straight down (§6, first fix), so **any vertical face gets `dot(n, up) = 0` and
no diffuse at all, at any yaw**. His face was lit by `entityLight.js`'s emissive
floor alone, which is a constant. Tilt his head up to track you and the normal
swings toward +y and catches the whole term — hence bright from above.

Vanilla's rig, from `com.mojang.blaze3d.platform.Lighting` in
[1.21](https://raw.githubusercontent.com/Yeet-Masta/MCP-1.21/main/src/main/java/com/mojang/blaze3d/platform/Lighting.java),
unchanged from 1.8.9's `RenderHelper.LIGHT0_POS/LIGHT1_POS`:

```java
DIFFUSE_LIGHT_0 = new Vector3f( 0.2F, 1.0F, -0.7F).normalize();
DIFFUSE_LIGHT_1 = new Vector3f(-0.2F, 1.0F,  0.7F).normalize();
```

consumed by `assets/minecraft/shaders/include/light.glsl`:

```glsl
#define MINECRAFT_LIGHT_POWER   (0.6)
#define MINECRAFT_AMBIENT_LIGHT (0.4)

float light0 = max(0.0, dot(lightDir0, normal));
float light1 = max(0.0, dot(lightDir1, normal));
float lightAccum = min(1.0, (light0 + light1) * MINECRAFT_LIGHT_POWER + MINECRAFT_AMBIENT_LIGHT);
```

They are **fixed in world space** — `setupLevel` hands the shader the same two
vectors at every hour. The day/night response is the lightmap, which is
`entityLight.js`'s `level`; the lights only decide which side of a model is lit.
Because the pair mirrors about Y, a horizontal normal gets
`|0.2·nx − 0.7·nz| / |v|`, which is **never zero**: 0.568 along Z and 0.162
along X. That variation is the thing the report says is missing.

### Two lights out of a one-light scene

noa creates exactly one `DirectionalLight`. After §6, terrain no longer reads
it, so its whole remaining job is `blockMeshes.js`'s non-cube meshes — slabs,
stairs, fences, torches — which have their own materials, never reach the
terrain plugin's shader hook, and still want the vertical vector for exactly
the reason report #6 gave. **It stays where it is and stays vertical.**

The rig is therefore two NEW `DirectionalLight`s owned by `entityLight.js`,
restricted with `includedOnlyMeshes`, and every entity mesh is taken off noa's
light in the same breath. Both carry the full `level`: Babylon sums
`ndl · diffuse · intensity` over lights, so two of them give `level · (d0 + d1)`,
`ENTITY_DIFFUSE` scales it to `0.6 · (d0 + d1)`, and the emissive adds the 0.4.
That **is** `light.glsl`, arrived at by arithmetic that was already happening.

`entityLight.js` is handed materials and Babylon restricts lights by mesh, so
`adopt()` bridges the two once a tick through `getBindedMeshes()`, with a Set
making every tick after the first a no-op.

Rejected: computing the accumulation in JavaScript and writing it into
`diffuseColor`. It is the obvious move because that file already owns
`diffuseColor`, and it cannot work — the accumulation is a function of the
surface **normal**, which exists per fragment. In JS it collapses to one number
for the whole model, which is precisely the "same level of dimness all the way
round" that was reported. Rejected: a second material plugin doing it in GLSL,
exact but a second shader path to maintain for a sum Babylon already performs.
Rejected: excluding terrain from the two new lights instead of including only
entities — chunk meshes come and go constantly, and an exclusion list over them
is wrong for one frame every time a chunk loads.

### keepMaterialLive moved

`trackEntityLight` now calls it on every material it is handed, so a tracked
entity material cannot be a frozen one. It spent its first life in
`playerModel.js` because `entityLight.js` was being rewritten the day it was
written; `playerModel.js` re-exports it so `heldItem.js` and `itemEntity.js`
keep their imports.

### Measured

`test/68-entity-shading.spec.js`, off the GPU with `gl.readPixels` over a crop
on Evan's face, at noon:

| Standing | Face brightness |
| --- | --- |
| +X | 0.0967 |
| −X | 0.0967 |
| +Z | 0.1450 |
| −Z | 0.1450 |

A ratio of **1.50** against the 1.488 the arithmetic predicts, and the opposite
pairs are identical to four decimals — the rig is mirror-symmetric, so report #6
cannot come back on people either. The mutation that proves it discriminates is
pointing both rig vectors straight up, which is the old single light: all four
readings collapse to 0.0795, the ratio to 1.000, and the spec fails.

The first version of that spec sampled the frame CENTRE, which at 2.2 blocks is
his shirt, and this skin's shirt is very nearly black — it read 0.0417 to 0.0488
across all four views, because 1.49 times almost nothing is almost nothing. The
crop moved to his face. Worth knowing before writing the next one.

---

## 9. The `meshChunk` contract

**Three wraps of one function now stack, and the order matters.** This was true
before it was written down, which is how it nearly broke: an earlier version of
the quad splitter would have silently fed `fluidGeometry` garbage. If you are
about to touch terrain geometry, this section is the thing to read first.

### Who wraps what, innermost first

noa exposes its mesher as `noa._terrainMesher`, and `meshChunk(chunk,
ignoreMaterials)` fills `chunk._terrainMeshes`. Each wrap below calls the one
inside it and then *mutates the meshes it produced*.

| order | file | installed at | what it adds |
|---|---|---|---|
| 1 (innermost) | noa's own mesher | — | positions, indices, uvs, `color`, `texAtlasIndices` |
| 2 | `src/blockLight.js:1117` | `main.js:191` | block light in vertex **alpha**, sky light in a **`noaSkyLight`** attribute |
| 3 | `src/fluidGeometry.js:338` | `fluids.js:1347` | per-cell fluid quads, flow UVs, rewritten `texAtlasIndices` |
| 4 (outermost) | `src/blockLight.js:1158` — *deferred* | `main.js:191`, applied later | a guard: drops any `noaSkyLight` whose length disagrees with the position buffer |

Install order in `main.js` is deliberate and is what produces that nesting:
`installTerrainAnimation` (183) → `installBlockLight` (191) → fluids, which
installs `installFluidGeometry` from `fluids.js:1347`. Because each wrap
captures the *current* `mesher.meshChunk` at install time, **moving an install
line moves a layer of this stack.**

Layer 4 exists because layer 3 runs after layer 2 and can change the vertex
count. `fluidGeometry` is expected to keep `noaSkyLight` in step itself
(`69-fluid-sky` asserts the lengths agree), so the guard should now be a
no-op — but it has not been proven redundant and is cheap. See
`docs/HEALTH.md` §9.

### The layout invariant every layer depends on

**Four vertices and six indices per quad. No vertex sharing. Ever.**

That is noa's own layout, and all three wraps decode it with the same two
lines:

```js
const nf = pos.length / 12                            // 3 floats x 4 verts
const pattern = [0,1,2,3,4,5].map(i => idx[f*6 + i] - f*4)
```

(`src/fluidGeometry.js:382,412` and `src/blockLight.js:1387,1586` — the same
arithmetic, independently written, twice.)

**The quad splitter gave up vertex sharing to preserve this.** Sharing
vertices between adjacent quads is roughly a third cheaper in buffer size, and
it was deliberately rejected: the moment one vertex belongs to two quads,
`pos.length / 12` stops being a quad count, `idx[f*6+i] - f*4` stops landing
inside the quad, and *both* downstream layers silently decode the wrong
geometry. Not crash — decode wrongly. That is the expensive kind.

### Rules for anyone adding a layer

1. **Call the wrap you captured, first.** Then mutate. Never re-implement.
2. **Keep every per-vertex attribute the same length as `position`.** A
   stale-length attribute is not a soft failure: `getVerticesData` throws
   `RangeError: Invalid typed array length` and no mesh is produced, so the
   chunk is simply absent from the world.
3. **Preserve 4-verts/6-indices per quad.** If you must change it, you are
   changing a contract shared by three files and you must update all of them
   and this section together.
4. **If you add a vertex attribute, register it with the material plugin too.**
   Babylon only binds an attribute a plugin asked for in `getAttributes`; an
   unregistered one compiles fine, binds to nothing, and reads a constant 0 —
   which for `noaSkyLight` (stored inverted) looks exactly like a normal fully
   lit world. See `blockLight.js:363`.
5. **Declare your own GLSL.** Never let Babylon write a uniform declaration
   for you via `getUniforms().ubo` size/type or `getUniforms().fragment`. Both
   routes inject at tokens that Babylon 6's shaders do not contain, both fail
   silently, and both have now cost this repo a day —
   `terrainAnimation.js:377` and the invisible-world regression in
   `docs/HEALTH.md` §0. Declare at a `CUSTOM_*` injection point you have
   grepped for in the actual shader.
