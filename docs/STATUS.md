# Status

## 2026-10-25, sprint 1

Six agents worked in parallel worktrees, and the coordinator merged them into main.
The brief is `docs/SPRINT-1.md`.

### Merged into main
- **AI Evan.** Per-visitor memory in one SQLite Durable Object per visitor, plus the `npm run interview` tool and an A* guided tour to each chapter. Design in `docs/ai-evan/04-memory.md`
- **Accounts.** Instant guests, nicknames, optional passkey sign-in, saved worlds, Forget me, and single player only (the tab list is removed)
- **Fidelity.** Boot is 4.5x faster (15.2 s to 3.4 s), vanilla sky and day/night, vanilla commands, and passive mobs. Pigs are silent until a licensed pig sound is found (see FUTURE.md)
- **Builds.** ch2 Harvard Science Center, ch3 Bilibili TV, ch4 the Cable Building at 611 Broadway, ch5 One Post Street, ch6 The climb (75 jumps, all tested)
- **Rule.** No trivia signs. Facts live in AI Evan's gitignored corpus (`corpus/extra/`)

### Still open
- **Landscape agent.** Rolling vanilla terrain and trees, a 288 x 400 overworld, all six plots wired in. It runs on branch `worktree-agent-a298b2e3da88326df`. If that session is gone, merge the branch as is, or resume from its worktree at `.claude/worktrees/agent-a298b2e3da88326df`
- After landscape merges, run the larger test set, take wide shots of every chapter from the path, and push

### Evan's items
- Run `npm run interview` with `ANTHROPIC_API_KEY` set. The corpus only exists on this Mac, in `corpus/extra/`
- Describe what the No Logo and Patronus offices look like inside
- Name the "other interests" the climb should touch
- Pick the live domain, then set `PASSKEY_RP_ID` and `PASSKEY_ORIGIN` to turn sign-in on
- Decide whether memory becomes AI Evan's default brain (today it needs `?brain=evan`). Recommendation is yes, after a test with the real key

### Rules Evan set this sprint
- Never tell visitors which floor the Patronus office is on, in code, commits or AI Evan
- No trivia signs in builds
- Video screens with proximity audio and multiplayer presence are cancelled

### Known gaps
- `public/terrain` (the mountains and Nether assets) is not in the repo, so those worlds and 7 specs fail on a fresh clone
- Spec 12's fingerprint test fails on the free sound set, same as before the sprint

Next session start. "Read docs/STATUS.md, merge the landscape branch if it is done, then run the test set and show me every chapter from the path"
