# Future builds

Everything here is secondary to one fact: **the island is empty.** The engine
is in good shape and getting better. None of that is what a visitor came for.
They came to find out who Evan is, and right now the world cannot tell them.

## Already built

Minecraft-accurate physics, survival HUD and inventory from Minecraft's own
sprites, mining and placing, day/night on Minecraft's clock, a skinned player
model with F5 perspectives and crouch, chat, block sounds, break/landing/sprint
particles, a 355-block palette on a paged texture atlas, oak trees, and a
62-test browser suite.

## In flight

- Damage and death sounds.
- Gamemodes (adventure default, survival, creative, spectator), OP
  authentication, and vanilla commands — built behind a single authority seam
  so the server can take over without touching any command.
- An item model distinct from blocks, crafting (2x2 and 3x3), armor, offhand.

## Blocked, and on what

Not forgotten — each is waiting on something specific.

- **Dropped item entities.** Mined blocks currently teleport into the
  inventory; they should fall on the ground and be picked up, with Q to drop.
  Waiting on the block-change seam being built with gamemodes, which is
  exactly what a drop should hang off. Doing both at once means writing it
  twice.
- **Tool mining speed.** The material tiers and multipliers are being defined
  with crafting, but wiring them into break times needs `interact.js`, which
  another agent holds.
- **Right-clicking a crafting table** to open the 3x3 grid — same file, same
  reason.
- **Armor damage reduction.** The formula and the HUD bar come with crafting;
  applying it needs `survival.js`.

## Sequencing

1. **Content on the island.** Blocked on nothing technical. This is the gap.
2. **Deployment.** There is still no hosting config. Nothing is live, so no
   visitor has ever seen any of this.
3. **Video screens.** The richest way to deliver the content, and independent
   of everything else.
4. **Multiplayer presence.** The most distinctive feature, but it only pays
   off once there's something to gather around.
5. **Skin customization**, then the long tail.

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

## 2. Multiplayer presence

Concurrent visitors seeing each other walk around.

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

- **Non-cube blocks: stairs, slabs, fences, panes.** The palette is 355 full
  cubes; these need custom block meshes via noa's `blockMesh`. They are also
  roughly half of what makes a Minecraft build look built rather than blocky,
  and a hard prerequisite for importing anything made in real Minecraft.
- **Importing real Minecraft builds.** Build in creative with WorldEdit,
  export a litematic, map block ids, paint onto the island. The authoring
  story for all the content above — and blocked on non-cube blocks, since any
  real build uses stairs.
- **Spawn signage or a guided path.** A visitor drops into an empty field with
  no idea what to do. Even one sign at spawn changes that.
- **Mobile.** Explicitly dropped, and that's a real decision — but pointer lock
  does not exist on touch devices, so phone visitors currently get a world they
  cannot move in. A fixed camera flythrough would at least show them something.
- **Passive ambient animals.** Deliberately NOT hostile mobs (see below), but
  a couple of wandering chickens would make the island feel alive for a
  fraction of the cost. The model infrastructure now exists.

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
