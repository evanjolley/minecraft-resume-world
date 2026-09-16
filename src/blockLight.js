import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js'

/*
 * BLOCK LIGHT.
 *
 * `docs/lighting.md` costed this at two to four days and said the shader end
 * was nearly free while the data end was not. Both halves of that turned out
 * to be right, and this file is the cheapest honest version of the data end.
 *
 * WHAT IS HERE: both of vanilla's channels. BLOCK LIGHT -- a glowstone lights
 * the floor in front of it, the light falls off one level per block, it stops
 * at walls, and pulling the glowstone out takes the light with it. And SKY
 * LIGHT -- every voxel with nothing opaque above it holds 15, that 15 falls
 * STRAIGHT DOWN with no decay at all, and it spreads sideways at the usual one
 * level per block. A cave at noon is dark. It was not, and docs/REPORTED.md 5b
 * is the report that it was not.
 *
 * THE ASYMMETRY IS THE WHOLE FEATURE. A voxel renders at
 * `max(skyLight * daylight, blockLight)` and only the FIRST term follows
 * sky.js's clock. That is what makes a torch matter at midnight and be
 * invisible at noon, and it is why the two channels cannot be collapsed into
 * one stored number: the number that would have to be stored changes every
 * tick, and vertex data is baked at mesh time.
 *
 * THE TWO GENUINELY NEW PIECES, as opposed to a second run through machinery
 * that was already here:
 *
 *   1. The no-decay downward rule is a SPECIAL CASE INSIDE THE BFS, not a
 *      different constant. See `propagate` -- one line, mirrored by one line
 *      in `removeLight`.
 *
 *   2. A block edit dirties a whole COLUMN where block light only ever dirties
 *      a radius. That is not extra code either: it falls out of rule 1. The
 *      removal walk follows the same down-with-no-decay edge the fill did, so
 *      placing one block on open ground darkens everything under it to the
 *      bedrock without a column loop existing anywhere.
 *
 *
 * HOW IT AVOIDS FORKING NOA, WHICH THE DOC ASSUMED IT COULDN'T
 *
 * The doc's estimate was a vendored copy of `terrainMesher.js` (987 lines) and
 * `chunk.js`, because neither has an extension point. Both were dodged:
 *
 *   - The store lives HERE, in a Map of chunk key -> Uint8Array, not beside
 *     `Chunk.voxels`. noa never needs to know it exists. Costs one extra Map
 *     lookup per voxel read and saves owning a fork of the chunk lifecycle.
 *
 *   - The mesher is not forked, it is WRAPPED. `meshChunk` is replaced on the
 *     instance; the original runs untouched, and then this file reads the
 *     finished mesh's position/normal/colour buffers back out and rewrites the
 *     alpha lane. Babylon keeps a CPU-side copy of vertex data, so reading it
 *     back is free of a GPU round trip.
 *
 * The road not taken: actually vendoring the mesher, which would compute light
 * per face during greedy meshing instead of per vertex afterwards -- fewer
 * passes and access to the face normal as an integer rather than a float. It
 * is also 987 lines of someone else's code that can never be upgraded again.
 * The wrapper costs one extra pass over ~4 numbers per vertex per remesh and
 * leaves `npm update noa-engine` working.
 *
 *
 * THE FREE LANE, AND WHY IT IS 1-MINUS
 *
 * `pushAOColor` in noa's mesher writes vertex alpha as a constant 1 that
 * nothing reads: Babylon only compiles VERTEXALPHA -- the define that makes
 * the fragment shader do `alpha *= vColor.a` -- when a mesh sets
 * `hasVertexAlpha`, and noa never does. But `vColor` is declared vec4 and
 * varying whenever VERTEXCOLOR is on, so the fragment shader can READ `.a`
 * with no define, no attribute, no buffer and no bandwidth. That is the lane.
 *
 * SUBTLE, AND THE reason the stored value is inverted: `hasVertexAlpha` is
 * exactly what we must NOT set, because Babylon's
 * `needAlphaBlendingForMesh()` returns true for any mesh with it and the
 * entire terrain would move to the transparent render list and sort itself
 * back-to-front every frame. Reading `.a` without setting it is the whole
 * trick.
 *
 * Light is stored as `1 - level/15`, not `level/15`. noa's untouched constant
 * is 1, so an unlit default has to mean "no block light" -- if it meant "full
 * block light" then any mesh this file failed to reach, for one frame or
 * forever, would render fullbright white. Inverted, the failure mode is
 * "looks exactly like today".
 *
 *
 * HOW IT COMPOSES WITH DAYLIGHT WITHOUT A UNIFORM
 *
 * Vanilla renders a voxel at `texture * max(skyLight * daylight, blockLight)`.
 * The shader hook here is
 *
 *     color.rgb = max(color.rgb * skyLight, noaBaseCol * blockLight)
 *
 * where `color.rgb` is the already-day-shaded result and `noaBaseCol` is the
 * unshaded texel captured a few lines earlier. That IS the vanilla max, and it
 * needs no daylight uniform and no per-frame bind: sky.js already drives
 * `light.intensity` and `scene.ambientColor` from the same `level`, so
 * `color.rgb` IS `texture * daylight` and multiplying it by the sky FRACTION
 * gives `texture * skyLight * daylight` exactly. At noon under open sky the
 * fraction is 1 and the max picks the sun; in a cave the fraction is 0 and the
 * max picks the torch, or nothing.
 *
 * Rejected: a `uDaylight` uniform and `color.rgb *= max(1.0, L / uDaylight)`.
 * Same result at both ends, but it divides by a number that approaches zero at
 * midnight, and the clamp needed to stop that is a tuning knob nobody wants.
 *
 *
 * WHY SKY LIGHT NEEDED A SECOND LANE AND COULD NOT SHARE THE FIRST
 *
 * Alpha is one interpolated float and there are now two numbers per vertex.
 * Packing them into one (`sky * 16 + block`, say) is the obvious saving and it
 * is wrong: the GPU INTERPOLATES a vertex attribute across the triangle, and
 * the interpolation of a packed pair is not the pair of the interpolations --
 * halfway between 15*16+0 and 0*16+15 is 127.5, which unpacks to sky 7,
 * block 15. So the second channel is a real second attribute, `noaSkyLight`,
 * declared by this plugin via `getAttributes`.
 *
 * Rejected: stealing a component of the vertex COLOUR, which is already vec4
 * and already uploaded. noa's `pushAOColor` writes `baseCol[i] * aoMult` into
 * rgb, and `baseCol` is the material's tint -- grass is green there, so the
 * three components are not redundant and none of them is free.
 *
 * STORED INVERTED, as `1 - sky/15`, for the same reason the alpha lane is: a
 * mesh this file never reaches has no such attribute at all, WebGL hands the
 * shader the generic default 0 for it, and 0 must mean "full sky" or every
 * unreached mesh in the world would render pitch black. Inverted, the failure
 * mode is again "looks exactly like today".
 *
 * FACE SHADING NOW LIVES HERE TOO, and it is the same four lines the note
 * that used to sit in this paragraph promised. `vNormalW` was the hook, and
 * both things it was waiting on -- the five-value table and face-shading the
 * block light -- fall out of one multiply at the end of the fragment code.
 * See MC_FACE_SHADE below.
 */

/*
 * TERRAIN FACE SHADING, and why it is a table and not a light.
 *
 * Minecraft gives every face of every block a CONSTANT multiplier on its light
 * level. From `ClientLevel.getShade(Direction, boolean)` in 1.21:
 *
 *     case DOWN:  return flag ? 0.9F : 0.5F;
 *     case UP:    return flag ? 0.9F : 1.0F;
 *     case NORTH: case SOUTH: return 0.8F;
 *     case WEST:  case EAST:  return 0.6F;
 *
 * (`flag` is `constantAmbientLight()`, the Nether/End dimension flag, and it
 * touches UP and DOWN only -- the sides stay 0.8 and 0.6 either way. Not
 * implemented here; dimensions.js would be where it went.)
 *
 * The table does not rotate with the sun and never has, which is the half of
 * report #6 that was already right. What was WRONG is that sky.js expressed
 * the table with a Babylon DirectionalLight, and `max(0, dot(n, -L))` is
 * antisymmetric: it cannot give +X and -X the same number unless L is
 * vertical, and a vertical L collapses all four sides AND the bottom onto one
 * value. sky.js pointed it straight down to kill the asymmetry and said so in
 * place -- the fix was right, the mechanism just could not say more than two
 * numbers. The table can say five, so it takes the job and the light is freed
 * for entities.
 *
 * Rejected: five directional lights, one per face direction. That does express
 * the table, and sky.js already rejected it for the right reason -- Babylon
 * lights are scene-wide, so they land on every entity too. Rejected: a
 * per-face vertex attribute written by the mesher. The normal IS that
 * attribute and it is already in the buffer; a second lane carrying a function
 * of the first is a lane that can disagree with it.
 *
 * NORTH/SOUTH is the Z pair and EAST/WEST is the X pair here as in vanilla,
 * and the compass mirror that debugScreen.js documents does not matter for
 * once: mirroring X swaps east with west, and east and west are the same
 * number.
 */
export const MC_FACE_SHADE = {
  up: 1.0, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6,
}

/**
 * Daylight for terrain, 0..1. Pushed by sky.js once a tick.
 *
 * It is a MODULE VARIABLE read at bind time rather than a value written onto
 * each material, and that is not a style choice. Terrain used to take its
 * daylight from the directional light's intensity, which lives in the LIGHT's
 * uniform buffer and is therefore rebound every frame. Nothing else on a
 * terrain material is: noa sets `scene.performancePriority = Intermediate`,
 * Babylon turns that into `checkReadyOnlyOnce`, `isFrozen` IS
 * `checkReadyOnlyOnce`, and StandardMaterial guards its whole material-UBO
 * write -- `vDiffuseColor`, `vEmissiveColor`, `vAmbientColor` -- behind
 * `!this.isFrozen`. So `scene.ambientColor` has not reached a terrain shader
 * since the day the material first rendered, and writing the daylight into
 * any StandardMaterial property would have been the fourth time that trap
 * has been sprung in this repo (56d40d2, the held item, the nametag).
 *
 * A PLUGIN uniform is outside that guard. `hardBindForSubMesh` is called from
 * StandardMaterial.bindForSubMesh BEFORE the `mustRebind` test and outside
 * the `isFrozen` one, so a value written there reaches the GPU on every draw
 * of a frozen material. That is the whole reason this file can own terrain's
 * daylight at all.
 */
let terrainLevel = 1

/** Called by sky.js, once a tick, with the same `level` entities get. */
export function setTerrainLight(value) {
  terrainLevel = value
}

/** Test seam: what the shader is actually being told the daylight is. */
export function getTerrainLight() {
  return terrainLevel
}

/** Vanilla's emission levels, by block key. Anything absent emits nothing. */
export const EMISSION = {
  glowstone: 15,
  sea_lantern: 15,
  lava: 15,
  torch: 14,
  redstone_torch: 7,
  magma_block: 3,
}

/** Vanilla's cap. One nibble, and the reason decay is 1/15 per block. */
export const MAX_LIGHT = 15

/**
 * Blocks that stop SKY light while letting block light through, by key.
 *
 * One entry, and it is not a special case so much as the world's edge finally
 * being asked what it is. island.js's barrier is solid, unbreakable and
 * INVISIBLE, and blocks.js registers it `opaque: false` for the rendering
 * reason -- an opaque block with no material is a hole in the world. So sky
 * light poured straight down every column outside the patch, reached the void
 * under the world floor, and lit the underside of the entire map from beneath.
 *
 * MEASURED, not theorised: 32,228 terrain vertices at spawn on the flat world
 * against a pre-sky-light 536, and the diagnostic said what it was -- 1,024
 * DOWN-facing quads per chunk, one per block, carrying a real sky gradient
 * across the underside of a floor nobody can see. The split criterion was
 * doing exactly what it should with light data that should never have existed.
 *
 * The barrier is Minecraft's world border wearing a block's clothes. Daylight
 * does not come in around the edge of the world.
 */
const SKY_OPAQUE = ['barrier']

/**
 * The sky channel's vertex attribute, holding `1 - skyLevel/15`.
 *
 * Named like noa's own `texAtlasIndices` rather than prefixed with the file,
 * because it travels with the terrain vertex buffers and the next person to
 * read a buffer dump should recognise it as terrain data.
 */
const SKY_ATTRIB = 'noaSkyLight'

/**
 * How dark a voxel with no light of any kind renders, as a fraction of its
 * own texel. Vanilla's lightmap bottoms out around here rather than at black.
 */
export const LIGHT_FLOOR = 0.05

/**
 * Block keys whose whole family emits, matched by prefix.
 *
 * Lava is eight flow ids plus a source (`lava`, `lava_flow_7`, ...), all of
 * which are lava and all of which glow. Listing them individually would go
 * stale the next time blocks.js adds a level.
 */
const EMISSION_PREFIXES = [['lava', 15]]

/* ------------------------------------------------------------------ *
 * The shader half
 * ------------------------------------------------------------------ */

class BlockLightPlugin extends MaterialPluginBase {
  constructor(material) {
    // Priority 210: after terrainAnimation.js's 200, so that if both ever want
    // the same injection point the light lands on top of the animated texel.
    super(material, 'NoaBlockLight', 210, { NOA_BLOCK_LIGHT: false })
    /*
     * OPT IN, BEFORE _enable, or hardBindForSubMesh below is never called.
     *
     * MaterialPluginManager only wires `_callbackPluginEventHardBindForSubMesh`
     * for plugins that set this; the default is false and the method is simply
     * ignored. Measured, not read: with it missing, a GPU readback of a lit
     * ground pixel at noon with the shader rewritten to output `uDaylight` in
     * the red channel came back R=0 -- the uniform had never been written, and
     * the whole world was rendering off the light floor instead.
     *
     * The ORDER is the other half of it. `_enable(true)` is what runs
     * `_activatePlugin`, and `_activatePlugin` reads this flag once, there and
     * then. Setting it after the enable compiles, type-checks and does
     * nothing -- which is exactly what the second GPU read showed, still R=0
     * with the flag apparently set.
     */
    this.registerForExtraEvents = true
    this._enable(true)
  }

  /*
   * THE ONE THING docs/lighting.md GOT WRONG, and it cost an hour.
   *
   * The doc says vertex alpha is "a free per-vertex lane" that the fragment
   * shader can read because `vColor` is declared vec4 whenever VERTEXCOLOR is
   * on. The varying is vec4. What is in it is not. Babylon's
   * ShadersInclude/vertexColorMixing.js:
   *
   *     vColor=vec4(1.0);
   *     #ifdef VERTEXCOLOR
   *       #ifdef VERTEXALPHA
   *         vColor*=color;
   *       #else
   *         vColor.rgb*=color.rgb;      <-- alpha stays 1.0
   *       #endif
   *     #endif
   *
   * So without VERTEXALPHA the alpha lane is written by the mesher, uploaded
   * to the GPU, and then thrown away in the vertex shader. The fragment shader
   * reads a constant 1 no matter what is in the buffer. Every injection point
   * compiles, every define is present, nothing errors, and the screen does not
   * change -- which is exactly what it did.
   *
   * VERTEXALPHA is a define, though, and defines are ours. Turning it on here
   * is NOT the same as setting `mesh.hasVertexAlpha`: that property is what
   * `needAlphaBlendingForMesh()` reads, and setting it would move the entire
   * terrain into the transparent render list to be depth-sorted every frame.
   * The define only changes the two shader lines. The second of those lines is
   * `alpha*=vColor.a`, which would make lit blocks see-through, and it is
   * deleted below.
   */
  prepareDefines(defines) {
    defines['NOA_BLOCK_LIGHT'] = true
    defines['VERTEXALPHA'] = true
  }
  getClassName() { return 'NoaBlockLightPlugin' }

  /*
   * One float. NAME ONLY -- no `size`, no `type` -- and the declaration is
   * written by hand in CUSTOM_FRAGMENT_DEFINITIONS below.
   *
   * THIS COMMENT USED TO SAY the opposite: that giving Babylon `size` and
   * `type` made it "declare the float into the MATERIAL uniform buffer for
   * us". That is true only for a material that actually compiles a uniform
   * BLOCK, and these terrain materials do not -- the emitted fragment shader
   * declares `uniform vec4 vDiffuseColor;` as a plain uniform, so there is no
   * Material block for the entry to be appended to. Concretely
   * (materialPluginManager.js:204-213): an entry WITH size and type goes to
   * `ubo.addUniform` and accumulates `_uboDeclaration`, which is injected by
   * replacing the token `#define ADDITIONAL_UBO_DECLARATION` -- a token that
   * is not in this shader. String.replace on a missing token returns the
   * string unchanged and reports nothing, so the declaration evaporated while
   * the NAME still reached the effect's uniform list. The result was
   * `'uDaylight' : undeclared identifier` at fragment line 324, every terrain
   * material failing to compile, and a world of pure skybox that you could
   * still stand on, because collision never asks the GPU anything.
   *
   * This is the THIRD variant of one trap. terrainAnimation.js:377 hit it via
   * `fragment:` (token `ADDITIONAL_FRAGMENT_DECLARATION`, equally absent);
   * this one hit it via `ubo:`. Both tokens are missing from Babylon 6's
   * shaders, and neither route ever complains. An entry with a name and no
   * size/type skips the UBO branch entirely and only registers the name
   * (materialPluginManager.js:211), which is all a `setFloat` needs.
   *
   * The rule, for the next plugin: declare your own GLSL at a CUSTOM_*
   * injection point that you have grepped for in the shader you are patching.
   * Never let Babylon write a declaration for you.
   */
  getUniforms() {
    return { ubo: [{ name: 'uDaylight' }] }
  }

  /*
   * HARD bind, not the ordinary one. `hardBindForSubMesh` is the hook
   * StandardMaterial calls unconditionally; `bindForSubMesh` sits inside its
   * `if (mustRebind)`. Both would work today, but only this one is immune to
   * the frozen-material problem described at `terrainLevel`, and being immune
   * to it by construction is the entire point of putting the daylight here.
   */
  hardBindForSubMesh(uniformBuffer, scene, engine, subMesh) {
    /*
     * Set on the EFFECT, not the uniform buffer. `updateFloat` addresses a
     * slot in the Material uniform block, and per getUniforms above this
     * float is a plain uniform with no block to live in -- the call found no
     * slot and silently did nothing. `setFloat` goes through the effect's
     * uniform location, which is the same path terrainAnimation.js:406 uses
     * for uAnimRemap on this very material.
     */
    const effect = subMesh?.effect
    if (effect) effect.setFloat('uDaylight', terrainLevel)
  }

  /*
   * The sky lane's attribute. Babylon only puts a name in the compiled
   * effect's attribute list if a plugin asks for it here; without this the
   * `attribute float noaSkyLight` declared below compiles fine, binds to
   * nothing, and reads a constant 0 -- which, because the value is stored
   * inverted, would look like a perfectly normal fully-lit world and hide the
   * mistake completely.
   */
  getAttributes(attributes) {
    if (!attributes.includes(SKY_ATTRIB)) attributes.push(SKY_ATTRIB)
  }

  getCustomCode(shaderType) {
    if (shaderType === 'vertex') {
      return {
        'CUSTOM_VERTEX_DEFINITIONS': `
          attribute float ${SKY_ATTRIB};
          varying float vNoaSkyDark;
        `,
        // MAIN_END rather than MAIN_BEGIN: nothing else reads it, and the end
        // is the hook noa's own plugins use, so the ordering is familiar.
        'CUSTOM_VERTEX_MAIN_END': `
          vNoaSkyDark = ${SKY_ATTRIB};
        `,
      }
    }
    if (shaderType !== 'fragment') return null
    return {
      /*
       * The other half of the VERTEXALPHA trade. Deleted rather than guarded,
       * because the define is on for one reason only and no terrain material
       * has ever wanted per-vertex opacity. The `!` prefix is Babylon's
       * regex-replace form, the same one terrainAnimation.js uses to swap the
       * atlas sampler.
       */
      '!alpha\\*=vColor\\.a;': '',
      /*
       * A file-scope `vec3` declared here and assigned in main(). GLSL allows
       * the declaration outside a function but not the assignment, which is
       * why this is two hooks rather than one.
       */
      'CUSTOM_FRAGMENT_DEFINITIONS': `
        vec3 noaBaseCol;
        varying float vNoaSkyDark;
        uniform float uDaylight;
      `,
      // Fires right after baseColor is final (post-texture, post-vColor.rgb,
      // so ambient occlusion is already multiplied in -- vanilla multiplies AO
      // into light too, so that is correct rather than convenient).
      'CUSTOM_FRAGMENT_UPDATE_DIFFUSE': `
        noaBaseCol = baseColor.rgb;
      `,
      /*
       * Before fog, so a torch does not punch through distance fog.
       *
       * THE FLOOR, and it is not a fudge. Vanilla's lightmap does not reach
       * black at light 0 either -- the darkest entry is a dim blue-grey, which
       * is why a cave with no torch in it is navigable rather than a void.
       * Without a floor here a sealed room at midnight renders as exactly
       * #000000 and there is nothing on screen to tell you the roof from the
       * wall. Rejected: clamping the sky FRACTION to a minimum instead, which
       * would make an unlit cave get brighter at noon -- the precise bug this
       * whole change exists to remove.
       */
      'CUSTOM_FRAGMENT_BEFORE_FOG': `
        #ifdef NORMAL
          /*
           * The five-value table, branchless. For a unit normal the SQUARES of
           * the components sum to 1, so weighting each axis's constant by its
           * squared component is an exact lookup on an axis-aligned face and a
           * smooth blend on anything else -- which is what a 45-degree stair
           * or a torch wants anyway. The ternary is the only place up and down
           * have to be told apart, because y*y cannot.
           */
          vec3 noaN = normalize(vNormalW);
          vec3 noaAxis = noaN * noaN;
          float noaFace = noaAxis.x * ${MC_FACE_SHADE.east.toFixed(3)}
                        + noaAxis.z * ${MC_FACE_SHADE.north.toFixed(3)}
                        + noaAxis.y * (noaN.y >= 0.0
                            ? ${MC_FACE_SHADE.up.toFixed(3)}
                            : ${MC_FACE_SHADE.down.toFixed(3)});
        #else
          float noaFace = 1.0;
        #endif
        /*
         * AND HERE THE BABYLON LIGHTS ARE THROWN AWAY. color arrives holding
         * finalDiffuse * baseAmbientColor + specular + reflection, all of
         * which for terrain is one directional light's Lambert term plus a
         * scene ambient that froze solid on the first frame. Replacing it
         * outright rather than trying to correct it is what lets sky.js point
         * that light wherever entities need it: terrain no longer reads it.
         *
         * Rejected: DISABLELIGHTING, which expresses the same intent as a
         * define. It also clears Babylon's _needNormals, and NORMAL going
         * off takes vNormalW -- the table's only input -- with it.
         */
        color.rgb = noaBaseCol * uDaylight;
        color.rgb = max(color.rgb * (1.0 - vNoaSkyDark), noaBaseCol * (1.0 - vColor.a));
        color.rgb = max(color.rgb, noaBaseCol * ${LIGHT_FLOOR.toFixed(3)});
        /*
         * Face shade multiplies the LIGHT, last, so it scales the sky term,
         * the block term and the floor alike. That is vanilla's order --
         * texture * lightmap * shade -- and it is also the line that makes
         * the underside of a glowstone-lit ceiling dimmer than the floor under
         * it, which the old comment in this file listed as not done.
         */
        color.rgb *= noaFace;
      `,
    }
  }
}

/** Attach the plugin to a terrain material once, unfreezing if noa froze it. */
function ensurePlugin(material) {
  if (!material || material._noaBlockLight) return
  material._noaBlockLight = true
  // noa freezes its baseline untextured material. A frozen material skips the
  // isReady path that would compile the new plugin in, so the shader would
  // silently keep the old code -- the exact failure mode 56d40d2 hit with
  // performancePriority.
  const wasFrozen = material.isFrozen
  if (wasFrozen) material.unfreeze()
  material._noaBlockLightPlugin = new BlockLightPlugin(material)
  if (wasFrozen) material.freeze()
}

/* ------------------------------------------------------------------ *
 * The data half
 * ------------------------------------------------------------------ */

export function installBlockLight(noa, { ids = {} } = {}) {
  const world = noa.world
  const CS = world._chunkSize
  const CS2 = CS * CS

  /** id -> emission level. Small dense array; block ids here top out at 638. */
  const emissionById = new Uint8Array(4096)
  for (const [key, id] of Object.entries(ids)) {
    let level = EMISSION[key] ?? 0
    if (!level) {
      for (const [prefix, lv] of EMISSION_PREFIXES) {
        if (key === prefix || key.startsWith(prefix + '_')) { level = lv; break }
      }
    }
    if (level && id < emissionById.length) emissionById[id] = level
  }

  /** id -> does light stop here. Read once from noa rather than duplicated. */
  const opaqueById = new Uint8Array(4096)
  for (let id = 0; id < emissionById.length; id++) {
    opaqueById[id] = noa.registry.getBlockOpacity(id) ? 1 : 0
  }
  /*
   * The same table plus SKY_OPAQUE. A SECOND table rather than a flag on the
   * first, because the two channels genuinely disagree about the barrier and
   * making them agree would change block light -- a torch at the world edge
   * currently shines through the wall, which nobody has complained about and
   * which spec 56 and 58 both measure.
   */
  const skyOpaqueById = opaqueById.slice()
  for (const key of SKY_OPAQUE) {
    const id = ids[key]
    if (id !== undefined && id < skyOpaqueById.length) skyOpaqueById[id] = 1
  }

  /*
   * Index 3 is DOWN, and that is load-bearing rather than incidental: the
   * whole of sky light's no-decay rule is `d === DOWN`.
   */
  const NEIGHBOURS = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ]
  const DOWN = 3

  const ckey = (ci, cj, ck) => ci + '|' + cj + '|' + ck
  const cdiv = (v) => Math.floor(v / CS)
  // JS % keeps the sign of the dividend, so -1 % 32 is -1, not 31.
  const cmod = (v) => ((v % CS) + CS) % CS

  /** chunk key -> [ci, cj, ck], so a dirty key can be turned back into a chunk. */
  const coords = new Map()
  /** Dirty chunk keys accumulated by a propagation pass, SHARED by both
   *  channels: one remesh repaints both lanes, so one set is enough. */
  const dirty = new Set()

  const blockAt = (x, y, z) => world.getBlockID(x, y, z)
  const isOpaque = (x, y, z) => opaqueById[blockAt(x, y, z)] === 1
  const blocksSky = (x, y, z) => skyOpaqueById[blockAt(x, y, z)] === 1

  /*
   * Is there a loaded chunk here, with a one-entry memo in front of it.
   *
   * WHY SKY LIGHT NEEDS THIS AND BLOCK LIGHT NEVER DID, which is the sharpest
   * consequence of the no-decay rule and cost a RangeError to find. Block
   * light stops on its own: it loses a level a block, so a flood is 15 blocks
   * across whether or not anything bounds it. Sky light going DOWN loses
   * nothing, so it has no range of its own and the edge of the loaded world is
   * the only thing that can stop it.
   *
   * `propagate` was accidentally safe -- an absent chunk reads as 15 and
   * `get(n) >= next` is already true, so the fill declines to write. `remove`
   * was not: the test for "this came from me" is `nl <= give(lv, DOWN)`, which
   * for a full-strength column is `15 <= 15`, so removing one block on the
   * surface walked downward through empty space forever, allocating a fresh
   * 32KB buffer every 32 blocks until the reseed array hit `Array.push`'s
   * 2^32 limit. That is `RangeError: Invalid array length`, from
   * test/65-sky-light.spec.js, on the first block a test placed.
   *
   * The memo is a single entry rather than a Set of keys because the walk is
   * coherent -- a column descent stays in one chunk for 32 steps -- and
   * because a Set has to be kept in step with the chunk lifecycle, which is
   * one more thing to get wrong than asking noa.
   */
  let memoI = NaN, memoJ = NaN, memoK = NaN, memoOK = false
  function chunkLoaded(ci, cj, ck) {
    if (ci !== memoI || cj !== memoJ || ck !== memoK) {
      memoI = ci; memoJ = cj; memoK = ck
      memoOK = !!world._storage.getChunkByIndexes(ci, cj, ck)
    }
    return memoOK
  }
  const forgetChunkMemo = () => { memoI = NaN }
  const loadedAt = (x, y, z) => chunkLoaded(cdiv(x), cdiv(y), cdiv(z))

  /*
   * A LIGHT CHANNEL: a store, a flood fill and a removal walk.
   *
   * Two instances, block and sky, because the two are the same algorithm
   * differing in exactly two places -- the default value and one edge rule --
   * and the alternative was a second copy of 120 lines that would drift.
   *
   * THE DEFAULT IS THE INTERESTING PARAMETER. Block light defaults to 0: an
   * unvisited voxel is dark, and a chunk with no buffer is a chunk with no
   * torch in it. Sky light defaults to 15: an unvisited voxel is OPEN, and a
   * chunk with no buffer is a chunk of open air. That inversion is what lets
   * `offCount` -- "how many voxels are not at the default" -- mean "how much
   * light is here" for one channel and "how much shadow is here" for the
   * other, and lets the mesh pass gate on the same predicate for both.
   *
   * It also picks the safe failure mode for each. A voxel this file never
   * reaches reads 0 block light and 15 sky light, which is exactly the world
   * as it rendered before either channel existed.
   */
  function makeChannel({ isSky }) {
    const DEFAULT = isSky ? MAX_LIGHT : 0
    const blocked = isSky ? blocksSky : isOpaque
    /** chunk key -> Uint8Array(CS^3). Allocated on first write, filled with
     *  DEFAULT so that "absent" and "all default" are the same world. */
    const store = new Map()
    /**
     * chunk key -> how many of its voxels differ from DEFAULT.
     *
     * Exists purely so the mesh pass can answer "is there anything to draw
     * near this chunk at all" in a Map lookup. A count rather than a boolean
     * because removal has to be able to take a chunk back to plain: `store`
     * keeps its buffer once allocated (see chunkBeingRemoved), so buffer
     * presence would be a one-way flag and every chunk a torch ever shone
     * into would pay the expensive mesh path for the rest of the session.
     */
    const offCount = new Map()

    function bufFor(k, ci, cj, ck) {
      let buf = store.get(k)
      if (!buf) {
        buf = new Uint8Array(CS * CS * CS)
        if (DEFAULT) buf.fill(DEFAULT)
        store.set(k, buf)
        coords.set(k, [ci, cj, ck])
      }
      return buf
    }

    /** Is this chunk anything but uniformly DEFAULT. The mesh pass's gate. */
    const chunkIsOff = (ci, cj, ck) => (offCount.get(ckey(ci, cj, ck)) || 0) > 0

    function get(x, y, z) {
      const buf = store.get(ckey(cdiv(x), cdiv(y), cdiv(z)))
      if (!buf) return DEFAULT
      return buf[cmod(x) * CS2 + cmod(y) * CS + cmod(z)]
    }

    function set(x, y, z, v) {
      const ci = cdiv(x), cj = cdiv(y), ck = cdiv(z)
      const k = ckey(ci, cj, ck)
      const buf = bufFor(k, ci, cj, ck)
      const at = cmod(x) * CS2 + cmod(y) * CS + cmod(z)
      const was = buf[at]
      if (was === v) return
      buf[at] = v
      if (was === DEFAULT) offCount.set(k, (offCount.get(k) || 0) + 1)
      else if (v === DEFAULT) offCount.set(k, (offCount.get(k) || 1) - 1)
      markDirty(ci, cj, ck, x, y, z)
    }

    /*
     * Flood fill. A flat array used as a FIFO with a read head rather than
     * Array.shift(), which is O(n) per pop and turns a radius-15 fill from
     * thousands of ops into millions. One queue PER CHANNEL, because a
     * removal walk on one channel reseeds into its own fill and the two runs
     * interleave during a single block edit.
     */
    let queue = []
    let qhead = 0
    const push = (x, y, z) => { queue.push(x, y, z) }

    /**
     * What level direction `d` hands on from a voxel holding `level`.
     *
     * THE NO-DECAY DOWNWARD RULE, and this is the whole of it. Sky light at
     * full strength loses nothing going down, which is why a forty-block
     * shaft is as bright at the bottom as at the top. It is conditioned on
     * `level === MAX_LIGHT` rather than applying to all sky light: light that
     * has already turned a corner and lost a level is ordinary light and
     * decays like any other, so an overhang's shadow does not stream downward
     * forever.
     */
    const give = (level, d) =>
      (isSky && d === DOWN && level === MAX_LIGHT) ? MAX_LIGHT : level - 1

    function propagate() {
      while (qhead < queue.length) {
        const x = queue[qhead++], y = queue[qhead++], z = queue[qhead++]
        const level = get(x, y, z)
        // level 1 gives 0 in every direction including down, since the
        // no-decay case needs 15.
        if (level <= 1) continue
        for (let d = 0; d < 6; d++) {
          const nx = x + NEIGHBOURS[d][0]
          const ny = y + NEIGHBOURS[d][1]
          const nz = z + NEIGHBOURS[d][2]
          if (isSky && !loadedAt(nx, ny, nz)) continue
          if (blocked(nx, ny, nz)) continue
          const next = give(level, d)
          if (get(nx, ny, nz) >= next) continue
          set(nx, ny, nz, next)
          push(nx, ny, nz)
        }
      }
      queue = []
      qhead = 0
    }

    /*
     * Removal, which is the half docs/lighting.md called the hard part and was
     * right about. You cannot just clear the voxel: every voxel that was lit
     * BY it is still holding a stale value, and re-propagating from what is
     * left would not lower any of them, because propagation only ever raises.
     * So the region is walked and zeroed first, and any voxel found holding a
     * level too high to have come from the removed source is a surviving
     * emitter's frontier and gets re-seeded.
     *
     * THE SKY MIRROR, and it is where the column behaviour comes from. The
     * test for "this came from me" is normally `nl < lv`, strictly less,
     * because decay is strict. Down from a full-strength sky voxel it is NOT
     * strict -- the voxel below holds the same 15 and still came from here --
     * so the same `give` the fill used decides the removal too. Place one
     * block on open ground and this walk follows its own shadow all the way
     * to the bedrock, with no column loop anywhere in the file.
     */
    function remove(x, y, z, wasLevel) {
      const rq = [x, y, z, wasLevel]
      let head = 0
      set(x, y, z, 0)
      const reseed = []
      while (head < rq.length) {
        const cx = rq[head++], cy = rq[head++], cz = rq[head++], lv = rq[head++]
        for (let d = 0; d < 6; d++) {
          const nx = cx + NEIGHBOURS[d][0]
          const ny = cy + NEIGHBOURS[d][1]
          const nz = cz + NEIGHBOURS[d][2]
          if (isSky && !loadedAt(nx, ny, nz)) continue
          const nl = get(nx, ny, nz)
          if (nl === 0) continue
          if (nl <= give(lv, d)) {
            set(nx, ny, nz, 0)
            rq.push(nx, ny, nz, nl)
          } else {
            // Too bright to have come from here -- something else still lights
            // it, so it becomes a seed for the refill pass.
            reseed.push(nx, ny, nz)
          }
        }
      }
      for (let i = 0; i < reseed.length; i += 3) push(reseed[i], reseed[i + 1], reseed[i + 2])
    }

    return { DEFAULT, store, offCount, bufFor, chunkIsOff, get, set, push, propagate, remove, give }
  }

  /*
   * SUBTLE: a voxel on a chunk boundary is a vertex of the NEIGHBOUR's mesh
   * too -- the mesher samples the air voxel outside each face, which for a
   * face on the seam lives in the next chunk over. So a light change one
   * voxel inside the boundary has to dirty both chunks or the seam shows a
   * hard brightness line.
   */
  function markDirty(ci, cj, ck, x, y, z) {
    dirty.add(ckey(ci, cj, ck))
    const lx = cmod(x), ly = cmod(y), lz = cmod(z)
    if (lx === 0) dirty.add(ckey(ci - 1, cj, ck))
    if (lx === CS - 1) dirty.add(ckey(ci + 1, cj, ck))
    if (ly === 0) dirty.add(ckey(ci, cj - 1, ck))
    if (ly === CS - 1) dirty.add(ckey(ci, cj + 1, ck))
    if (lz === 0) dirty.add(ckey(ci, cj, ck - 1))
    if (lz === CS - 1) dirty.add(ckey(ci, cj, ck + 1))
  }

  const blockCh = makeChannel({ isSky: false })
  const skyCh = makeChannel({ isSky: true })
  const getLight = blockCh.get
  const getSky = skyCh.get
  const chunkIsLit = blockCh.chunkIsOff
  const chunkIsShaded = skyCh.chunkIsOff

  /** Turn the dirty set into remesh requests, then clear it. */
  function flushDirty(skipChunk) {
    for (const k of dirty) {
      const c = coords.get(k)
      const ijk = c || k.split('|').map(Number)
      const chunk = world._storage.getChunkByIndexes(ijk[0], ijk[1], ijk[2])
      if (!chunk || chunk.isDisposed || chunk === skipChunk) continue
      /*
       * `_terrainDirty` FIRST, and without it this whole function is a no-op
       * for the case it exists to serve. noa's `possiblyQueueChunkForMeshing`
       * opens with `if (!(chunk._terrainDirty || chunk._objectsDirty)) return`
       * -- it assumes the only reason to rebuild a mesh is that its VOXELS
       * changed. A chunk that a neighbour's glowstone has just lit has exactly
       * the same voxels as a second ago and is silently dropped from the
       * queue.
       *
       * Found by `test/58-glowstone-radial.spec.js`, not by looking: the
       * falloff came out perfectly symmetric in three directions and dead flat
       * zero in the fourth, and the fourth was the far side of x = 64, a chunk
       * boundary. It was invisible before that spec because the old readback
       * rewrote light on EVERY mesh for every reason, so a chunk edited for
       * any other cause quietly picked the light up on the way past.
       */
      chunk._terrainDirty = true
      world._queueChunkForRemesh(chunk)
    }
    dirty.clear()
  }

  /* -------------------------------------------------------------- *
   * Chunk lifecycle
   * -------------------------------------------------------------- */

  /**
   * Seed a freshly arrived chunk: its own emitters, plus whatever its already
   * lit neighbours are shining across the seam.
   */
  function seedChunk(chunk) {
    const size = chunk.size
    const data = chunk.voxels.data
    const ox = chunk.x, oy = chunk.y, oz = chunk.z
    // Fast reject. A chunk of one block id can only matter if that id glows.
    let found = false
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const base = (i * size + j) * size
        for (let k = 0; k < size; k++) {
          const lvl = emissionById[data[base + k]]
          if (!lvl) continue
          found = true
          blockCh.set(ox + i, oy + j, oz + k, lvl)
          blockCh.push(ox + i, oy + j, oz + k)
        }
      }
    }
    /*
     * Light arriving from neighbours that were computed first. Only the six
     * planes of voxels just OUTSIDE the chunk can carry it in, so only those
     * are scanned -- 6 * size^2 reads rather than a second full volume.
     */
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = NEIGHBOURS[d]
      // The fixed coordinate on this side: one voxel beyond the chunk.
      const fx = dx > 0 ? ox + size : ox - 1
      const fy = dy > 0 ? oy + size : oy - 1
      const fz = dz > 0 ? oz + size : oz - 1
      for (let a = 0; a < size; a++) {
        for (let b = 0; b < size; b++) {
          let x, y, z
          if (dx !== 0) { x = fx; y = oy + a; z = oz + b }
          else if (dy !== 0) { x = ox + a; y = fy; z = oz + b }
          else { x = ox + a; y = oy + b; z = fz }
          if (getLight(x, y, z) > 1) { blockCh.push(x, y, z); found = true }
        }
      }
    }
    if (!found) return
    blockCh.propagate()
  }

  /**
   * Sky light for a freshly arrived chunk.
   *
   * COLUMN FIRST, BFS SECOND, and the split is what keeps this affordable. A
   * pure BFS seeded at the top of the world would push every open voxel and
   * pop it again to discover that its neighbour already holds 15. The column
   * descent computes the whole no-decay case in one linear pass over the
   * voxel buffer with no queue at all, and leaves the BFS only the sideways
   * spread under overhangs -- which is the part that actually needs a queue.
   *
   * WHAT IT ASSUMES ABOUT THE CHUNK ABOVE, since this is the one place sky
   * light has to guess. If the chunk overhead is not loaded the column starts
   * at 15: above the top of the world there is nothing but sky, and that is
   * the common case because the world has a finite ceiling. If the guess is
   * wrong -- the chunk above arrives later carrying a roof -- it is corrected
   * from the other side, in the plane scan below, by the chunk that arrives.
   *
   * WHICH VOXELS GO IN THE QUEUE, which is the other half of the cost. Only
   * those with a horizontal neighbour more than one level away; on open
   * ground that is none of them. Pushing every lit voxel would be correct and
   * would cost six `isOpaque` calls each for 32,768 voxels a chunk.
   */
  function seedSky(chunk) {
    const size = chunk.size
    const data = chunk.voxels.data
    const ox = chunk.x, oy = chunk.y, oz = chunk.z
    const ci = cdiv(ox), cj = cdiv(oy), ck = cdiv(oz)
    const k0 = ckey(ci, cj, ck)
    const buf = skyCh.bufFor(k0, ci, cj, ck)
    const aboveLoaded = !!world._storage.getChunkByIndexes(ci, cj + 1, ck)
    /*
     * Counted over TRANSPARENT voxels only, and that is the difference
     * between a useful gate and a useless one. A solid stone voxel stores 0
     * because the removal walk must not read a stale 15 out of a wall -- but
     * the mesher never samples a solid voxel, so a chunk of solid stone has
     * nothing for the sky lane to write and must not be flagged as if it did.
     * Count the solids and every chunk with ground in it pays the full
     * readback forever.
     */
    let off = 0
    for (let i = 0; i < size; i++) {
      for (let k = 0; k < size; k++) {
        let cur = MAX_LIGHT
        if (aboveLoaded) cur = skyCh.get(ox + i, oy + size, oz + k) === MAX_LIGHT ? MAX_LIGHT : 0
        for (let j = size - 1; j >= 0; j--) {
          const at = (i * size + j) * size + k
          const solid = skyOpaqueById[data[at]] === 1
          if (solid) cur = 0
          buf[at] = cur
          if (!solid && cur !== MAX_LIGHT) off++
          if (i > 0) {
            const n = buf[((i - 1) * size + j) * size + k]
            if (n > cur + 1) skyCh.push(ox + i - 1, oy + j, oz + k)
            else if (cur > n + 1) skyCh.push(ox + i, oy + j, oz + k)
          }
          if (k > 0) {
            const n = buf[(i * size + j) * size + k - 1]
            if (n > cur + 1) skyCh.push(ox + i, oy + j, oz + k - 1)
            else if (cur > n + 1) skyCh.push(ox + i, oy + j, oz + k)
          }
        }
      }
    }
    skyCh.offCount.set(k0, off)
    // The whole chunk changed, so every mesh that samples into it is stale.
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (let c = -1; c <= 1; c++) dirty.add(ckey(ci + a, cj + b, ck + c))
      }
    }

    /*
     * The seam, in both directions and with one correction.
     *
     * Unlike block light this cannot scan only the outside plane and push what
     * it finds. Sky light flows OUT of a new chunk as readily as into it -- an
     * air chunk arriving beside a loaded cave lights the cave mouth -- so both
     * sides are offered to `give`, which knows the no-decay rule and answers
     * exactly which of the two can raise the other.
     *
     * AND THE CORRECTION, which is the guess above coming home. If this chunk
     * has a roof in it, the chunk below may have been computed while nothing
     * was overhead and be holding a full column of daylight that no longer
     * reaches it. `remove` walks that column down and takes it out, which is
     * the same machinery a player placing one block on open ground uses.
     *
     * Unloaded neighbours are SKIPPED rather than read. `skyCh.get` answers 15
     * for a chunk it has no buffer for, which is the right default for the sky
     * above the world and exactly the wrong one for a wall that has not
     * arrived yet -- reading it would flood this chunk with light through
     * terrain that is about to appear.
     */
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = NEIGHBOURS[d]
      if (!world._storage.getChunkByIndexes(ci + dx, cj + dy, ck + dz)) continue
      const fx = dx > 0 ? ox + size : ox - 1
      const fy = dy > 0 ? oy + size : oy - 1
      const fz = dz > 0 ? oz + size : oz - 1
      for (let a = 0; a < size; a++) {
        for (let b = 0; b < size; b++) {
          let x, y, z
          if (dx !== 0) { x = fx; y = oy + a; z = oz + b }
          else if (dy !== 0) { x = ox + a; y = fy; z = oz + b }
          else { x = ox + a; y = oy + b; z = fz }
          const inx = x - dx, iny = y - dy, inz = z - dz
          const vin = skyCh.get(inx, iny, inz)
          const vout = skyCh.get(x, y, z)
          // d ^ 1 is the opposite direction: the pairs are (0,1), (2,3), (4,5).
          if (!blocksSky(inx, iny, inz) && skyCh.give(vout, d ^ 1) > vin) skyCh.push(x, y, z)
          if (!blocksSky(x, y, z) && skyCh.give(vin, d) > vout) skyCh.push(inx, iny, inz)
          if (d === DOWN && vout > 0 && vout > skyCh.give(vin, DOWN)) skyCh.remove(x, y, z, vout)
        }
      }
    }
    skyCh.propagate()
  }

  let seedMs = 0
  world.on('chunkAdded', (chunk) => {
    forgetChunkMemo()
    const t0 = performance.now()
    seedChunk(chunk)
    seedSky(chunk)
    seedMs = performance.now() - t0
    // The chunk is about to be meshed by noa anyway; only its neighbours need
    // asking for.
    flushDirty(chunk)
  })

  world.on('chunkBeingRemoved', (requestID, voxels, userData) => {
    forgetChunkMemo()
    // Nothing: the store is keyed by chunk index and the chunk will come back
    // with the same index. Dropping it would mean re-flooding on every chunk
    // reload, and 32KB per chunk is the price of not doing that.
  })

  /* -------------------------------------------------------------- *
   * Block edits -- the single choke point
   * -------------------------------------------------------------- */

  const origSetBlockID = world.setBlockID.bind(world)
  world.setBlockID = function (id, x, y, z) {
    const prev = blockAt(x, y, z)
    origSetBlockID(id, x, y, z)
    if (prev === id) return
    onBlockChanged(x, y, z, prev, id)
  }

  let editMs = 0
  function onBlockChanged(x, y, z, prevID, id) {
    const t0 = performance.now()
    const wasEmit = emissionById[prevID]
    const nowEmit = emissionById[id]
    const wasOpaque = opaqueById[prevID] === 1
    const nowOpaque = opaqueById[id] === 1

    const here = getLight(x, y, z)
    if (here > 0) {
      // Whether the emitter went away or a wall went up, the light standing at
      // this voxel is now wrong and everything downstream of it with it.
      blockCh.remove(x, y, z, here)
    }
    if (nowEmit) {
      blockCh.set(x, y, z, nowEmit)
      blockCh.push(x, y, z)
    } else if (!nowOpaque) {
      // A hole opened: the six neighbours may now shine through it.
      for (let d = 0; d < 6; d++) {
        const nx = x + NEIGHBOURS[d][0]
        const ny = y + NEIGHBOURS[d][1]
        const nz = z + NEIGHBOURS[d][2]
        if (getLight(nx, ny, nz) > 1) blockCh.push(nx, ny, nz)
      }
    }

    /*
     * THE SKY HALF, AND IT IS THE HALF THAT MOVES A COLUMN.
     *
     * Only an OPACITY change can touch sky light -- a glowstone does not cast
     * a shadow and swapping stone for dirt does not either -- which is why
     * this whole block is under one condition and block light's is not.
     *
     * Placing: the voxel goes dark and `remove` follows the shadow down. The
     * down-with-no-decay edge it walks is the same one the fill came in on, so
     * a block dropped on open ground at y=136 takes the light out of every
     * voxel under it to the world floor, not out of a 15-block radius. That IS
     * the column recompute; there is no column loop.
     *
     * Mining: the six neighbours are offered through `give`, which is what
     * makes the voxel above matter more than the other five. If it holds 15
     * the new hole holds 15 too, and the fill runs on down the shaft it just
     * opened -- so digging straight down keeps the bottom of the shaft as
     * bright as the top, which is the rule a 40-block mineshaft is the test of.
     */
    const wasSkyBlock = skyOpaqueById[prevID] === 1
    const nowSkyBlock = skyOpaqueById[id] === 1
    let skyMoved = false
    if (wasSkyBlock !== nowSkyBlock) {
      const skyHere = getSky(x, y, z)
      if (nowSkyBlock) {
        if (skyHere > 0) { skyCh.remove(x, y, z, skyHere); skyMoved = true }
      } else {
        for (let d = 0; d < 6; d++) {
          const nx = x + NEIGHBOURS[d][0]
          const ny = y + NEIGHBOURS[d][1]
          const nz = z + NEIGHBOURS[d][2]
          if (skyCh.give(getSky(nx, ny, nz), d ^ 1) > skyHere) {
            skyCh.push(nx, ny, nz)
            skyMoved = true
          }
        }
      }
    }

    if (!wasEmit && !nowEmit && wasOpaque === nowOpaque && here === 0 && !skyMoved) {
      // Nothing light-shaped happened.
      editMs = performance.now() - t0
      dirty.clear()
      return
    }
    blockCh.propagate()
    skyCh.propagate()
    flushDirty(null)
    editMs = performance.now() - t0
  }

  /* -------------------------------------------------------------- *
   * The mesh half -- read the finished buffers back and rewrite alpha
   * -------------------------------------------------------------- */

  const mesher = noa._terrainMesher
  /*
   * THE MESHCHUNK CONTRACT -- read docs/lighting.md section 9 before changing
   * anything here. Three wraps of this one function stack (noa's own, this
   * one, fluidGeometry.js's, plus the deferred guard below), the order is set
   * by the install order in main.js, and all of them decode noa's
   * 4-vertices/6-indices-per-quad layout with the same two lines. Vertex
   * sharing was given up on purpose to keep that true.
   */
  const origMeshChunk = mesher.meshChunk.bind(mesher)
  let meshMs = 0
  mesher.meshChunk = function (chunk, ignoreMaterials) {
    origMeshChunk(chunk, ignoreMaterials)
    const t0 = performance.now()
    for (const mesh of chunk._terrainMeshes) {
      ensurePlugin(mesh.material)
      writeVertexLight(mesh, chunk)
    }
    meshMs = performance.now() - t0
  }

  /*
   * A SECOND WRAP, DEFERRED ONE MICROTASK, AND IT IS A SAFETY NET RATHER THAN
   * A FEATURE.
   *
   * `src/fluidGeometry.js` wraps `meshChunk` OUTSIDE this file's wrap and, on
   * any mesh containing a fluid face, rebuilds position/normal/colour/UV and
   * `texAtlasIndices` at a LARGER vertex count -- it splits merged fluid quads
   * into unit cells. It does not know about `noaSkyLight`, so that attribute
   * is left behind at the old, shorter length, and a vertex buffer shorter
   * than the draw call reads off the end of it.
   *
   * The block-light lane survives this untouched because it rides in vertex
   * ALPHA, which fluidGeometry interpolates along with the rest of the colour.
   * The sky lane cannot, for the reason in the header: two interpolated
   * numbers need two attributes.
   *
   * So this drops a stale sky attribute rather than letting it be read out of
   * range. The cost is that water and lava surfaces render at full sky -- too
   * bright in a cave, and wrong -- and the fix is one line in fluidGeometry's
   * own readback, beside the `texAtlasIndices` it already carries. Reported
   * rather than done here: that file belongs to another agent.
   *
   * The microtask is what puts this OUTSIDE fluidGeometry's wrap. Every
   * install in main.js is synchronous, so a microtask queued during install
   * runs after all of them and before the first animation frame -- which is
   * the earliest a chunk can be meshed, since chunks need a worldDataNeeded
   * round trip first. Rejected: wrapping again immediately, which would land
   * INSIDE fluidGeometry and fix nothing.
   */
  queueMicrotask(() => {
    const inner = mesher.meshChunk.bind(mesher)
    mesher.meshChunk = function (chunk, ignoreMaterials) {
      inner(chunk, ignoreMaterials)
      for (const mesh of chunk._terrainMeshes) {
        const sky = mesh.getVerticesData(SKY_ATTRIB)
        if (!sky) continue
        const pos = mesh.getVerticesData(VertexBuffer.PositionKind)
        if (pos && sky.length === pos.length / 3) continue
        mesh.removeVerticesData(SKY_ATTRIB)
      }
    }
  })

  /**
   * Light at one terrain vertex, 0..15.
   *
   * A terrain vertex sits on a block CORNER, and the four voxels touching that
   * corner on the outside of the face are what vanilla averages. The face
   * normal says which side "outside" is; the other two axes give the 2x2.
   * Opaque voxels are skipped rather than counted as zero -- counting them
   * would draw a dark rim around every lit block where it meets the floor.
   *
   * Pure in (position, normal), which is load-bearing for the T-junction
   * argument below: two quads meeting at an edge sample the shared lattice
   * points through this same function and therefore cannot disagree.
   */
  function sampleLight(get, blocked, px, py, pz, nx, ny, nz) {
    let sum = 0, count = 0
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        let vx, vy, vz
        // Step half a block along the normal to land inside the voxel the face
        // looks into, then floor: corner + 0.5*normal is that voxel's boundary.
        if (nx !== 0) {
          vx = Math.floor(px + nx * 0.5)
          vy = Math.floor(py) - a
          vz = Math.floor(pz) - b
        } else if (ny !== 0) {
          vy = Math.floor(py + ny * 0.5)
          vx = Math.floor(px) - a
          vz = Math.floor(pz) - b
        } else {
          vz = Math.floor(pz + nz * 0.5)
          vx = Math.floor(px) - a
          vy = Math.floor(py) - b
        }
        if (blocked(vx, vy, vz)) continue
        sum += get(vx, vy, vz)
        count++
      }
    }
    // An all-opaque 2x2 samples nothing. Falling back to the channel's own
    // default keeps a wholly-buried vertex at "no block light, full sky",
    // which is the value every unreached vertex in the world already carries.
    return count ? sum / count : (get === getSky ? MAX_LIGHT : 0)
  }

  /** Is any chunk overlapping this world-space box holding light. */
  function boxIsLit(x0, y0, z0, x1, y1, z1) {
    for (let ci = cdiv(x0); ci <= cdiv(x1); ci++) {
      for (let cj = cdiv(y0); cj <= cdiv(y1); cj++) {
        for (let ck = cdiv(z0); ck <= cdiv(z1); ck++) {
          if (chunkIsLit(ci, cj, ck)) return true
        }
      }
    }
    return false
  }

  /** Is any chunk overlapping this world-space box holding shadow. */
  function boxIsShaded(x0, y0, z0, x1, y1, z1) {
    for (let ci = cdiv(x0); ci <= cdiv(x1); ci++) {
      for (let cj = cdiv(y0); cj <= cdiv(y1); cj++) {
        for (let ck = cdiv(z0); ck <= cdiv(z1); ck++) {
          if (chunkIsShaded(ci, cj, ck)) return true
        }
      }
    }
    return false
  }

  /**
   * Does the sky channel vary anywhere in this box of voxels.
   *
   * THE REASON THIS EXISTS RATHER THAN JUST GOING STRAIGHT TO THE LATTICE.
   * The per-chunk gate above is useless for sky on any chunk that contains
   * both ground and air, which is every chunk anyone looks at. This is the
   * finer sieve underneath it: one buffer read per voxel over the box the face
   * can reach, against the lattice pass's four reads plus an average per
   * corner per channel. It answers the outdoor case -- a 32x32 patch of ground
   * under open sky, all 15 -- for about an eighth of the cost, and the outdoor
   * case is nearly all of them.
   *
   * Opaque voxels are skipped because sampleLight skips them too; counting a
   * wall's stored 0 as variation would split every quad that touches ground.
   */
  function boxSkyValue(x0, y0, z0, x1, y1, z1) {
    let seen = -1
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (blocksSky(x, y, z)) continue
          const v = getSky(x, y, z)
          if (seen < 0) seen = v
          else if (v !== seen) return -1
        }
      }
    }
    // Nothing transparent in the box at all: the face is buried, and a buried
    // vertex takes the channel default like every unreached vertex does.
    return seen < 0 ? MAX_LIGHT : seen
  }

  /*
   * How the parent quad's four corner colours are read at an interior point.
   *
   * NOT bilinear, and the difference matters. The GPU never draws a quad; it
   * draws the two triangles noa's `decideTriDir` split it into, and inside a
   * triangle a vertex colour is interpolated LINEARLY over three corners, not
   * bilinearly over four. Sampling the parent bilinearly would have shifted
   * ambient occlusion on every split quad by up to the fold in its diagonal.
   *
   * Sampling it the way the rasteriser does makes the split exact wherever it
   * can be: a linear function is reproduced exactly by bilinear interpolation,
   * so any sub-quad lying wholly inside one parent triangle comes out
   * pixel-identical to the unsplit parent. Only sub-quads straddling the
   * parent's diagonal differ, and only by that fold.
   *
   * (s, t) are the quad's own parameters: v0 at (0,0), v1 at (1,0), v2 at
   * (1,1), v3 at (0,1). `diag02` says the diagonal runs v0-v2 rather than
   * v1-v3, which is `decideTriDir`'s output read back off the index buffer.
   */
  const TRI_W = [0, 0, 0, 0]
  function triWeights(s, t, diag02) {
    if (diag02) {
      if (s >= t) { TRI_W[0] = 1 - s; TRI_W[1] = s - t; TRI_W[2] = t; TRI_W[3] = 0 }
      else { TRI_W[0] = 1 - t; TRI_W[1] = 0; TRI_W[2] = s; TRI_W[3] = t - s }
    } else if (s + t >= 1) {
      TRI_W[0] = 0; TRI_W[1] = 1 - t; TRI_W[2] = s + t - 1; TRI_W[3] = 1 - s
    } else {
      TRI_W[0] = 1 - s - t; TRI_W[1] = s; TRI_W[2] = 0; TRI_W[3] = t
    }
    return TRI_W
  }

  /**
   * Per-vertex smooth light, written back into the finished chunk mesh.
   *
   * THE PROBLEM THIS SOLVES, measured rather than suspected (docs/REPORTED.md
   * 5a, `test/58-glowstone-radial.spec.js`, commit 3402684). A terrain vertex
   * is NOT a block corner once noa's greedy mesher has been at it:
   * `maskCompare` in `terrainMesher.js` merges faces whose material and AO
   * mask agree and knows nothing about light, so a flat floor arrives here as
   * a handful of quads many blocks wide. Writing light at their four corners
   * and letting the GPU ramp across the span is what Evan saw as "glowstone
   * lights directionally instead of radially" -- 625 floor blocks became 17
   * quads, one of them 13 wide with corner levels 2/0/1/13. Worse: on a pad
   * big enough that no corner is within 15 blocks of the emitter, the floor
   * got NO light at all.
   *
   * THE FIX: split the lit quads back into unit sub-quads, here, in the
   * readback. Vanilla's equivalent is refusing to merge faces whose light
   * differs; this is the same geometry arrived at from the other end.
   *
   * WHY NO FORK. The doc assumed this had to live inside the merge predicate.
   * It does not. noa's MeshBuilder lays every buffer out perfectly regularly
   * -- four vertices per quad in a fixed order (`addPositionValues`: v0 =
   * corner, v1 = corner + u, v2 = corner + u + v, v3 = corner + v), six
   * indices, UVs linear in u and v, one atlas index per vertex -- so a quad's
   * span is readable straight off the buffers and its subdivision is writable
   * back into them. Staying off a fork is a deliberate, documented property of
   * this file (see the header) and it survives this change.
   *
   * WHICH QUADS GET SPLIT: only those some voxel actually lights. Splitting
   * everything undoes greedy meshing and the vertex count it exists to
   * control, on a world that is largely flat superflat ground.
   *
   * THE T-JUNCTION OBJECTION, and why it is answered rather than accepted. A
   * split quad meeting an unsplit neighbour puts vertices in the middle of the
   * neighbour's edge, which is a T-junction and normally means a visible seam.
   * It does not here, because of WHICH quads are left unsplit. A quad is only
   * left whole when every lattice point across it samples zero. Its neighbour
   * samples those same shared lattice points through the same `sampleLight`,
   * so the split side's vertices on that edge are zero too, and the unsplit
   * side interpolates zero between two zeroes. Both sides of the seam carry
   * the same value, so there is no discontinuity in the light channel -- which
   * is the only channel this pass touches. (Position, normal, UV and colour
   * RGB are interpolated from the parent, so they are continuous by
   * construction.) `test/58-glowstone-radial.spec.js` photographs the boundary.
   *
   * THE ROAD NOT TAKEN: clipping the split to a radius around each emitter
   * instead of to "any light at all". Cheaper on a floor lit by one torch, but
   * it reintroduces exactly the T-junction this rule dodges, because the
   * clipped edge would fall somewhere the light is NOT zero.
   */
  function writeVertexLight(mesh, chunk) {
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)
    const norm = mesh.getVerticesData(VertexBuffer.NormalKind)
    const col = mesh.getVerticesData(VertexBuffer.ColorKind)
    if (!pos || !norm || !col) return

    const ox = chunk.x, oy = chunk.y, oz = chunk.z
    const ci = cdiv(ox), cj = cdiv(oy), ck = cdiv(oz)
    /*
     * The whole-mesh gate, and it is why an unlit world costs LESS than it did
     * before this change rather than more. noa rebuilds the mesh from scratch
     * on every remesh and `pushAOColor` writes alpha 1, which is already the
     * "no block light" value -- so a chunk with no light within reach needs no
     * pass at all, not even the cheap one. The 3x3x3 of chunk keys is checked
     * rather than just this one, because a face on a seam samples the voxel
     * outside it, which lives in the next chunk over.
     */
    let near = false
    for (let a = -1; a <= 1 && !near; a++) {
      for (let b = -1; b <= 1 && !near; b++) {
        for (let c = -1; c <= 1 && !near; c++) {
          if (chunkIsLit(ci + a, cj + b, ck + c)) near = true
          if (chunkIsShaded(ci + a, cj + b, ck + c)) near = true
        }
      }
    }
    if (!near) return

    const uv = mesh.getVerticesData(VertexBuffer.UVKind)
    const atlas = mesh.getVerticesData('texAtlasIndices')
    const idx = mesh.getIndices()
    // No index buffer means the parent's winding and diagonal are unknowable,
    // and a sub-quad that guesses them wrong is a hole in the floor. Has never
    // happened -- noa always sets them -- so this is a bail, not a fallback.
    if (!idx || !uv) return
    const nq = (pos.length / 12) | 0

    /*
     * Pass one: measure. Each lit quad's (w+1)*(h+1) lattice light values are
     * computed once and KEPT, because pass two needs the identical numbers and
     * recomputing them would double the only expensive part of this function.
     */
    const grids = new Array(nq).fill(null)
    let anySplit = false
    for (let f = 0; f < nq; f++) {
      const p = f * 12
      const x0 = pos[p], y0 = pos[p + 1], z0 = pos[p + 2]
      // u = v1 - v0, v = v3 - v0. Both are axis-aligned with exactly one
      // non-zero, positive component, so the magnitude IS that component.
      const ux = pos[p + 3] - x0, uy = pos[p + 4] - y0, uz = pos[p + 5] - z0
      const vx = pos[p + 9] - x0, vy = pos[p + 10] - y0, vz = pos[p + 11] - z0
      const w = Math.round(ux + uy + uz)
      const h = Math.round(vx + vy + vz)
      if (w < 1 || h < 1) continue

      // Cheap reject before the grid: the box of voxels this face can possibly
      // sample. Conservative by one block on the low side of every axis, which
      // is what the `- a` / `- b` in sampleLight reaches back for.
      const bx0 = ox + x0 - 1, by0 = oy + y0 - 1, bz0 = oz + z0 - 1
      const bx1 = ox + x0 + ux + vx, by1 = oy + y0 + uy + vy, bz1 = oz + z0 + uz + vz
      const lit = boxIsLit(bx0, by0, bz0, bx1, by1, bz1)
      /*
       * Two sieves for the sky channel, coarse then fine. The chunk-level one
       * is nearly free and answers "is there shadow anywhere near"; it is also
       * nearly useless on a surface chunk, which is half ground and half air.
       * The voxel-level one behind it is what actually carries the outdoor
       * case, where the answer is "every voxel this face can see holds 15".
       */
      const skyU = boxIsShaded(bx0, by0, bz0, bx1, by1, bz1)
        ? boxSkyValue(bx0, by0, bz0, bx1, by1, bz1) : MAX_LIGHT
      // MAX_LIGHT here means "uniformly open", which is the attribute's own
      // default -- nothing to write. Any other uniform value still has to be
      // written; it just does not have to be SAMPLED, so `skyU >= 0` skips the
      // lattice pass for the sky channel and keeps the number it already has.
      const shaded = skyU !== MAX_LIGHT
      if (!lit && !shaded) continue

      const nx = norm[p], ny = norm[p + 1], nz = norm[p + 2]
      const g = new Float32Array((w + 1) * (h + 1))
      const gs = new Float32Array((w + 1) * (h + 1))
      for (let b = 0; b <= h; b++) {
        const t = b / h
        for (let a = 0; a <= w; a++) {
          const sPar = a / w
          const wx = ox + x0 + ux * sPar + vx * t
          const wy = oy + y0 + uy * sPar + vy * t
          const wz = oz + z0 + uz * sPar + vz * t
          g[b * (w + 1) + a] = lit
            ? sampleLight(getLight, isOpaque, wx, wy, wz, nx, ny, nz) : 0
          gs[b * (w + 1) + a] = skyU >= 0
            ? skyU : sampleLight(getSky, blocksSky, wx, wy, wz, nx, ny, nz)
        }
      }
      /*
       * WHICH CELLS GET SPLIT -- and this is the criterion re-derived, because
       * the one it replaces does not survive a second channel.
       *
       * IT USED TO SAY "LIT". The bounding box of lattice points holding any
       * light at all, widened by one cell, split into unit sub-quads. That is
       * correct for block light and catastrophic for sky light: outdoors every
       * open surface in the world reads 15, so "lit" is the entire visible
       * world and greedy meshing is undone everywhere. Not a local cost -- a
       * vertex-count explosion across every chunk you can see.
       *
       * IT NOW SAYS "VARIES". A quad whose lattice values are all the same
       * interpolates to that value everywhere, which is not an approximation
       * of the right answer, it IS the right answer, and it is the common case
       * outdoors. What needs splitting is light that CHANGES across the quad.
       * So a lattice CELL is `flat` when its four corners agree in BOTH
       * channels, and the split region is the bounding box of the cells that
       * are not.
       *
       * THE WIDENING IS GONE, AND ITS GUARANTEE IS NOT. The old rule needed
       * `A0 - 1` to make the split region's outer ring provably zero. Cells
       * are a stronger statement than points: a cell outside the non-flat box
       * is flat by definition, two flat cells sharing an edge share two
       * corners and therefore share a value, and a rectangle of flat cells is
       * connected -- so every remainder quad below is UNIFORM, not merely
       * dark. Uniform is what the T-junction argument actually needed. Its
       * neighbour across the seam samples the same lattice points through the
       * same `sampleLight` and reads the same constant, and a merged quad
       * interpolating a constant to itself has nothing to disagree about.
       *
       * And on block light alone the two rules coincide exactly: outside a
       * lit disc every corner is 0, the first non-flat cell column is the one
       * straddling the boundary at A0-1, and the last is A1. Same box, same
       * vertices, same picture -- which is why 58's numbers did not move.
       */
      let A0 = w, A1 = -1, B0 = h, B1 = -1
      const row = w + 1
      for (let b = 0; b < h; b++) {
        for (let a = 0; a < w; a++) {
          const i0 = b * row + a
          const l = g[i0], k = gs[i0]
          if (g[i0 + 1] === l && g[i0 + row] === l && g[i0 + row + 1] === l
            && gs[i0 + 1] === k && gs[i0 + row] === k && gs[i0 + row + 1] === k) continue
          if (a < A0) A0 = a
          if (a > A1) A1 = a
          if (b < B0) B0 = b
          if (b > B1) B1 = b
        }
      }
      /*
       * WHICH CELLS GET SPLIT, and the -1 is the whole T-junction argument.
       *
       * The split is clipped to the lit lattice points' bounding box, widened
       * by one cell on each side. That widening is what guarantees the split
       * region's OUTER lattice ring is all zeroes: A0 is the first lit lattice
       * column, so column A0-1 is dark by definition. Every large remainder
       * quad below therefore meets the split region along an edge that reads
       * zero from both sides, and interpolates zero to zero across itself.
       * There is no discontinuity in the light channel to see.
       *
       * Without the clip a single torch on a chunk-wide floor would shatter
       * the entire 32x32 quad instead of the disc it actually lights -- which
       * is roughly a 4x difference in vertices in the superflat case, and the
       * difference between sky light being affordable and not.
       */
      const cA0 = A0, cA1 = A1, cB0 = B0, cB1 = B1
      // A1 < 0 means no cell varies: the whole quad is one value and the four
      // corners already say so. Still recorded, because those four corners
      // have to be WRITTEN -- "uniform" is not "unchanged".
      const split = A1 >= 0 && (cA1 - cA0 + 1) * (cB1 - cB0 + 1) > 1
      grids[f] = { w, h, g, gs, cA0, cA1, cB0, cB1, split }
      if (split) anySplit = true
    }

    if (!grids.some(Boolean)) return

    /*
     * The cheap exit: light touched this mesh but every lit quad was already
     * one block, so only the alpha lane changes and the geometry does not.
     * This is the path a torch in a cramped room takes, and the one
     * test/56-block-light.spec.js has always exercised.
     *
     * setVerticesData rather than updateVerticesData: noa applies its vertex
     * data non-updatable, and Babylon's update path on a STATIC_DRAW buffer is
     * a silent no-op on some backends. Rebuilding provably lands.
     */
    if (!anySplit) {
      /*
       * Zero-filled, which IS full sky, because the value is stored inverted.
       * So a quad this loop skips needs no writing at all, and a mesh where
       * every quad is skipped never allocates the attribute -- that is what
       * `anySky` below decides.
       */
      const sky = new Float32Array(pos.length / 3)
      let anySky = false
      for (let f = 0; f < nq; f++) {
        const q = grids[f]
        if (!q) continue
        for (let c = 0; c < 4; c++) {
          // Lattice order round the quad: v0 (0,0), v1 (1,0), v2 (1,1), v3 (0,1).
          const a = (c === 1 || c === 2) ? q.w : 0
          const b = (c === 2 || c === 3) ? q.h : 0
          const at = b * (q.w + 1) + a
          col[(f * 4 + c) * 4 + 3] = 1 - q.g[at] / MAX_LIGHT
          const sd = 1 - q.gs[at] / MAX_LIGHT
          sky[f * 4 + c] = sd
          if (sd > 0) anySky = true
        }
      }
      mesh.setVerticesData(VertexBuffer.ColorKind, col, false, 4)
      if (anySky) mesh.setVerticesData(SKY_ATTRIB, sky, false, 1)
      return
    }

    /*
     * Pass two: rebuild, FOUR VERTICES PER QUAD and no vertex sharing.
     *
     * Sharing a sub-quad lattice would cost about a third of the vertices, and
     * it is wrong here: `src/fluidGeometry.js` wraps `meshChunk` OUTSIDE this
     * one and reads the result back with `nf = pos.length / 12` and
     * `idx[f*6+i] - f*4`. That layout -- noa's own -- is a contract between
     * three files, not an implementation detail of this one. Breaking it would
     * hand fluidGeometry garbage quads to reshape. fluidGeometry's own split
     * keeps the same contract, which is why the two can stack.
     */
    const outPos = [], outNorm = [], outCol = [], outUV = [], outIdx = []
    const outAtlas = atlas ? [] : null
    const outSky = []
    let anySky = false
    let vcount = 0

    for (let f = 0; f < nq; f++) {
      const q = grids[f]
      const p = f * 12
      /*
       * The parent's own winding and diagonal, read back off the index buffer
       * rather than recomputed. `addIndexValues` writes faceNum*4 plus one of
       * four fixed patterns, so subtracting the base recovers the pattern
       * exactly -- including which way `decideTriDir` split it, which is the
       * thing ambient occlusion is most sensitive to.
       */
      const pat = [0, 1, 2, 3, 4, 5].map((i) => idx[f * 6 + i] - f * 4)

      if (!q || !q.split) {
        for (let c = 0; c < 4; c++) {
          const src = f * 4 + c
          outPos.push(pos[src * 3], pos[src * 3 + 1], pos[src * 3 + 2])
          outNorm.push(norm[src * 3], norm[src * 3 + 1], norm[src * 3 + 2])
          const a = q ? ((c === 1 || c === 2) ? q.w : 0) : 0
          const b = q ? ((c === 2 || c === 3) ? q.h : 0) : 0
          outCol.push(col[src * 4], col[src * 4 + 1], col[src * 4 + 2],
            q ? 1 - q.g[b * (q.w + 1) + a] / MAX_LIGHT : col[src * 4 + 3])
          outUV.push(uv[src * 2], uv[src * 2 + 1])
          if (outAtlas) outAtlas.push(atlas[src])
          const sd = q ? 1 - q.gs[b * (q.w + 1) + a] / MAX_LIGHT : 0
          outSky.push(sd)
          if (sd > 0) anySky = true
        }
        for (let i = 0; i < 6; i++) outIdx.push(vcount + pat[i])
        vcount += 4
        continue
      }

      const { w, h, g, gs, cA0, cA1, cB0, cB1 } = q
      const x0 = pos[p], y0 = pos[p + 1], z0 = pos[p + 2]
      const ux = pos[p + 3] - x0, uy = pos[p + 4] - y0, uz = pos[p + 5] - z0
      const vx = pos[p + 9] - x0, vy = pos[p + 10] - y0, vz = pos[p + 11] - z0
      const diag02 = (pat[0] === 0 || pat[1] === 0 || pat[2] === 0)
        && (pat[0] === 2 || pat[1] === 2 || pat[2] === 2)

      /** One output quad covering lattice [a0,a1] x [b0,b1] of the parent. */
      const emit = (a0, b0, a1, b1) => {
        const as = [a0, a1, a1, a0], bs = [b0, b0, b1, b1]
        for (let c = 0; c < 4; c++) {
          const sPar = as[c] / w, t = bs[c] / h
          outPos.push(
            x0 + ux * sPar + vx * t,
            y0 + uy * sPar + vy * t,
            z0 + uz * sPar + vz * t)
          outNorm.push(norm[p], norm[p + 1], norm[p + 2])
          // UVs are linear in (s, t) by construction (`addUVs`), and bilinear
          // interpolation reproduces a linear function exactly, so no triangle
          // bookkeeping is needed here -- unlike the colours just below.
          for (let e = 0; e < 2; e++) {
            outUV.push(
              (1 - sPar) * (1 - t) * uv[(f * 4) * 2 + e] +
              sPar * (1 - t) * uv[(f * 4 + 1) * 2 + e] +
              sPar * t * uv[(f * 4 + 2) * 2 + e] +
              (1 - sPar) * t * uv[(f * 4 + 3) * 2 + e])
          }
          if (outAtlas) outAtlas.push(atlas[f * 4])
          const tw = triWeights(sPar, t, diag02)
          for (let e = 0; e < 3; e++) {
            outCol.push(
              tw[0] * col[(f * 4) * 4 + e] +
              tw[1] * col[(f * 4 + 1) * 4 + e] +
              tw[2] * col[(f * 4 + 2) * 4 + e] +
              tw[3] * col[(f * 4 + 3) * 4 + e])
          }
          outCol.push(1 - g[bs[c] * (w + 1) + as[c]] / MAX_LIGHT)
          const sd = 1 - gs[bs[c] * (w + 1) + as[c]] / MAX_LIGHT
          outSky.push(sd)
          if (sd > 0) anySky = true
        }
        for (let i = 0; i < 6; i++) outIdx.push(vcount + pat[i])
        vcount += 4
      }

      for (let b = cB0; b <= cB1; b++) {
        for (let a = cA0; a <= cA1; a++) emit(a, b, a + 1, b + 1)
      }
      // The remainder, still merged. Four rectangles at most, and each one is
      // dark on all four corners by the argument above.
      if (cA0 > 0) emit(0, 0, cA0, h)
      if (cA1 + 1 < w) emit(cA1 + 1, 0, w, h)
      if (cB0 > 0) emit(cA0, 0, cA1 + 1, cB0)
      if (cB1 + 1 < h) emit(cA0, cB1 + 1, cA1 + 1, h)
    }

    /*
     * VertexData.applyToMesh rather than five setVerticesData calls. The
     * vertex COUNT changes here, and applyToMesh is the path noa itself used
     * to build this mesh: it orders the writes so positions land first and
     * rebuilds the submesh over the new index range. Setting the buffers
     * piecemeal leaves Babylon's geometry with a stale _totalVertices between
     * calls, which is a crash waiting on a resize.
     *
     * Uint16 runs out at 65536 vertices and a heavily lit chunk can pass that.
     * Babylon's `_normalizeIndexData` takes a Uint32Array as 32-bit indices
     * directly, and every WebGL2 context supports them.
     */
    const vdat = new VertexData()
    vdat.positions = new Float32Array(outPos)
    vdat.normals = new Float32Array(outNorm)
    vdat.colors = new Float32Array(outCol)
    vdat.uvs = new Float32Array(outUV)
    vdat.indices = vcount > 65535 ? new Uint32Array(outIdx) : new Uint16Array(outIdx)
    vdat.applyToMesh(mesh)
    // Not standard VertexBuffer kinds, so applyToMesh does not carry them.
    if (outAtlas) mesh.setVerticesData('texAtlasIndices', new Float32Array(outAtlas), false, 1)
    if (anySky) mesh.setVerticesData(SKY_ATTRIB, new Float32Array(outSky), false, 1)
  }

  /* -------------------------------------------------------------- *
   * Public surface
   * -------------------------------------------------------------- */

  const api = {
    /** Block light level 0..15 at a voxel. What F3's "Client Light" wants. */
    getBlockLight: (x, y, z) => getLight(Math.floor(x), Math.floor(y), Math.floor(z)),
    /** Sky light level 0..15 at a voxel, BEFORE the day/night multiplier. 15
     *  under open sky at midnight as well as at noon -- the clock is applied
     *  by whoever renders it, never stored. */
    getSkyLight: (x, y, z) => getSky(Math.floor(x), Math.floor(y), Math.floor(z)),
    /** Emission level of a block id, 0 if it does not glow. */
    emissionOf: (id) => emissionById[id] || 0,
    /** ms spent in the last block edit's propagation. For the perf spec. */
    lastEditMs: () => editMs,
    /** ms spent rewriting vertex light on the last chunk meshed. */
    lastMeshMs: () => meshMs,
    /** ms spent flooding BOTH channels into the last chunk that arrived. */
    lastSeedMs: () => seedMs,
    /*
     * Number of chunks currently holding light data.
     *
     * THIS THREW. `store` stopped being one Map at module scope the day sky
     * light split the engine into two channels, and this line kept naming it
     * -- `ReferenceError: store is not defined` on every call, on a function
     * the specs use. It counts the union of the two channels' keys rather
     * than either one, because a chunk holds light data if EITHER channel has
     * a buffer for it and the old single number meant exactly that.
     */
    chunkCount: () => new Set([...blockCh.store.keys(), ...skyCh.store.keys()]).size,
    /** Daylight the terrain shader is being handed this tick. Test seam --
     *  the only honest way to read it is from the module that binds it. */
    terrainLight: () => terrainLevel,
    /** Vanilla's per-face table, so a spec can assert against it without
     *  retyping it (see 68-entity-shading / 36-face-shading). */
    faceShade: MC_FACE_SHADE,
    EMISSION,
    MAX_LIGHT,
  }
  // Self-published rather than routed through main.js's `window.game`, because
  // main.js belongs to another agent this session and the specs need a handle.
  if (typeof window !== 'undefined') window.blockLight = api
  return api
}
