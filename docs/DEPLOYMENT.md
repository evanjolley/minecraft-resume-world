# Deployment

**Decision: Cloudflare Workers with static assets.** Not Pages, not Vercel, not
GitHub Pages. Reasoning below, because the obvious reason is not the real one.

## The static hosting is not the deciding factor

The built site is ~4.5MB of assets and a 1.24MB bundle (310KB gzipped). Every
candidate serves that for free without noticing. If static hosting were all
this needed, GitHub Pages would do and the question would be boring.

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

## Plan

1. `wrangler.toml` with static assets, deploy from CI on push to `main`.
2. Point `world.evanjolley.com` at it. Leave evanjolley.com on GitHub Pages —
   two independent things, neither able to break the other.
3. Multiplayer later adds a Durable Object binding to the same Worker.

Nothing here is live yet, and going live is Evan's call, not an agent's.
