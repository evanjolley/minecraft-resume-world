# Decisions

Engineering decisions and the reasons for them. Open questions that need
Evan are in `DECISIONS.md` at the repo root.

## 2026-10-25. AI Evan's visitor memory lives in one SQLite Durable Object per visitor

**Decision.** `VisitorMemory` (`worker/agent/visitorMemory.js`), a
SQLite-backed Durable Object, one per visitor, addressed by
`idFromName(visitorId)`. Evan's own knowledge is not in it. That is a
read-only bundle built at deploy time (`docs/ai-evan/04-memory.md` section 3).

**The access pattern.** Every turn reads everything about one visitor (facts,
summaries, the current transcript) and appends a few rows. No turn ever reads
another visitor's data. At 1,000 visitors talking at once that is 1,000
small, independent, write-heavy records.

**Why a Durable Object.**

- Each object is single-threaded and owns its data, so the lease that keeps
  one turn at a time, the per-visit turn cap and the daily token budget are
  exact. The rate-limit binding is approximate and per-colo by Cloudflare's own
  description, and the operations doc already named a Durable Object as the
  fix (`docs/ai-evan/02-operations.md` sections 3.4 and 8).
- SQLite storage sits with the object, so the reads every turn needs are local
  calls, not network round trips.
- No shared hotspot. A thousand visitors are a thousand objects, spread
  across machines by Cloudflare.
- The alarm gives scheduled work per visitor for free (summarize a visit 30
  minutes after it ends, delete the visitor 30 days after their last visit)
  without a cron job scanning a table.
- Idle objects hibernate and are not billed for duration (Workers pricing
  page, cited in `02-operations.md` 5.1). The model call runs in the Worker,
  not in the object, so an object is active for milliseconds per turn.
- The repo already planned Durable Objects with `new_sqlite_classes` for
  multiplayer (`wrangler.toml`). Same pattern, different class, as
  `02-operations.md` 5.2 recommends.

**Rejected.**

- **D1.** One database, one primary that serializes every write. Every turn
  of every visitor would funnel through it, from wherever the primary lives.
  Fine at a dozen visitors, the wrong shape at a thousand, and it gives no
  per-visitor lock, so the turn lease would need its own mechanism.
- **KV.** Eventually consistent, and Cloudflare documents a limit of one write
  per second per key. A tool loop writes several times a second to the same
  visitor, and a turn cap read from a stale value is not a cap.
- **A vector store for memory.** Neither ChatGPT nor Claude uses one for
  personal memory, per the public reverse engineering
  (`docs/ai-evan/04-memory.md` section 1). Thirty facts and five summaries fit
  in the prompt.
- **Running the model call inside the object.** Simpler, but the object would
  be active, and billed for duration, for the whole several-second model call
  of every turn. The Worker calls `begin` and `commit` instead.

**Cost at 1,000 concurrent visitors.** Two or three object requests per turn,
so a thousand 15-turn visits is about 45,000 requests and tiny row storage.
That is inside the Workers Paid plan's included allowance. Model spend
dominates by orders of magnitude and is estimated in `04-memory.md` section 6.

## 2026-10-25. The server holds the AI Evan transcript

The browser sends one message per request, and the server keeps the history
in the visitor's Durable Object. This removes transcript forging, which the
stateless `/api/agent` documented and tolerated, and is what makes the turn
cap real. The client also no longer supplies tool descriptions, only tool
names, because a description is prompt text (`src/evanToolDefs.js`).

## 2026-10-25. Chat on Sonnet 5.5 at low effort, interview on Opus 5.5

The in-world chat uses `claude-sonnet-5-5` at effort `low`, which is half the
price of Opus 5.5 and is the documented setting for chat, where latency is the
design problem (`FUTURE.md` section 2). Override with `AGENT_MODEL`. The
summarizer uses the same model by default (`MEMORY_MODEL` overrides). The
interview runs locally on `claude-opus-5-5`, where quality matters more than
price and the volume is one person.

## 2026-10-25. No token streaming for AI Evan yet

The output gate screens the whole reply before any of it is shown, and that
conflicts with streaming (`02-operations.md` 6.3). Replies are capped at 800
tokens at low effort, so they are short. Sentence-level streaming with a
per-sentence gate is the path if latency needs it.
