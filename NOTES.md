# NOTES.md — handoff log

Newest entry first. Two developers work on this repo from separate Claude Code accounts and never
at the same time, so neither can see the other's session history. **Anything learned or decided
that is not in the diff has to be written down here**, or it is lost.

Worth recording, in rough order of value to the next person:

- What you tried that did **not** work, and why. Unreproducible from the diff, and the most
  expensive thing to rediscover.
- Decisions and the reason behind them, especially where you rejected the obvious approach.
- What is unfinished, and where you stopped.
- Anything about the live SiYuan instance or its kernel that surprised you.

## Entry template

```markdown
## YYYY-MM-DD — <short title>

**Who:** <name or account>
**Branch / PR:** <branch name, PR link if opened>

**Changed**
- ...

**Learned**
- ...

**Did not work**
- ...

**Left unfinished**
- ...
```

---

## 2026-08-27 — Repo set up for asynchronous collaboration

**Who:** Eric (with Claude Code)
**Branch / PR:** `chore/collab-setup` — PR not yet opened

**Changed**
- Added `CLAUDE.md`: project layout, real commands, conventions inferred from the existing code,
  enforced rules, and the working agreement (pull, branch, PR, update this file).
- Added `.claude/settings.json`, committed and shared: allows build/test/read-only git and `gh`
  commands, denies reads and writes of `.env*`, denies `git push` and `npm run format`.
- Added this file.
- `.gitignore`: added `.claude/settings.local.json` and a general `.env.*`. Existing entries left
  alone.
- `README.md`: added a "Getting started for a new collaborator" section pointing here and at
  `CLAUDE.md`.

**Learned** (all three of these were found by running the commands, not by reading the manifest)
- **`npm run lint` is broken.** The script exists but the repo has no ESLint config, so it exits
  with "couldn't find a configuration file". Not caused by any recent change. Adding a config is
  a real decision — it imposes a style on a codebase that has none — so it was left alone and
  documented instead. Do not treat its failure as a regression.
- **`npm test` is broken twice over, and the first one was a surprise.** It does not merely need
  infrastructure — the suite does not compile. `__tests__/integration.test.ts` has eight TS errors
  from about line 415, reading `.count` and `.updatedIds` off a value typed `boolean`, because the
  tag-replace handler's return type changed and the test was never updated. It fails before it
  reaches the network. Underneath that, the tests are integration-only: they import from `dist/`
  and need a live SiYuan instance plus `SIYUAN_TOKEN` in `.env`, and they create and delete real
  notes. So `npm run build` is the only enforceable pre-commit check, which is what `CLAUDE.md`
  requires. Found by accident — an unquoted backtick in a shell command ran `npm test` when I did
  not intend to, which is the only reason it was caught before this file claimed otherwise.
- **`npm run format` would rewrite the repo.** Prettier is configured but the existing code does
  not satisfy it, so a repo-wide run produces an enormous diff unrelated to your change. It is
  denied in `.claude/settings.json` for that reason rather than for any risk in Prettier itself.

**Did not work**
- Nothing attempted and abandoned. The three items above were the surprises.

**Left unfinished**
- **PR not opened.** The branch is committed locally and needs pushing.
- **The test suite does not compile.** Eight type errors in `__tests__/integration.test.ts` where
  it reads `.count` / `.updatedIds` off a boolean. Small fix, but it belongs in its own PR with a
  live SiYuan instance to hand, since nobody can tell whether the rest of the suite still passes
  until it compiles.
- **ESLint has no config**, so there is no lint gate. Worth deciding deliberately: either add a
  config and fix the fallout in its own PR, or drop the `lint` script so it stops looking like a
  command that works.
- **Deployment specifics are deliberately absent from this repo** because it is public. Container
  commands, hostnames and the API token live in the private SiYuan project hub. If a future
  collaborator needs them, hand them over out of band rather than committing them.
