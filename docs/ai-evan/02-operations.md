# Running AI Evan as an anonymous public endpoint

What it actually takes to put a tool-using LLM agent behind a URL that anyone can
hit, without leaking a key, without a surprise bill, and without it feeling broken
inside a running game.

Researched 2026-09-14. Every platform number below is dated, because most of them
were different a year ago and several changed in the last six months. Where the
evidence is thin I say so rather than rounding an opinion up into a finding.

Scope note. A sibling document covers truthfulness, persona, and adversarial
content. This one is the operational side. Where the two touch (streaming versus
post-hoc validation, transcript forging) I flag the seam and stop.

---

## 1. The shape of the problem

Three facts about this deployment decide almost everything else.

**The endpoint is anonymous and the cost is per message.** There is no login and
Evan does not want one. So the usual lever, "charge the user or throttle their
account", is gone. Everything has to be enforced on signals that a stranger
carries by default.

**Traffic is sparse and bursty.** A portfolio site gets a handful of visitors most
days and a spike when Evan posts a link. Sparse bursty traffic breaks the cost
assumption that most LLM cost writing is built on, which is that the prompt cache
stays warm. It will not stay warm here. Section 3 is mostly about that.

**The world keeps running while you chat.** This is unusual and it is an advantage.
In a normal chat product a slow response means a user staring at a spinner. Here a
slow response means a player who wanders off and looks at a tree. The latency
budget is genuinely looser than a chat app, but the *input focus* budget is much
tighter. More in section 6.

---

## 2. Where the key lives

### 2.1 The answer

A Workers secret, set with `wrangler secret put ANTHROPIC_API_KEY`, read in the
Worker as `env.ANTHROPIC_API_KEY`. That is the whole thing. It is the current,
correct, boring pattern.

The distinction that matters is secret versus plaintext var. Cloudflare's
[secrets docs](https://developers.cloudflare.com/workers/configuration/secrets/)
(last updated 2026-07-03) are blunt about it. Values set as secrets are not
readable back from Wrangler or the dashboard after you set them. Values in
`[vars]` in `wrangler.toml` are plaintext, visible in the dashboard, and in this
repo's case would be committed to git. The docs say directly, "Do not use
plaintext environment variables to store sensitive information."

Three things worth knowing beyond the basics.

Secrets are **non-inheritable across environments**. If you ever add a staging
environment you set the secret again with `-env`, it does not cascade.

Local development reads `.dev.vars` or `.env` in the Wrangler directory, and the
docs say use one or the other, not both. That file must be gitignored. This repo
has no `.dev.vars` yet, so add the gitignore line before you create the file, not
after.

There is a `secrets.required` validation feature. `wrangler deploy` and
`wrangler versions upload` will fail with a list of missing secrets if you declare
them and they are not set. Cheap insurance against deploying a Worker whose only
failure mode is a 500 on the first chat message.

### 2.2 Secrets Store and AI Gateway BYOK, and why to skip both for now

**Secrets Store** is the account-level version, a secret stored once and bound into
multiple Workers. The docs still describe it as beta as of the July 2026 revision.
One Worker and one key does not need it.

**AI Gateway BYOK** is more interesting and still probably not worth it yet. Per
[Cloudflare's BYOK docs](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/),
you store the Anthropic key in Cloudflare Secrets Store, and the Worker's request
carries `cf-aig-authorization: Bearer <CF token>` instead of the Anthropic key. The
gateway injects the real key after the request leaves your code.

The security argument for this is weaker than it looks. Your Worker still holds a
credential that can spend money, it is just a Cloudflare token rather than an
Anthropic one. The real argument for AI Gateway is observability and the kill
switch, not key handling. See 3.4.

### 2.3 Routing, which this repo has not solved yet

`wrangler.toml` currently declares `[assets]` with `directory = "./dist"` and no
`main`. There is no Worker script. Adding one means the asset server and the Worker
now both want the request.

The repo already worked this out for multiplayer. The commented block says
`run_worker_first = ["/ws"]` so the WebSocket upgrade reaches the Worker instead of
being answered by the asset server. The chat endpoint needs the same treatment,
`run_worker_first = ["/api/chat"]` or whatever the path ends up being. With
`not_found_handling` at its default of `"none"` a non-matching path should fall
through to the Worker anyway, but relying on fall-through means the routing is
implicit and breaks silently the day someone adds a `dist/api/` directory. Make it
explicit, same as `/ws`.

### 2.4 What actually bites when you call Anthropic from a Worker

Per the [Workers limits page](https://developers.cloudflare.com/workers/platform/limits/index.md)
(last updated 2026-09-05).

**CPU time is the one that bites, and it is not what people expect.** Free plan is
**10 ms of CPU per invocation**. Paid is 5 minutes maximum with a **30 second
default**, tunable via `limits.cpu_ms`. The trap is that people read "10 ms" and
conclude an LLM call is impossible on the free plan. It is not, because the docs
state plainly that waiting on `fetch()` does not count toward CPU time. A Worker
that opens a connection to Anthropic and pipes the response body through untouched
uses almost no CPU.

What *does* burn CPU is parsing. If you decode the SSE stream, JSON-parse every
`content_block_delta`, re-wrap it in your own envelope, and re-encode, you are doing
real work per token. Across a thousand-token response on the free plan's 10 ms
budget, that is genuinely tight. This is a concrete design constraint, not a
theoretical one. Either pipe the Anthropic SSE stream through with a
`TransformStream` that does minimal work, or be on the Paid plan.

**Wall clock is a non-issue.** The limits page says there is **no enforced duration
limit on HTTP requests while the client remains connected**. A sixty second Opus
response with three tool calls will not be killed by Cloudflare. This is a real
advantage over Vercel functions, which the repo's `docs/DEPLOYMENT.md` already
notes close WebSockets at max duration.

**Subrequests used to be a real ceiling and mostly are not now.** A
[2026-02-11 changelog](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/)
raised the Paid plan default from 1,000 to **10,000 per invocation**, configurable
up to 10 million. The Free plan is still **50 external subrequests** per
invocation. A tool-use loop of five Anthropic calls plus a few internal reads is
nowhere near either. Do not let this shape the design.

**Six simultaneous connections waiting for response headers.** Only relevant if you
fan out parallel tool calls that each hit the network. The planned tools are local
(`set_player_name`, world-state read), so this is not a concern today. Worth
remembering if a `search_my_writing` tool ever appears.

**Client disconnect costs you money.** If the visitor closes the tab mid-stream,
Anthropic keeps generating and bills you for the full output. Nothing in Workers
cancels the upstream automatically. Wire the `AbortController` to the downstream
request's abort signal. This is a small change that is very easy to forget and it
exactly matches the abuse pattern of a script that fires requests and never reads
the response.

`ctx.waitUntil()` gives you **up to 30 seconds after the response is sent or the
client disconnects**. That is your window for writing a log line or a usage counter
without holding the response open.

**128 MB memory per isolate, no enforced response body limit.** Neither matters
here as long as you stream rather than buffer.

---

## 3. Cost control

### 3.1 The math, done properly, because the shape of it is counterintuitive

Anthropic's [prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md)
give the multipliers.

| | Multiplier on base input |
|---|---|
| 5 minute cache write | 1.25x |
| 1 hour cache write | 2x |
| Cache read | 0.1x |

Two details from that page do most of the work here.

**Cache reads refresh the TTL for free.** "The cache is refreshed for no additional
cost each time the cached content is used." So a busy prefix stays hot indefinitely
on the 5 minute TTL and you never pay a second write.

**The TTL clock starts when the request starts, not when it ends.** Generation time
counts against the lifetime. A response that takes four minutes to stream leaves
about one minute for the follow-up to land on a 5 minute TTL.

Now run the numbers for this project. Assume a 25,000 token system prompt, Sonnet 5
at $3 in and $15 out, roughly 250 output tokens per turn, six turns per
conversation, plus a couple of extra model calls for tool round trips, so call it
eight model calls per conversation.

Per model call once the cache is warm.

- Cached prefix read, 25,000 x $0.30/MTok = **$0.0075**
- Uncached tail (growing transcript, say 800 tokens average), 800 x $3/MTok = $0.0024
- Output, 250 x $15/MTok = $0.00375

That is about **$0.014 per model call**, so about **$0.11 per conversation**.

Now the write. A 1 hour write of that prefix is 25,000 x $6/MTok = **$0.15**. That
single number is larger than the entire rest of the conversation.

This is the finding that surprised me most and it inverts the usual advice. The
standard line is "you have a big fixed prompt, so prompt caching is a huge win."
That is true for a product with continuous traffic. It is much weaker for a
portfolio site, because **at sparse traffic most visitors arrive cache-cold and pay
the write premium**, and the write premium on a 25k prefix dominates everything
else.

Three regimes, per conversation, 25k prefix on Sonnet 5.

| Regime | Cost per conversation |
|---|---|
| Every conversation arrives cold (1h TTL) | ~$0.26 |
| One in four arrives cold | ~$0.15 |
| Cache continuously warm | ~$0.11 |
| No caching at all | ~$0.65 |

So caching is always worth it, by roughly 2.5x even in the worst case, because a
conversation is multiple turns and the break-even on a 1 hour write is only about
three requests against the same prefix. But it is not the 10x that the "0.1x cache
read" headline implies, and the difference between the good case and the bad case
is entirely about **how big the always-resident prefix is**.

### 3.2 The actual lever is prompt size, not caching configuration

Halving the resident prompt halves the write premium *and* halves the per-turn read.
Cutting a 25k prompt to 6k, with the rest of the corpus behind a `lookup` tool that
only fires when a question needs it, takes the cold-arrival conversation from about
$0.26 to about $0.05.

That is a content architecture decision and it belongs to the sibling document on
persona and corpus, not here. But the operational consequence is worth stating
loudly, because it will not be obvious from that side. **The size of the always-on
system prompt is the single largest input to the monthly bill, and it is a bigger
lever than every rate limit and cap in this document combined.**

### 3.3 TTL choice

Use the **1 hour TTL**. The reasoning is specific to sparse traffic.

On the 5 minute TTL, conversations spaced more than five minutes apart each pay
their own write, at 1.25x. On the 1 hour TTL, a cluster of visitors within an hour
shares one write at 2x. At five conversations per hour, that is one 2x write versus
five 1.25x writes. The 1 hour TTL wins at any density above roughly two
conversations per hour and loses only when traffic is so dense that the 5 minute
cache never goes cold, at which point the absolute numbers are small anyway.

The one caveat is that the 1 hour write costs 2x and is wasted entirely if exactly
one person ever talks to it in that hour and only sends one message. That is the
realistic worst case for a portfolio site and it caps your downside at $0.25 for a
one-message visit. Acceptable.

### 3.4 Rate limiting, and the specific ways it disappoints

**The Workers Rate Limiting binding.** Configured in `wrangler.toml` as a
`ratelimits` entry with a `namespace_id`, a `limit`, and a `period`, then called as
`await env.LIMITER.limit({ key })`. Per the
[docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
three constraints that are easy to miss.

**Period must be exactly 10 or 60 seconds.** There is no "20 per hour". If you want
an hourly or daily budget you are building it yourself.

**Limits are per Cloudflare location, not global.** The docs say "for each unique
key you pass to your rate limiting binding, there is a unique limit per Cloudflare
location." A script running from five regions gets five times the budget. The docs
also describe the counters as "permissive, eventually consistent, and intentionally
designed to not be used as an accurate accounting system", cached locally and
updated asynchronously, so counts can briefly exceed the limit under concurrency.

**Cloudflare explicitly recommends against keying on IP.** From the same page, "It
is not recommended to use IP addresses or locations... since these can be shared by
many users." This is the thing most people build first and it is documented as the
wrong default. Carrier-grade NAT puts thousands of mobile users behind one address,
and IPv6 rotation within a /64 gives an attacker effectively free key space. IP
limiting is worth having as a coarse floor, keyed on the /64 rather than the full
address for v6, but it is not the mechanism.

The honest framing is that the rate limit binding is a **cheap, fast, approximate
speed bump**. It is not a budget. For an accurate global counter the docs point at
Durable Objects, which this project is already going to have.

**AI Gateway rate limiting** is a different and complementary thing. The
[rate limiting page](https://developers.cloudflare.com/ai-gateway/features/rate-limiting/)
offers fixed or sliding windows configured per gateway, and states the behavior "will
be uniformly applied to all requests for that gateway." The docs do not describe
per-IP or per-user keying. So it is a **global throttle on the whole endpoint**,
which makes it useless for fairness between visitors and excellent as a circuit
breaker. A gateway limit of, say, 300 requests per hour means a runaway script
degrades the experience for everyone but cannot generate an unbounded bill. That is
the right trade for a portfolio site.

One unresolved contradiction. A third-party writeup
([aiarch.dev](https://aiarch.dev/cloudflare-ai-gateway)) claims AI Gateway's rate
limit does not apply to BYOK traffic, while Cloudflare's own BYOK page mentions
dynamic routes enabling "rate limit, budget limit and other restrictions". I could
not resolve this from primary sources. If you use both BYOK and gateway rate
limiting, verify with a test rather than trusting either claim.

**AI Gateway is free.** Per the
[pricing page](https://developers.cloudflare.com/ai-gateway/reference/pricing/),
analytics, caching, and rate limiting are free on all plans. Persistent logs are
capped at 100,000 total across all gateways on the Workers Free plan and 10 million
per gateway on Paid. Guardrails and Logpush are the paid extras, and neither is
needed here. Free rate limiting plus free per-request logs with token counts is a
genuinely good deal for zero code.

### 3.5 The caps that actually stop a bill

Layered, cheapest enforcement first.

1. **`max_tokens` per response.** 600 to 800 is plenty for a conversational answer
   and it hard-caps the most expensive token class. This is the highest-value single
   line of code in the whole system.
2. **Max user message length.** Reject anything over ~1,000 characters at the edge
   before it costs a token. A long pasted document is either a mistake or an attempt
   to use you as a summarizer.
3. **Max turns per conversation.** Twenty is generous for "tell me about your
   career". It also bounds transcript growth, which is the term that grows
   quadratically if you resend history each turn.
4. **Max model calls per user turn.** The tool loop must have a hard iteration cap,
   four or five. Without it a model that loops on a failing tool spends money in a
   circle.
5. **Per-session token budget.** Accumulate `usage` across the session and cut the
   session off at a ceiling. This catches the case the turn cap misses, which is
   twenty turns of maximum-length messages.
6. **Gateway-wide throttle.** AI Gateway, as above.
7. **A hard spend limit on the Anthropic side.** Put this key in its own Console
   workspace with a monthly limit, so that the ceiling is enforced by the party
   that sends the bill rather than by code you wrote. I did not verify the current
   Console UI for workspace spend limits from a primary source, so confirm it
   exists before relying on it as the backstop.

### 3.6 What shipped public demos actually report, which is less than I hoped

I looked for first-hand accounts of people who put an LLM behind a public URL and
got surprised. **I did not find good primary evidence and I am not going to
manufacture it.** The search results for this are dominated by vendor pricing
listicles and by content-marketing pages with implausibly clean numbers. The
closest real data I found is adjacent rather than on point.

A [techtrenches.dev writeup](https://techtrenches.dev/p/nobody-won-the-token-race)
documents internal-tool overspend with specific figures, including an Uber CTO
demo that spent $1,200 in a two-hour session, typical engineer spend of $150 to
$250 a month, and Uber capping tools at $1,500 per month per tool as of 2026-06-02.
That is authenticated employees on internal tools, not anonymous strangers on a
public endpoint, so treat it as evidence about how fast uncapped LLM spend moves
rather than evidence about this threat model.

The general leaked-key pattern, where a committed key is found by a scanner within
seconds and produces a five-figure invoice, is widely reported (for example
[systemshardening.com](https://www.systemshardening.com/articles/ai-landscape/llm-api-abuse-detection/))
but it is about key exfiltration, which is a different failure than endpoint abuse.

So the honest summary is that **the "public demo bankrupted me" story is folklore
more than documented**, and the reason is probably that public demos are throttled
early or die from indifference rather than from abuse. That should lower the anxiety
level somewhat. It should not lower the caps, because the caps are nearly free.

---

## 4. Abuse, operationally

Prompt injection and adversarial content are the sibling document's problem. This
section is about the two things that cost money or uptime. Somebody using the
endpoint as a free LLM, and somebody flooding it.

### 4.1 The free-proxy threat is mostly self-defeating, if you let it be

To use AI Evan as a general-purpose LLM, an attacker needs it to answer arbitrary
prompts at useful length. Every constraint in section 3.5 degrades that. A 700 token
output cap, a fixed system prompt they cannot replace, and a persona that declines
off-topic requests make it a bad proxy compared to the genuinely free anonymous
endpoints that already exist. There is a whole ecosystem of those, including
providers offering anonymous free tiers with no signup. **Nobody works to steal a
worse free thing when better free things are one search away.**

The security posture that follows is economic rather than detective. Do not try to
classify "is this person using me as a proxy". Make the endpoint structurally bad at
being a proxy and stop there.

Two hard requirements fall out of this.

**Never accept a system prompt from the client.** The system prompt is assembled
server-side and the server strips any client-supplied message with a `system` role
before building the request. This is the single control that stops the endpoint from
being a generic completion API.

**Do not echo back things that make it useful as a tool.** If the response format is
plain conversational text in a Minecraft chat log, it is not attractive for
programmatic use. Resist the temptation to add a JSON mode.

### 4.2 Telling a curious visitor from a script, without a login

Layered signals, none of which is individually sufficient.

**Cloudflare Turnstile is the load-bearing one.** Free, unlimited sitekeys,
unlimited challenges on the free plan, and an invisible mode where a real visitor
sees nothing. Cloudflare's own use-case docs specifically describe using Turnstile
to secure public endpoints that run expensive LLM completions, which is exactly this.
For a single-page app there is a Pre-Clearance cookie pattern so you solve once per
session rather than per message. Issue a Turnstile token when the world boots,
verify it server-side, and mint a short-lived signed session token the chat endpoint
requires. A script now has to run a browser, which raises the cost of abuse by
orders of magnitude for roughly zero cost to Evan.

Caveat worth knowing. The free tier has no custom risk thresholds and no per-endpoint
bot policies, and Turnstile is not unbypassable. It is a cost multiplier on the
attacker, not a wall.

**Origin and Referer checks.** Trivially forgeable and therefore worthless against a
determined attacker, but they cost one line and they filter out the entire class of
lazy `curl` traffic. Worth having for that reason alone.

**Session continuity.** A real visitor loaded the game, spawned, walked somewhere, and
then opened chat. A script posts to `/api/chat` cold. Requiring a session token that
was minted at world-boot, and only issuing it alongside a Turnstile verification,
collapses both checks into one gate.

**Human timing.** A person takes more than a second to type a message. Sub-second
consecutive messages from the same session are a strong signal. Enforce a minimum
interval per session and you get this for free as a side effect of the per-session
rate limit.

**What does not work and should not be built.** User-Agent filtering, blocking
datacenter ASNs (that also blocks VPN users, who are disproportionately the
technical audience this site is for), and anything that tries to detect "is this
prompt suspicious" with a classifier. That last one costs a model call per message
to defend against a problem the token caps already bound.

---

## 5. Session memory

### 5.1 The three options

**Client-held transcript, resent each turn.** The browser keeps the messages in
memory or `localStorage` and posts the whole array. The server validates shape,
caps length, strips non-user roles, and forwards.

Cheap, stateless, and it is by far the best privacy story, because Evan's
infrastructure stores nothing about strangers. It fails in two ways. It does not
survive a refresh unless you use `localStorage`, and it does not survive a return
visit in any useful form. More seriously, **the transcript is forgeable**. A script
can send a history containing invented assistant turns, and then ask a follow-up
that builds on them. On its own that only fools the forger, since nobody else sees
their screen. It stops being harmless the moment transcripts get logged and Evan
reads them believing the assistant said those things. The cheap fix is to HMAC each
assistant turn server-side and reject any assistant turn whose signature does not
verify, which is maybe fifteen lines and keeps the state client-side.

**Server-side session store in a Durable Object.** An opaque session id in a
first-party cookie or `localStorage` maps to a DO holding the transcript. Nothing
forgeable, transcripts survive refresh, return-visit memory becomes trivial, and the
prompt prefix you send is entirely server-controlled, which is slightly better for
cache stability.

The cost is nil. Per the
[Workers pricing page](https://developers.cloudflare.com/workers/platform/pricing/)
(last updated 2026-08-28) the free plan includes 100,000 Durable Object requests per
day and 13,000 GB-s per day, and objects that are idle and hibernation-eligible are
not billed for duration. A portfolio chat will not register.

The real cost is privacy and obligation. You now hold strangers' messages and you
have to decide how long, and say so. See section 7.

**Stateless with a rolling summary.** Keep no transcript, keep a short model-written
summary of the conversation so far, and send that instead. Cheapest in tokens, and
it degrades badly. The summary drops exactly the specific detail (a name, a
company) that the person expects you to remember, which is the one thing the feature
exists to do. Good for a fifty-turn agent, wrong for an eight-turn conversation
where the whole point is "it remembered my name".

### 5.2 Consistency with multiplayer, which is the interesting constraint

The brief notes that whatever holds session state is probably the same machinery
multiplayer needs, and that being consistent matters. I think that is half right and
the distinction is worth drawing precisely, because getting it wrong produces a
design that looks tidy and is wrong.

Multiplayer needs **one long-lived object per room**, holding shared state, fanning
messages to many connections. `wrangler.toml`'s commented block already describes it
as a `Room` class with `new_sqlite_classes`.

Chat sessions need **many short-lived objects, one per visitor**, holding private
state, talking to exactly one connection.

Those are different lifetimes, different cardinalities, and different privacy
properties. They should be **two Durable Object classes, not one**. Putting chat
transcripts inside the Room object couples a private per-visitor thing to a shared
public thing and means a busy room keeps chat state hot in memory for no reason.

What should be consistent is the **pattern**, not the object. Same migrations
discipline (`new_sqlite_classes`, which the repo already correctly notes is fixed at
class creation and cannot be changed later), same naming convention for object ids,
same approach to hibernation. If the chat DO is written the same way the Room DO
will be, the second one is a copy of the first with different contents. That is the
consistency that pays off, and it does not require them to be the same object.

Cross-visit memory, "ah, you were here last week", is a separate and later decision.
Mechanically it is a persistent id in `localStorage` or a first-party cookie plus a
DO. Ethically it is the moment you start building a profile of an identifiable
returning visitor, which changes the privacy conversation in section 7 materially.
It is also the feature most likely to feel creepy rather than charming to a stranger
who did not opt into anything. I would ship without it and add it only if Evan
actually wants it after watching real conversations.

---

## 6. Latency and streaming in a running world

### 6.1 What the timing actually needs to be

The game context changes the budget in a way worth being precise about.

The player is not blocked. Rain is falling, the world is rendering, the chat log sits
in a corner. A five second wait for a full answer is survivable in a way it is not in
a bare chatbox. But two things are much tighter than in a chat app.

**Input focus.** In a Minecraft-style chat the input steals the keyboard. If the
player cannot move while waiting, a three second wait feels like a freeze. Release
focus the instant the message is sent, not when the answer arrives. Everything else
in this section is secondary to that.

**Acknowledgement.** The log needs a line within a couple hundred milliseconds saying
the message landed. Not a spinner. A Minecraft-style line, the in-world equivalent of
Evan starting to type. That is a client-side render of the user's own message plus a
placeholder, it requires no network round trip at all, and it buys you several
seconds of patience.

On the numbers, the evidence is softer than I would like. A 2026 benchmark writeup
reports Haiku 4.5 first token at roughly 597 ms from a Toronto server
([digitalapplied.com](https://www.digitalapplied.com/blog/ai-model-latency-benchmarks-2026-ttft-throughput)),
and a separate 2026 benchmark reports a p95 to p50 ratio averaging about 2.1x across
providers, with Anthropic noted as among the more consistent
([kunalganglani.com](https://www.kunalganglani.com/blog/llm-api-latency-benchmarks-2026)).
Both are independent blog benchmarks rather than vendor-published figures, so treat
them as order-of-magnitude. The useful takeaway is the shape rather than the digits.
**Design for p95, not p50, because the tail is roughly double and the tail is what
people remember.** If p50 first token is around a second, assume two for planning.

### 6.2 Tool loops are where perceived latency actually dies

This is the part that catches people, and it is worse here than in a normal chat
product.

A single completion streams a first token in around a second. A tool-using turn does
not. The model emits an assistant turn ending in `tool_use`, your code runs the tool,
you send a second request with the result, and *that* turn produces the user-visible
text. The first visible token is now after two full round trips, each of which
re-processes the prompt. Add a second tool call and you are at three.

A 2026 agent-latency writeup puts typical production agents at two to five model
calls per user turn, and reports one case where the model itself accounted for only
about 35 percent of total latency, the rest being sequential tool calls, unnecessary
intermediate steps, and a missing streaming layer
([mlsystems.dev](https://mlsystems.dev/blog/agent-loop-latency/)). Again, a blog
benchmark, not a vendor figure. But the structural claim is just arithmetic and does
not need a citation.

Three mitigations, in order of value.

**Keep the tools local.** `set_player_name` and a world-state read execute inside the
Worker with no network call. The tool round trip is then pure model latency and adds
maybe a second, not five. This is the strongest argument for resisting a
`search_the_web` tool.

**Stream the pre-tool text.** If the model says "let me check where you are" before
emitting the `tool_use` block, stream that into the log. The player sees Evan
thinking out loud, which is exactly what a Minecraft NPC should do, and the dead time
between round trips is now filled with in-character content rather than nothing.

**Cap the loop at four or five iterations.** Both for money (3.5) and because a
six-round-trip answer has already lost the player.

### 6.3 Should it stream

Yes, with one real caveat and one presentational adjustment.

Streaming does not make anything faster. It makes the wait legible. The commonly
cited contrast is tokens appearing at a few hundred milliseconds versus a blank field
for several seconds. On the plumbing, Workers has first-class support via
`TransformStream`, and Cloudflare switches the response to passthrough mode when it
sees `Content-Type: text/event-stream`, so the main requirement is emitting the right
content type and adding `Cache-Control: no-transform` so nothing tries to minify the
stream.

**The caveat is real and it belongs to the sibling document.** If AI Evan's answers
are going to be validated, filtered, or fact-checked before display, you cannot stream
them, because by the time you know the sentence was wrong the player has read it. That
is a genuine architectural fork. Streaming and post-hoc validation are mutually
exclusive on the same text. A middle path exists, which is to stream at sentence
granularity and validate each completed sentence before releasing it, at the cost of
some smoothness and a lot of complexity. My read is that for a portfolio site the
right answer is to stream and to solve truthfulness in the prompt and the tool
surface rather than in a downstream filter, but that call is not mine to make here.

**The presentational adjustment.** Minecraft chat is line-based and monospaced.
Token-by-token rendering into a fixed log looks wrong, because words half-appear and
the log reflows. Buffer to word or clause boundaries and append. You keep the "it is
alive" feeling and lose the jitter. This also cuts CPU per chunk, which matters on the
free plan's 10 ms budget (2.4).

---

## 7. Privacy and data handling, practically

Strangers will type things into this. Some of them will type something personal,
because people do that with anything that talks back.

### 7.1 What is true regardless of what you build

Their message goes to Anthropic. As of the September 2025 change, standard API inputs
and outputs are retained for **7 days** and then deleted, and API inputs and outputs
are not used for model training. Certain newer "covered models" carry a **30 day**
retention requirement instead, effective 2026-06-09. So even a system that stores
nothing has a third party holding the text for a week or a month. That is not a
problem, but it is a fact that any honest notice has to accommodate. Do not write
"your messages are not stored anywhere", because it is false.

Anthropic also added **disclosure requirements** in its 2026 Usage Policy updates, to
the effect that organizations using its tools help their own users understand they
are interacting with an AI system. For consumer-facing deployments this is an explicit
expectation, not just good manners.

### 7.2 Sensible defaults

**Say it is an AI, in the first line, in character.** "I am an AI version of Evan"
costs nothing, satisfies the disclosure expectation, and is funnier in a voxel world
than it would be anywhere else. It also pre-empts the entire category of visitor who
was going to spend three messages testing whether it is a real person.

**Do not log message bodies by default.** Log counts, token usage, latency, tool
calls, and error rates. Those give you every operational signal you need. Note that
`wrangler.toml` already has `[observability] enabled = true`, so be deliberate about
what you `console.log`. Putting a user's message into a log line is a storage decision
made by accident.

**If you do want to read transcripts, and you probably will, make it explicit and
bounded.** Evan will genuinely want to see what people ask, and that is a reasonable
thing to want. So store them deliberately, with a stated retention (30 days is a
defensible round number), with an automatic delete, and with a one-line notice in the
chat UI rather than a linked privacy policy nobody opens. Something like "this
conversation may be kept for 30 days so Evan can see what people ask" is more honest
and more effective than a policy page.

**Do not collect identity until there is a reason to.** The booking flow is the
reason. An email address typed to schedule a meeting is a different data flow with a
different justification and it should be handled differently from chat text. Keep them
separate. Do not let the chat transcript become the place an email address
accidentally lands.

**Redact before storage, not after.** If you store transcripts, run a trivial regex
for email addresses and phone numbers and replace them before writing. Cheap,
imperfect, and it removes the most likely category of accidental PII.

**Persistent identifiers are the line.** Anonymous per-visit state with no durable id
is essentially unregulated and uninteresting. A persistent cookie id plus stored
transcripts is a profile of an identifiable returning individual, and that is a
materially different thing under GDPR and similar regimes. This is the practical
reason to treat "remembers you came back" as a deliberate later decision rather than a
free bonus on the session store.

---

## 8. What I would actually build

Concrete, for this repo, in order.

**The key.** A Workers secret named `ANTHROPIC_API_KEY`, set with
`wrangler secret put`, read as `env.ANTHROPIC_API_KEY`. Declared in
`secrets.required` so a deploy without it fails loudly. `.dev.vars` for local,
gitignored before it exists. Add `run_worker_first = ["/api/chat"]` to the `[assets]`
block, same explicitness the repo already applied to `/ws`.

**The model and the prompt.** Sonnet 5, not Opus. This is a conversational persona
answering questions about a career, not a reasoning task, and Opus costs 1.7x more per
input token and 1.7x more per output token for capability this does not use. Target a
resident system prompt under 8,000 tokens with the long tail of the corpus behind a
lookup tool. That single decision is worth more than everything else on this list.
Cache the prefix with `ttl: "1h"`.

**The gate.** Cloudflare Turnstile in invisible mode, verified when the world boots,
exchanged for a short-lived signed session token that `/api/chat` requires. Origin
check as a one-line freebie. No login, ever.

**Rate limiting, three layers.**
- Per session token, enforced in the session Durable Object, so it is accurate and
  global. Twenty turns, a minimum one second between messages, and a total token
  budget for the session.
- Workers rate limit binding keyed on the session token, not the IP, 60 second
  period, as a cheap fast pre-filter before the DO is even touched.
- AI Gateway rate limit as the global circuit breaker. Set it at something like ten
  times the traffic Evan expects. It exists to bound the worst day, not to be hit.

**Caps in code.** `max_tokens` 800. User message max 1,000 characters. Tool loop max
four iterations. `AbortController` wired to client disconnect so a closed tab stops
costing money.

**Session state.** A `ChatSession` Durable Object, separate class from the future
`Room`, same `new_sqlite_classes` migration discipline and naming conventions. Holds
the transcript for the visit, holds the rate counters, hibernates when idle. Server
holds the transcript, client sends only the new message. This removes transcript
forging entirely, which is worth more than the HMAC alternative's simplicity, and it
costs nothing on the free tier.

**Streaming.** Yes. SSE with `Content-Type: text/event-stream` and
`Cache-Control: no-transform`. Pipe Anthropic's stream through a `TransformStream`
that does the minimum work necessary, buffering to word boundaries before appending to
the chat log. Release keyboard focus on send, not on completion. Render the player's
own message and a "..." placeholder client-side immediately.

**Privacy.** AI disclosure in the greeting. Transcripts stored in the DO with a 30 day
alarm-driven delete. One line of notice in the chat UI. Email regex redaction before
write. No `console.log` of message bodies.

**Spend backstop.** A dedicated Anthropic Console workspace for this key with a
monthly limit set to roughly three times the expected bill, so the ceiling is enforced
by the party that sends the invoice.

### What I would not bother with, and why

**Cloudflare Secrets Store.** Still beta, solves a multi-Worker problem this project
does not have. One `wrangler secret put` is the complete solution.

**AI Gateway BYOK.** The security benefit is illusory, since the Worker still holds a
spend-capable credential either way. Use AI Gateway for the throttle and the logs,
keep the key in a Workers secret.

**IP-based rate limiting as the primary mechanism.** Cloudflare's own docs recommend
against it, it is per-colo so it is weaker than it looks, and CGNAT means it punishes
legitimate mobile users while an IPv6 rotation defeats it. Keep a coarse /64 limit as
a floor and stop.

**Semantic response caching.** Caching "what did Evan do at Patronus" so the second
asker gets a free answer sounds clever and is wrong here. Traffic is too sparse for
meaningful hit rates, the responses are personalized with the visitor's name, and the
first identical-question repeat will happen approximately never. Prompt caching
already captures the actual repetition, which is the prompt, not the answer.

**A moderation or "is this abuse" classifier call.** It costs a model call per message
to defend against a problem the token caps already bound. The economics of the defense
are worse than the economics of the attack.

**Cross-visit memory in v1.** It is the feature most likely to cross from charming to
unsettling for a stranger, it is the thing that turns an anonymous system into a
profiling system, and it is not what makes the demo land. Add it later if real
transcripts suggest people want it.

**Its own WAF rules, bot management tiers, or Attack Mode.** Turnstile plus the caps
covers the realistic threat. Buying protection sized for an attack this site will not
attract is how a fun project turns into an ops burden.

**Anything that assumes the cache is warm.** Do not build cost projections, dashboards,
or optimizations around a hot prefix. At this traffic it is cold more often than it is
warm, and designs that quietly assume otherwise fail in the direction of a bigger bill.

---

## 9. The smallest thing that could ship

The first version needs to survive Evan sending a link to a dozen people. Not a front
page. Here is the version that is honest about that.

**Ship this.**

- Worker with the key as a secret, `run_worker_first` on the chat path.
- Sonnet 5, system prompt cached with `ttl: "1h"`, `max_tokens` 800.
- Client holds the transcript and posts it each turn. No Durable Object yet. Server
  strips any `system` or `assistant` role it did not produce and caps array length at
  twenty. Transcript forging is tolerable at this stage because nothing is logged and
  the forger only fools themselves.
- Rate limiting binding keyed on a random session id generated at world boot, 60
  second period. Approximate and per-colo and completely adequate for a dozen friends.
- AI Gateway in front, with a global rate limit as the circuit breaker, because it is
  free and it is the one thing that bounds the worst case.
- Anthropic Console spend limit on the key.
- Streaming, because it is roughly the same amount of code as not streaming and the
  difference in feel is large.
- One line of AI disclosure in the greeting. No transcript storage at all, which means
  no privacy notice to write and nothing to delete.

**Skip for now.** Turnstile. The session Durable Object. Return-visit memory. Any
transcript storage. Per-session token budgets. Redaction, since there is nothing to
redact.

That is maybe a day of work and it is genuinely safe, because the three things that
bound the bill (`max_tokens`, the gateway throttle, and the Console spend limit) are
all present and none of them depends on correctly identifying an attacker.

### What has to change if it gets popular

In roughly this order, triggered by roughly these signals.

**When you see requests without a session token, or the gateway throttle actually
trips.** Add Turnstile. This is the first real upgrade and it is the one that changes
the attacker's cost the most.

**When you want to read what people asked.** Add the `ChatSession` Durable Object,
move the transcript server-side, and at the same moment write the retention policy and
the one-line notice. These two changes must ship together. Storing transcripts without
deciding retention is the mistake.

**When the bill crosses whatever number makes Evan uncomfortable.** The lever is prompt
size, not rate limits. Move corpus out of the resident prompt and behind a lookup tool
and re-measure. Check `cache_read_input_tokens` in the usage response before assuming
caching is working, since a prompt below the model's minimum cacheable prefix caches
silently not at all.

**When the per-colo weakness of the rate limit binding actually shows up**, which looks
like a suspiciously even distribution of traffic across regions. Move the counter into
the Durable Object, which is exactly what Cloudflare's docs recommend for accurate
global counting.

**When free-plan CPU becomes the limit.** The symptom is CPU-exceeded errors on long
streamed responses, not a cost problem. Move to Workers Paid at $5 a month, which
raises the default CPU budget from 10 ms to 30 seconds and the external subrequest
limit from 50 to 10,000. The Free plan's 100,000 requests a day will not be the thing
that breaks first.

---

## Rough monthly cost at plausible traffic

Portfolio sites do not get chatbot traffic like products do. A realistic figure for a
site Evan shares deliberately is somewhere between twenty and a hundred conversations a
month, with a spike on the day he posts it.

At **100 conversations a month**, six turns each, roughly eight model calls per
conversation, Sonnet 5, and an 8,000 token resident prompt with 1 hour caching, with
maybe half of conversations arriving cache-cold.

| Line item | Monthly |
|---|---|
| Model calls (~800 at ~$0.008 each) | ~$6 |
| Cache writes (~50 cold arrivals at ~$0.05) | ~$2.50 |
| Cloudflare Workers | $0 free, or $5 paid |
| AI Gateway, Turnstile, Durable Objects | $0 |
| **Total** | **~$9 to $14 a month** |

Same traffic with a 25,000 token resident prompt instead of 8,000 is roughly **$25 to
$30 a month**, which is the prompt-size lever from 3.2 showing up in the only place
that matters.

The bad day, where the link does well and a thousand conversations happen in
twenty-four hours, is roughly **$90 to $100** if nothing throttles. With the AI Gateway
circuit breaker set sensibly it is bounded well below that, and the experience degrades
to "AI Evan is busy right now" rather than to an invoice.

I would set the Anthropic Console spend limit at **$50 a month**. High enough that a
genuinely good day does not silently break the site, low enough that a bad week is an
annoyance rather than an event.
