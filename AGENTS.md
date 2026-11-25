# Agent instructions

Shared by every AI agent working in this repo. Kiro reads this file directly;
`CLAUDE.md` (Claude Code) and `GEMINI.md` (Gemini CLI) import it.
Edit this file, not those.

## Branches

- Work on `dev`. Commit and push there.
- `main` is production: every push to it deploys to the live app.
- Don't commit to, push to, or merge into `main` unless the user asks.

## Roadmap

`docs/roadmap.md` is the shared plan: what's done, what's next, and the rules
for new features (owner stays in control, $0 budget, free-database limits,
light staff screens). Read it before planning or building a feature. When you
finish part of a phase, update its status and "Open" list in the same change.

## Release notes

The app shows a "New update available" sheet when a deploy adds a new entry to
`RELEASES` in `src/lib/releases.ts` (see `src/components/UpdatePrompt.tsx`).
Deploys without a new entry only show a small "Update available" pill.
Writing that entry is your job, as part of the same change.

### When to write one

Write or update an entry when your change is something the shop owner or
staff would notice in the app:

- a new screen, button, setting, or feature
- changed behaviour (what a button does, what gets shown, timing, defaults)
- a visible fix (something broken now works, a layout no longer cuts off text)
- a noticeable speed-up

Skip it for changes nobody using the app would notice: refactors, tests,
types, dependency bumps, logging, build or CI config, docs, agent files, and
fixes to code that hasn't shipped yet.

If you're unsure, ask the user instead of guessing.

### New entry or add to the current one

Run `git diff origin/main -- src/lib/releases.ts`.

- If the top entry shows up in that diff, it isn't live on `main` yet (it may
  be on `dev`, or uncommitted). Add your
  lines to its `changes` (and adjust its `title` if it no longer fits). Don't
  create a second unpushed entry.
- Otherwise add a new entry at the top of the list.

### Format

```ts
{
  id: 2,                 // previous top id + 1. Never reuse or reorder ids.
  date: "2026-11-24",    // today in Manila time (Asia/Manila), YYYY-MM-DD
  title: "Easier wave times",
  changes: [
    "Wave time buttons in Auto-ship schedule are bigger and easier to tap.",
  ],
},
```

- `title`: 2 to 5 words naming the main change. No version numbers, no "Update".
- `changes`: 1 to 4 short sentences, one per change, each ending in a period.
- Write for the shop owner on a phone, not for a developer:
  - Say what they'll see or can now do, using the names on screen
    ("Auto-ship schedule", "Money", "Refresh now").
  - No file names, component names, code terms, or ticket numbers.
  - Plain words, active voice, no hype ("Improved", "Enhanced", "Exciting").
- Only the 5 newest entries are sent to the app. Leave older entries in place.

### Check

Run `npx vitest run src/lib/__tests__/releases.test.ts`. It checks ids, dates,
and that no field is empty.

Tell the user in your final message that you added or updated a release note,
and quote it, so they can edit it before pushing.
