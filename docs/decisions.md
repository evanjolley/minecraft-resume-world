# Decisions

Engineering decisions with the reasoning and the alternatives, so nobody has to
reconstruct them. `DECISIONS.md` at the repo root is a different file. It holds
open questions waiting on Evan.

---

## 2026-10-25. Login is a passkey, and it is optional

**Decision.** Every visitor is a guest the moment the page loads, with a
nickname they can change from the pause menu, with `/nick`, or by telling AI
Evan. Signing in is an upgrade that keeps the same visitor id, done with a
passkey (WebAuthn). Code lives in `worker/account/` and `src/account.js`.

**Why a passkey.**

- It needs no third party and no secret beyond `SESSION_SECRET`, which the
  Worker needs anyway to sign sessions. Nothing to buy, nothing to configure,
  nothing to rotate.
- It stores no personal data. The server keeps a public key and a nickname.
  No email address sits in a database on a personal site.
- It is one tap or one fingerprint, and synced passkeys (iCloud Keychain,
  Google Password Manager) already exist on most phones and laptops, which is
  exactly the "follows you across devices" requirement.
- It is fully testable locally. Chromium's virtual authenticator drives the
  real ceremony in `test/63-login-e2e.spec.js`.

**Alternatives considered.**

| Method | Friction for the visitor | Operational cost | Why not |
|---|---|---|---|
| Email magic link | Leave the game, open mail, click | An email sending service plus deliverability work, and a stored email address | Most friction, the only option with a running bill and PII |
| Google or GitHub OAuth | One click if signed in | OAuth app per provider, client secret, consent screen, redirect URIs per domain | Collects an email address, adds two secrets, and recruiters on locked down work laptops may not use a personal Google account there |
| Passkey | One tap | None beyond `SESSION_SECRET` | Chosen |

**The catch, and what to do about it.** A passkey is bound to its relying
party id, which is the domain. Passkeys created on `world.<account>.workers.dev`
will not work on `world.evanjolley.com`. So either set `LOGIN = "off"` until the
custom domain is live, or accept that early accounts will need to sign up again.
Recommendation is to leave login off until the domain decision in
`DECISIONS.md` is made, then set `PASSKEY_RP_ID` and `PASSKEY_ORIGIN`.

A lost passkey with no synced copy means a lost account. That is acceptable
here because the world is also saved locally and nothing in an account is
irreplaceable.

**Sessions.** A token `v1.<payload>.<mac>` signed with HMAC SHA-256 under
`SESSION_SECRET`, carried as an HttpOnly `SameSite=Strict` cookie scoped to
`/api` and as a bearer token. Stateless, so a guest costs no storage at all.
It cannot be revoked before expiry (guests 365 days, accounts 90 days,
refreshed on every visit). That is acceptable for what it guards, a visitor's
own block edits and conversation memory. A per-visitor token generation number
in the Durable Object is the fix if revocation is ever needed.

**For the AI EVAN side.** `getVisitor(request, env)` in
`worker/account/session.js` returns `{ id, account, exp }` or null. The id is
stable across the guest to account upgrade and across devices. Key per-visitor
memory by it.

---

## 2026-10-25. Nicknames are filtered on both sides with one shared function

`src/nickname.js` is imported by the browser and by the Worker. Rules, in
order, are vanilla username shape (1 to 16 of `[A-Za-z0-9_]`), nothing that
reads as Evan (`Evan`, `ev4n`, anything containing `jolley`, `RealEvan`) or as
staff (`Admin`, `Moderator`, `Owner`), and a short slur list matched after
undoing leetspeak. Ordinary names that contain a short slur as a substring
(Nazir, raccoon, torpedo, Dickens) are allowed because short stems are matched
only as the whole name. The known false positive is Scunthorpe.

Single player makes the client copy acceptable. A name is only ever shown to its
owner. The copy that matters is the one the server checks before storing an
account's name.

---

## 2026-10-25. Saved worlds are local first, synced through one Durable Object per account

**Decision.** IndexedDB holds every visitor's save, written every few seconds,
which works for guests and offline. A signed-in visitor also syncs to their own
Durable Object with SQLite (`worker/world/`). Guests never touch the server.

**What is stored.** A diff against the generated world, not chunks. Each edit
is `[x, y, z, block, generatedBlock]`, blocks by key rather than numeric id
because engine ids are positional and move when `blocks.js` gains an entry.
Plus position, view direction, inventory, game mode and time of day.

**Surviving a new landscape.** Each edit records the block the generator put at
that coordinate. On load an edit is replayed only where the generator still
produces that block. Where the landscape moved, the edit describes nothing that
exists and is dropped, and everywhere else it survives. A per world generation
id (a fingerprint of a coarse terrain sample) is also stored. If it changed, the
saved position is ignored and the visitor arrives at spawn. One generation id
for the whole save was rejected because it would discard every edit in the
world when one tree moved somewhere else.

**Concurrency.** Optimistic. A write carries the revision it was based on, and
a stale write gets a 409 with the newer save, which the client merges (union of
edits, its own edits winning a conflict, newest state) and retries. Two devices
never silently overwrite each other.

### Cost at 1,000 concurrent players

Assumptions. Every one of the 1,000 is signed in (the worst case, since guests
cost nothing). A changed world syncs at most every 30 seconds, so 2 writes per
minute per player. One sync writes about 2 SQLite rows, because a save is one
state row plus one row per changed dimension rather than one row per block.
A typical save is about 20 KB.

Prices are from the Cloudflare pricing pages for
[Workers](https://developers.cloudflare.com/workers/platform/pricing/),
[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/) and
[R2](https://developers.cloudflare.com/r2/pricing/), read 2026-10-25.

**Upper bound, 1,000 concurrent around the clock for a month.**
That is 1,000 × 2 × 60 × 24 × 30 = 86.4 million syncs.

| Line | Usage | Included | Cost |
|---|---|---|---|
| Workers base | | | $5.00 |
| Worker requests | 86.4M | 10M | 76.4M × $0.30/M = $22.92 |
| Worker CPU, about 3 ms per sync | 259M ms | 30M ms | 229M × $0.02/M = $4.58 |
| Durable Object requests | 86.4M | 1M | 85.4M × $0.15/M = $12.81 |
| Durable Object duration | about 10 ms active per sync, 108k GB-s | 400k GB-s | $0 |
| SQLite rows written | 172.8M | 50M | 122.8M × $1.00/M = $122.80 |
| SQLite rows read | about 260M | 25B | $0 |
| SQLite storage | 1M accounts × 20 KB = 20 GB | 5 GB | 15 × $0.20 = $3.00 |
| **Total** | | | **about $171 per month** |

Duration is near zero because an object with no pending I/O and no sockets
qualifies for hibernation and is not billed while idle, per the Durable Objects
pricing page.

**Realistic, a 1,000 player spike for 2 hours a day.** Everything above scales
by 2/24. 7.2M syncs fit inside the included Worker requests and the 50M
included rows written, so the bill is the $5 base plus about $1 of Durable
Object requests.

The knob is the sync interval. Local saves are free and frequent, and the
server only needs the latest state, so 60 seconds would halve every usage line.

### Alternatives

**One D1 database for everyone.** Rows written are priced the same ($1 per
million after 50M), there is no per request fee, and storage is $0.75 per
GB-month against $0.20. It loses on two limits from the
[D1 limits page](https://developers.cloudflare.com/d1/platform/limits/). A
database is capped at 10 GB, so 1M accounts at 20 KB already needs sharding by
hand. And "each individual D1 database is inherently single-threaded", so every
visitor's save queues behind every other visitor's. No query here ever spans
two visitors, so a shared database buys nothing in exchange. D1 would be the
right call if Evan wanted cross-visitor queries, for example a leaderboard.

**R2, one object per save.** Cheapest storage at $0.015 per GB-month, but
every save is a Class A write at $4.50 per million. The upper bound above would
cost 86.4M × $4.50/M = $389 in writes alone, and an object store holds
passkeys and nicknames awkwardly.

**Workers KV.** Writes are $5 per million and KV is eventually consistent,
which breaks "sign in on your phone and see what you built on your laptop a
minute ago".

**Durable Object per visitor wins** on isolation (1,000 independent
single-writer databases, each up to 10 GB), on strong consistency for the
multi-device case, and on locality. The same object, keyed by the same visitor
id, is the natural home for AI Evan's per-visitor memory.

---

## 2026-10-25. Single player, and the Tab list is gone

Multiplayer presence is cancelled (`docs/SPRINT-1.md` item 6). `src/tabList.js`
and its spec were removed. Vanilla hides the player list in singleplayer too,
since `PlayerTabOverlay` is only shown when the connection is not a local
server or more than one player is listed. Chat stays, with AI Evan in it.
