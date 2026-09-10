# Future builds

Everything here is secondary to one fact: **the island is empty.** The engine
is in good shape — real Minecraft physics, survival HUD, inventory, mining,
day/night, a skinned player model. None of that is what a visitor came for.
They came to find out who Evan is, and right now the world cannot tell them.

## Sequencing

1. **Content on the island.** Blocked on nothing technical.
2. **Deployment.** There is still no hosting config. Nothing is live.
3. **Video screens.** The richest way to deliver the content, and independent
   of everything else.
4. **Multiplayer presence.** The single most distinctive feature, but it only
   pays off once there's something to gather around.
5. **Skins**, then **commands**.

The ordering rule: anything that makes the world worth visiting beats anything
that makes it more elaborate.

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

## 3. Commands, and my case against chat

**Commands are worth building.** A `/` interface is instantly recognisable and
genuinely useful here: `/tp <plot>` to jump to a resume section, `/time` to
force day or night, `/skin <name>`, `/help` to orient a lost visitor. Purely
client-side to start. Perhaps half a day.

**Chat I'd push back on.** Player-to-player text on a personal domain,
attached to Evan's name and next to his resume, is a moderation liability with
almost no upside for someone who is there for three minutes. The realistic
outcomes are an empty chat box or one you have to police.

If it ships anyway: rate limit per connection, cap length, strip links, and
build the kill switch on day one rather than the day you need it. That's ~3
days once moderation is taken seriously, against ~1 day if it isn't — and the
1-day version is the one that becomes a problem.

The Minecraft *feel* comes from the `/` interface and the chat-styled overlay
for system messages ("Evan joined the game"). That's available without any
user-to-user messaging at all.

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

- **Sounds.** Footsteps varying by block, break and place, ambient wind. Now
  that the visuals are close, this is the largest remaining gap between "looks
  like Minecraft" and "feels like Minecraft". Needs CC0 audio — the same
  licensing rule as textures applies. ~1 day.
- **Block break particles.** Cheap, and their absence is conspicuous.
- **Spawn signage or a guided path.** A visitor drops into an empty field with
  no idea what to do. Even one sign at spawn changes that.
- **Mobile.** Explicitly dropped, and that's a real decision — but pointer lock
  does not exist on touch devices, so phone visitors currently get a world they
  cannot move in. A fixed camera flythrough would at least show them something.

## Not worth building

- **Mobs and combat.** Large effort, no relationship to the purpose.
- **Crafting.** Same. The inventory exists to hold building blocks.
- **Redstone.** No.
- **Voice chat.** WebRTC infrastructure plus the worst moderation surface
  available, for something nobody wants on a resume site.
- **Procedural or infinite world.** The island being small and deliberately
  built is the entire idea.
- **Anti-cheat.** There is nothing to protect.
