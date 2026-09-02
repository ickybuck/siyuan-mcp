# Modifications

This repository is a fork of [porkll/siyuan-mcp](https://github.com/porkll/siyuan-mcp),
Copyright 2024 lei, licensed under the Apache License, Version 2.0.

Section 4(b) of that licence requires that modified files carry prominent notice of the change.
This file is that notice: it records every inherited file that has been changed, and everything
added on top. It is maintained alongside the code rather than as per-file headers, so that one
place stays authoritative.

Fork point: upstream commit `4a8f43a` (`@porkll/siyuan-mcp@0.1.1`).

## Published identity

This fork is published to npm as [`siyuan-mcp-blocks`](https://www.npmjs.com/package/siyuan-mcp-blocks),
not under upstream's `@porkll` scope. The name change is deliberate: publishing under upstream's
scope would imply an endorsement that does not exist, which section 6 of the Apache License does
not permit.

## What changed, in substance

Upstream exposed 16 tools, all document-granular: to edit one paragraph of a large note you
rewrote the whole note. This fork adds block-level editing, a complete database (attribute view)
layer, per-document history and rollback, and a body of read-back verification. It registers 76
tools.

The verification work is the larger and less visible part. SiYuan's `/api/transactions` queues
work and returns `code: 0` *before running it*, reporting failures only to SiYuan's own interface —
so a success response from anything transaction-backed promises nothing. Every write path here
reads its result back and fails loudly when the write did not land, and several tools reject input
up front that the kernel would otherwise accept and silently discard.

## Inherited files that have been modified

| File | Nature of the change |
| --- | --- |
| `mcp-server/core/server.ts` | Dispatch through `safeExecute` so argument validation actually runs; usage-guide prompt and tool wiring |
| `mcp-server/core/types.ts` | `safeExecute` added to the `ToolHandler` contract |
| `mcp-server/handlers/base.ts` | Rewritten validation: unknown arguments rejected by name, required arguments checked, `allowEmpty` for arguments where the empty string is a real instruction |
| `mcp-server/handlers/index.ts` | Registration of all added handlers |
| `mcp-server/handlers/document.ts` | Read-back on create and rename; `create_parents`; entity guards; whole-document rewrite |
| `mcp-server/handlers/notebook.ts` | Entity guards on notebook names |
| `mcp-server/handlers/search.ts` | Ancestor-hit collapsing, document-scoped content search, result de-duplication |
| `mcp-server/handlers/snapshot.ts` | Meaningful return values instead of `void` |
| `mcp-server/handlers/tag.ts` | Measured tag replacement: counts, affected IDs, and an explicit failure when a tag matches nothing |
| `mcp-server/bin/http.ts` | Session handling and transport fixes for the HTTP endpoint |
| `src/index.ts` | Wiring for the added API modules; `overwriteFile` reimplemented as a verified whole-document replace |
| `src/api/document.ts` | Parent-path and HTML-entity guards, verified create, polled rename read-back, corrected move-to-notebook-root path handling, paged document tree |
| `src/api/block.ts` | Corrected insert anchors (`previousID`/`nextID` semantics), multi-block rejection on `update_block`, block counting helpers |
| `src/api/search.ts` | Ancestor collapsing, document-scoped search, de-duplication, explicit SQL limits |
| `src/api/notebook.ts` | Entity guards |
| `src/api/tag.ts` | Rewritten to measure and verify rather than return a constant `true` |
| `src/types/index.ts` | Types for the added surface |
| `__tests__/integration.test.ts` | Updated for the changed return shapes |
| `README.md`, `README_zh.md` | Fork description, tool inventory, added-behaviour documentation |
| `CHANGELOG.md` | Fork history appended below upstream's |
| `Makefile`, `.gitignore`, `package.json`, `package-lock.json` | Build, packaging and identity for this fork |

Upstream's committed build output under `mcp-server/**/*.js`, `*.d.ts` and `*.map` was deleted;
`dist/` is generated and gitignored here. No upstream source file was removed.

## Files added

- `src/api/av.ts` — the database (attribute view) layer
- `src/api/history.ts` — per-document version history and rollback
- `src/api/icon.ts` — icons for documents, database views and notebooks
- `src/utils/readback.ts` — the shared write-verification helper
- `src/utils/entities.ts` — HTML-entity guards and IAL unescaping
- `mcp-server/handlers/av.ts`, `block.ts`, `view.ts`, `history.ts`, `guide.ts` — the added tools
- `mcp-server/core/usage-guide.ts` — the usage guide, served as both an MCP prompt and a tool
- `Dockerfile`, `.dockerignore`, `.github/workflows/docker-publish.yml` — container build and publish
- `CLAUDE.md`, `NOTES.md`, `.claude/settings.json` — collaboration setup
- `scripts/scan-findings.mjs` — maintenance tooling

## Provenance of the changes

The additions in this fork were written with AI assistance (Claude Code), as was upstream's
original code. See the notice at the top of the README: it applies to this fork's own code as
well as to the code it inherits.
