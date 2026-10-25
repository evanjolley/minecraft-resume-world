# Minecraft resume world

Evan's personal site as a walkable Minecraft world (world.evanjolley.com). Browser
voxel engine on noa-engine, served as static files plus a Cloudflare Worker.

## Read first
- `docs/STATUS.md` for where things stand and what is next
- `docs/SPRINT-1.md` for Evan's current direction and the shared agent rules
- `docs/FUTURE.md` for the long-form roadmap, `docs/REPORTED.md` for bugs from play
- `docs/builds/README.md` before touching any chapter plot

## Hard rules
- `src/builds/ch1-millard-north.js` is Evan's own build. Never change it.
- The repo is PUBLIC. Personal material about Evan lives only in gitignored `corpus/`.
- A push to main runs CI smoke only. Publishing needs Evan's go and the Cloudflare secret.
- Single player only. Each visitor has a private world and a private AI Evan chat.
- Facts about Evan come from the resume, the repo, or Evan. Never invent them.

## Commands
    npm install
    npm run dev       # http://localhost:5173
    npm run smoke     # fast check
    npm test          # full suite, slow
