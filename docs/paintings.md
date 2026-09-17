# Paintings

Two kinds hang on the walls of this world, and they differ in almost every way
that matters — resolution, where the art comes from, whether it is committed,
and whether it survives a deploy.

|                | vanilla                          | custom                        |
| -------------- | -------------------------------- | ----------------------------- |
| art            | Mojang's 51 variants             | Evan's images, one per chapter |
| resolution     | 16 px per block                  | 128 px per block               |
| source         | a local Minecraft install        | `paintings-src/`              |
| committed?     | **no** (`public/paintings/vanilla/` is gitignored) | **yes** (`public/paintings/*.png`) |
| in a deploy?   | no — draws a placeholder         | yes                           |
| how to get one | click a wall with a painting item | `hangPainting()` from a build file |

## Adding the next one

Three steps, and only the first is a decision.

1. Put the image in `paintings-src/`.
2. Add a row to `CUSTOM_PAINTINGS` in `src/paintings.js` — a name, the
   filename, and how many blocks wide and high it hangs.
3. `npm run paintings`.

Then hang it from a build file:

```js
import { hangPainting } from '../paintingArt.js'

// x, y, z is the BOTTOM-LEFT block of the painting as a viewer sees it.
// 'south' is the direction the picture faces, so this one is read by
// somebody standing to the south of it looking north.
hangPainting(-40, 71, 118, 'south', 'millard_north')
```

The size is an **aspect ratio decision** and it is the step that goes wrong.
The source is centre-cropped to `w:h`, never squashed, so a landscape photo in
a portrait frame loses its ends. The build refuses a crop more than 15% off
and tells you both ratios — `millardnorth2.webp` at 2000×1276 into a 2×3 frame
fails with "135% off", which is the check doing its job rather than an
obstacle to route around. Pick the orientation that matches the photo.

Vanilla, for reference, has no 2×3 **or** 3×2 variant. Its sizes are 1×1, 1×2,
2×1, 2×2, 3×3, 3×4, 4×2, 4×3 and 4×4. Custom paintings are not restricted to
that table, which is most of the point of having them.

## Source formats are a mess, on purpose

`millardnorth4.jpg` is an AVIF file. Nothing in its name says so, a browser
would refuse it, and it would have shipped as a broken texture. So the build
probes every source for its **real** format and says when the extension lies:

```
! millardnorth4.jpg is actually HEIF, not JPG. Decoded anyway; rename it so
  the next reader is not misled.
```

A warning rather than an error, because sharp decodes it correctly either way.
The three things that *do* stop the build are a missing source, an undecodable
source, and a crop that would destroy the picture — each names the file.

## Licensing — open, and Evan's call

**`paintings-src/millardnorth2.webp` is a third-party architectural
photograph.** It is committed to this repo, this repo is public, and
`npm run build:deploy` will serve it.

That is the same class of question `DECISIONS.md` already carries open about
serving Mojang-derived terrain, and `scripts/check-deploy-assets.mjs` is the
boundary that enforces the answers this repo *has* settled. Custom painting
art deliberately sits outside that check: the script asks "which source built
this atlas", and a photograph has no source marker to read.

Nothing here blocks on it and there is no attribution UI. It is written down
so that it is a decision rather than a discovery:

- Vanilla painting art is Mojang's and is **already handled** — gitignored,
  never deployed, and a deployed build has none of it.
- Custom painting art is **whatever Evan puts in `paintings-src/`**, and
  clearing it for a public site is his call, per image.

If the answer for some future image is "no", the mechanism already exists:
leave it out of `CUSTOM_PAINTINGS` and it is neither built nor served.
