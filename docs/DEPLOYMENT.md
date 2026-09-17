# Deployment

**Decision: Cloudflare Workers with static assets.** Not Pages, not Vercel, not
GitHub Pages. Reasoning below, because the obvious reason is not the real one.

## The static hosting is not the deciding factor

The built site is a bundle of 1.27MB (313KB gzipped) plus roughly a thousand
small files -- textures, UI sprites, fonts, 42 sound samples. The 917-file /
1.84MB figure this file used to quote predates both the committed sound set
and the terrain asset and is no longer the number; re-measure with
`npm run build:deploy` before quoting one. An earlier draft said ~4.5MB of
assets, which came from `du` reporting allocated blocks; most of these files
are 200-byte PNGs and `du` rounds every one of them up to 4KB. Either way
every candidate serves it for free without noticing. If static hosting were
all this needed, GitHub Pages would do and the question would be boring.

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
- `.github/workflows/deploy.yml` — a fast build-and-smoke job on every push to
  `main`, and the full pipeline (package, whole suite, then deploy) on a tag or
  a manual dispatch. See "What CI actually runs, and when" below.
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

### What was left, and is not left any more

This section used to list four lines in three files that still had to change
before a deploy could carry audio. All four have. `build:deploy` now pins
`npm run sounds:free` and no longer deletes `dist/sounds`;
`deploy/.assetsignore` no longer blanket-refuses a `sounds/` directory; the
workflow's verify step defers to `scripts/check-deploy-assets.mjs`, which
asserts `dist/sounds/.source` reads `free`; and the `--grep-invert 12-sounds`
exclusion is gone, so CI runs the sound spec like any other.

The lock moved rather than disappearing, and it is stronger where it landed.
Refusing a directory passed quietly both for a Mojang-sourced build and for a
silent one. Asserting the marker fails on either. `src/sounds.js` still treats
a missing manifest as "stay quiet", so a partial build degrades rather than
breaking.

### Coverage, honestly

The free set is 42 files and 402KB committed, producing 42 samples and 441KB
built. Vanilla now produces 149, across 14 families rather than 6 -- the block
-> SoundType mapping in `src/sounds.js` stopped being four rows and a stone
default, and the vanilla build grew the eight families the terrain is actually
made of (deepslate, tuff, moss, sculk, calcite, amethyst, basalt, plus wool).
Where the two sets differ, on the six families they share:

| | vanilla | free |
|---|---|---|
| `step` variants | 6/6/6/4/5/4 | 3/3/2/4/3/4 |
| `dig` variants | 4 per group | 3/3/3/3/2/4 |
| `hurt` | 3 samples | **1** |
| everything else | 1 each | 1 each |

**The free set did not shrink and did not change what it plays.** The eight new
families exist only in a vanilla build; a block mapped to one the build did not
produce resolves through `SOUND_GROUPS`' `from` chain to the nearest family
that it did, and the build fails if any family cannot reach one. So a free
deploy still plays six families and still sounds as it did -- minus the bug it
shared with vanilla, where leaves, logs, moss and packed ice all played stone.
Only the SAMPLES fall back; the volume and pitch stay with the mapped family,
which is why an iron block rings rather than thudding.

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

313KB gzipped is roughly one large photograph. The site is a game: it cannot
show anything until Babylon, noa, the whole block table and the meshing code
are all present, and then it spends longer decoding and meshing the terrain
patch than it ever spent downloading the code. Splitting that into chunks would add
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

Nothing is. The file counts below were taken before the sound set and the
terrain asset existed and are indicative rather than current; the shape is
what matters:

| | |
|---|---|
| `index.html` | ~16KB. It does NOT carry the CC-BY-SA attribution, contrary to what this table used to say |
| `assets/index-*.js` | 1.27MB, the bundle |
| `textures/` | 437 PNGs, 5 atlas pages, 355 held-item strips, 96 item sprites |
| `ui/` | 22 HUD and container sprites |
| `fonts/` | Monocraft.ttf and its OFL text |
| `skins/` | one default player skin |
| `sounds/` | 42 `.ogg`, 441KB, plus `NOTICE.txt` |
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

That loose end is closed, and the paragraph here that used to claim otherwise
was wrong twice over. `build-textures.mjs` does emit `NOTICE.txt` on a CE
build (`fromCE()` copies it out of `textures-src/ce/`), and `build:deploy`
pins CE, so the file the README names IS in `dist/`. A `--source=vanilla`
build does not emit it, which is why a developer's `public/textures/` may not
have one; that is correct, since there is nothing to attribute.

What is NOT true, and this file asserted it: there is no attribution on an
entry overlay in `index.html`. Checked -- the only mention of a licence in
that file is a CSS comment about Monocraft, which no visitor sees. The NOTICE
files ship and nothing points at them, so the credits surface in
`docs/FUTURE.md` is a genuine prerequisite for going live rather than a
nicety.

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

Until `CLOUDFLARE_API_TOKEN` is non-empty, a dispatch runs everything up to and
including `wrangler deploy --dry-run` and then logs a notice saying it skipped
the deploy. That ordering is deliberate: the pipeline gets exercised before
anything is published, so the first real deploy is not also the first time any
of it ran.

**The secret alone is not enough, and this is the one surprise in here.** The
`publish` job runs `npm run prompt`, not `npm run prompt:ci`, so it needs
`corpus/` — which is gitignored and will never be on a runner, because it is
Evan's personal data and this repo is public. So a deploy *from CI* fails at
that step even with the token in place, deliberately and with a message
pointing at `corpus/README.md`.

The path that works today is `npm run deploy` from Evan's machine, where
`corpus/` lives. Three ways to change that, in increasing order of how much
they give away:

1. Leave it. CI proves the pipeline; Evan runs the one command that publishes.
2. Put the corpus in a repository secret and write it out in `publish`. It
   never lands in the repo, but GitHub then holds it.
3. Deploy the Worker without a corpus. The stub prompt already makes this
   safe rather than embarrassing — `worker/index.js` refuses to answer when it
   sees `IS_STUB` — but the site ships with AI Evan turned off.

## What CI actually runs, and when

`.github/workflows/deploy.yml` used to run all of it on every push. That was
right when pushes were rare and wrong once they were not: the whole ~900-test
suite across two engines is a two-hour answer to an eight-second question, and
`cancel-in-progress` meant most runs were killed by the next commit before
producing any answer at all.

| Trigger | Jobs | Roughly |
| --- | --- | --- |
| push to `main` | `smoke` — `npm run build` + `npm run smoke` | minutes |
| tag `v*`, or manual dispatch | `package` ∥ `suite`, then `publish` | hours |

`npm run smoke` is `test/01-world.spec.js` + `test/43-browsers.spec.js` on
chromium. That pair exists because a shader that failed to compile once
shipped an invisible world past three agents reporting green — it catches the
failure that is both catastrophic and invisible in a diff, and it is the one
worth paying for on every commit.

`package` and `suite` run in parallel and neither needs the other, so
`build:deploy` breakage now surfaces in about three minutes rather than behind
two hours of tests. Nothing publishes unless both are green.

### Why CI could never pass at all until now

Worth recording, because the fix looks like a workaround and is not. Every run
since the AI Evan worker landed failed about four seconds in:

```
Error: Cannot find module '.../worker/prompt.generated.js'
  imported from .../worker/index.js
```

`worker/index.js` imports the generated prompt at module load;
`test/55-ai-evan-brain.spec.js` imports the Worker; the generated prompt is
built from `corpus/` and both are gitignored. So Playwright could not collect
the spec, and no arrangement of the workflow was ever going to fix that — it
was structural, not flaky.

CI now runs `npm run prompt:ci` (`build-prompt.mjs --allow-stub`), which
writes an obviously-fake prompt **only** when `corpus/` is absent. With the
corpus present the flag does nothing and you get the real prompt and the real
tests, so a developer's run is unchanged. The stub sets `IS_STUB`, and
`worker/index.js` declines every request when it sees it, which is what keeps
"a stub must never reach a visitor" true rather than hoped for. The header of
`scripts/build-prompt.mjs` carries the full argument and what was rejected.

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
- `vite build` — `dist/assets/index-*.js` at 1,274,145 bytes (313KB gzipped),
  measured at `dfee897`. The 1,238,259 / 310KB this used to quote was taken
  before water, lava and the terrain decoder landed.
- `dist/` — all five atlas pages present, `fonts/Monocraft.ttf` present, all
  22 UI sprites present. The 917-file, 1,928,929-byte figure predates both
  `dist/sounds/` and the terrain work; re-measure rather than quote it.
- `npm run test` — the whole suite, `test/12-sounds.spec.js` included. That
  file could not run at all before the free sound set existed. 215 tests
  across 20 spec files at `4db014f`.
- `wrangler deploy --dry-run` — config parses, asset directory resolves,
  993 entries read, no bindings. Nothing was uploaded and no account was
  authenticated.

Still true: nothing is live, and going live is Evan's call.


## Sound: resolved

The deployed site is no longer silent. `npm run sounds:free` builds a
committed CC0 / CC BY / CC BY-SA set (`sounds-src/free`, 402KB), it is what
`build:deploy` pins, and the Minecraft extraction is still available locally
as `npm run sounds:vanilla`. Plain `npm run sounds` names no source and
rebuilds whatever is installed, which is the rule described two sections
above -- an earlier version of this paragraph said it "defaults to" the free
set, and that would have been the exact footgun that rule exists to prevent.

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

## Open: is generated terrain redistributable? (blocks deployment)

**This is unresolved, and until it resolves the terrain data does not ship.**
`public/terrain/` is gitignored and `dist/` must not carry it. That default is
a choice made in the absence of an answer, not an answer.

### Why this is not the textures question again

The textures rule is settled and easy: Mojang's PNGs are Mojang's artwork,
copying them into a public repo is redistribution, so the build keeps them
untracked and offers a CC-licensed alternative. Same for the audio.

The terrain data is a different shape. Nobody at Mojang drew this hillside.
It is the **output of running their world generator** on a seed — closer to
the output of a compiler than to an art asset. The familiar analogy is that
the output of GCC is not covered by GCC's licence, and that instinct says
this is fine.

The instinct is not evidence, and there are at least three reasons to be
careful before acting on it:

- **The output is not independent of the program.** A compiler's output is
  mostly a transformation of input the user wrote. Here the "input" is a
  64-bit number and *everything* interesting in the output — the shape of the
  mountain, where the biomes meet — comes from Mojang's code. That is much
  closer to generated content than to a transformation.
- **Block names and the palette are Mojang's vocabulary.** The manifest lists
  `minecraft:`-derived keys. Probably de minimis, but it is a second thing
  being copied, not zero things.
- **The EULA is not the usual open-source licence, and it talks about what
  you may do with things you make using the game.** Whether a generated
  region file is one of those things is exactly the question, and reading the
  EULA to find out is a job for someone willing to be accountable for the
  reading. This file is not that.

### What the honest positions are

- **Conservative**, and the current default: treat generated terrain like the
  textures. Keep it local, keep it out of the deploy, and give the public
  build a world of its own -- either by restoring the hand-generated island,
  which now exists only in git history since `src/island.js` was rewritten as
  a lookup, or by writing an original generator. Costs the realism that
  motivated the whole exercise, and costs real work rather than a flag.
- **Permissive**: publish it, on the compiler-output reasoning, and accept
  that the reasoning is untested. Cheap and probably fine and definitely not
  verified.
- **Sidestep entirely**, and worth more thought than it first gets: ship the
  *seed and the extractor* rather than the blocks, and generate on the
  visitor's machine. This fails for this project — it needs a JVM — but the
  general move (ship the recipe, not the dish) is what an original generator
  tuned to look like the scored patch would be, and that has no licensing
  question at all.

### What would actually settle it

Someone reading the current Minecraft EULA and the Commercial Usage
Guidelines against this specific use — a non-commercial personal portfolio
serving a 128x128 region of generated blocks, no Mojang textures, no Mojang
code. That is a decision with a named owner, and it is Evan's, not this
build's.

Until then the gate is: **`dist/` must not contain `terrain/`**, and it is
enforced rather than intended. `scripts/check-deploy-assets.mjs` fails the
build if `dist/terrain/` exists, alongside the two `.source` marker checks;
`build:deploy` deletes it; `deploy/.assetsignore` refuses to upload it; and
`public/terrain/` is gitignored. Four locks, because vite copies `public/`
into `dist/` wholesale and this data reached the deploy artifact once already
without ever being committed.

The practical consequence, which belongs here rather than in `FUTURE.md`:
until this resolves, a deployed build has no terrain to load, and
`src/island.js` throws rather than serving an empty world. So this question
does not merely delay a nicety -- it is the reason there is nothing to
deploy.

## Open: may Evan's cape be served? (does not block deployment)

**Unresolved.** The NPC wears Evan's real Minecraft appearance, fetched from
Mojang's session server for his own account and committed under
`skins-src/jollyboys/` with its provenance. Two files, two different
questions:

- **`skin.png`** is his, in the ordinary sense that a player's skin is the
  player's. It ships.
- **`cape.png`** is not. A cape is Mojang artwork *granted* to an account —
  MineCon, a migration, a partner drop. Owning the right to wear it in the
  game is not the right to serve the PNG off a website. That is the textures
  question again, and this repo answers that one conservatively.

Nobody has ruled on it, and this file is not ruling on it either. What has
been done instead is to make the answer cheap in both directions:

`scripts/build-textures.mjs --no-cape` emits the skin and no cape image, and
`build:deploy` passes it. A build made that way is not a degraded one — the
cape is optional art in `playerModel.js`, and when its image does not load
`attachCape` removes itself and leaves a correct, capeless Evan. That path
is exercised by `test/22-evan-skin.spec.js`, not merely available.

The gate is: **`dist/skins/evan-cape.png` must not exist**, enforced in
`scripts/check-deploy-assets.mjs` for the same reason the terrain gate is
enforced rather than intended — `public/skins/` is a developer's working
state, it is allowed to hold the cape, and vite copies `public/` into `dist/`
wholesale.

If Evan decides it may ship, the change is one flag in one npm script and one
line in the checker. If he decides it may not, nothing changes.
