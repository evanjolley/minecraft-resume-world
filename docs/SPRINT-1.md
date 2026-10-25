# Sprint 1 brief (2026-10-25)

Evan's direction for this sprint, and the shared rules every agent on it follows.
Each agent works in its own git worktree and branch. The coordinator merges.

## What Evan asked for

1. **The world looks like real Minecraft.** The landscape between plots reads as
   random noise today. It is flat, the trees look bad, and it does not look like
   vanilla terrain. Make it believable: real vanilla tree shapes, rolling
   terrain, believable biomes, water, flowers, grass, the works.
2. **Build the remaining plots.** Chapters 2 through 6. Plots may grow to the
   size Evan's own plots reached (ch2 is 74 x 76). The world layout and size may
   change to fit them. Builds will be adjusted later, so a good first pass beats
   a perfect plan.
3. **Do not change anything inside Evan's existing plot.** `src/builds/ch1-millard-north.js`
   and what it stamps are frozen. Its plot may be translated to a new position in a
   new layout, but its size (66 x 63) and contents stay byte for byte.
4. **Identity.** Login, guests and nicknames.
5. **Persistence.** A visitor's world stays changed when they come back.
6. **Single player only.** No seeing other visitors. Every visitor gets their own
   world and their own private conversation with AI Evan. Multiplayer presence
   (FUTURE.md 2b) is cancelled. Video screens with proximity audio (FUTURE.md 1)
   are cancelled.
7. **AI Evan.** An agent that walks around the world, gives tours, and tells
   visitors about Evan. It has real memory, so it remembers what each visitor
   said across visits. It knows a lot about Evan, loaded through an interview
   process Evan can sit through ("download my brain").
8. **Scale.** Design for 1,000 people talking to AI Evan at once, each in their
   own world. Every backend choice is made with that in mind.
9. **Efficiency.** Wherever the code can be faster, leaner or more scalable,
   make it so. Evan expects inefficiencies and authorizes fixing them.
10. **Minecraft fidelity is authorized.** Any missing block, physics behavior,
    mob, crafting recipe, command or rule that a build or feature needs may be
    built. Anything that is wrong versus vanilla (physics, day/night, commands)
    may be corrected toward vanilla.

## Plot table contract (for builders and the landscape agent)

| chapter | id | subject | footprint |
|---|---|---|---|
| 1 | ch1 | Omaha, Millard North High School | 66 x 63, FROZEN |
| 2 | ch2 | Harvard, Science Center and school work | 74 x 76 |
| 3 | ch3 | Bilibili | up to 74 x 76 |
| 4 | ch4 | New York, No Logo | up to 74 x 76 |
| 5 | ch5 | San Francisco, Patronus AI | up to 74 x 76 |
| 6 | ch6 | The climb (parkour going up) | up to 74 x 76, plus the air |

- Builders write in plot-local coordinates through the stamper (`src/builds/stamp.js`,
  `docs/builds/README.md`). Each build file exports its footprint as
  `export const SIZE = { w, d }` so the layout can be derived, not hand-copied.
- Plot positions are owned by the landscape agent (`src/builds/plots.js`
  `CHAPTERS`, `LAND`). Builders never edit positions.
- The plot interior is flat at `GROUND_Y`. Terrain may roll around plots but must
  blend down to plot level at the plot edge.

## Shared rules

- **Facts about Evan** come only from the repo (`public/EvanJolley_Resume.pdf`,
  `docs/ai-evan/03-corpus.md`, comments in `src/builds/plots.js`) or from Evan.
  Never invent facts about Evan or any other real person. If a build wants a
  detail you do not have, make it generic, and list it as a question in your
  final report.
- **This repo is PUBLIC.** Personal corpus material (interview answers, memory
  dumps) goes in gitignored paths only (`corpus/`, as today).
- **Nothing outward-facing.** Do not deploy, do not run `wrangler deploy`, do not
  create Cloudflare resources, do not call paid APIs, do not push. Code against
  bindings and verify locally (vite dev, wrangler dev / miniflare, Playwright).
- **Commit on your own branch** with explicit pathspecs
  (`git commit -m "..." -- paths`), never `-a`. Do not merge into main.
- **Tests.** The full suite is roughly 900 tests and slow. Run the specs that
  touch your area plus `npm run smoke`. Add specs for what you build.
- **Screenshots** that show your result go in
  `~/.agent-library/minecraft-resume-world/2026-10-25-sprint-1/<your-area>/`.
- **American spelling** in new prose. Match the surrounding code style.
- **Final report**, under 300 words: what shipped (commits), what is unfinished,
  any decision Evan needs to make (with a recommendation), and any files you
  touched outside your area (so the coordinator can expect merge conflicts).
