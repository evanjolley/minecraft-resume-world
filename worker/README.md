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

One line in `src/main.js`, which this directory does not own:

```diff
-import { createEvanTools, stubBackend, LINES } from './aiEvan.js'
+import { createEvanTools, stubBackend, workerBackend, LINES } from './aiEvan.js'
@@
-    backend: stubBackend,
+    backend: workerBackend(),
```

`stubBackend` stays exported and stays working. It is the offline path: no key,
no Worker, no network, which is what keeps `npm run dev` usable on a plane and
`test/21-ai-evan.spec.js` free to run.

## 4. AI Gateway

Optional and free, and it is the only control that bounds the genuinely bad
day. Create a gateway in the Cloudflare dashboard, set a global rate limit on
it, and point `API` in `index.js` at the gateway URL instead of
`api.anthropic.com`. When it trips, visitors get "AI Evan is busy right now"
instead of Evan getting an invoice.

## What it costs to leave on

Every ceiling is in `CAPS` in `index.js` with the thing it stops. The ones that
bound the bill without needing to identify an attacker are `maxTokens`, the
gateway throttle and the Console spend limit. The one this design does *not*
have is a real per-visitor conversation cap, because there is no Durable Object
yet; the comment above `MODEL` explains why that is survivable and what signal
should change it.
