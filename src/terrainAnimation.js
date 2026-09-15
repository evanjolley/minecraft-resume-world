/*
 * Animated block textures, without re-meshing anything.
 *
 * ------------------------------------------------------------------------
 * WHY THIS FILE IS NOT "just set atlasIndex every tick"
 *
 * noa uploads each atlas page as a sampler2DArray and picks the layer with
 * `texAtlasIndex`, which is a VARYING fed from a per-vertex attribute that
 * terrainMesher.js writes when the chunk is meshed. Changing a material's
 * atlasIndex on the registry afterwards does nothing at all: the number is
 * already in every chunk's vertex buffer. Animating that way means re-meshing
 * every chunk containing water fifteen times a second. docs/water.md section 3
 * rules it out and lands on the plan this file implements.
 *
 * THE PLAN: a layer-remap uniform.
 *
 * Every frame of every animated texture gets its own layer in the atlas,
 * appended AFTER the page's regular materials (scripts/build-textures.mjs).
 * The material keeps the logical layer it was meshed with, and the fragment
 * shader gains one indirection:
 *
 *     float layer = uAnimRemap[texAtlasIndex];   // identity for static mats
 *     baseColor = texture(atlasTexture, vec3(vDiffuseUV, layer));
 *
 * Per tick, JS writes one float per animated material into that table. No
 * re-mesh, no texture upload, one small UBO write per draw. Nine animated
 * textures cost exactly what one costs. That is the whole idea.
 *
 * HOW IT GETS INTO THE PIPELINE. noa's TerrainMatManager builds one Babylon
 * material per atlas page, lazily, and attaches its own plugin -- whose
 * fragment replacement has already consumed the line a second plugin would
 * need to target. So instead this module builds the page material itself,
 * with the extended plugin, and re-registers the page's materials with
 * `renderMaterial`. `terrainMaterials.js:createTerrainMat` returns
 * `matInfo.renderMat` untouched when it is set. That is noa's supported
 * escape hatch, and it is the one line of API docs/water.md pointed at.
 *
 * Re-registering a name that already exists is not a hack either:
 * registry.js:182 reuses the existing matID for a known name, so the block
 * ids that resolved to it at registerBlock time still point at the same
 * material. It has to run BEFORE the first chunk meshes, which is why
 * main.js calls it on the line after registerBlocks().
 *
 * WHY THE TABLE LIVES HERE AND NOT IN blocks.js. Frame counts and timings are
 * a property of the ANIMATION, not of the block, and keeping them here means
 * the atlas layout can be computed identically by the build script and by the
 * runtime with no third file to keep in sync. The build script imports this
 * table, and -- this is the part that matters -- checks every number in it
 * against the real `.mcmeta` in the jar and throws if they disagree. Hand-copied
 * constants that are verified against their source on every build are not
 * hand-copied constants.
 * ------------------------------------------------------------------------
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js'
import { RawTexture2DArray } from '@babylonjs/core/Materials/Textures/rawTexture2DArray.js'
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js'
import { Constants } from '@babylonjs/core/Engines/constants.js'
import { ATLAS_PAGES } from './blocks.js'

/**
 * Every animated texture in the block palette, measured from 1.21.8.
 *
 * `frametime` is in MINECRAFT TICKS (50ms), unconverted, so these numbers can
 * be diffed against the `.mcmeta` by eye. `order` is the explicit frame list
 * when the mcmeta has one -- lava's is the interesting case: 38 entries that
 * run 0..19 and then back down 18..1, a ping-pong, not a loop. An animation
 * whose mcmeta has no frame list gets `order: null` and plays 0..frames-1.
 *
 * `interpolate` is recorded because the mcmeta has it and the build script
 * verifies against it, but the shader does NOT cross-fade yet. That affects
 * magma, prismarine, sculk and the two nether stems, all of which are slow
 * and subtle; water and lava, the two anyone will look at, do not use it.
 */
export const ANIMATIONS = {
  water_still: { frames: 32, frametime: 2, order: null, interpolate: false },
  lava_still: {
    frames: 20,
    frametime: 2,
    interpolate: false,
    // 0..19 then 18..1: vanilla's explicit ping-pong. Written out rather than
    // generated so the build script's comparison against the mcmeta is a
    // comparison and not a re-derivation of the same guess.
    order: [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
      18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ],
  },
  magma: { frames: 3, frametime: 8, order: [0, 1, 2], interpolate: true },
  sea_lantern: { frames: 5, frametime: 5, order: null, interpolate: false },
  prismarine: {
    frames: 4,
    frametime: 300,
    interpolate: true,
    // 6600 ticks -- five and a half minutes -- which is why prismarine reads
    // as breathing rather than as animating.
    order: [
      0, 1, 0, 2, 0, 3, 0, 1, 2, 1, 3, 1, 0, 2, 1, 2, 3, 2, 0, 3, 1, 3,
    ],
  },
  sculk: { frames: 4, frametime: 20, order: null, interpolate: true },
  crimson_stem: { frames: 5, frametime: 10, order: null, interpolate: true },
  warped_stem: { frames: 5, frametime: 10, order: null, interpolate: true },
}

/**
 * The nether portal's frames, which are NOT in ANIMATIONS.
 *
 * `nether_portal` is not a material in blocks.js -- there is no portal block
 * there and that file belongs to another agent this pass -- so its frames
 * cannot be appended to "the page its material is on". They are instead given
 * a home on the alpha page (the portal texture's alpha runs 155-232) as a
 * standalone frame run with no owning material, and src/dimensions.js
 * registers a material pointing straight at frame 0 of it.
 */
export const STANDALONE = {
  nether_portal: { page: 'alpha', frames: 32, frametime: 1, order: null, interpolate: false },
}

/** One Minecraft tick, in milliseconds. */
export const TICK_MS = 50

/*
 * The 128-layer cap in blocks.js is a deliberate margin under the 256 layers
 * WebGL2 guarantees. Frames blow through it -- atlas0 and atlas1 are already
 * full at 128 -- so the margin is re-spent rather than abandoned: 192 is still
 * 25% under the floor, and a page that would exceed it throws at build time
 * rather than shipping a texture that works on this machine only.
 *
 * (docs/water.md said every frame fit in the free slots on atlas3 and atlas4.
 * That was right for water and lava and wrong for the other five: a material's
 * frames must live on the material's OWN page, and magma is on atlas0,
 * prismarine and sea_lantern on atlas1, both of which are full at 128.)
 */
export const MAX_PAGE_LAYERS = 192

/**
 * Where every frame of every animation lives.
 *
 * Returns one entry per atlas page, in page order, with `extra` naming the
 * frame layers appended after the page's regular materials. Pure function of
 * ATLAS_PAGES and the tables above, so the build script and the runtime agree
 * by construction rather than by convention.
 */
export function atlasLayout(pages = ATLAS_PAGES) {
  const alphaPage = pages.findIndex(p => p.hasAlpha)
  return pages.map((page, pageIndex) => {
    const extra = []
    let next = page.names.length
    const anims = []
    for (const [i, name] of page.names.entries()) {
      const anim = ANIMATIONS[name]
      if (!anim) continue
      anims.push({ name, index: i, base: next, ...anim })
      for (let f = 0; f < anim.frames; f++) extra.push({ name, frame: f })
      next += anim.frames
    }
    for (const [name, anim] of Object.entries(STANDALONE)) {
      if (anim.page === 'alpha' ? pageIndex !== alphaPage : anim.page !== page.file) continue
      // index === base: a standalone run has no regular material to remap
      // FROM, so its first frame layer is also the layer the material samples.
      anims.push({ name, index: next, base: next, standalone: true, ...anim })
      for (let f = 0; f < anim.frames; f++) extra.push({ name, frame: f })
      next += anim.frames
    }
    if (next > MAX_PAGE_LAYERS) {
      throw new Error(`${page.file} would need ${next} layers, over the ${MAX_PAGE_LAYERS} cap`)
    }
    return { ...page, pageIndex, extra, anims, layers: next }
  })
}

/** Which layer an animation is showing at tick `t`. */
export function frameAt(anim, t) {
  const order = anim.order || Array.from({ length: anim.frames }, (_, i) => i)
  const step = Math.floor(t / anim.frametime) % order.length
  return order[step]
}

/* ------------------------------------------------------------------ *
 * The shader
 * ------------------------------------------------------------------ */

/*
 * A copy of noa's TerrainMaterialPlugin (terrainMaterials.js:184-263) with the
 * remap added. Copied rather than subclassed because the thing that changes is
 * inside a regex string replacement of a line noa's version has already
 * rewritten -- there is no seam to extend.
 *
 * The table is a vec4 array rather than a float array because std140 pads every
 * element of a float[] out to 16 bytes anyway; packing four layers per vec4
 * makes the same memory hold four times as much. `uAnimRemap[i>>2][i&3]` needs
 * GLSL ES 3.0, which noa's `texture(sampler2DArray, ...)` already requires.
 */
class AnimatedTerrainPlugin extends MaterialPluginBase {
  constructor(material, texture, vec4Count) {
    super(material, 'NoaAnimatedTerrain', 200, { NOA_TWOD_ARRAY_TEXTURE: false })
    this._enable(true)
    this._atlasTextureArray = null
    this._vec4Count = vec4Count
    /** layer -> layer, identity until a tick says otherwise. */
    this.remap = new Float32Array(vec4Count * 4)
    for (let i = 0; i < this.remap.length; i++) this.remap[i] = i
    this.layers = 0
    texture.onLoadObservable.add(tex => this.setTextureArrayData(tex))
  }

  setTextureArrayData(texture) {
    const { width, height } = texture.getSize()
    const numLayers = Math.round(height / width)
    this.layers = numLayers
    const data = texture._readPixelsSync()
    this._atlasTextureArray = new RawTexture2DArray(
      data, width, width, numLayers,
      Constants.TEXTUREFORMAT_RGBA, texture.getScene(), true, false,
      Texture.NEAREST_SAMPLINGMODE,
    )
  }

  prepareDefines(defines) { defines['NOA_TWOD_ARRAY_TEXTURE'] = true }
  getClassName() { return 'NoaAnimatedTerrainPlugin' }
  getSamplers(samplers) { samplers.push('atlasTexture') }
  getAttributes(attributes) { attributes.push('texAtlasIndices') }

  /*
   * A plain uniform, NOT a UBO entry, and that is the subtle part.
   *
   * Declaring `{ name, size, type, arraySize }` puts the array in the
   * material's uniform BUFFER, whose layout StandardMaterial builds in its own
   * constructor -- before a plugin attached afterwards can contribute to it.
   * The shader then compiles against a declaration that was never injected
   * and every terrain material in the world fails with "'uAnimRemap':
   * undeclared identifier". What that looks like from inside the game is a
   * sky with no ground in it.
   *
   * An entry with a name and no size/type still registers the NAME as a plain
   * uniform (materialPluginManager.js:211 pushes it outside the size check),
   * and `fragment` injects the declaration at ADDITIONAL_FRAGMENT_DECLARATION.
   * So the uniform is declared, has a location, and is set per draw with
   * setArray4 off the sub-mesh's effect.
   */
  getUniforms() {
    return {
      ubo: [{ name: 'uAnimRemap' }],
      fragment: `uniform vec4 uAnimRemap[${this._vec4Count}];`,
    }
  }

  bindForSubMesh(uniformBuffer, scene, engine, subMesh) {
    if (this._atlasTextureArray) uniformBuffer.setTexture('atlasTexture', this._atlasTextureArray)
    subMesh?.effect?.setArray4('uAnimRemap', this.remap)
  }

  getCustomCode(shaderType) {
    if (shaderType === 'vertex') return {
      'CUSTOM_VERTEX_MAIN_BEGIN': `
        texAtlasIndex = texAtlasIndices;
      `,
      'CUSTOM_VERTEX_DEFINITIONS': `
        uniform highp sampler2DArray atlasTexture;
        attribute float texAtlasIndices;
        varying float texAtlasIndex;
      `,
    }
    if (shaderType === 'fragment') return {
      '!baseColor\\=texture2D\\(diffuseSampler,vDiffuseUV\\+uvOffset\\);':
        `int noaLayer = int(texAtlasIndex + 0.5);
         float noaMapped = uAnimRemap[noaLayer >> 2][noaLayer & 3];
         baseColor = texture(atlasTexture, vec3(vDiffuseUV, noaMapped));`,
      'CUSTOM_FRAGMENT_DEFINITIONS': `
        uniform highp sampler2DArray atlasTexture;
        varying float texAtlasIndex;
      `,
    }
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Install
 * ------------------------------------------------------------------ */

/**
 * Build one animated material per atlas page and hand it to noa.
 *
 * Must be called after registerBlocks (the material names have to exist) and
 * before any chunk is meshed (noa caches the page material on first use).
 */
export function installTerrainAnimation(noa, { pages = ATLAS_PAGES } = {}) {
  const layout = atlasLayout(pages)
  const scene = noa.rendering.getScene()
  const installed = []

  for (const page of layout) {
    if (!page.anims.length) continue

    // The material name has to be one noa would have chosen, because
    // blocks.js's double-sided-translucent hook matches on
    // `terrain-textured-<blockMatID>` and looks the id back up in the
    // registry. Borrowing the id of the page's first material keeps that
    // hook working against a material noa never created.
    // registerMaterial returns the matID, and registry.js:182 reuses the
    // existing id for a name it already knows -- so re-registering the first
    // name with exactly the options blocks.js used is how you ASK for an id
    // without reaching into a private lookup.
    const firstId = noa.registry.registerMaterial(page.names[0], {
      textureURL: page.file, atlasIndex: 0, texHasAlpha: page.hasAlpha,
    })
    const url = noa.registry.getMaterialData(firstId).texture
    const mat = noa.rendering.makeStandardMaterial('terrain-textured-' + firstId)
    const tex = new Texture(url, scene, true, false, Texture.NEAREST_SAMPLINGMODE)
    if (page.hasAlpha) tex.hasAlpha = true
    mat.diffuseTexture = tex
    const plugin = new AnimatedTerrainPlugin(mat, tex, Math.ceil(page.layers / 4))

    for (const [i, name] of page.names.entries()) {
      noa.registry.registerMaterial(name, {
        textureURL: page.file,
        atlasIndex: i,
        texHasAlpha: page.hasAlpha,
        renderMaterial: mat,
      })
    }
    installed.push({ page, mat, plugin })
  }

  let ticks = 0
  let paused = false
  let carry = 0

  /**
   * Point every animated material's layer at the frame for tick `ticks`.
   *
   * Guard: if the atlas PNG on disk is shorter than the layout expects, the
   * frames were never built (a CE build substitutes a still ice tile for
   * water and has no animation to extract) and remapping would sample a layer
   * that does not exist. Identity is exactly today's behaviour, so the CE
   * build degrades to a frozen first frame rather than to garbage.
   */
  const apply = () => {
    for (const { plugin, page } of installed) {
      if (plugin.layers && plugin.layers < page.layers) continue
      for (const anim of page.anims) {
        plugin.remap[anim.index] = anim.base + frameAt(anim, ticks)
      }
    }
  }
  apply()

  const api = {
    /** Advance by real milliseconds, in whole Minecraft ticks. */
    advance(ms) {
      if (paused) return
      carry += ms
      const whole = Math.floor(carry / TICK_MS)
      if (whole <= 0) return
      carry -= whole * TICK_MS
      ticks += whole
      apply()
    },
    /** Freeze or unfreeze every animation. The specs use this to prove that
     *  a moving texture is what they are actually measuring. */
    setPaused(v) { paused = !!v },
    get paused() { return paused },
    get tick() { return ticks },
    /** Which atlas layer `name` is showing right now. Specs read this; so
     *  does anything that wants to know whether frames were built at all. */
    layerOf(name) {
      for (const { page, plugin } of installed) {
        for (const anim of page.anims) {
          if (anim.name === name) return plugin.remap[anim.index]
        }
      }
      return -1
    },
    /** True once the atlas image has loaded with its frame layers present. */
    framesLoaded(name) {
      for (const { page, plugin } of installed) {
        if (!page.anims.some(a => a.name === name)) continue
        return plugin.layers >= page.layers
      }
      return false
    },
    layout,
    /** Where a standalone (material-less) frame run starts. dimensions.js
     *  needs this to register the portal material. */
    standaloneSlot(name) {
      for (const page of layout) {
        const anim = page.anims.find(a => a.name === name && a.standalone)
        if (anim) return { file: page.file, index: anim.index, hasAlpha: page.hasAlpha }
      }
      return null
    },
  }

  noa.on('tick', dt => api.advance(dt))
  return api
}
