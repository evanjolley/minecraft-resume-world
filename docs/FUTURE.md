# Future builds

Everything here is secondary to one fact: **the island is empty.** The engine
is in good shape and getting better. None of that is what a visitor came for.
They came to find out who Evan is, and right now the world cannot tell them.

## Already built

Minecraft-accurate physics, survival HUD and inventory from Minecraft's own
sprites, mining and placing, day/night on Minecraft's clock, a skinned player
model with F5 perspectives and crouch, chat, block and damage sounds,
break/landing/sprint particles, rain and thunder, Fancy 3D clouds, a 355-block palette on a paged
texture atlas, slabs and stairs for 28 material families with real sub-voxel
collision,
oak trees, game modes behind an OP-gated authority, an item model with crafting
(2x2 and 3x3), armor and an offhand, and a 109-test browser suite.

Nothing is in flight.

## Next, in the order I'd take them

Roughly ascending in how much they depend on a decision from Evan.

1. **Ore drops.** Ores still drop themselves rather than coal, diamond and
   lapis — which is silk-touch behaviour. Needs an ore-to-item table in
   `blocks.js`. Small, and conspicuous once you mine one.
2. **The pickup sound** is currently the UI click pitched up, because
   `random/pop` is not extracted. `sounds.js` already has a `fallback` field
   that the manifest overrides automatically the day `pickup: ['random/pop']`
   is added to `build-sounds.mjs`.
3. **Connected non-cube blocks** — fences, walls, panes, bars, and stair
   corner shapes. Slabs and stairs shipped; these did not, and the reason is
   structural rather than a matter of effort. noa draws a custom block mesh as
   a thin instance, so every voxel of a block id shares one geometry and can
   only differ by a transform — and a fence post with two arms is not a
   transform of one with three. The three ways out are written up at the
   bottom of `src/blockMeshes.js`; the least bad is a parallel instanced-mesh
   system driven off the registry's onSet/onUnset hooks, which has to
   reimplement noa's origin rebasing because noa offers no hook to shift our
   matrices when it shifts its own.
4. **Shift-click in the inventory**, both senses: move a stack to the other
   container, and craft as many as fit. Its absence is felt immediately by
   anyone who has played.
6. **Deployment** — platform decided, see `docs/DEPLOYMENT.md`. Then
   **content**, then **video screens** and
   **multiplayer** — see Sequencing below. These are the ones that need Evan,
   not more engine work.

## Sequencing

1. **Content on the island.** Blocked on nothing technical. This is the gap.
2. **Deployment.** There is still no hosting config. Nothing is live, so no
   visitor has ever seen any of this.
3. **Video screens.** The richest way to deliver the content, and independent
   of everything else.
4. **An AI version of Evan, in the world, that visitors can talk to and book
   time with.** See section 2. This displaced multiplayer.
5. **Skin customization**, then the long tail. Multiplayer is no longer near
   the top; the reasoning is in section 2b.

The ordering rule: anything that makes the world worth visiting beats anything
that makes it more elaborate. Engine polish has been the easy, fun work; it is
not the work that makes the site do its job.

The numbered sections below are detail, not priority — read the sequencing
above for order. Keep this file honest: when something ships it moves up to
"Already built" and its section goes, and anything deferred lands in
"Blocked" with the reason rather than being quietly dropped.

---

## 1. Video screens with proximity audio

Play recorded clips on block faces — a wall of black wool becomes a screen —
with volume rising as you approach.

**Implementation.** Babylon's `VideoTexture` wraps an HTML `<video>` element
and can be used as a material texture on any mesh, so a screen is a flat quad
placed against a block face with that material. Register it through
`noa.rendering.addMeshToScene`, like everything else here, or noa's selection
octree will silently never draw it.

For audio, route through Web Audio rather than setting `video.volume` per
tick: `createMediaElementSource(videoEl)` → `PannerNode` → destination. A
panner gives real positional audio — it attenuates with distance *and* pans
between ears as you walk around the screen — with the falloff handled by
`distanceModel`, `refDistance`, `rolloffFactor` and `maxDistance` instead of
hand-rolled math. Feed the listener position from the camera each frame.

Road not taken: manual `video.volume` from a distance calculation. Simpler,
but flat mono — you lose the directional cue that makes a space feel real,
which is most of the point.

**Gotchas.**

- **Autoplay is blocked.** Browsers refuse to start audible media without a
  user gesture. This world already needs a first click to capture the mouse —
  start videos muted and unmute on that click.
- **Decode cost is the real budget.** Each playing video decodes continuously,
  and several 1080p streams will cost more than the entire voxel renderer.
  `pause()` anything out of range and only `play()` on approach. 720p is
  plenty on a block face.
- **Don't put video in the repo.** Host on Cloudflare Stream or R2. A handful
  of clips will dwarf all the code.
- **Sync across viewers** (everyone seeing the same frame) needs a shared
  clock. Skip it — let each visitor's playback be independent.

**Effort.** ~1–2 days for the first screen done properly, then near-zero per
additional screen. The real cost is recording and editing the clips.

---

## 1b. Identity: login, guests and nicknames

Evan's sketch, and the shape the rest should assume:

A visitor arrives and either logs in, or continues as a guest with a
**nickname**, then spawns into the world under that name. Separately there is a
fast path — click straight through to the resume without entering the world at
all, for someone who wants the document and not the game.

That fast path matters more than it sounds. It is the honest answer to "this is
a lovely toy but I just want to know where he worked", and having it means the
world never has to apologise for being a world.

**This is where `/op` gets fixed.** Today `/op <passphrase>` squats on
Minecraft's name for a different idea: vanilla's `/op <username>` grants
operator to someone ELSE and presupposes you already are one. Vanilla's real
bootstrap is the server console, which a static site does not have — hence the
passphrase. When identity lands, split them:

- `/login <passphrase>` — the console-equivalent bootstrap, owner only.
- `/op <username>` and `/deop <username>` — vanilla's meaning, which only
  becomes meaningful once other players exist.

Deliberately deferred rather than renamed now, because the rename is free once
usernames exist and premature otherwise.

**Nicknames are a moderation surface**, the same as chat: a free-text name
displayed to strangers on Evan's domain. Either a generated name, or a filtered
one, decided before it ships rather than after.

---

## 1c. Persistence: a world that stays changed

Break a block, leave, come back, it is still broken. Technically small, and the
codebase is already shaped for it — but it forces a product decision first.

**Store the DIFF, not the world.** The island is 80x80x64 = 409,600 blocks, and
storing all of it would be absurd. It does not need storing: `island.js` is a
pure function of position, so the base world regenerates byte-identically on
every load, for free. Only blocks that DIFFER from generation need recording —
a few thousand for an authored island, each a coordinate and an id.

That is what the pure-function discipline in `island.js` has been buying all
along, and it is worth not breaking: the moment generation depends on hidden
state, the base world stops being reproducible and the whole diff trick dies.

A Durable Object gets 10GB of SQLite, free-plan storage is not charged, and the
room object that holds the multiplayer state is the natural owner of the diff.
`authority.requestBlockChange` is already the single place a block changes, so
persistence hooks there and nowhere else.

**DECIDED: a sandbox area.** One bounded region anyone may build in; the rest
of the island protected. Visitors get to do something rather than walk through
a museum, and the resume content cannot be touched.

`requestBlockChange` already receives the position, so it is one bounds test in
one place — and it can ship BEFORE multiplayer, since it changes what adventure
mode permits in the current single-player world too.

Rejected: owner-only building (safe, but visitors can only look), and
per-visitor diffs (nobody can ruin anything, but nobody can show anyone
anything either — which throws away the reason to have other people present).

Two sub-decisions still open:

- **Where, and how is it marked?** A visitor must be able to tell at a glance
  where they may build. Fenced, or a different floor material, or simply set
  apart from the resume plots. Undecided because it depends on the island
  layout, which does not exist yet.
- **Shared or per-visitor, WITHIN the sandbox?** This is the moderation
  question, and it does not go away by being confined. A shared persistent
  sandbox on a personal domain will eventually contain something obscene —
  that is not pessimism, it is what happens. Options: per-visitor diffs inside
  the sandbox (no moderation surface at all, but you cannot see each other's
  builds), shared with an automatic daily reset (honest, self-limiting, and a
  sign can say so), or shared and permanent with a `/fill` to clear it, which
  means noticing.

Recommendation: shared with a daily reset. It keeps the point of multiplayer —
seeing what someone else made — while capping how long anything bad survives,
and it needs no judgement calls from Evan.

---

## 2. AI Evan: an agent in the world

A character standing in the world that visitors can talk to — answering
questions about Evan's work, and **booking time with him**. Not a chatbot
beside the game: a thing you walk up to.

### Why this displaced multiplayer

Multiplayer has an empty-room problem no engineering fixes. Traffic here is a
handful of visitors a day, so the probability two are in the world in the same
moment is near zero. The feature's value scales with concurrency and the
concurrency is one — a shared world where everyone is alone.

AI Evan is there for every visitor, every time. And it serves the site's actual
purpose, which multiplayer never does: multiplayer is spectacle standing next
to a resume, while this **is** the resume, in the one form someone might
actually engage with. People who would never open a CV will ask a question.

### The MVP is much smaller than "AI agents controlling NPCs"

No pathfinding, no navigation, no autonomy. A character standing in one place,
proximity to start a conversation, chat wired to a model call through the
Worker. A Minecraft Evan standing at his own resume plot is a stronger image
than one wandering around, and it skips the single hardest piece (A* over a
voxel grid with jump and fall costs).

Most of the body already exists: `playerModel.js` is a factory, `poseModel()`
takes explicit state rather than reading the player, and the skin is one
swappable material. An NPC is that model with no keyboard attached.

### Tools, which is what makes it an agent rather than a chatbot

- **Answer questions** about Evan's work, grounded in real content.
- **Check availability and book a meeting.** This is the one that makes it
  real — a visitor leaves with a calendar invite rather than an impression.
  Cal.com is the obvious backend: purpose-built, has an API, and already
  handles timezones, availability and confirmations, none of which are worth
  rebuilding. Google Calendar directly is the alternative and means owning
  OAuth for no benefit.
- **Point at things in the world** — walk a visitor to a plot, or just
  highlight it. Cheap, and it ties the agent to the space.

The Worker holds the keys and runs the tool loop. Nothing model-facing can live
in the bundle.

### What will actually be hard

- **Grounding.** A vague AI Evan is worse than none — it reads as a gimmick
  that dodges questions. It needs real career detail to draw on, which is the
  same content gap blocking everything else on this list.
- **Hallucinating a job he never had** is the failure that matters. This
  speaks as Evan, on Evan's domain, to people evaluating him. Bounds on what it
  will claim are not optional.
- **Prompt injection.** Visitors will try to make it say things. Assume that
  from the first line of the system prompt, not after someone screenshots it.
- **Booking abuse.** Anyone can book. Rate limits, and probably an email
  confirmation step before anything reaches the real calendar.
- **Latency is the design problem, not the model.** A character that pauses
  three seconds before replying reads as broken. Idle animation, a typing
  indicator in Minecraft's own chat style, and acknowledgement have to cover it.
- **Cost per visitor.** Model calls with a tool loop are not free. Cap it.

### Prerequisites

The Worker (shared with everything else), then content to ground it. Nothing
should start before the island has something on it — an agent with nothing to
talk about is a demo of an agent.

---

## 2b. Multiplayer presence

Concurrent visitors seeing each other walk around.

**Demoted, not abandoned.** See section 2 for why: the value scales with
concurrency, and on a site with a handful of visitors a day two of them are
almost never in the world at the same moment. Most of the infrastructure below
gets built anyway for AI Evan — the Worker, the Durable Object, remote
characters rendered from the player model — so this becomes a smaller job
later rather than a cancelled one. Worth doing if traffic ever justifies it,
or simply because it is fun.

**Implementation.** A Cloudflare Worker fronting one Durable Object as the
room, using WebSocket hibernation so an empty room costs nothing while idle.
Clients send `{x, y, z, bodyYaw, headYaw, pitch, sneaking, swinging}` about
ten times a second; the DO fans out to everyone else.

Rendering other players is mostly plumbing: `createPlayerModel()` is already a
factory and the skin material is already shared and swappable, both written
with this in mind. `poseModel()` takes an explicit state object, so a remote
player animates through exactly the same path as the local one.

**Interpolate, don't snap.** Buffer roughly 100ms of incoming state and lerp
between the last two snapshots. At 10Hz, applying positions directly makes
everyone teleport ten times a second.

**Gotchas.**

- **Trust the clients completely.** There is nothing to cheat at. Do not build
  anti-cheat; it is pure cost here.
- **Names are a moderation surface.** Free text from strangers, displayed on
  Evan's domain next to his resume. Either no nameplates at all, or generate
  them (`Brave Badger`, `Quiet Anvil`) with no user input.
- **One room is the right architecture.** A Durable Object is single-threaded
  and one is plenty for a portfolio site. Don't shard.
- **Verify the current Durable Objects free tier** before assuming cost. It
  has changed more than once.

**Effort.** ~2–3 days. **Depends on** deployment existing.

---

## 3. Chat moderation, when chat becomes multiplayer

Chat itself is built, and commands are in flight. What is NOT built, and must
be before chat carries anyone else's words, is moderation.

Today chat is local: you are talking to yourself, so there is nothing to
police. The moment messages travel between visitors, player-to-player text on
a personal domain — attached to Evan's name, next to his resume — becomes a
liability with little upside for someone who is there for three minutes.

Before chat goes multiplayer: rate limit per connection, cap length, strip
links, and build the kill switch on day one rather than the day it's needed.

Worth considering: ship multiplayer with commands and system messages
("Evan joined the game") but WITHOUT player-to-player messaging. That keeps
the Minecraft feel and the useful half, and leaves the abuse surface closed.

---

## 3b. OP authority, and where the server takes over

`src/authority.js` is the only module that grants or denies anything. It is
written on the assumption that the client is untrusted, even though today it is
the client doing the deciding.

**What lands with the Durable Object.** `isOperator()` becomes a token check.
`/op` posts the passphrase to the room, the room holds the real secret (a
Worker env var, never in the bundle) and returns a short-lived signed token.
Every `request*` method carries it and the DO decides. The `world` adapter in
`main.js` does not change: it is how a confirmed change reaches the game, and
that is the same job whether the confirmation came from a local branch or a
socket.

**What is already correct for that world.** Nothing outside the authority calls
`noa.setBlock`, so `requestBlockChange` and `requestFill` are the only two
functions the server has to validate. `/fill` is one request rather than a loop,
because a server must validate a volume as a volume — 32768 round trips is not
something that can be made to work later. Game modes are granted rather than
assigned. Every request is a promise, so no call site assumes a synchronous
answer.

**What is not.** The passphrase constant. It ships in the bundle, devtools
reads it in ten seconds, and the localStorage key can be forged without it. The
file says so at length. The fix when multiplayer lands is not a longer string
or a hash — it is the room holding the secret.

**Do not** add anti-cheat, a login UI, or client-side crypto. The list of
things the server must refuse is short: block changes outside an allowed
region, game mode grants, and `/fill` volume. Everything else a visitor can do
affects only their own tab.

---

## 4. Skin customization

Mostly scaffolded already. `createSkinMaterial()` is called once and the
result shared by the third-person model and the first-person arm, so changing
a skin is one texture swap.

**Two routes.** Local upload of a 64×64 PNG is simplest and has no third-party
dependency. Fetching by Minecraft username via Mojang's public profile API is
the nicer experience, but it's someone else's service, it will need a Worker
proxy for CORS, and it introduces an outage you don't control — verify the
current endpoints before committing to it.

**Gotchas.** Validate dimensions (64×64, or 64×32 legacy which has a different
layout) and reject anything oversized. The slim/"Alex" model has 3px arms at
different UV offsets and needs a second mapping — `playerModel.js` currently
maps the wide layout only, and says so.

**Effort.** ~0.5 day for upload; ~1 day with username lookup.

---

## Also worth building

- **Importing real Minecraft builds.** Build in creative with WorldEdit,
  export a litematic, map block ids, paint onto the island. The authoring
  story for all the content above. No longer blocked: slabs and stairs exist,
  which is what every real build is made of. An importer has to map vanilla
  blockstates onto this table's ids — `oak_stairs[facing=east,half=bottom]`
  onto `oak_stairs_east_bottom` — and address the variants directly rather
  than through `noa.setBlock`'s placement orientation, which deliberately only
  rewrites a family's canonical id.
- **Spawn signage or a guided path.** A visitor drops into an empty field with
  no idea what to do. Even one sign at spawn changes that.
- **Mobile.** Explicitly dropped, and that's a real decision — but pointer lock
  does not exist on touch devices, so phone visitors currently get a world they
  cannot move in. A fixed camera flythrough would at least show them something.
- **Passive ambient animals.** Deliberately NOT hostile mobs (see below), but
  a couple of wandering chickens would make the island feel alive for a
  fraction of the cost. The model infrastructure now exists.

## Someday

Further out than everything above — no timeline, not costed, recorded so they
are not lost. Evan has more to add here.

### Autonomous NPCs that move

The full version of section 2: characters that walk, follow, and act rather
than standing still. The hard piece is **pathfinding** — A* over the voxel grid
with costs for jumping and falling — and it is what makes an NPC look alive or
look broken. Deliberately not in the MVP, because a stationary AI Evan gets
most of the value without it.


## Not worth building

- **Hostile mobs and combat.** Large effort, and actively harmful: a zombie
  attacking someone halfway through reading your work history is worse than no
  mobs at all. Passive animals are the version worth having.
- **Crafting.** Same. The inventory exists to hold building blocks.
- **Redstone.** No.
- **Voice chat.** WebRTC infrastructure plus the worst moderation surface
  available, for something nobody wants on a resume site.
- **Procedural or infinite world.** The island being small and deliberately
  built is the entire idea.
- **Anti-cheat.** There is nothing to protect.
