# 03 — Corpus

**What should AI Evan know, and where does it come from?**

Scope: this doc answers the data question only. Truthfulness and evals are `01-*`;
operations are `02-*`. Everything here assumes the corpus lives in the system prompt,
not a retrieval index.

---

## The finding that reframes the problem

Before any of the source-by-source analysis, one thing came out of the inventory that
changes what this project is:

**The resume is already wrong.**

`public/EvanJolley_Resume.pdf` says:

> Patronus AI — September 2026 – Present — *Member of Technical Staff, Growth*

Every Patronus artifact in the inbox and in Granola — the interview confirmations, the
calendar titles, the offer thread — calls the role **Founding Marketer**. Separately,
there is an active a16z New Media contract in the inbox with a start date, and it does
not appear on the resume at all.

Neither of those is a scandal. They are the normal lag of a career moving faster than
the PDF that describes it. But they matter enormously here, because a resume PDF is a
document a human reads once and forgives. A chatbot is a thing that will confidently
repeat a wrong job title to a recruiter, at 3am, forever, without Evan in the room.

So the first conclusion is a governance one, not a sourcing one:

> **There must be exactly one canonical fact file, it must not be the PDF, and updating
> it must be the same action as updating the resume.**

If the corpus is assembled by scraping several sources that each half-agree, the agent
inherits the disagreement and resolves it by picking whichever phrasing is nearest in
the context window. That is the single most likely way this thing embarrasses him.

---

## Half 1 — What actually makes a persona agent sound like a person

Four findings from the literature matter here, and three of them push in the same
direction: **toward a small, deliberately made, spoken-register corpus, and away from
everything Evan currently has lying around.**

### 1. Few-shot style imitation works, plateaus almost immediately, and is worst at exactly the register this project needs

The most directly relevant paper is *"Catch Me If You Can? Not Yet: LLMs Still Struggle
to Imitate the Implicit Writing Styles of Everyday Authors"*
([arXiv 2509.14543](https://arxiv.org/abs/2509.14543)) — 400+ real authors, 40,000+
generations, six frontier models, across news, email, forums and blogs.

Two results decide the corpus design.

**More examples stop helping fast.** The main setup uses five in-context writing
samples. Ablating across 2, 4, 6, 8 and 10 examples, the authors report that adding more
"affects the four metrics very little." Returns flatten around four or five. This is the
empirical answer to "handful vs large scrape": **there is no version of this where 200
samples beats 20.** Few-shot does beat zero-shot, so examples are doing real work — they
just cap out.

**The cap is much lower for informal writing.** Authorship-verification accuracy on the
generated text is 95%+ for news and email, and collapses to **19–21% for blogs and
forums**. Models can imitate formal, structured registers. They largely cannot imitate
how a specific person sounds when they are being casual. A game chat box is the blog/forum
end of that spectrum, not the news end. So the honest expectation is that this is the
hard case, and it will take deliberate work rather than volume.

Corroborating: [STYLL](https://arxiv.org/pdf/2212.08986) on imitating non-famous authors
from a handful of texts, and the ACL 2022
["Recipe for Arbitrary Text Style Transfer"](https://aclanthology.org/2022.acl-short.94.pdf),
whose finding is quietly important — *augmented zero-shot* prompting, meaning a
natural-language **description** of the style plus generic exemplars, rivals task-specific
few-shot. A well-written paragraph describing how Evan talks may be worth as much as the
samples themselves. [Register-analysis steering](https://arxiv.org/abs/2505.00679)
(Yang & Carpuat 2025) pushes the same way: having a model extract explicit register
descriptors from exemplars and write against those beats relying on the exemplars alone.

### 2. Curated and summarized beats raw and voluminous — this one has real evidence

Amazon's *"Integrating Summarization and Retrieval for Enhanced Personalization via
LLMs"* (CIKM'23, [arXiv 2310.20081](https://arxiv.org/abs/2310.20081)) found that
task-aware **LLM-written summaries of the user** match or beat raw retrieval over that
user's history on most [LaMP](https://aclanthology.org/2024.acl-long.399/) tasks **with
75% less retrieved user data** — and in sparse-data settings beat retrieval outright.

The practitioner reports agree, independently. Ammon Haggerty's public
[digital twin](https://github.com/ammonhaggerty/my-digital-twin) is a system-prompt-only
persona bot built on a 30–40k word corpus; his stated breakthrough was
**pre-processing long-form articles into structured summaries rather than pasting raw
prose.** Dan Shipper's
[podcast-trained bot](https://every.to/chain-of-thought/i-trained-a-gpt-3-chatbot-on-every-episode-of-my-favorite-podcast)
reproduced the subject's idiolect well from raw transcripts but produced answers that
were "subtly wrong"; his retrospective fix was to clean the transcripts into tight,
clearly-defined explanations.

Same conclusion three times from three directions: **distillation beats dumping.** This
is a licence to hand-assemble ~15k tokens and not feel like you are cutting corners.
Hand-assembly is the technique, not the budget-constrained fallback.

### 3. Spoken versus written: a corpus of his writing encodes *writing*, and you cannot subtract it

This is the finding that should drive the whole plan, and I want to be honest that it is
**strong theory plus strong indirect measurement, not a direct experiment.** No paper
I found tests "prompt on essays, measure conversational naturalness."

The theory is Biber's multidimensional register analysis
([overview](https://jan.ucc.nau.edu/biber/Biber/Biber_2012.pdf)), which is about as
settled as descriptive linguistics gets: factor analysis over 67 linguistic features
across 23 spoken and written genres. Conversation and informational writing sit at
**opposite ends of Dimension 1** (involved vs informational production). Conversation is
pronoun-heavy, present-tense, contraction-heavy, hedge-heavy, low type-token ratio, low
nominalization. Informational writing relies on **phrasal** modification; conversation
relies on **clausal** modification — a deep structural difference that no amount of
"be casual" in a system prompt reaches. For scale of the gap: in conversation the
complementizer *that* is deleted **over 80%** of the time; in newspaper writing with
non-coreferential subjects, ~15%.

The consequence for this project is precise. Register is a property of the **text**, not
the author. A corpus of Evan's portfolio prose encodes *Evan-plus-written-register*, and
the model has no way to factor those apart. Prompt on it and you get a bot that talks
like a portfolio — which is not a small miss, because it is the miss that reads as
"chatbot".

And the model's own defaults make it worse rather than better. Multidimensional analysis
of [AI-generated vs human text](https://www.sciencedirect.com/science/article/abs/pii/S2666799123000436)
finds ChatGPT disfavors narration and shows **substantially less register variation than
humans** — quantified as much lower variance in text-level factor scores. The base model
already collapses toward a narrow mid-formal band. Notably, it also **under**-produces
interactional metadiscourse (hedges, boosters, attitude markers), which cuts against
folk wisdom: LLMs over-hedge *epistemically* ("it's worth noting that it depends") while
under-producing the *interpersonal* stance markers ("honestly", "I mean", "yeah, no")
that make speech sound like a person.

So: written source material biases toward written register, and the model's prior biases
toward mid-formal, and those errors compound in the same direction. The corrective is to
source from material that is already in the target register. It is not a coincidence
that the self-clone research ([arXiv 2509.06393](https://arxiv.org/pdf/2509.06393))
reaches for the subject's **chat logs**, not their essays.

Practical rule that falls out of this, and out of the register-steering paper:
**quarantine content from style.** Essays and site prose go in as *what Evan thinks*.
Transcripts and a written register description go in as *how Evan talks*. Do not let one
block try to do both jobs.

### 4. Structured facts versus prose — split them, and keep the persona block short

The sibling doc owns truthfulness; here is what bears on **corpus shape**.

**For lookup questions, structure wins.**
["Better Think with Tables"](https://arxiv.org/html/2412.17189v3) fed identical data to
eight models as plain text, pipe-delimited tables, JSON and knowledge-graph triples.
Tables won nearly every operation — retrieval +6.6pp F1, update +11.96pp, deletion
+5.7pp — and were also the **most token-efficient** representation at every sparsity
level, degrading least when 90% of attributes were missing. That last property maps
exactly onto a career record where most roles lack most fields.

**For "why" questions, prose wins.** A 2025 structure benchmark
([arXiv 2510.26238](https://arxiv.org/abs/2510.26238)) found markup better for rigid
lookup (counting, reverse lookup) but **narrative better for multi-hop and "concept
aggregation"** reasoning. That is precisely the split in this product. *"What year did he
leave Arize"* is rigid lookup. *"Why did a growth person go to an eval company"* is
concept aggregation. **Both formats earn their place; they just answer different
questions, so keep them in separate blocks.**

**Coherent narrative is actively penalized in long context.** This is the most
counterintuitive result I hit and it deserves attention. Chroma's
[Context Rot](https://www.trychroma.com/research/context-rot) study (18 models including
Claude 4, GPT-4.1, Gemini 2.5) found models scored **better on shuffled haystacks than on
logically coherent ones** — "structural coherence consistently hurts model performance."
A beautifully flowing career narrative is the exact structure that finding punishes.
Chroma also found that on LongMemEval, the same questions against a ~113k-token full
context versus a ~300-token focused context favoured the focused context for every model,
**with Claude showing the largest gap.**

**Persona length is a direct tax on factual accuracy.** The PRISM paper
([arXiv 2603.18507](https://arxiv.org/abs/2603.18507)) reports MMLU at **71.6% baseline →
68.0% with a minimal persona → 66.3% with a long persona.** Personas help alignment and
framing tasks and hurt memorized-knowledge tasks; the proposed mechanism is that persona
pushes the model into instruction-following mode at the cost of recall. This corroborates
Zheng et al.'s [*"When 'A Helpful Assistant' Is Not Really Helpful"*](https://aclanthology.org/2024.findings-emnlp.888/)
(EMNLP Findings 2024; 162 personas, 2,410 factual questions, four model families), which
found **no statistically significant improvement from any persona** over a no-persona
control, and some personas actively harmful. One usable detail from it: *audience*-specific
framing ("you are talking to a hiring manager") beat *speaker*-specific framing, small but
significant.

> Both results point the same way: **every extra paragraph of persona costs accuracy.**
> That is a strong argument for a shorter corpus than the 20–30k this project budgeted.

**Style exemplars can be copied verbatim into factual answers.**
[Cho et al.](https://arxiv.org/abs/2601.10809) show style features are entangled, not
independently controllable — instructing brevity measurably degrades factual accuracy and
apparent expertise. And a
[persona-dialogue ICL study](https://arxiv.org/abs/2402.09954) documents a "dialogue
co-occurrence reinforcement phenomenon": when a demonstration's context resembles the
query context, the model **lifts a response straight out of the demonstration.** That is
the contamination mechanism, named, in exactly this setting. The mitigation is concrete:
keep voice exemplars **short, topically distant from likely factual questions, and
containing zero career claims.** If an exemplar contains a plausible invented detail, it
can be copied out as fact.

**Layout.** Anthropic's own
[long-context guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/long-context-tips)
says that past ~20k tokens you should put longform data **at the top, above instructions
and examples**, wrap it in XML document tags, and ask the model to quote relevant source
spans before answering — queries-at-the-end improving quality by up to 30% in their
tests. Combined with ["Lost in the Middle"](https://aclanthology.org/2024.tacl-1.9/)
(U-shaped attention, >30% degradation at worst middle positions) and the persona-drift
finding above, the layout is forced: **records at top, behaviour rules at bottom, nothing
load-bearing in the middle.**

**The real ceiling is rule count, not tokens.**
[IFScale](https://arxiv.org/abs/2507.11538) (500 instructions, 20 models) found frontier
models at only **68% adherence at 500 instructions**, with reasoning models holding near
perfect until a **threshold around 150–250** and then falling off sharply — plus a
documented bias toward earlier instructions. Keep the behavioural rule list well under
50, most important first.

**Abstention has to be instructed, and it costs recall.**
[AbstentionBench](https://arxiv.org/abs/2506.09038) (Meta; 20 models, 35k unanswerable
queries) found abstention recall ranging from near-perfect to near-zero, that **scale does
not fix it** (Llama 3.1 8B→405B shows almost no effect), and that **reasoning fine-tuning
makes it 24% worse.** A custom abstention-encouraging system prompt does help without
significant precision loss. But there is a tax:
["Not All Needles Are Found"](https://arxiv.org/abs/2601.02023) A/B'd a "don't make it up"
prompt and saw GPT-5-mini faithfulness rise 74.1% → 89.8% while **literal extraction fell
96.4% → 90.3%** — a failure they name "faithfulness masking," where the model answers
"not mentioned" even when the evidence is right there. Over-refusal disguised as
grounding.

The countermeasure is a two-sided rule rather than a blanket prohibition: *"if a record
covers the question you must answer from it; decline only when no record covers it"* —
plus quote-before-answer, which raises grounding by making the model **look** rather than
**hedge**. That paper also found fact *distribution* mattered enormously: centrally
clustered facts collapsed extraction to 0% under anti-hallucination prompting, while
uniform distribution held 100%. **Do not bury a dense block of dates in the middle of the
prompt.**

**Caching, briefly, because it makes the size question cheap.** Under current Claude
[prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/long-context-tips),
cache writes cost 1.25x base input at 5-minute TTL and reads cost 0.1x, and the 5-minute
cache **refreshes free on every read** — so a site with steady traffic keeps it warm
indefinitely. A ~30k system prompt is roughly $0.19 to write once and ~$0.015 per call
thereafter. The constraint on corpus size is therefore **accuracy, not money**. Note that
the cache hierarchy is tools → system → messages, so any edit to the system block
invalidates everything after it: put the stable corpus in one cached block and never
tweak it mid-session.

### 5. Where it stops being a person and starts being a chatbot wearing a name

Four documented failure modes, ordered by how badly each would hurt this specific product.

**Refusing to not know things.** The best-documented tell, and the one most likely to bite
here. [CHARM](https://arxiv.org/abs/2609.01352) separates *boundary-awareness* (noticing a
question is outside the character's knowledge) from *boundary-compliance* (actually
abstaining), and finds character hallucination is driven **predominantly by compliance
failures** — models explicitly acknowledge a query is out of scope and then answer
anyway, with verified cases of the base model's own knowledge overriding the persona.
[Character-LLM](https://arxiv.org/pdf/2310.10158) had to invent "protective experiences"
— training data in which the character explicitly declines to know something — to suppress
this. Haggerty's field report is the same thing in plain English: the twin invents
"detailed but entirely fictional narratives" and "no amount of rule-setting seems to curb
its default eagerness."

*Direct implication for the corpus:* the recording needs Evan saying "I don't know" and
"I'd rather not get into that" in his own voice, on tape, several times. Those are
protective examples. That is why group E of the interview asks for them explicitly, and
it is one of the few things on this list that raw source material can never provide.

**Sycophancy.** [ELEPHANT](https://arxiv.org/abs/2505.13995) (ICLR 2026) finds that across
11 models, LLMs preserve the user's face **45 percentage points more than humans**, and
affirm **both sides of the same conflict in 48% of cases**. The paper also shows this is
rewarded in preference data, so it is baked in at the RLHF layer and prompt-level
mitigation is "limited in effectiveness". A recruiter probing "so you're not really
technical, are you?" is a face-threatening question, and the default behaviour is to fold.
Worth an explicit eval case.

**Persona drift.** [Li et al.](https://arxiv.org/abs/2402.10962) measure **significant
persona drift within eight rounds** of self-chat on LLaMA2-70B, with a clean mechanism:
attention to system-prompt tokens is stable *within* a response but drops sharply each
time a new user message is appended. [Identity drift across 9 models](https://arxiv.org/abs/2412.00804)
adds two uncomfortable findings — **larger models drift more**, and assigning a persona
may not help maintain identity. Since the inference-time fixes need model internals,
the practical lever through a hosted API is **restating the persona near the end of
context**, which also sidesteps Lost-in-the-Middle.

**Getting lost across turns.** Laban et al.,
["LLMs Get Lost In Multi-Turn Conversation"](https://arxiv.org/abs/2505.06120) — every
top model, **average 39% performance drop** multi-turn vs single-turn over 200k+ simulated
conversations. The decomposition is the useful part: aptitude loss is only 15%, but
**unreliability rises 112%**, and "when LLMs take a wrong turn in a conversation, they get
lost and do not recover." One off-voice reply early poisons the session. For a walk-up
chat box this argues for short sessions and a cheap reset.

**Assistant-ese**, finally, is the sum of the register findings above: uniform response
length where humans alternate short and long, listicles in conversation, uniform
cautiousness where humans vary certainty with evidence, closing summary paragraphs, and a
friendliness register no adult uses outside customer support.

### The honest caveat

[Fine-tuning beats prompting for tone of voice](https://arxiv.org/abs/2507.04889), and the
margin is not small — the paper hits a high rate of genuinely conversational output with
only **100 training samples**, and attributes prompting's failure to "instruction
following limitations and in-context bias" rather than to a fixable prompt.
[Panza](https://arxiv.org/pdf/2407.10994) finds all fine-tuning regimes beat
pretrained+RAG "by a large margin" on matching a user's writing style.

Meanwhile the opposite ordering holds for *facts*: a LaMP-family
[survey](https://arxiv.org/pdf/2406.17803) reports retrieval-based personalization at
+14.92% versus parameter-efficient tuning at +1.07%. The reconciliation is clean —
**fine-tuning is good at register, context is good at facts**, and a system prompt has to
do both jobs at once. So expect the *style* half to be the weaker half, and plan for the
voice to land at maybe 80% and stay there.

That is an argument for leaning into the game chat box rather than fighting it. Haggerty
deliberately avoided realistic avatar and voice cloning specifically to dodge the uncanny
valley. A blocky Minecraft character in a chat window sets an expectation that a
photorealistic talking head does not. **The medium buys back the 20%.**

---

## Half 2 — What Evan actually has

Ratings are **signal** (how much does this teach the agent that nothing else does),
**effort** (what it costs to turn into corpus), and **privacy** (what it costs him to
use it). Privacy is rated as cost, so low is good.

### Summary table

| Source | Good for | Signal | Effort | Privacy cost | Verdict |
|---|---|---|---|---|---|
| Structured fact file (to be written) | Facts, dates, numbers | **Very high** | Medium | None | **Build it** |
| Recorded interview with Evan | Voice, stories, opinions | **Very high** | Medium | None (he controls it) | **Build it** |
| evanjolley.com role writeups | Facts + written voice | High | None (done) | None (published) | **Use as-is** |
| Granola interview transcripts | Conversational voice, stories | **Very high** | High | **High** | **Flag — his call** |
| Resume PDF | Dates, titles, spine | Medium | None | Low (already public) | Use as a checklist, not as text |
| Bilibili channel | How he talks on camera | Medium | High | Low (public) | Later, narrow slice |
| GitHub repos | Proof he builds | Low-medium | Low | Low | Thin facts only |
| No Logo blog (196 files) | Nothing he needs | Very low | Low | Low | **Exclude** |
| Gmail | Nothing he needs | **Very low** | High | **Very high** | **Exclude** |
| Google Drive | Nothing he needs | Very low | Medium | **Very high** | **Exclude** |
| Linear | Nothing he needs | Very low | Medium | Medium (employer's) | **Exclude** |

---

### Resume PDF — `public/EvanJolley_Resume.pdf`

One page, ~460 words, **~800 tokens**. Already in the repo and already served by the
site, so there is no acquisition cost at all.

It is a good *skeleton* and a bad *corpus*. Good: it is the complete list of employers
with dates, and it carries the load-bearing numbers — $100K to $8M run rate in 15
months, 150,000+ Perplexity student users in 3 months, 250+ ambassadors across 140
universities, 0 to 100K Bilibili followers in 72 days. Those are exactly the facts a
recruiter will ask for and exactly the facts an agent must never round or embellish.

Bad: resume prose is a register no human speaks. "Drove product strategy for the
software that runs No Logo's operations across factory quoting, sampling, production
tracking, and fulfillment" is a fine bullet and a terrible sentence to say out loud in a
chat box. Feed the PDF's *facts* into the fact file by hand; do not paste its *text*
into the prompt, because the model will imitate the nearest register it can see and
resume-ese is a strong attractor.

Also: it is the stale artifact described above. Treat it as an output of the fact file,
not an input to it.

### evanjolley.com role writeups — the best thing that already exists

This is the find of the inventory. The personal site (`evanjolley/evanjolley-site`,
single 13MB `index.html`) contains a JS data structure with first-person `prose` blocks
for **eight roles** — No Logo, Bilibili, Perplexity, Arize AI, Cornhusker Boys State,
Atomic, Offline Ventures, Play With Heart.

Stripped of the base64 assets, the prose totals **5,540 characters / ~1,110 words /
~1,400 tokens**. It is already written, already public, already in his voice, and it
covers **three roles the resume PDF omits entirely** (Atomic, Offline Ventures, Play
With Heart).

The register is right for a portfolio and only half-right for a chat box. Compare the
same fact in two places. Resume:

> Joined as employee #2 at a $100K revenue run rate and helped scale to an $8M run rate
> in 15 months

Site:

> I joined as an early employee when GMV was running at $100K a year and helped push it
> to $8M in 15 months.

The second is a human sentence. It is still *written* — measured, no filler, complete
clauses — but it is first person, it uses plain verbs, and it does not stack
prepositional phrases. That is a much better starting point than the PDF and it costs
nothing to use.

Two cautions. It is *polished* written prose, so on its own it will produce an agent
that sounds like a well-edited person rather than a talking one — which is the register
problem in Half 1. And it disagrees with the resume in places (the site calls No Logo
"Product & Growth · Early Employee", the resume says "Product and Growth (Employee
#2)"; the site says GMV, the resume says revenue — **those are not the same metric and
someone will ask**). Reconcile before shipping.

**Verdict: use all ~1,400 tokens, after reconciliation. Best signal-per-token of any
existing artifact.**

### Granola meeting transcripts — the highest-signal source, and the one to think hardest about

Granola holds **11 meetings in the last 30 days**. The composition is the point:

- **5 meetings** are the Patronus AI Founding Marketer loop — hiring manager screen,
  deep dive, peer sync, case study debrief, founder sync.
- **4 meetings** are the a16z New Media loop.
- The rest are intro calls with the same two orgs.

Nine of eleven recent meetings are **Evan being interviewed about his career by people
evaluating him**. That is not adjacent to the AI Evan use case. That *is* the use case,
verbatim, with a human doing it. Every question a recruiter would type into the game
chat box — what did you own at No Logo, why did you leave, what would you do in the
first 90 days, what is the hardest thing you shipped — was asked of him in these
recordings, out loud, under pressure, and he answered in real spoken English.

Nothing else in the inventory is remotely as good for voice. The personal site tells you
how he writes. These tell you how he *talks about exactly this subject*.

And it is the source I would most hesitate over.

- **Third parties are in every one.** Named individuals at Patronus and a16z, speaking
  candidly in a hiring context, who did not consent to being training data for a public
  chatbot.
- **It is commercially sensitive.** A case study debrief and a founder sync contain the
  other side's strategy, and a contract-adjacent conversation may contain comp.
- **One loop is with his current employer.** Patronus is where he starts. Interview
  transcripts with your own new employer are an awkward thing to have quietly powering a
  public website.
- **Granola's API only exposes `last_30_days`.** So this is a rolling window, not an
  archive — whatever is taken has to be taken deliberately, not synced.

There is a real mitigation, and it is worth stating precisely because it changes the
calculus a lot: **the transcripts are diarized, and only Evan's turns are needed.** The
interviewers' questions can be dropped entirely — they are not his voice and they carry
almost all of the third-party content. What survives is a monologue-only extract of one
person describing his own work. That removes most of the privacy surface, though not the
part where he discusses the other company.

Even so: this is not a call I will make for him, and it is not a call an agent should
make silently. Realistic yield from an Evan-only extract of two or three sessions is
**3,000–6,000 tokens** of genuinely conversational career talk, which is more than
enough — you do not want all nine.

**Verdict: the highest-signal source available, gated on Evan's explicit approval, and
only as an Evan-turns-only extract from sessions he names. It does not get its own line
in the budget below, because if he approves it, it improves components #3 and #5 rather
than adding to them — real spoken answers replacing interview answers. If he says no, the
recorded interview in "Questions for Evan" replaces it at ~80% of the value and 0% of the
privacy cost. That is why the interview is the recommendation and this is the upgrade.**

### Gmail — I agree with the lead engineer, and more strongly than he put it

The advice was: don't mine email, poor signal-to-noise, mostly logistics, wrong
register, large privacy surface. I checked rather than assumed, with a metadata-level
sample of sent mail.

**Volume:** ~201 sent threads in 90 days.

**Composition of the most recent 20 threads**, characterised without reproducing
content: apartment hunting via Craigslist (four separate threads), a billing dispute and
refund chase with a subscription service, interview *scheduling* logistics (not
interview content), HR onboarding forms, a contract terms confirmation, and a
negotiation with a landlord about a family member.

The register finding is the decisive one. His actual sent-mail voice, at length, is
things like "Works great for me, thanks! Evan" and "Hi there, I should be free for the
first half of the day PST." Transactional email is *not a compressed version of how
someone talks*. It is a separate register with its own conventions — salutation,
minimal body, sign-off — and an LLM given a few thousand of those will learn to be
clipped and courteous and say nothing. That is the worst possible failure mode for this
product, because it is the failure mode that looks like success: fluent, polite,
on-brand, empty.

The privacy surface is worse than "large". In a 20-thread skim I incidentally saw his
home address, phone number, contract terms, a tax-adjacent thread, and a personal
dispute involving his mother. There is no filter that reliably separates "career
substance" from that, because the career substance in email is ~2% of the volume and
sits in the same threads as the rest.

And the one thing email *could* have offered — cold outreach, since "50 cold emails a
day" is a headline No Logo fact — is not really there either, because the No Logo
outreach ran through a CRM he built, not his personal Gmail.

**Verdict: exclude entirely. Not "sample carefully" — exclude. The lead engineer was
right, and the register argument is a better reason than the noise argument.**

### Bilibili — right medium, wrong subject, wrong language

Live follower count pulled from the API: **282,162** (the resume's "280k" is accurate
and about to be stale — another argument for the fact file owning numbers).

This is the only existing source that is *Evan speaking on camera at length*, which is
the right medium. But the subject matter is wrong. The channel is educational content
about American culture made for a Chinese audience, largely in Mandarin — conversations
with his grandfather about the Army and motorcycle clubs, Midwest life, a video about
being a small-town kid who got to Harvard. Almost none of it is about his professional
work, and the parts that are personal are in the wrong language for the site's visitors.

Cost is real too: transcription and translation of long-form video, to extract a voice
that is his *presenting* voice rather than his *conversational* voice.

Two things are worth keeping. First, the "small-town kid at Harvard" video is a genuine
biographical story and the only place a real *origin story* exists on tape — that is
worth mining as a story, not as style. Second, the channel itself is a **fact** the
agent must hold, because "you have 282K followers on Chinese YouTube" is the single most
memorable thing on his resume and recruiters will ask about it.

He has also said he plans to record himself talking through his resume. **That plan is
the single best idea in this whole inventory** and it is what the "Questions for Evan"
section is designed to make concrete.

**Verdict: not a style corpus. Keep as a hard fact plus one story. Revisit only if the
planned resume-narration recording happens, at which point it is the primary source.**

### No Logo blog — exclude for voice, near-zero for facts

The repo (`evanjolley/io-style-template`, private) has **196 blog-related paths** out of
417 total — articles plus per-article hero images on topics like "alternatives to
traditional manufacturing", "best countries to manufacture products", "do you need an
LLC to sell products".

The brief already flagged the concern and the concern is correct, but the actual reason
to exclude is sharper than "brand voice". This is **SEO content**, written to rank. SEO
content has a house style that is the *inverse* of what this agent needs: keyword-front
loaded headings, definitional openers, exhaustive coverage of a topic regardless of what
was asked, and a confident, complete tone that never says "I don't know". Train a
persona on it and you get a chatbot that answers every question with a structured
overview. That is precisely the uncanny failure mode.

There is also an authorship problem. Evan *edited* or oversaw a large number of these
rather than writing every word, so the corpus does not cleanly represent any single
human's voice.

The one thing worth extracting is a single sentence of fact — that he built and ran No
Logo's content operation at this scale — which belongs in the fact file and costs about
20 tokens.

**Verdict: exclude the text. Keep one fact.**

### GitHub — thin, but cheap and non-zero

24 repos, 5 public. The public ones that matter: `minecraft-resume-world` (this project),
`gazegate` (a webcam eye-contact app, with a private iOS sibling), `evanjolley-site`.
Private ones span Python, TypeScript and Swift.

This is weak voice signal — commit messages and READMEs are their own terse register —
but it is real evidence for a claim a recruiter will probe: that a growth person
actually ships code. The `minecraft-resume-world` README and the fact that the visitor
is *standing inside* the repo while asking is a nice, cheap, verifiable hook.

**Verdict: 3–4 sentences of fact in the fact file. Do not ingest source or commit
history.**

### Google Drive — near-zero signal, high privacy cost

Searched; the career-adjacent results are **a decade of near-duplicate resume
versions** (`.docx`, `.pdf`, Google Docs, back to 2019), plus tax return documents,
invoices, a W-9, transfer credit records, and old coursework. There is nothing here the
fact file will not have, and a lot here that must never go near a public chatbot.

**Verdict: exclude. The one legitimate use is checking an old resume version to recover
a date he has forgotten — a manual lookup, not an ingest.**

### Linear — exclude

Work tickets from his employer. Wrong register (terse task language), not his to
publish, and the facts are at a granularity no recruiter asks about.

### Evan himself — the source the whole thing should be built on

Everything above is an artifact produced for some *other* purpose — a PDF for
applicant-tracking systems, a portfolio for skimming, an SEO article for Google, an
email to book a call. None of it was produced to answer "so what was No Logo actually
like".

The corpus this agent needs mostly does not exist yet, and the cheapest way to create it
is to ask him and record the answers. It is the highest-signal source, it has zero
privacy cost because he controls every word, it produces spoken register by
construction, and it is the only source that can contain the things recruiters actually
want and no artifact holds: why he left, what went wrong, what he'd do differently, what
he wants next, and what he'd say when he doesn't know.

The interview is in the last section and it is the actionable part of this document.

---

## What I would actually build the corpus from

The brief budgeted 20–30k tokens. **I would spend about half that**, and the research in
Half 1 is why: persona length is a measured tax on factual accuracy (71.6% → 68.0% →
66.3% on MMLU as the persona block grows), coherent long narrative is actively penalized
in long context, and focused contexts beat full ones by wide margins with Claude showing
the largest gap. The budget is not the binding constraint — accuracy is. Every token has
to earn a seat.

Ordered by build order, not by size.

| # | Component | Source | Format | Est. tokens |
|---|---|---|---|---|
| 1 | **Canonical fact records**, one per role | Hand-written from resume + site + Evan's corrections | Structured / XML-tagged, table-like fields | ~1,500 |
| 2 | **Role narratives**, 8 roles, ~120 words each | evanjolley.com prose, reconciled against #1 | Short prose | ~1,400 |
| 3 | **Story bank**, 8–12 anecdotes | Interview, group B | Short prose, one per block | ~2,500 |
| 4 | **Opinions & motivations** | Interview, groups C + D | Short prose | ~1,500 |
| 5 | **Voice exemplars**, 12–18 Q&A pairs | Interview, groups C + E, hand-picked | Verbatim dialogue | ~1,500 |
| 6 | **Refusal & boundary rules** | Interview, group F | Rules, <50 total | ~600 |
| 7 | **Persona block** | Written, deliberately minimal | Rules | ~400 |
| | **Total** | | | **~9,400** |

That leaves generous headroom under the original budget for the booking flow `02-*` will
add, and it is in the range where the long-context evidence says the model is still
reliable.

**The shape matters as much as the contents.** Layout is forced by three separate
findings — Anthropic's own long-context guidance (longform data at top, above
instructions), Lost-in-the-Middle's U-shaped attention, and the persona-drift finding
that attention to the system prompt decays as user turns accumulate:

1. **Top:** fact records (#1), XML-tagged, one document block per role.
2. **Upper middle:** role narratives and story bank (#2, #3).
3. **Lower middle:** opinions (#4).
4. **Bottom:** voice exemplars (#5), then boundary rules (#6), then the persona block
   (#7) **last**, so the behavioural constraints sit in the high-attention tail and get
   re-read closest to each new user turn.

Two layout rules that came straight out of the research and are easy to get wrong:
**spread dates and numbers evenly rather than clustering them** (clustered facts collapsed
extraction to 0% under anti-hallucination prompting in one study, versus 100% when
uniformly distributed), and **keep voice exemplars topically distant from likely factual
questions** — the documented copying phenomenon means an exemplar that resembles the
query context can be lifted verbatim, so no exemplar should contain a career claim.

Notes on the ordering:

**#1 first and alone.** Build the fact records before anything else and make them the
single source of truth for every number, date and title. Regenerate the resume PDF *from*
them. If only one thing on this list gets done, it should be this, because it is the fix
for the Founding-Marketer-vs-Member-of-Technical-Staff problem and that problem is live
right now on a site that is already serving the PDF.

**#3 through #5 all come out of one recording.** The interview is the main event;
everything else is scaffolding around it. It is one 90-minute session that produces three
of the seven components.

**#5 is separate from #3 on purpose.** The stories teach the model *substance*; a small
hand-picked set of exemplar exchanges teaches it the *shape* of a reply — length, opener,
how he handles a question he can't answer. Keeping them as a labelled block rather than
burying them in the transcript makes it possible to tune the voice without re-cutting the
corpus, and keeps the copying risk contained to a block you can audit.

**#7 stays short deliberately.** The instinct is to write a loving character description.
The evidence says that costs accuracy for no measured gain — no persona in Zheng et al.'s
162 beat the no-persona control on factual questions. Say who he is, say who he's talking
to (audience-framing beat speaker-framing), and stop.

**What is not on this list: the raw interview transcript.** ~8,000 tokens of unedited
speech was my first instinct and the research argues against it — distillation beats
dumping, three times over from three directions (Amazon's 75%-less-data result,
Haggerty's summarize-don't-paste breakthrough, Shipper's transcript cleanup). Record the
full 90 minutes, then cut it to #3, #4 and #5. Keep the raw transcript out of the repo.

**Deliberately excluded, and why:**

- **Gmail.** Wrong register, catastrophic privacy surface, ~2% useful. Covered above.
- **Google Drive.** Old resumes and tax documents. Nothing to gain, plenty to lose.
- **The No Logo blog's 196 articles.** SEO register actively teaches the failure mode.
- **Linear.** Not his to publish, and nobody will ask.
- **The resume PDF's prose.** Its facts, yes. Its sentences, no — they are a register
  attractor that will drag every answer toward bullet-point English.
- **Bilibili video transcripts.** Wrong subject, wrong language, high transcription cost.
  Two facts and one story survive; the rest does not earn its tokens.
- **Any bulk scrape of anything.** The entire recommended corpus is hand-assembled. At
  15K tokens, hand-assembly is a day of work, and every token being deliberate is worth
  more than any volume of scraped text.

**The one thing I would add that is not a source:** a short "as of" date at the top of
the fact file, and a rule that the agent states it when asked about anything current.
An agent that says "as of when this was written in September 2026, I was about to start
at Patronus" ages gracefully. One that says "I work at Patronus" is wrong the day he
leaves, and nobody will notice for a year.

---

## Questions for Evan

This is the interview. It is designed to be **recorded and transcribed, not typed** —
typed answers will come out in written register and defeat the purpose. Talk, ramble,
leave the false starts in. The cleanup happens later.

Rough timing: 75–100 minutes. It splits cleanly across two sessions at group C.

Two rules while recording:

1. **Say numbers out loud every time, even when it feels repetitive.** "We went from a
   hundred thousand to eight million in fifteen months" needs to appear in the corpus as
   spoken words, not just as a row in the fact file, or the agent will recite the number
   in a different voice from the rest of the sentence.
2. **When you don't know or don't want to answer, say so on tape, in your own words.**
   Those clips are the most valuable thing in the whole recording. They are the only way
   the agent learns to decline like you instead of like a chatbot.

### Group A — The record (15 min, answer fast, this is the fact file)

1. Walk the timeline out loud, start to finish, with months. Every role including the
   ones not on the PDF — Atomic, Offline Ventures, Play With Heart, Arize, and anything
   from before those.
2. **What is your Patronus job title?** The resume says Member of Technical Staff,
   Growth. Everything else says Founding Marketer. Which one does the agent say?
3. **What is the a16z New Media arrangement and is it public?** It is not on the resume.
   Is it a job, a contract, a scout role, something else? Can AI Evan mention it at all?
   If a recruiter asks "what are you doing right now", what is the true answer?
4. No Logo: is $100K → $8M **GMV** or **revenue**? The site says one, the resume says the
   other. Also — run rate at what points exactly, and over which fifteen months?
5. Harvard: graduation year, degree as it should be stated, and any concentration detail
   you want said.
6. Bilibili follower count — it is 282,162 today. What number should the agent give, and
   how should it hedge that the real number moves?
7. Where do you live and where will you live? The agent will get asked about location and
   remote/onsite constantly and it is the one fact that changes fastest.
8. Are you open to opportunities, and what is the honest answer the agent should give
   given that you are two weeks from starting somewhere?

### Group B — The roles (35 min, this is where the stories are)

For **No Logo**, **Perplexity**, **Arize**, and **Bilibili** — the four a recruiter will
actually dig into — answer all of these. For the rest, just question 1.

1. Ninety seconds: what was the company, what was your job, what happened while you were
   there.
2. **What did you personally build or do that would not have happened without you?** Name
   the thing. Not the team's accomplishment — yours.
3. Walk me through the custom CRM at No Logo. What did it actually do, what did you write
   it in, how long did it take, what broke? *(This is the single most interesting claim
   on the resume and it is one line long. A growth hire who shipped their own crawler is
   a different candidate from one who bought a tool.)*
4. What went wrong? Name a thing you got wrong, shipped badly, or had to undo. What did
   you do about it.
5. Employee #2 at No Logo: what was the company on your first day — how many people,
   what was the office, what did you personally do that first week?
6. Scaling Shenzhen from 2 part-timers to 20 people: what does "standardizing processes"
   mean in practice? What was the actual process before and after, and what was the
   hardest part of running a team in another country?
7. Perplexity: you cold-DMed the CBO. What did the message say? What happened next?
   *(This is a story, and stories are what the agent is short of.)*
8. Why did you leave? Ask it of each role and answer honestly — the agent needs a version
   that is true and that you're happy to have repeated.
9. Bilibili: why did you start it, what is the channel actually about, and what did
   growing it teach you that applies to a job?
10. Arize: you ghost-wrote technical content on RAG and agent observability in 2023.
    What did you learn about the technology from writing about it? *(Patronus is an eval
    company. Someone will connect these dots and ask.)*

### Group C — The questions you'll actually be asked (20 min)

Answer these the way you'd answer them on a call. Short, spoken, no preparation. These
become the voice exemplars.

11. "So tell me about yourself."
12. "What are you looking for?"
13. "What are you best at?"
14. "What are you bad at?" — and answer it honestly, not with a strength in disguise.
    The agent copying a fake weakness is worse than the agent admitting a real one.
15. "Are you technical?" — this is the question your profile invites and the one with
    the most room to sound either impressive or defensive. What is the true answer?
16. "You're a growth person who builds things. Which one are you?"
17. "Why should we hire you over someone who has done this before?"
18. "What do you want to be doing in three years?"
19. "Why Patronus?" — and the harder version, "why did you pick Patronus over a16z?"
20. "What's your comp expectation?" *(Answer for yourself so you can decide what the
    agent does with it — see group F. It almost certainly should refuse.)*
21. "Tell me about the Minecraft thing." — a visitor standing inside this world will ask.
    Why did you build it, how long did it take, what is it built on, what was hard?

### Group D — The things that make you a person, not a profile (15 min)

These are what separate a persona from a résumé reader. Answer conversationally.

22. What's an opinion you hold about growth or marketing that most people in the field
    would disagree with?
23. What's the best thing you've ever shipped, by your own standard rather than by
    metrics?
24. What do you actually do all day when nobody assigns you anything? *(The Bilibili
    channel, the eye-contact app, the voxel world and the finance tracker all suggest a
    pattern. Name it yourself rather than making the agent infer it.)*
25. How did a kid from Nebraska end up at Harvard, in Shenzhen, and on Chinese social
    media? Tell it as a story, out loud, once, the way you'd tell it at a dinner.
26. What are you bad at that you're actively working on?
27. What's something you changed your mind about in the last two years?
28. What do you do outside work? *(Boys State every June is on the resume and is the
    most humanizing thing on it. Say more about it than the bullet does.)*

### Group E — Voice calibration (10 min, feels silly, matters most)

29. Someone asks AI Evan a question in a game chat box. **How long should the answer
    be?** One sentence? Three? Answer out loud with an example.
30. Say, in your own words, how you'd tell a recruiter you're not interested — without
    being rude and without being mushy.
31. Say, in your own words, "I don't know." Then say "I'd rather not get into that
    here." Then say "that's not really something I can answer, but Evan can — want to
    grab time?" Say each one three different ways.
32. Do you swear? Do you use contractions? Do you ever answer with just "yeah"? Be
    honest — the default LLM register is a notch more formal than almost everyone, and
    without instruction it will smooth you out.
33. What words or phrases would you **never** say? *(You already have a rule about no
    colons and no em-dashes in written prose. Does that apply to the agent's speech, or
    is that a writing-only rule?)*
34. Read three of your own site writeups out loud, in your normal speaking voice, without
    reading them verbatim — say what they say the way you'd say it. This gives a direct
    written-vs-spoken pair for the same facts, which is the most useful calibration data
    in the whole recording.

### Group F — Boundaries (10 min, and this is the one that keeps you out of trouble)

The sibling doc on truthfulness covers *how* the agent refuses. These questions decide
*what* it refuses.

35. **Comp.** Salary history, current comp, expectations. Refuse entirely, give a range,
    or defer to you? Pick one.
36. **Other people.** Can the agent name colleagues, managers, founders? Say what it was
    like to work with a specific person? Default should be no — confirm.
37. **Employers' confidential business.** No Logo's margins, client names, factory
    relationships. Patronus's roadmap. What is the line?
38. **The a16z arrangement** — say it, hedge it, or refuse it?
39. **Personal life.** Relationship status, where exactly you live, your phone number,
    family. *(Your phone number is on the resume PDF the site already serves. Should the
    agent give it out? That is a decision, not an oversight.)*
40. **Politics, religion, opinions about China.** You make content for a Chinese audience
    and this will get probed, sometimes in bad faith. What does the agent say?
41. If someone is rude, or tries to jailbreak it, or tries to get it to say something
    damaging — what does Evan-in-the-box do? What's the tone?
42. **What should it do when it doesn't know?** Deflect to email, offer to book time, or
    just say so? And what's the one thing it must *never* do — presumably guess.
43. Last one: if a visitor talks to this thing for ten minutes and then meets you, what
    do you want them to be surprised by, and what do you want them to *not* be surprised
    by? That answer is the actual spec for everything above.

---

## Immediate next action

Group A alone is thirty minutes of Evan's time and produces the canonical fact records,
which resolve a live inconsistency between the resume the site is serving right now and
the job he is about to start. Do that before any prompt engineering happens, because
every downstream artifact inherits whatever the records say.

One more thing worth queueing behind it, and it is cheap. **No published study has run
this exact experiment** — the same career facts as structured records versus the same
facts in first-person prose, graded on recruiter-style questions. Everything in Half 1
section 4 is adjacent inference from table-QA, format-sensitivity and long-context work.
Writing 30–50 questions a recruiter would plausibly ask and A/B-ing the two corpus
formats against them is a few hours of work, and it is the only evidence that will
actually be about Evan. That eval doubles as the regression suite the `01-*` truthfulness
work will need anyway, so it should be built once and shared.
