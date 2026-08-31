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

## 2026-08-31 — PF ID collision fixed; Hermes skill for this connector

**Who:** Eric (second developer, Claude Code — MCP session)
**Branch / PR:** `docs/notes-2026-08-31`

**Changed**
- Project Findings: the duplicated `PF-46` was renumbered to **PF-49**. The row that moved is
  `20260829010918-tob8aec` ("A renamed document keeps its old title in blocks.content"), created
  07:09; the earlier `20260829000000-pf00046` (04:43) keeps 46. Snapshot taken first, and the
  result verified by re-reading: 49 rows, max 49, no duplicates, no gaps in 1–49.
- No code changes in this repo.
- A Hermes Agent skill for driving this connector now lives on my machine at
  `~/.hermes/skills/knowledge/siyuan-mcp/SKILL.md`. Deliberately not committed — it is agent
  configuration, not connector code, and it hardcodes one deployment's URL.

**Learned**
- **The PF collision is `get_next_sequence_value` behaving exactly as documented, not a bug.**
  Its own description says it reads the current maximum and returns max+1, is not an atomic
  counter, and that two near-simultaneous calls can return the same value. Two sessions filed
  findings ~2.5h apart and both got 46. Renumbering fixes the instance, not the mechanism.
- **SiYuan has no auto-increment / unique-ID field type.** Confirmed against `KEY_TYPES` in
  `mcp-server/handlers/av.ts`: text, number, date, select, mSelect, url, email, phone, mAsset,
  template, created, updated, checkbox, relation, rollup, lineNumber. `lineNumber` is row
  position and silently reassigns on delete or reorder, so it cannot serve as a stable ID. No
  upstream issue proposing one was findable. A manually-maintained PF-# column remains the only
  option, and collisions remain possible by construction.
- **`set_database_cell` wants the row id from `render_database` (`rows[].id`)**, not the
  `blockID` that appears in `get_database`'s `keyValues`. They coincide for the detached rows in
  this database, but the tool description is explicit that they do not always.
- **`get_database` on Project Findings no longer fits in one tool result** (~302k chars / 7,240
  lines). `render_database` with a `fields` allowlist is the practical read when only one column
  is needed — which is what PF-26 added it for.

**Did not work**
- `resolve_database_ids` called with an `ids` parameter returned `{}` — no error. The real
  parameters are `item_ids` and `block_ids`, and the handler's own `validate()` throws when
  neither is present, so an unrecognised key should have been rejected the same way. As it
  stands, a typo in the parameter name reads as a successful lookup that found nothing. Worth
  filing as a finding; not filed here, to avoid taking another sequence number in the middle of
  fixing a sequence collision.

**Left unfinished**
- **No durable fix for PF numbering.** Three options, none chosen: serialise findings writes to
  one session at a time; allocate the number at write time and verify uniqueness immediately
  after; or add a uniqueness guard to the connector so a colliding write fails loudly.
- **`.claude/settings.json` denies `Bash(git push:*)`, which blocks the branch-and-PR workflow
  the working agreement requires.** Suggest narrowing it to pushes targeting `main` so a topic
  branch can still be pushed.
- **PRs #5–#8 have no NOTES.md entries yet.** PF-29/30/35/36/39/40/42, the view tools, `set_icon`
  and the usage-guide rewrite are all in the diff, but the reasoning behind them is not in this
  log.

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
