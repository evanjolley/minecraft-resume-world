# Status

## 2026-10-25, sprint 1

Six agents worked in parallel worktrees, and the coordinator merged them into main.
The brief is `docs/SPRINT-1.md`.

### Merged into main
- **AI Evan.** Per-visitor memory in one SQLite Durable Object per visitor, plus the `npm run interview` tool and an A* guided tour to each chapter. Design in `docs/ai-evan/04-memory.md`
- **Accounts.** Instant guests, nicknames, optional passkey sign-in, saved worlds, Forget me, and single player only (the tab list is removed)
- **Fidelity.** Boot is 4.5x faster (15.2 s to 3.4 s), vanilla sky and day/night, vanilla commands, and passive mobs. Pigs are silent until a licensed pig sound is found (see FUTURE.md)
- **Landscape.** Rolling vanilla terrain and trees, a 288 x 400 overworld, all six chapters stamped, ch1 unchanged. Plot table in `src/builds/plots.js`
- **Builds.** ch2 Harvard Science Center, ch3 Bilibili TV, ch4 the Cable Building at 611 Broadway, ch5 One Post Street, ch6 The climb (75 jumps, all tested)
- **Rule.** No trivia signs. Facts live in AI Evan's gitignored corpus (`corpus/extra/`)

### Still open
- **Frame rate.** The bigger forested world drops spawn fps from about 25 to 18 under software rendering. Check on a real GPU before thinning plants (`PLANT_REACH` in `src/builds/flora.js`). Spec 68's 20 fps budget fails on a loaded machine
- **Review pass.** Wide shots of all six chapters are in `~/.agent-library/minecraft-resume-world/2026-10-25-wide-shots/`. Trees in front of ch2 and ch5 are thinned along the sight line from the path (`SIGHT_LINES` in `src/builds/plots.js`), shots in `2026-10-25-tree-thinning/`. Towers reaching the clouds (tops at y 199, clouds at 192) is fine by Evan
- Run the full suite once on a quiet machine

### Evan's items
- Find the September quiz corpus (`corpus/profile.md` and `corpus/answers.json`). It is not on this Mac and not in this claude.ai account's artifacts. It was made under Evan's personal account. `npm run prompt` cannot build AI Evan's brain without `profile.md`
- The brain dump (private artifact "AI Evan Brain Dump", two rounds on 2026-10-25) is pulled into the gitignored corpus. Facts are in `corpus/extra/brain-dump-2026-10-25.md`, voice in `corpus/knowledge/voice.md`, boundaries in `corpus/interview/boundaries-to-merge.md` (merge into `profile.md` once it is back). Resume chunks it contradicted are corrected. Opinions and a few voice answers are still thin
- Describe what the No Logo and Patronus offices look like inside
- Name the "other interests" the climb should touch
- Pick the live domain, then set `PASSKEY_RP_ID` and `PASSKEY_ORIGIN` to turn sign-in on
- Put an Anthropic API key in `.dev.vars` (gitignored) so AI Evan can be tested live under `wrangler dev`

### AI Evan conduct (merged 2026-10-25)
- One friendly warning, then "Evan left the game". Signed-in visitors stay blocked for good, guests for the visit (30 quiet minutes). Server owns the state, in the visitor's Durable Object. Spec 113
- Warning line approved by Evan
- AI Evan runs on Claude Haiku 5.5 and the memory brain is the default. If the Worker or key is missing, visitors silently get the stub. `corpus/profile.md` was rebuilt from the brain dump and the resume (the September quiz corpus is not on this Mac; Evan said the brain dump is enough). Not yet tested against the real API

### Rules Evan set this sprint
- Never tell visitors which floor the Patronus office is on, in code, commits or AI Evan
- No trivia signs in builds
- Video screens with proximity audio and multiplayer presence are cancelled

### Known gaps
- This Mac has no Minecraft install. Vanilla textures and sounds are rebuilt from the official 1.21.8 files kept in `~/.agent-library/minecraft-resume-world/2026-10-25-minecraft-1.21.8-assets/`, with `HOME=<that folder>/home npm run textures:vanilla` (same for `sounds:vanilla`). Any `npm run build:deploy` switches `public/` back to the free sets, so rerun both afterwards
- `public/terrain` (the mountains and Nether assets) is not in the repo, so those worlds and 7 specs fail on a fresh clone
- Spec 12's fingerprint test fails on the free sound set, same as before the sprint

Next session start. "Read docs/STATUS.md and CLAUDE.md in ~/Personal/minecraft-resume-world. Check whether the old quiz corpus is back on this Mac, merge the brain dump boundaries into profile.md, then let us go through the open items"
