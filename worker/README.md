# Turning AI Evan on

Nothing here is live. The client still talks to `stubBackend`, so the site
behaves exactly as it did before this directory existed. Four steps switch it
over, and the first three can be done in any order.

## 1. The key

Anthropic Console, in **its own workspace** with a monthly spend limit. Put the
limit at **$50**. `docs/ai-evan/02-operations.md` sizes the realistic month at
$9 to $14 and the bad day at $90 to $100 if nothing throttles, so $50 is high
enough that a genuinely good day does not break the site and low enough that a
bad week is an annoyance.

```sh
npx wrangler@4 secret put ANTHROPIC_API_KEY
```

For local development it goes in `.dev.vars`, which is already gitignored:

```sh
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars
npx wrangler@4 dev
```

The key never reaches the browser. It is read as `env.ANTHROPIC_API_KEY` inside
`fetch`, it is never put in a response body, and the client bundle has no field
for it.

## 2. The prompt

```sh
npm run prompt          # writes worker/prompt.generated.js
npm run prompt:check    # sizes only, writes nothing
```

Built from `corpus/`, which is gitignored, into a file which is also gitignored.
`npm run deploy` and `npm run deploy:dry-run` both run it first, so there is no
way to deploy a stale prompt and no way to deploy without a corpus. If
`corpus/profile.md` is missing the build **stops**; it does not emit a
placeholder, because a placeholder deploys an Evan who confidently knows
nothing about Evan.

Re-run it whenever `corpus/profile.md` changes. Nothing else caches it.

## 3. The client

AI Evan with memory is `POST /api/evan` (`worker/agent/`, design in
`docs/ai-evan/04-memory.md`). The page picks its brain at runtime:

- default: `evanBackend()`, which posts one message at a time to `/api/evan`.
  The server holds the transcript in the visitor's Durable Object.
- `?brain=stub`, or `game.useBrain('stub')` in the console: `stubBackend`, the
  offline script. No key, no Worker, no network.

The default falls back to the stub on its own. At boot the page asks
`/api/evan` for `{ status: true }`, and if there is no answer, an error, or
`brain: 'none'` (no `ANTHROPIC_API_KEY`, or a stub prompt), it runs the stub
for that visit without saying so. Plain `npm run dev` has no API and boots
the stub without asking. The older stateless `/api/agent` and `workerBackend`
still work and can be removed once `/api/evan` is live.

### Trying it locally without a key

```sh
npm run prompt:ci                       # or npm run prompt, with corpus/
echo 'AGENT_MOCK_MODEL=1' >> .dev.vars
npm run build:deploy && npx wrangler@4 dev
# open http://localhost:8787/
```

`AGENT_MOCK_MODEL=1` answers from `worker/agent/mock.js` and is ignored
whenever `ANTHROPIC_API_KEY` is set.

### The entry module

`main` in `wrangler.toml` is `worker/main.js`, not `index.js`. workerd refuses
to start a Worker whose main module has a named export that is not a function
or class, and `index.js` exports `PROMPT_IS_STUB` and `CAPS`. That made the
Worker fail at startup under `wrangler dev`, which `deploy --dry-run` does not
catch. `test/110-ai-evan-memory.spec.js` now checks it.

## 4. AI Gateway

Optional and free, and it is the only control that bounds the genuinely bad
day. Create a gateway in the Cloudflare dashboard, set a global rate limit on
it, and point `API` in `index.js` at the gateway URL instead of
`api.anthropic.com`. When it trips, visitors get "AI Evan is busy right now"
instead of Evan getting an invoice.

## What it costs to leave on

Every ceiling is in `CAPS` in `index.js` with the thing it stops. The ones that
bound the bill without needing to identify an attacker are `maxTokens`, the
gateway throttle and the Console spend limit. The one the stateless design
lacked was a real per-visitor conversation cap. `/api/evan` has one now, with a
daily token budget, in the visitor's Durable Object (`worker/agent/memory.js`,
`LIMITS`).
