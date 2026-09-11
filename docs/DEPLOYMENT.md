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

## The sounds problem, and what is left of it

**Solved on the repository side, not yet on the deploy side.** A clean checkout
now has audio; a `wrangler deploy` still strips it. The rest of this section is
why, and the exact four lines that change it.

### What this used to say

That a deploy was silent on purpose. `public/sounds/` was built only by
`npm run sounds`, which read the asset store of a Minecraft install on the
machine it ran on: CI had no such install, and the audio was Mojang's anyway,
so publishing it from a public domain would have been redistribution. Two locks
enforced that -- `npm run build:deploy` deleted `dist/sounds`, and
`deploy/.assetsignore` told wrangler never to upload a `sounds/` directory.

### What changed

`scripts/build-sounds.mjs` grew a second source, exactly the way
`build-textures.mjs` has `ce` and `vanilla`:

    npm run sounds:free      # the committed free set, from sounds-src/free/
    npm run sounds:vanilla   # your own Minecraft install, unchanged
    npm run sounds           # neither -- rebuilds whichever is installed

Both emit the SAME logical names -- `step/grass1`, `dig/stone3`,
`damage/hit1`, `random/pop` -- because `src/sounds.js` and
`test/12-sounds.spec.js` name samples by vanilla's flat asset path and neither
was this change's to edit. The manifest is the contract; which source filled it
is an implementation detail, recorded in `public/sounds/.source` the way the
texture build records its own.

`postinstall` runs `build-sounds.mjs --ensure` alongside the texture one, so
`npm ci` on a bare runner produces 42 samples before anything asks for them.

**`test/12-sounds.spec.js` now passes on a clean checkout.** That is the half
of this the CI workflow cares about: its `--grep-invert 12-sounds` exists
solely because the suite could not produce a manifest, and that reason no
longer holds. The comment above that step in `.github/workflows/deploy.yml`
should go with it.

### The licensing, which was the whole exercise

The recommendation this file used to carry -- take VoxeLibre's `mcl_sounds` --
was checked rather than trusted, and it survived, with one correction and one
addition.

It survived for the reason given: `mods/CORE/mcl_sounds/README.txt` maps every
file to a named author, a licence and a source URL, where Minetest Game's
`default` mod ships nearly the same audio credited to a bare list of twelve
people with no mapping at all. That claim was verified against
`minetest_game/mods/default/license.txt`, which does exactly that. VoxeLibre's
`LEGAL.md` also says in as many words that its media is dual-licensed away from
the GPL that covers its code, which is the thing that has to be true before any
of the per-file licences matter.

Every per-file licence was then re-read on its own Freesound or OpenGameArt
page rather than taken from the upstream README. Two corrections came out of
that, both recorded in `sounds-src/free/NOTICE.txt`: Erdie's stone footsteps
and Benboncan's pickaxe sample read CC BY **4.0** on Freesound today where
VoxeLibre's README says 3.0, and the CC0 body-fall sample's uploader account
has since been deleted, which does not matter because a CC0 waiver cannot be
withdrawn.

**The correction: Kenney is unusable as an automated source.** This file
proposed filling the gaps from kenney.nl. That site sits behind a bot check
that hangs `curl` indefinitely, and Kenney publishes no asset repository on
GitHub. The same files are on OpenGameArt, uploaded by Kenney, CC0, and that
is where they came from instead.

**The addition: the snow rejection was right, and generalised.** VoxeLibre's
snow footsteps are credited to "Unknown authors", so they are out -- a licence
without an author is a licence nobody granted. qubodup's CC0 dry snow steps
replace them, and there are exactly four of them, which matters more than it
looks: vanilla ships one snow recording under both `step/snowN` and
`dig/snowN`, and `test/12-sounds.spec.js` asserts exactly four fingerprint
collisions and no others. The free build reproduces that property deliberately.

Also rejected, having looked: several OpenGameArt entries that list CC-BY-SA
alongside GPL 2.0/3.0 and one whose licence field reads CC0 while its own
comment thread argues it was GPL. Neither is a licence you want to be wrong
about on a public domain.

### What is left, and it is four lines in three files this change does not own

The deployed site is still silent, because every lock built for Mojang's audio
is still closed and none of them can tell the two sources apart. All four now
have a cheap test available to them: `dist/sounds/.source` reads `free` or
`vanilla`, and vite copies it into `dist/` along with `NOTICE.txt`.

1. **`package.json`, `build:deploy`.** It ends with `rm -rf dist/sounds`. The
   fix is the same shape as the line beside it: `build:deploy` already runs
   `npm run textures:ce` to force the redistributable texture source, so it
   should run `npm run sounds:free` to force the redistributable sound source,
   and drop the delete.
2. **`deploy/.assetsignore`.** Its last line is `sounds/`. It has to go, and
   the belt-and-braces it provided has to come back somewhere that can tell
   `free` from `vanilla` -- which an assetsignore file cannot.
3. **`.github/workflows/deploy.yml`, the verify step.** `test ! -d dist/sounds`
   should invert into an assertion that `dist/sounds/manifest.json` exists and
   `dist/sounds/.source` reads `free`. That is strictly stronger than the
   delete it replaces: it fails on a Mojang build AND on a silent one, where
   deleting could only ever produce silence quietly.
4. **`.github/workflows/deploy.yml`, the test step.** `--grep-invert
   12-sounds` can go.

Until (1) and (2) happen the site stays silent, and that is now a bug rather
than a policy. `src/sounds.js` still treats a missing manifest as "stay quiet",
so nothing breaks in the meantime.

### Coverage, honestly

The free set is 42 files and 402KB committed, producing 42 samples and 441KB
built. Vanilla produces 62. Where they differ:

| | vanilla | free |
|---|---|---|
| `step` variants | 6/6/6/4/5/4 | 3/3/2/4/3/4 |
| `dig` variants | 4 per group | 3/3/3/3/2/4 |
| `hurt` | 3 samples | **1** |
| everything else | 1 each | 1 each |

Fewer footstep variants is audible as more repetition and nothing worse. The
single hurt sample is the one real gap: `sounds.js` applies vanilla's
`(rand - rand) * 0.2 + 1.0` pitch spread per play, which is what keeps repeated
damage from reading as a metronome, so one sample is survivable where one flat
sample would not be. Three CC0 grunts were available and rejected -- they are a
different person's voice from VoxeLibre's hurt sound, and three samples that
are obviously two different people is worse than one repeated.

Two more substitutions worth knowing, both flagged in the build script: sand's
`dig` is gravel's, because no open pack has a sand break sound; and the GUI
click and the item-pickup blip are Kenney UI clicks, because Minetest has no
interface audio at all to borrow.

## Which asset source is installed, and the two ways it gets changed for you

Both asset builds can emit from a committed, openly licensed source or from a
local Minecraft install, and the choice is recorded in `public/textures/.source`
and `public/sounds/.source`. Everything below exists because that choice is
invisible once the build finishes -- an atlas looks like an atlas -- so it can
be replaced without anyone noticing.

`npm run textures` and `npm run sounds` name no source. They mean "build this
again", and they keep whatever is installed. Switching is `textures:ce`,
`textures:vanilla`, `sounds:free`, `sounds:vanilla` -- by name, never by
default. The plain scripts used to be the switch, and running `npm run textures`
to check an unrelated edit to the build script silently put a vanilla install
back on CE. Five seconds, no warning, and the only visible symptom is that the
world looks slightly wrong.

`npm install` is safe: postinstall runs `--ensure`, which reads the marker and
rebuilds the same source, or does nothing if the build is already complete.

**`npm run build:deploy` is NOT safe, and this is the one rough edge left.** It
pins `textures:ce` and `sounds:free` on purpose, because those are the only
sources that may be served -- and it writes them into `public/`, not just
`dist/`. So a deploy leaves a vanilla developer on CE, and the fix is to run
`npm run textures:vanilla` afterwards. Building the redistributable set straight
into `dist/` without touching `public/` would remove the edge entirely; it is
not built because nothing has ever been deployed. Worth doing before deploying
becomes routine.

`scripts/check-deploy-assets.mjs` runs last in `build:deploy` and asserts
`dist/textures/.source` is `ce` and `dist/sounds/.source` is `free`, failing the
build otherwise. The pinned flags are a convention; this is the thing that
notices when an edit breaks it. It reads `dist/` rather than `public/` on
purpose -- `public/` is a working directory and is allowed to be vanilla,
`dist/` is the artifact that ships.

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
| `sounds/` | 42 `.ogg`, 441KB, plus `NOTICE.txt` — once the four lines above change |
| `EvanJolley_Resume.pdf` | 88KB, public on purpose |

The resume is the only file that is personal, and it is the point. There are
no `.map` files (vite does not emit them here) and no `.env`. There is now one
dotfile: `sounds/.source`, which vite copies out of `public/` and which is the
thing the deploy checks should be reading.

`deploy/_headers` has no `/sounds/*` rule, so the samples fall through to the
`must-revalidate` default — 42 conditional requests on the first click of every
return visit. They belong with `/textures/*` on a day: the filenames come out
of `public/` verbatim, so `step/grass1.ogg` is a permanent URL whose contents
change if the sound source ever does.

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
- `npm run test` — the whole suite, `test/12-sounds.spec.js` included. That
  file could not run at all before the free sound set existed.
- `wrangler deploy --dry-run` — config parses, asset directory resolves,
  993 entries read, no bindings. Nothing was uploaded and no account was
  authenticated.

Still true: nothing is live, and going live is Evan's call.


## Sound: resolved

The deployed site is no longer silent. `npm run sounds` defaults to a committed
CC0 / CC BY / CC BY-SA set (`sounds-src/free`, 402KB), with the Minecraft
extraction still available locally as `npm run sounds:vanilla`.

The lock against publishing Mojang's audio **moved rather than disappeared**,
and is now stronger. It used to be "refuse to upload a sounds directory", which
quietly passed both for a Mojang build and for a silent one. The deploy
workflow now asserts `dist/sounds/.source` reads `free` — which fails on either.

Verified: `npm run build:deploy` produces `dist/` at 6.8MB with 42 samples, the
attribution NOTICE, and the marker reading `free`.

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
