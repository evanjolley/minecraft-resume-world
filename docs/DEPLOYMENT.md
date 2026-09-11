# Deployment

**Decision: Cloudflare Workers with static assets.** Not Pages, not Vercel, not
GitHub Pages. Reasoning below, because the obvious reason is not the real one.

## The static hosting is not the deciding factor

The built site, measured from a clean checkout rather than estimated, is 917
files and 1.84MB: a 1.24MB bundle (310KB gzipped) and about 690KB of
everything else. An earlier draft of this file said ~4.5MB of assets, which
came from `du` reporting allocated blocks; most of these files are 200-byte
PNGs and `du` rounds every one of them up to 4KB. Either way every candidate
serves it for free without noticing. If static hosting were all this needed,
GitHub Pages would do and the question would be boring.

The deciding factor is **multiplayer**, which is on the roadmap and which this
codebase has already been shaped around — `src/authority.js` exists precisely so
a server can take over the deciding without any command changing.

## What multiplayer actually needs

One long-lived room that holds state in memory and fans WebSocket messages out
to everyone in it. That is the whole requirement.

**Cloudflare Durable Objects are that, exactly.** A Durable Object IS the room:
single-threaded, addressable by name, holding its state in memory between
messages. WebSocket Hibernation is GA, outgoing messages aren't billed, and an
idle hibernating object isn't billed for duration — so an empty world costs
nothing while still being instantly there when someone arrives. The free plan
allows 100,000 requests/day, which for a portfolio site is not a constraint.

**Vercel can do WebSockets now** (native support, public beta since June 2026)
but not this shape. Connections close when the Function hits its maximum
duration, so clients need reconnect-with-backoff, and state has to live in an
external store — Vercel's own docs point at Redis from their Marketplace. So
the same feature costs a Function, plus Redis, plus reconnection handling,
versus one object that simply is the room.

That is the entire argument. Everything else is tie-breakers.

## Why Workers rather than Pages

Cloudflare recommends Workers with static assets for new projects, and Pages is
now the legacy path. Static asset requests are free on both. Workers means one
deployment for the site and the multiplayer room rather than two platforms
stitched together — and, concretely, it means adding multiplayer later is a
binding in `wrangler.toml`, not a re-platform.

## Tie-breakers

- **Build minutes.** Vercel's free build allowance has been a real cost here
  before — $18 of $20 burned in a single session on another project. Frequent
  small deploys are how this project works.
- **Video.** The roadmap wants recorded clips on in-world screens. R2 has no
  egress fees, which matters for video more than for anything else on this
  site.
- **One vendor** for site, room, and video storage. Fewer places for a
  three-minute visitor's experience to break.

## Rejected

- **GitHub Pages.** Static only. No backend, ever. Fine for evanjolley.com;
  a dead end here.
- **Fly.io / Railway** (a real always-on Node process). The simplest possible
  mental model for WebSockets, and genuinely a fair choice — but it means
  paying for and operating a server that is idle almost all the time, for a
  site whose traffic is a handful of visitors a day.
- **Vercel + Ably/Pusher.** Works, and offloads the hard part to someone whose
  job it is. Rejected because it is two vendors and a subscription to avoid a
  problem Durable Objects simply do not have.

## What is built, and what it cannot do yet

Everything below exists and has been exercised. Nothing has been deployed, no
Cloudflare account has been touched, and no DNS record has been created.

- `wrangler.toml` — the Worker, pointed at `dist/`, with the Durable Object
  binding multiplayer will need written out and commented so the claim above
  about "a binding, not a re-platform" can be checked rather than believed.
- `deploy/_headers` and `deploy/.assetsignore` — cache policy and an upload
  blocklist, copied into `dist/` by the deploy build.
- `.github/workflows/deploy.yml` — install, textures, tests, build, verify,
  validate the config on every push to `main`, and deploy only if a secret
  that does not exist yet is present.
- `npm run deploy:dry-run` — proves the config parses and `dist/` resolves,
  without an account.

## The sounds problem, which is the real one

**A deploy today is silent, on purpose, and that needs saying out loud rather
than being discovered.**

`public/sounds/` is built by `npm run sounds`, which reads the asset store of a
Minecraft install on the machine it runs on. CI has no such install, so a CI
build has no audio at all. That is not the interesting half. The interesting
half is that the audio is Mojang's, and `scripts/build-sounds.mjs` says at
length why it is gitignored: extracting it onto your own machine from a copy
you own is fine, publishing it from a public domain is redistribution. The
same rule the textures already follow.

So the failure mode to avoid is not "CI forgot the sounds". It is Evan running
`npm run build` on the laptop that *does* have them, then `wrangler deploy`,
and publishing 76 Mojang `.ogg` files from his own domain without noticing.
`.gitignore` does not prevent that, because it only guards the repository.
Two things do:

- `npm run build:deploy` deletes `dist/sounds` after vite copies it in.
- `deploy/.assetsignore` tells wrangler never to upload a `sounds/` directory,
  which catches a deploy from a `dist/` some earlier `npm run build` left
  behind.

`src/sounds.js` already treats a missing manifest as "stay quiet", so the
deployed site degrades to silence rather than throwing. It also means the
deployed site is a voxel world where nothing makes a sound, which for a
three-minute visit is a real loss — footsteps are most of why moving through
it feels physical.

The same root cause makes the test suite unable to pass on a clean checkout.
`test/12-sounds.spec.js` arms an audio harness against a manifest that is not
there; a fresh clone runs 98 passed, 1 failed, 10 did not run. CI therefore
skips that one file and says so in the log. Both the skip and the silence
disappear together.

### Recommendation: take VoxeLibre's sound set

Of the options investigated — commit a CC0/CC-BY set, ship silent and say so,
or synthesise something — committing a real set wins, and the one to take is
**VoxeLibre's `mcl_sounds`** (`github.com/VoxeLibre/VoxeLibre`, 77 `.ogg`
files, 898KB, already Vorbis and already cut to game length). VoxeLibre is the
project formerly called MineClone2, and its textures descend from the same
Pixel Perfection lineage this repo already ships, so the sonic character and
the licence posture both already match.

The deciding factor is not coverage, it is paperwork.
`mods/CORE/mcl_sounds/README.txt` maps **every single file** to a named author,
a licence and a source URL. Minetest's own `default` mod has near-identical
audio under the same licences and gives no file-to-author mapping at all —
which would mean writing a NOTICE.txt that says "some of these are CC BY 3.0
by one of these seven people", and this repo does not do attribution that way.
The licences are a mix of CC0, CC BY 3.0 and CC BY-SA 3.0; the footstep core is
ShareAlike, which is the same obligation `public/textures/NOTICE.txt` already
carries, so it costs nothing new.

Three gaps, all fillable from **Kenney** (kenney.nl, CC0, attribution
genuinely optional):

- Player hurt. VoxeLibre has one sample where `sounds.js` wants three. Take
  two more from qubodup's CC0 vocal pack on OpenGameArt.
- UI click. VoxeLibre has none; Kenney's Interface Sounds has `click_001.ogg`
  at 6KB.
- Snow footsteps. VoxeLibre's are credited to "Unknown authors", which is
  exactly the kind of provenance this repo has refused elsewhere. Kenney's
  `footstep_snow_000-004` replaces them with something actually traceable.

Rejected: **Sonniss's GDC bundles**, whose licence is royalty-free but
explicitly forbids redistributing the sounds as standalone files, which is
precisely what a public repo of `.ogg`s and a web server handing them to
browsers does. **Curating Freesound directly**, because licences there are
per-sample and include CC BY-NC — hours of work to reproduce the manifest
VoxeLibre already wrote. **Terasology and Craft**: nineteen dig sounds and no
footsteps, and no audio at all, respectively.

This is left unimplemented deliberately. It needs a `sounds-src/` committed
alongside `textures-src/`, and `scripts/build-sounds.mjs` growing a
`--source=free` path next to its Minecraft extraction the way
`build-textures.mjs` already has `ce` and `vanilla` — and that script belongs
to someone else right now. The Minecraft extraction should stay: it is the
higher-fidelity local developer build, exactly as `textures:vanilla` is.

## Is the 1.24MB bundle a problem

No, and code splitting would make it worse.

310KB gzipped is roughly one large photograph. The site is a game: it cannot
show anything until Babylon, noa, the whole block table and the meshing code
are all present, and then it spends longer generating and meshing an 80x80x64
island than it ever spent downloading. Splitting that into chunks would add
round trips to arrive at the same total, later. The only genuinely deferrable
thing is the inventory and crafting UI, which is DOM and small; the 1.2MB is
the engine, and the engine is not optional.

What would actually help, if the entry screen ever feels slow, is a
`<link rel="preload">` for the atlases so the texture fetch overlaps the
bundle parse rather than following it. That is a change to `index.html`, and
it is worth measuring before doing.

Vite's 500KB warning is a default threshold, not a finding.

## Cache headers

Workers serves static assets with `Cache-Control: public, max-age=0,
must-revalidate`, which is safe and expensive: a returning visitor makes about
900 conditional requests before the world can boot, and almost every one of
those files is a few hundred bytes, so the round trips cost far more than the
bytes. `deploy/_headers` fixes that, and the interesting part is where it
*does not* apply `immutable`.

`/assets/*` and `/fonts/*` get a year and `immutable`. Vite writes a content
hash into bundle filenames, so those URLs change whenever the bytes do, and
Monocraft is a pinned third-party file.

`/textures/*`, `/ui/*` and `/skins/*` get one day and no `immutable`, and this
is the subtle one. Those names come out of `public/` verbatim, so `atlas0.png`
is a permanent URL whose contents change every time the block palette does —
and an atlas layer index *is* a block identity, so a stale atlas does not look
slightly old, it draws the wrong blocks. A day is long enough to skip
revalidation across a visit and short enough that a palette change cannot
haunt anyone. The real fix is content-hashed atlas filenames out of
`build-textures.mjs`, at which point they move up to join `/assets/*`.

`index.html` stays on the revalidate default, because it is what points at
every hashed bundle: caching it is caching the whole deploy.

## What is in `public/`, and whether any of it is a surprise

Nothing is. The deployed tree is 917 files:

| | |
|---|---|
| `index.html` | 13.8KB, carries the CC-BY-SA attribution the licence requires |
| `assets/index-*.js` | 1.24MB, the bundle |
| `textures/` | 437 PNGs, 5 atlas pages, 355 held-item strips, 96 item sprites |
| `ui/` | 22 HUD and container sprites |
| `fonts/` | Monocraft.ttf and its OFL text |
| `skins/` | one default player skin |
| `EvanJolley_Resume.pdf` | 88KB, public on purpose |

The resume is the only file that is personal, and it is the point. There are
no `.map` files (vite does not emit them here), no `.env`, no dotfiles, and
the local `sounds/` is stripped by the deploy build for the reasons above.

One loose end worth someone's attention, though it is not a deployment
problem: `README.md` points at `public/textures/NOTICE.txt` and the CE build
does not actually emit it. The licence is still satisfied, because the
attribution is on the entry overlay in `index.html`, which is where a visitor
sees it — but the file the README names is not in `dist/`.

## Going live

Assume a Cloudflare account and nothing else. Two paths, and the fork is about
DNS rather than about the Worker.

### The part that is the same either way

    npm install -g wrangler        # or skip it; the npm scripts use npx
    npx wrangler login             # opens a browser, authorises this machine

Then, from the repo:

    npm run deploy:dry-run         # builds and validates without publishing
    npm run deploy                 # publishes

That second command is the whole of going live. It creates a Worker called
`world` and serves it at `world.<your-subdomain>.workers.dev`, which needs no
DNS at all and is a real shareable URL. If the goal is to look at the thing on
the internet before deciding anything about domains, stop here.

### Then, the domain — and this is a decision, not a step

`world.evanjolley.com` **cannot be attached without moving evanjolley.com's
DNS to Cloudflare.** A Workers custom domain requires the zone to be on
Cloudflare, and evanjolley.com is on GoDaddy's nameservers today
(`ns69`/`ns70.domaincontrol.com`) with the four GitHub Pages A records and a
`www` CNAME. Cloudflare only sells subdomain-only zones on Enterprise, so
there is no way to hand it just `world.` and leave the rest alone.

This was worth finding before rather than during. The brief for this work said
evanjolley.com must not be touched, and the honest answer is that it has to be
touched a little:

1. Add `evanjolley.com` in the Cloudflare dashboard. Cloudflare scans the
   existing zone and imports the records. **Check the four A records and the
   `www` CNAME came across before continuing** — the scan is good, not
   perfect, and this is the step where the portfolio site could break.
2. Set those GitHub Pages records to **DNS-only** (grey cloud, not orange).
   Proxying GitHub Pages through Cloudflare works, but it changes how TLS and
   caching behave on a site that is fine today, and there is no reason to
   accept that risk as a side effect of deploying something else.
3. Change the nameservers at GoDaddy to the two Cloudflare gives you.
   Propagation is usually under an hour. evanjolley.com keeps resolving to the
   same GitHub Pages IPs throughout.
4. Uncomment the `[[routes]]` block in `wrangler.toml` and run `npm run
   deploy`. Wrangler creates the `world.evanjolley.com` record itself; there
   is no DNS record to add by hand.

It is reversible — the nameservers can go back to GoDaddy — and the blast
radius is one zone whose records do not change. But it is a change to the
thing that serves evanjolley.com, so it is Evan's to make, not an agent's.

The alternative, if that trade is unattractive: leave the zone where it is and
live on the `workers.dev` URL. Everything works; the address is just uglier.

### Turning on automatic deploys

The workflow deploys on push to `main` and cannot fire until two repository
secrets exist. In **Settings → Secrets and variables → Actions → New
repository secret** on `evanjolley/minecraft-resume-world`:

- `CLOUDFLARE_API_TOKEN` — from **My Profile → API Tokens → Create Token** in
  the Cloudflare dashboard. The **Edit Cloudflare Workers** template is the
  right one. Scope it to the one account, not to all of them.
- `CLOUDFLARE_ACCOUNT_ID` — on the right-hand side of the Workers & Pages
  overview page.

Until `CLOUDFLARE_API_TOKEN` is non-empty, the workflow runs everything up to
and including `wrangler deploy --dry-run` and then logs a notice saying it
skipped the deploy. That ordering is deliberate: the pipeline gets exercised
on every push for as long as it takes Evan to decide, so the first real deploy
is not also the first time any of it ran.

Rejected: `cloudflare/wrangler-action`. It is maintained and fine, but its
only real convenience is installing wrangler, which `npx` does anyway, and it
is one more third party holding a token that can publish to Evan's account.

Also rejected: adding wrangler to `devDependencies`. It would pin the version
properly, which is the better answer eventually — but it rewrites
`package-lock.json`, and two other agents are rebasing on this branch right
now. `npx --yes wrangler@4` pins the major version and touches nothing.

## Verified

From a clean `git clone` of `main` into an empty directory, on Node 24:

- `npm ci` — 94 packages, 3s. Its `postinstall` hook runs
  `build-textures.mjs --ensure`, so the 437 textures, 5 atlas pages, 355
  held-item strips, 96 item sprites, 22 UI sprites and the default skin all
  exist before anything asks for them. The ordering the CI build depends on
  is not something the workflow arranges; it is already true.
- `npm run textures` — 428 textures decoded, 95 substituted, 5 biome-tinted,
  0.9s.
- `vite build` — 380 modules, 343ms, `dist/assets/index-*.js` at 1,238,259
  bytes (310KB gzipped).
- `dist/` — **917 files, 1,928,929 bytes.** All five atlas pages present,
  `fonts/Monocraft.ttf` present, all 22 UI sprites present, no `dist/sounds`
  (the clean checkout has no Minecraft install to extract from).
- `npm run test` — 97 of 109 pass; the 12 in `test/12-sounds.spec.js` are
  skipped for the reason above.
- `wrangler deploy --dry-run` — config parses, asset directory resolves,
  993 entries read, no bindings. Nothing was uploaded and no account was
  authenticated.

Still true: nothing is live, and going live is Evan's call.


## Open: which domain (undecided, deliberately)

Not deployed yet, and the domain is unchosen. The thing that makes this less
obvious than it looks:

**`evanjolley.com` and `world.evanjolley.com` cost the same DNS work.**
Cloudflare needs the whole zone for any custom domain, apex included, so
dropping the subdomain does not avoid the GoDaddy migration. The only option
that avoids DNS entirely is the free `workers.dev` URL, which is a real
shareable link and needs nothing.

And `evanjolley.com` is not free real estate: it currently serves a 13.6MB
portfolio from GitHub Pages. Pointing the apex at this Worker replaces that
site. That may well be the intent one day — the world becoming the portfolio
rather than sitting beside it — but it is a bigger decision than picking a
host, and it should be made on purpose.

A third option exists and is the best end state if the answer is "both":
serve the portfolio at the apex and the world at `evanjolley.com/world` via a
Cloudflare route. It needs app changes — Vite has no `base` set and roughly
seven files hardcode absolute asset paths like `/textures/...` — so it is the
most work, not the least.

Recommendation while the island is still empty: `workers.dev`. Deciding the
domain is cheap later and the choice is reversible; replacing a working
portfolio with an empty island is neither.
