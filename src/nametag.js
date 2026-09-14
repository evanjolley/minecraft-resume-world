import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Quaternion } from '@babylonjs/core/Maths/math.vector'
import { Constants } from '@babylonjs/core/Engines/constants'

/*
 * NAMETAGS, transcribed from EntityRenderer.renderNameTag rather than
 * approximated. The method is short enough to quote, and every constant
 * below is one of its literals:
 *
 *   posestack.translate(0, entity.getNameTagOffsetY(), 0)   // bbHeight + 0.5
 *   posestack.mulPose(entityRenderDispatcher.cameraOrientation())
 *   posestack.scale(-0.025F, -0.025F, 0.025F)
 *   int k = (int)(options.getBackgroundOpacity(0.25F) * 255) << 24
 *   float f2 = (float)(-font.width(component) / 2)
 *   font.drawInBatch(..., 553648127, false, ..., SEE_THROUGH, k, i)
 *   if (flag) font.drawInBatch(..., -1, false, ..., NORMAL, 0, i)
 *
 * The four things that make this read as Minecraft rather than as floating
 * text, in rough order of how obviously wrong they look when missed:
 *
 * 1. IT IS A WORLD-SPACE OBJECT. 0.025 blocks per font pixel, applied once,
 *    with no distance compensation anywhere in the path -- so a nametag
 *    shrinks with perspective exactly like a block does. Every "billboard
 *    text" helper you would reach for instead keeps a constant screen size,
 *    and that single difference is most of why homebrew nametags look like
 *    UI stuck to a game rather than part of it.
 *
 * 2. TWO PASSES, not one. Not sneaking, Minecraft draws the tag twice: once
 *    with depth testing OFF, background quad and text at 0x20FFFFFF (white,
 *    alpha 32/255), then again depth-tested at opaque white with NO
 *    background. So the dark box and a ghost of the text are always visible
 *    through terrain, and the crisp white layer only lands where there is
 *    nothing in the way. One see-through pass at full opacity -- the obvious
 *    shortcut -- gets "renders through walls" right and loses the fact that
 *    an occluded name is visibly dimmer than a clear one.
 *
 * 3. FULL CAMERA ORIENTATION, including pitch. cameraOrientation() is
 *    Camera.rotation(), built as rotationYXZ(-yaw, pitch, 0), so the tag is
 *    parallel to the near plane and tips back when you look up at someone.
 *    A yaw-only billboard -- which is what "billboard" usually means -- stays
 *    vertical and shears visibly from below.
 *
 * 4. NO DROP SHADOW. The `false` in drawInBatch is dropShadow. Chat has one,
 *    nametags do not, and adding one here because the rest of this HUD has
 *    one would be a plausible-looking mistake.
 *
 * Rejected: HTML elements positioned with project(). It is easier, it gets
 * crisp text for free, and it cannot do (1) or (2) at all -- a DOM node has
 * no depth buffer to lose a fight with, so an occluded name is either fully
 * visible or hand-occluded with a raycast per frame per player.
 */

/** Blocks per font pixel. The 0.025 in the scale() above. */
const PX = 0.025

/** Font pixels: line box, and the background's one-pixel bleed either side. */
const LINE_H = 9
const BG_TOP = -1, BG_BOTTOM = 9

/** (int)(0.25 * 255) = 63. Pure black; the RGB bits of `k` are all zero. */
const BG_ALPHA = 63 / 255
/** 553648127 = 0x20FFFFFF. */
const SEE_THROUGH_ALPHA = 32 / 255

/** getNameTagOffsetY() is bbHeight + 0.5 for everything except a Sniffer. */
export const NAMETAG_OFFSET = (height) => height + 0.5

/*
 * 64 blocks, from `if (!(d0 > 4096.0D))`, camera position to entity feet.
 * 32 when sneaking (shouldShowName's `isDiscrete() ? 32 : 64`) -- not
 * implemented here because nothing in this world sneaks but you, and you are
 * the one case whose tag is handled separately. Noted so the next person does
 * not think it was missed.
 */
const MAX_DISTANCE = 64

/*
 * Canvas pixels per font pixel. The texture is drawn at 8x and sampled
 * NEAREST, which is what Minecraft's bitmap font does: the glyph edges stay
 * hard when you walk up to someone instead of going soft. Mipmaps off for the
 * same reason -- a mipped nametag turns to grey mush at twenty blocks.
 */
const SUPERSAMPLE = 8

/*
 * Monocraft's advance is 2/3 em, the same relationship hud.js uses, so a font
 * size of 9 canvas-pixels-per-font-pixel puts one glyph cell on exactly 6
 * font pixels and the line box on 9.
 */
const fontSpec = () => `${LINE_H * SUPERSAMPLE}px Monocraft, monospace`

/**
 * One nametag. Two meshes and one texture, following the two passes above.
 *
 * Owns no position of its own: the caller moves it every frame, because the
 * thing it is attached to is interpolated for render (see perspective.js on
 * _renderPosition) and a tag placed on tick judders against a body that does
 * not.
 */
export function createNametag(noa, { text = '', height = 1.8, name = 'nametag' } = {}) {
  const scene = noa.rendering.getScene()

  /*
   * One texture, two materials. The see-through pass wants the background and
   * dim text; the depth-tested pass wants opaque text and no background. Those
   * are different IMAGES, so they get one canvas each -- trying to share by
   * tinting a single texture cannot express "no background on the second
   * pass", which is a real and visible part of the look (without it the box
   * doubles up and goes noticeably darker where it is unoccluded).
   */
  const layers = [
    // Drawn first: alphaIndex, not distance, is what Babylon sorts transparent
    // meshes by when it is set, and these two are close enough to coplanar
    // that a distance sort would flicker between them as you walk around.
    { seeThrough: true, alphaIndex: 0 },
    { seeThrough: false, alphaIndex: 1 },
  ].map((layer, i) => {
    const texture = new DynamicTexture(`${name}-tex-${i}`,
      { width: 8, height: 8 }, scene, false, Texture.NEAREST_SAMPLINGMODE)
    texture.hasAlpha = true
    /*
     * Flip V. A DynamicTexture's canvas is Y-DOWN and Babylon samples the
     * plane's UVs Y-UP, so the glyphs come out upside down -- which is the
     * kind of bug that no assertion in the spec file can see and one
     * screenshot makes obvious.
     *
     * Worth noting this is NOT vanilla's `scale(-0.025F, -0.025F, 0.025F)`.
     * That negation is the font's own Y-down frame being turned into the
     * camera-oriented one, and it is already accounted for: the canvas is
     * drawn in font space, top-down, exactly as the font renderer emits it.
     * This is Babylon's UV convention on top of that, and conflating the two
     * is how you end up flipping twice and back.
     */
    texture.vScale = -1
    texture.vOffset = 1

    const material = noa.rendering.makeStandardMaterial(`${name}-mat-${i}`)
    /*
     * emissive for colour, opacity for alpha, and NO diffuseTexture -- which
     * is the whole trick and took a screenshot to find.
     *
     * StandardMaterial.needAlphaTesting() is true whenever the DIFFUSE
     * texture has alpha, and alpha testing discards anything below a 0.4
     * cutoff. Both of the things that make a nametag a nametag are below it:
     * the background box is 63/255 and the see-through text is 32/255. With
     * the texture wired to diffuse, every translucent pixel was thrown away
     * and what survived was a crisp white name floating on nothing -- which
     * looks deliberate, passes every assertion in the spec, and is wrong.
     *
     * An opacityTexture forces real alpha BLENDING instead, which is what
     * vanilla's TRANSLUCENT_TRANSPARENCY does. Text is unlit: Minecraft's
     * nametags are lightmap-modulated and these are not, see the divergence
     * note at the bottom of this file.
     */
    material.opacityTexture = texture
    material.emissiveTexture = texture
    /*
     * THE TWO LINES THAT MADE THIS LOOK WRONG, and they are both a colour
     * being ADDED where you would assume it was multiplied.
     *
     * emissiveColor was white. In Babylon's default fragment shader the
     * emissive texture is not a modulation, it is a sum:
     *
     *     vec3 emissiveColor = vEmissiveColor;
     *     #ifdef EMISSIVE
     *       emissiveColor += texture2D(emissiveSampler, ...).rgb * vEmissiveInfos.y;
     *
     * so a white emissiveColor pins every pixel of the quad to white before
     * the texture is even sampled, and the texture can only ever add. The
     * background box is BLACK at 63/255 in the canvas, and it was coming out
     * WHITE at 63/255 on screen -- a pale haze that brightened the terrain
     * behind the name instead of the dark plate that dims it. The alpha
     * channel comes from opacityTexture and was always right, so the tag had
     * vanilla's exact geometry, spacing and see-through behaviour and still
     * read as not-quite-Minecraft. The colour has to come from the texture,
     * which means the constant has to be zero. crackOverlay.js has the same
     * line for the same reason.
     *
     * And ambientColor: noa's makeStandardMaterial leaves it white, and
     * Babylon adds that term too (finalDiffuse gets + vAmbientColor) even
     * with disableLighting on -- which with no diffuseTexture means the whole
     * quad picks up scene.ambientColor, a 0.46 grey. It was INVISIBLE while
     * emissiveColor was white, because line 287's clamp was already saturated
     * at 1.0; zeroing emissive alone would have swapped a white box for a
     * grey one. Same line as crackOverlay.js, particles.js and sky.js.
     */
    material.emissiveColor = new Color3(0, 0, 0)
    material.ambientColor = new Color3(0, 0, 0)
    material.diffuseColor = new Color3(0, 0, 0)
    material.specularColor = new Color3(0, 0, 0)
    material.disableLighting = true
    material.backFaceCulling = false

    if (layer.seeThrough) {
      /*
       * RenderType.textSeeThrough: NO_DEPTH_TEST plus a colour-only write
       * mask. depthFunction ALWAYS is the former; disableDepthWrite is the
       * latter, and it matters as much -- a tag that WROTE depth would punch
       * a name-shaped hole that the opaque pass then fails to draw into.
       */
      material.depthFunction = Constants.ALWAYS
      material.disableDepthWrite = true
    }

    const mesh = CreatePlane(`${name}-${i}`, { width: 1, height: 1 }, scene)
    mesh.material = material
    mesh.isPickable = false
    mesh.alphaIndex = layer.alphaIndex
    noa.rendering.addMeshToScene(mesh)
    return { texture, material, mesh, ...layer }
  })

  let current = null
  let enabled = true
  let width = 0

  /** Redraw both canvases. Only on a rename -- this is not a per-frame cost. */
  const render = (value) => {
    if (value === current) return
    current = value

    // Measure once, off a throwaway context, because the canvas has to be
    // sized before anything is drawn into it.
    const probe = document.createElement('canvas').getContext('2d')
    probe.font = fontSpec()
    // font.width() is Mth.ceil of the summed advances, each of which is the
    // glyph width plus one pixel of spacing -- including after the last glyph.
    width = Math.ceil(probe.measureText(value).width / SUPERSAMPLE)

    const wPx = width - BG_TOP + 1   // -1 .. width+1, so width + 2 font px
    const hPx = BG_BOTTOM - BG_TOP   // -1 .. 9, so 10 font px

    for (const layer of layers) {
      layer.texture.scaleTo(wPx * SUPERSAMPLE, hPx * SUPERSAMPLE)
      const ctx = layer.texture.getContext()
      ctx.clearRect(0, 0, wPx * SUPERSAMPLE, hPx * SUPERSAMPLE)

      if (layer.seeThrough) {
        ctx.fillStyle = `rgba(0, 0, 0, ${BG_ALPHA})`
        ctx.fillRect(0, 0, wPx * SUPERSAMPLE, hPx * SUPERSAMPLE)
      }

      ctx.font = fontSpec()
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = layer.seeThrough
        ? `rgba(255, 255, 255, ${SEE_THROUGH_ALPHA})`
        : 'rgb(255, 255, 255)'
      /*
       * The glyph box is font pixels 0..8 of the line, and the background
       * starts one pixel above it, so the text's vertical centre is 1 + 4
       * pixels down the canvas. Horizontally the text starts one pixel in,
       * which is the background's left bleed -- the centring that vanilla
       * does with `-font.width()/2` is applied to the MESH below instead,
       * because the mesh is what has to end up centred on the head.
       */
      ctx.fillText(value, SUPERSAMPLE, (1 + LINE_H / 2) * SUPERSAMPLE)
      layer.texture.update(false)

      layer.mesh.scaling.set(wPx * PX, hPx * PX, 1)
    }
  }

  render(text)

  const api = {
    get text() { return current },
    setText(value) { render(String(value ?? '')) },
    setEnabled(value) {
      enabled = !!value
      for (const layer of layers) layer.mesh.setEnabled(enabled)
    },
    get enabled() { return enabled },
    /** Font-pixel width of the text, which is what vanilla centres on. */
    get width() { return width },
    /** For the test suite, which asserts on placement without screenshotting. */
    meshes: layers.map((l) => l.mesh),

    /**
     * Place and orient, given the entity's FEET in noa-local coordinates.
     * Call from beforeRender.
     */
    update([x, y, z]) {
      if (!enabled) return
      const camera = scene.activeCamera
      /*
       * Distance is measured camera-to-feet, which is what
       * `entityRenderDispatcher.distanceToSqr(entity)` does -- entity
       * position, not entity centre. Both meshes vanish together; culling one
       * pass would leave a ghost.
       */
      const cam = camera?.globalPosition
      const far = !!cam && (cam.x - x) ** 2 + (cam.y - y) ** 2 + (cam.z - z) ** 2
        > MAX_DISTANCE * MAX_DISTANCE

      for (const layer of layers) {
        /*
         * The anchor is the TOP of the glyph box, and the tag grows upward
         * from it -- font space is Y-down and the scale() negates Y. The
         * background reaches one font pixel BELOW the anchor, so the plane's
         * centre sits at (-1 + 9)/2 = 4 font pixels above it.
         */
        layer.mesh.position.set(
          x, y + NAMETAG_OFFSET(height) + (LINE_H - 1) / 2 * PX, z)
        /*
         * The whole billboard, in one line: copy the camera's absolute
         * rotation. Babylon's BILLBOARDMODE_ALL is close but not the same
         * thing -- it turns each mesh to face the camera's POSITION, so tags
         * at the edge of the screen turn slightly toward the middle, where
         * vanilla's are all exactly parallel.
         */
        if (camera) {
          layer.mesh.rotationQuaternion = (layer.mesh.rotationQuaternion ?? new Quaternion())
            .copyFrom(camera.absoluteRotation)
        }
        layer.mesh.setEnabled(!far)
      }
    },

    dispose() {
      for (const layer of layers) { layer.mesh.dispose(); layer.material.dispose(); layer.texture.dispose() }
    },
  }
  return api
}

/*
 * KNOWN DIVERGENCES FROM VANILLA, all deliberate:
 *
 * - YOU CAN SEE YOUR OWN NAME IN F5. Vanilla cannot: shouldShowName ends with
 *   `livingentity != minecraft.getCameraEntity()`, and the camera entity is
 *   still you in third person, so Minecraft never draws your own tag in any
 *   perspective. It is drawn here because the whole point of the conversation
 *   is that being renamed is something you SEE happen to yourself, and a
 *   confirmation you have to take on trust is not the same feature. main.js
 *   calls it a divergence rather than hiding it as a surprise.
 *
 * - NO LIGHTMAP. All four vanilla text render types set LIGHTMAP and get the
 *   entity's packed light, so a name in a cave is dimmer. These are drawn at
 *   constant brightness, so they will read slightly bright in the dark. Fixing
 *   it means sampling noa's light at the entity, which noa does not expose
 *   per-entity today.
 *
 * - CENTRING IS EXACT HERE AND HALF A PIXEL OFF IN VANILLA. `-font.width()/2`
 *   is Java integer division, so an odd-width string lands half a pixel right
 *   of centre. Monocraft is monospaced at 6 font pixels, so every width in
 *   this world is even and the two agree anyway -- but a variable-width font
 *   would need Math.trunc to reproduce the wart.
 */
