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

## 2026-09-02 (later) — published to npm as siyuan-mcp-blocks

**Who:** Eric (Claude Code — "Code" thread)
**Branch / PR:** PRs #26, #27; published `siyuan-mcp-blocks@0.2.0`

**Changed**
- Renamed again, `siyuan-mcp-extended` → `siyuan-mcp-blocks`, before publishing (PR #26).
- `clean` script made cross-platform (PR #27).
- Published: https://www.npmjs.com/package/siyuan-mcp-blocks — Apache-2.0, maintainer ickybuck.

**Learned**
- **Free on npm is not free where people look.** `siyuan-mcp-extended` was unclaimed on the registry, but `jjdunlop/siyuan-mcp-extended` already existed on GitHub. Check both before settling a name.
- **`prepublishOnly` ran `rm -rf dist`,** and npm runs scripts through `cmd.exe` on Windows. The publish died in the pre-publish hook without contacting the registry, and the failure looked like an auth problem for two rounds. Use `node -e "require('fs').rmSync(...)"` for anything that has to run on both platforms.
- **npm no longer offers TOTP enrolment** — the 2FA page is passkeys, recovery codes, and a "require 2FA for write actions" toggle. A passkey cannot answer `--otp`, so publishing from a CLI means either a recovery code, a bypass token, or turning that toggle off for the length of one publish. The toggle is the smallest and most reversible of the three; it was turned back on immediately after.
- **The npm README is frozen per version.** Editing it in git later does not change what a published version shows, so the notice ordering matters at publish time and not before the next release.
- Publishing needs a browser auth round trip, so it cannot be driven from this session at all — the CLI prints a one-time URL and waits. Credentials are the user's to handle either way.

**Left unfinished**
- PF-67 and PF-69 are with Chat to verify against the live package page.
- No release process exists: publishing was manual, and nothing ties a git tag to an npm version. Worth a thought before 0.3.0.

## 2026-09-02 — Apache-2.0 compliance, and the package identity

**Who:** Eric (Claude Code — "Code" thread)
**Branch / PR:** `docs/apache-compliance` (PR #24)

**Changed**
- `NOTICE` and `MODIFICATIONS.md` added — attribution to upstream and the section 4(b) statement of modification, listing all 22 inherited files that were changed and everything added. Repository level rather than per-file headers, by Eric's call.
- Package renamed `@porkll/siyuan-mcp` → `siyuan-mcp-extended`, version 0.2.0; `author`, `repository`, `bugs`, `homepage` now describe this fork. `license` stays Apache-2.0.
- README and README_zh: licence provenance, upstream in Acknowledgments and Related Projects, AI-development notice extended to this fork's own code, counts corrected 58 → 76, install and import examples repointed here.
- GitHub description and six topics set (they were empty).

**Learned**
- **Most of the compliance work was already done and nobody had checked.** LICENSE was intact and unmodified — verifiable from git history, since the last commit touching it is upstream's own — `package.json` already said Apache-2.0, and the README already linked upstream. The real gaps were the 4(b) notices and the package identity. Worth establishing the facts before scoping compliance work; the findings were written from upstream's public state because Chat cannot see this repo.
- **Upstream ships no NOTICE file**, so the "reproduce the NOTICE" obligation was moot. Confirmed by listing upstream's repo contents rather than assuming.
- **Upstream's README undercounts upstream.** It says "15 essential tools"; counting registered names in its handler source gives 16. The hub was right.
- **The package was the actual risk, not the licence.** `@porkll/siyuan-mcp` with `author: "lei"` would have implied endorsement if published, which Apache-2.0's trademark clause does not permit — and the Makefile's `publish` target passed that name literally to `npm publish`.
- The 36 deletions since the fork point are all committed build output. Recorded in MODIFICATIONS.md so nobody re-derives it.

**Left unfinished**
- PF-67 and PF-69 are with Chat for verification; PF-71 is closed. PF-65 was already with Chat.
- If this is ever published somewhere that reads 4(b) strictly, per-file modification headers on the 22 inherited files are a mechanical follow-up.
- npm publishing is not set up: no account is configured here, and `npm publish` has never been run for this name.

## 2026-09-01 — NOTES.md header repair, and the closed-row sweep written down

**Who:** Eric (Claude Code — "Code" thread)
**Branch / PR:** `docs/closed-row-sweep`

**Changed**
- CLAUDE.md working agreement gained rule 6: after a verification round, search the findings notes rather than trusting the status column, with the marker list and the reason.
- `scripts/scan-findings.mjs` — the sweep as a runnable script. Takes the database ID as an argument and the credentials from the environment, so no workspace specifics are committed.
- Repaired this file: four entries had been inserted above the title, splitting `# NOTES.md — handoff log` into `# NO` … `TES.md — handoff log`.

**Did not work**
- **The CRLF failure mode again, and this time it corrupted a file rather than doing nothing.** The insertion script located the entry point with `s.indexOf('
---
')`. Git had converted this file to CRLF, so the marker never matched, `indexOf` returned `-1`, and `slice(0, -1 + 5)` silently cut the header at character 4 and inserted there. It looked like it had worked: the entry was present and in the right order, so three sessions passed before anyone read line 1.
- Two lessons, and the second is the one that matters. Match `?
`, never a bare `
`, in any script that edits a file in this repo. And when a script computes an insertion offset, assert the marker was actually found — `indexOf` returning `-1` is a valid number that produces a plausible-looking result.
- Verified the repair by normalising both versions and comparing content order-insensitively: identical, 311 lines before and after. Worth doing rather than eyeballing a 74-line diff.

**Left unfinished**
- PF-65 is with Chat for verification. Nothing else is open.

## 2026-08-31 (late) — PF-65, and two follow-ups that were hiding inside closed rows

**Who:** Eric (Claude Code — "Code" thread)
**Branch / PR:** `fix/pf-65-and-followups` (PR #21); deployed as `sha-90168d380178cd342a99a94bad7dc97478d35d04`

**Changed**
- PF-65: `rename_document` returned `verified: false` for every title containing `&`. The kramdown IAL stores attribute values XML-escaped, so the raw `&` sent in never matched the `&amp;` read back. The IAL value is now unescaped before comparison (`unescapeIalValue` in `src/utils/entities.ts`).
- `move_documents`: the resolve-first guard covered only the `to_notebook_root` branch. Both branches now share `requireDocuments`, which also validates the destination ID, and polls ~2s so a create-then-move sequence stops failing on index lag.
- `batch_replace_tag`: `new_tag` is required again, taking its empty case from `allowEmpty` like `set_icon` and `set_database_cell`.

**Learned**
- **Two fixes can collide in the verification layer without either being wrong.** PF-49 moved the rename read-back to kramdown because it is live; PF-60 made ampersands reachable in titles again. Neither is a mistake, and together they made `verified` meaningless for a common class of titles. Worth asking, when a read-back compares user text to something read back, what the storage layer does to that text on the way through.
- **A wrong signal is worse than no signal.** Nothing was ever lost here — the rename always landed and the note correctly said not to retry. The cost was that `verified` stopped meaning anything for titles with an ampersand, which teaches the caller to ignore it.
- **Findings recorded inside closed rows are easy to lose.** Two live follow-ups were sitting in the notes of PF-42 and PF-59 with the rows marked Closed: the `allowEmpty` inventory being inconsistent, and the move guard covering one branch. A grep of every note's last verification section for phrases like "STILL TRUE" and "NOT FIXED" surfaced them in one pass. Worth repeating after any verification round rather than trusting the status column alone.

**Left unfinished**
- PF-65 is with Chat for verification. PF-42 and PF-59 are closed with their follow-ups resolved and recorded.
- The title-to-icon migration across 223 documents is still outstanding, and is still a content decision rather than a tool one.

## 2026-08-31 (evening) — per-document rollback, and four findings

**Who:** Eric (Claude Code — "Code" thread)
**Branch / PR:** `feat/document-history` (PR #18); deployed as `sha-84a25aace80dfea00bf07262c639cab7105a2d41`

**Changed**
- `list_document_history`, `get_document_history_content`, `rollback_document` — restore one document without taking the workspace back with it.
- PF-59: `move_documents` with `to_notebook_root` sent `hpath` where `moveDocs` wants the `.sy` file path. Now sends `path`, and refuses the whole call if any ID does not resolve instead of moving a subset.
- PF-60: the HTML-entity check moved to `src/utils/entities.ts` and now covers document rename, notebook create/rename and database rename, not only `create_document`.
- `create_document` accepts empty `content` again (third instance of the `allowEmpty` collision).

**Learned**
- **The kernel has no "history for document X" endpoint.** `searchHistory` narrows history timestamps by keyword; `getHistoryItems` expands one timestamp into the documents it touched. Per-document listing means filtering those by ID. The title is only used to narrow the search — membership is decided by ID, so a renamed document still resolves, and falls back to scanning timestamps in reverse.
- **History settings on this instance:** generated every 10 minutes for changed documents, retained 30 days (`generateHistoryInterval`, `historyRetentionDays` from `/api/system/getConf`). A document edited moments ago has no version yet — worth knowing before concluding a tool is broken.
- **History content comes back as editor DOM,** not markdown. Stripped to text by default; `format: "html"` keeps it.
- **Two of the four findings were not our bugs.** PF-57 was a duplicate of PF-56, fixed hours before it was filed. PF-58's "No approval received" appears nowhere in this codebase — `insert_block_after` and `insert_block_before` both work called directly against the MCP endpoint, so it came from the client's approval flow. Checking the string against the repo took a minute and settled it.

**Did not work**
- `node -e` with a heredoc for edits to `src/api/*.ts` again: several replacements silently matched nothing because the files are CRLF and the patterns used `
`. The counts looked plausible (the import landed, the body did not), which is the dangerous kind of failure. Use the editor against exact read-back text, or check every replacement actually applied.
- Probing kernel endpoints with empty bodies to see which exist is mostly safe, but `/api/export/exportData` takes no required arguments and simply ran, writing two 2.2 MB workspace zips into `temp/export`. Deleted. Probe with a deliberately invalid argument instead of no arguments.

**Left unfinished**
- PF-57, PF-58, PF-59, PF-60, PF-62 and PF-64 are with Chat for verification.

## 2026-08-31 (later) — three verification failures, fixed as two rules

**Who:** Eric (Claude Code — "Code" thread)
**Branch / PR:** `fix/readback-rules` (PR #15) and `fix/rename-readback-kramdown` (PR #16); deployed as `sha-acc24e6444e03719aa17635bc8b8e6a6ef5ae46d`

PF-42, PF-49 and PF-54 all failed verification. Two patterns underneath them, fixed as rules rather than as three tickets.

**Rule 1 — never verify a write against the SQL index, and never call an unconfirmed read-back a failure.**
- New `src/utils/readback.ts`: poll a live read; distinguish "could not confirm" from "contradicted".
- `rename_document` had inverted its own bug — it threw on every first rename of a document, quoting the old title, for renames that had already landed. A false failure on a completed write is worse than a silent success: the caller retries or rolls back finished work. It now returns `{ success: true, verified: false, note }` when it cannot confirm.
- `batch_replace_tag` pre-counted and post-counted from the same lagging index, so the two agreed with each other and disagreed with reality (`{count: 1, remaining: 0}` for two blocks both successfully renamed). Counts are now labelled a floor, and `verified` requires the old and new tag reads to agree.

**Rule 2 — `allowEmpty`.** The PF-50/52 empty-required check killed `set_icon(icon: "")`, the documented way to clear an icon. `BaseToolHandler.allowEmpty` lets a tool declare which required arguments accept `""`; swept every handler whose description documents empty-string behaviour (`set_icon.icon`, `set_database_cell.value`, `batch_replace_tag.new_tag`).

**Learned**
- **`/api/attr/getBlockAttrs` lags too.** The PF-49 fix read block attributes specifically to dodge the index, and it still failed — on a freshly created document the attribute read returned the old title across the full two-second polling window. `/api/block/getBlockKramdown` carries `title=` in the document block's IAL and had the new value immediately. That is the live read for a title.
- **Overriding `validate()` without `super.validate()` silently drops the unknown-argument check.** Two handlers did; that is why `resolve_database_ids` answered a misspelled `item_ids` with a vague "provide at least one of" while `get_document_content` named the offender. Check for this whenever a handler adds its own validation.
- **A workaround in one tool is a bug waiting in the next.** `new_tag` was made optional to dodge the empty-required collision; `set_icon` hit the identical collision days later and had no such escape. The second occurrence is the signal to fix the rule.
- **Appending to a Findings note: do not retype the existing text.** These notes run to several thousand characters and setting a cell replaces the whole value. Read the old value programmatically, concatenate, write, then assert the old value is still a prefix of the stored one.

**Did not work**
- Driving `tools/call` through nested `ssh` + `docker run curl` with inline JSON — the quoting is unsurvivable. Write the payload to a file on the host, mount it, and `curl -d @file`. A probe script that opens its own MCP session per call is worth the extra round trip.

**Left unfinished**
- PF-42, PF-49, PF-54 are back to `Needs verification` with Chat. Nothing else is open.

## 2026-08-31 — PF-46 through PF-56: the silent-success family, closed out

**Who:** Eric (Claude Code — "Code" thread)
**Branch / PR:** `fix/pf-46-56`, merged as PR #13; deployed as `sha-c7d1d73d952e52d706e83f0d4d6bd6684ba9f00c`

**Changed**
- `add_database_rows_with_values` rejects an `item_id` that already exists and takes `on_existing: "skip"` (PF-46).
- `create_document` refuses a non-existent parent path and HTML entities in a path, takes `create_parents`, and returns the read-back location instead of a bare ID (PF-48).
- `rename_document` verifies through block attributes rather than the SQL index (PF-49).
- `embed_database` with `parent_id` anchors to the current last child and verifies the position (PF-56).
- Search results de-duplicated by block ID (PF-47, backstop only — see below).
- `batch_replace_tag` returns `{ count, updatedIds, remaining }`, fails when the tag matches nothing, and `new_tag` is now optional.
- Rebuilt the Milestone Tracker's row-creation template in the live workspace (PF-53). No code change.

**Learned**
- **`item_id` does not update. It de-duplicates.** SiYuan recognises an existing `item_id`, declines the second row, then discards the submitted values while counting the row as written. The usage guide claimed the opposite for weeks; the cost was about thirty cell updates across eleven rows, all reported as written and never stored. If you need to change existing rows, `set_database_cells` is the only path that writes.
- **`insertBlock` treats `parentID` as "first child", not "append".** The embed succeeded, returned a block ID, and put correct data at the top of the document. Nothing in the response distinguishes that from the intended placement — position has to be read back.
- **A bare ID is not a receipt.** `create_document` returned one, and it cannot tell you whether you landed in the tree you meant or in a shadow tree the kernel invented. Returning the read-back `hpath` costs one extra call and removes the entire class.
- **`new_tag` had to stop being required.** The PF-50/52 validation rejects an empty required argument, and tag *removal* is exactly the empty case. Worth checking any other tool where the empty string is a meaningful value.

**Did not work / not reproducible**
- **PF-47's doubled search result.** The index holds one row for the document in question, with the current title. The ID de-duplication shipped anyway, but nothing was reproduced. If it recurs, capture both IDs first: identical means the backstop failed, different means it is two real documents and a different finding.
- **PF-48's ampersand escaping.** A raw `&` passes cleanly through both the library and the MCP tool. Nothing here escapes it, so the `&amp;` almost certainly arrived that way from the client. The entity guard shipped because an entity in a path is an escaping accident either way, and it was what triggered the phantom-parent creation.
- Editing `mcp-server/core/usage-guide.ts` with `node -e` string replacement failed silently twice — the file is one big template literal, so every backtick in inserted prose needs escaping, and the shell mangles the escapes on the way in. Use the editor against exact read-back text.

**Left unfinished**
- The integration suite needs a live `SIYUAN_TOKEN` and was not run; it type-checks, and `create_document`'s assertions were updated for the new return shape. Someone with a token should run it once.
- PF-29 and PF-42 are still `Needs verification` from earlier batches, owned by Chat.
- PF-55 is deliberately unused: Chat takes odd numbers, Code takes even.

## 2026-08-31 — PF-45 closed from the server end; PF-50 filed; deployment verified

**Who:** Eric (second developer, Claude Code — MCP session)
**Branch / PR:** `docs/notes-2026-08-31-deploy`

**Changed**
- **PF-45 closed.** Status `Closed`, Updated 2026-08-31, with a resolution appended to its notes.
  The original 3,331-character note is preserved verbatim as an exact prefix — verified
  programmatically, not by eye, because setting a text cell replaces the whole value.
- **PF-50 filed:** `resolve_database_ids` returns `{}` for an unrecognised parameter name instead
  of rejecting it. Bug / New / Owner Code.
- 32 superseded `ghcr.io/ickybuck/siyuan-mcp` images pruned from the NAS, keeping only the running
  one. All remain in GHCR.
- No code changes.

**Learned**
- **PF-45 was a client-side manifest cache, not a stale container.** That finding explicitly said
  the question could not be settled from a chat client and needed checking from the server end.
  It now has been. The running container is `sha-0cab7a8c750b6d8c6c05bc0da67ec5bbbf691966` — a
  full 40-character match to what was `main` at the time, the PR #8 merge that *added* the four
  tools reported missing. The container was recreated 1m44s after that merge; the PF-45 row was
  written about two hours later. A second MCP client, on the same container, is offered all four
  tools. So the server was current the whole time and one client held a `tools/list` cached at
  session start.
- **The operational rule that follows: after a redeploy, reconnect the MCP client — do not
  investigate the container.** The symptom points squarely at the wrong layer, and this cost real
  time to establish.
- **CORRECTION (same day): redeployment is NOT automatic.** This entry first claimed it was,
  on the strength of the container appearing ninety seconds after the merge. That was the
  collaborator redeploying promptly, not automation. The workflow only builds and pushes to
  GHCR — it has no deploy step and never contacts the NAS. The container is pinned to an
  immutable `sha-<full-commit-sha>` tag, and there is no watchtower/diun, no systemd timer and
  no user crontab; `siyuan-mcp` carries no `ix-` prefix, so it is hand-managed rather than a
  TrueNAS app. **A merge to `main` does not update the running connector — somebody has to
  redeploy it.** Not fully excluded: root's crontab needs a password and was not read.
- **The SiYuan kernel is `b3log/siyuan:v3.8.1`; upstream latest is `v3.8.2` (2026-08-30).** One
  patch release behind. The local `b3log/siyuan:latest` tag points at the same digest as `v3.8.1`
  and is 13 days old, so `latest` on that box is not actually latest. The container is pinned
  explicitly, which is why it has not drifted. Note this also puts the `make init` reference pin
  (v3.1.17) seven minor versions behind the kernel actually in use.
- **`get_next_sequence_value` was used the way it has to be used to be safe:** called immediately
  before the write, not carried across a gap, with uniqueness verified by reading the whole
  database back afterward. Both times it returned the expected value and both times the read-back
  confirmed no duplicates and no gaps.

**Did not work**
- **Docker on the NAS was available the whole time; I concluded otherwise from a bad test.**
  `truenas_admin` has NOPASSWD sudo scoped to `/usr/bin/docker` (and one `ez-workout` deploy
  script) — `sudo -n -l` says so plainly. I probed with `sudo -n true`, which is *not* in that
  list, got "a password is required", and generalised it to "Docker is gated". Consequence: the
  container inspection and the image prune were handed to Eric to run by hand for no reason.
  NOPASSWD is scoped per command — test the command you actually intend to run, or read
  `sudo -n -l`.
- Probing the deployed MCP server over HTTP from the NAS host was a dead end and briefly
  misleading. Port 3000 on the host is **Docmost**, not this connector, and it answered a POST to
  `/mcp` with `401 Unauthorized` — which looked like evidence that the connector requires an auth
  header it does not. The connector's port is not published to the host at all; it exists only on
  the Docker network, which is why Hermes reaches it as `siyuan-mcp:3000`. Identify what is
  actually listening before drawing conclusions from its responses.

**Left unfinished**
- **Whether to take SiYuan v3.8.2.** Not urgent, and not casual: this connector is developed
  against live kernel behaviour and much of this database catalogues kernel quirks, so a bump can
  invalidate findings quietly. If taken: snapshot first, pin the new tag explicitly rather than
  using `latest`, and re-run the regression sweep.
- **PRs #5–#8 still have no NOTES.md entries.**

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
- **The `Bash(git push:*)` deny in `.claude/settings.json` is not a reliable guardrail.** It is
  loaded from the session's project root, so it only applies to a session started inside this
  repo. This session was rooted at the parent home directory, never loaded the file, and pushed
  this branch without resistance. So the deny stops the workflow it was not meant to stop (a
  repo-rooted session opening a PR) and does not stop what it was meant to stop (any session
  pushing to `main`), depending only on which directory Claude Code was started from. Worth
  either narrowing it to `main` and accepting it as advisory, or moving the protection to where
  it actually binds — a branch protection rule on GitHub.
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
