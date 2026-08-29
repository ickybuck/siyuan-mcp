# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this project is

An MCP server that gives AI assistants block-level and database-level access to a
[SiYuan](https://github.com/siyuan-note/siyuan) workspace. It is a fork of
`porkll/siyuan-mcp`, extended well past upstream: upstream had 16 document-granular tools and no
block or database tools.

It runs two ways from the same code: over stdio for a local client, and over HTTP for a remote
one. The HTTP build is what is deployed.

## Structure

```
src/api/          Thin client over SiYuan's HTTP API — one file per area
                  (av.ts is the database/attribute-view layer and is by far the largest)
src/types/        Shared types
src/utils/        Helpers
src/index.ts      createSiyuanTools() — the library entry point
mcp-server/core/  Server, tool registry, shared types, and usage-guide.ts
mcp-server/handlers/  One MCP tool per class; index.ts registers them all
mcp-server/bin/   cli.ts, stdio.ts, http.ts entry points
__tests__/        Integration tests (see the caveat under Commands)
```

Two layers, and the split matters: `src/api/*` talks to SiYuan and knows nothing about MCP;
`mcp-server/handlers/*` defines tools and knows nothing about HTTP. Validation that protects data
belongs in the API layer so both paths get it. Validation about tool arguments belongs in the
handler.

## Commands

```bash
npm install          # install dependencies
npm run build        # tsc — the gate that must pass before committing
npm run watch        # tsc --watch
npm test             # jest — see the caveat below
npm run mcp:stdio    # run the stdio server from dist/
npm run mcp:http     # run the HTTP server from dist/
```

Three things about these are not obvious and will waste your time otherwise:

- **`npm test` does not currently run at all.** The suite fails to compile: `__tests__/integration.test.ts`
  has eight TypeScript errors around line 415, reading `.count` and `.updatedIds` off a `boolean`
  — the tag-replace handler's return type changed and the test was never updated. It fails before
  it reaches the network, so this is not about your environment. Even once that is fixed, the only
  tests are integration tests: they import from `dist/` (**build first or you test stale code**),
  they need a live SiYuan instance with `SIYUAN_TOKEN` in `.env` (copy `.env.example`), and they
  create and delete real notes in the notebook named by `SIYUAN_TEST_NOTEBOOK`. There is no
  unit-test suite.
- **`npm run lint` does not work.** The script exists but no ESLint config does, so it exits with
  "couldn't find a configuration file". Do not put it in a checklist and do not treat its failure
  as your change breaking something. Adding a config is a real decision, not a fix to slip into an
  unrelated PR.
- **Do not run `npm run format` across the repo.** Prettier is configured and the existing code
  does not satisfy it, so a repo-wide run rewrites files you did not touch and buries your diff.
  Match the formatting of the file you are editing.

`make init` clones the SiYuan source for reference but pins **v3.1.17**, which is far behind the
kernel this connector is developed against. Check the version you actually deploy before trusting
anything you read there.

## Conventions

Inferred from the existing code — follow them rather than your own defaults.

- **TypeScript, ESM, NodeNext.** Relative imports carry a `.js` extension even though the source
  is `.ts` (`import { foo } from './bar.js'`). This looks wrong and is correct.
- **Formatting**: 2-space indent, single quotes, semicolons, 100-column width, trailing commas
  where ES5 allows (`.prettierrc`).
- **Comment languages are split by audience, deliberately.** Internal rationale in `src/api/*` is
  written in Chinese, matching the upstream fork. Everything a tool caller sees — tool
  descriptions, `inputSchema` field descriptions, error messages, the usage guide — is English.
  Keep both in their lane.
- **Every handler** subclasses `BaseToolHandler` and declares `name`, `annotations`,
  `description`, `inputSchema`, and `execute`. `annotations` is required by the abstract base
  class, so a build fails without it; set `readOnlyHint` / `destructiveHint` honestly, because
  they drive the permission screen a user actually sees.
- **Registering a new tool takes two edits in `mcp-server/handlers/index.ts`**: add it to the
  import/export list, and add `new YourHandler()` to `createAllHandlers()`. Missing the second is
  a silent no-op — the tool simply never appears.
- **Tool descriptions carry the failure modes, not just the happy path.** They are the only
  documentation most callers ever read. Say what silently goes wrong and name the alternative
  tool.
- **Errors name the offending input and the way out.** "Unknown field X, available: ..." beats
  "invalid argument".

## Rules

- **`npm run build` must pass before you commit.** It is the only check that runs without
  infrastructure, so it is the one that is actually enforceable.
- **Never commit secrets.** `SIYUAN_TOKEN` is a full read/write credential for the workspace.
  `.env` is gitignored — keep it that way, and never paste a token into a source file, a test, a
  commit message, or a tool description.
- **Never hand-edit `dist/`.** It is build output and gitignored; changes there vanish on the next
  `tsc` and mislead whoever reads them.
- **Verify SiYuan writes by reading them back.** This is the project's most expensive lesson, not
  a style preference. `POST /api/transactions` queues the work and returns `code: 0` *before it
  runs*, and failures are reported only to SiYuan's own interface — so a success response from
  anything transaction-backed promises nothing. Validate arguments before writing, read the state
  back after, and fail loudly if it did not land.
- **Prefer failing loudly over accepting silently.** Several bugs in this project's history were
  calls that reported success while discarding data. When in doubt, reject the input and name the
  problem.
- **Do not weaken a test to make it pass.** The integration tests touch real data; a test that
  suddenly needs loosening is usually reporting a real regression.
- **Do not put deployment specifics in this repo.** It is public. Hostnames, container commands
  and credentials live in the private SiYuan project hub, not here.

## Working agreement

Two developers, separate Claude Code accounts, never working at the same time. Neither of us can
see the other's session history, so the repo has to carry the context.

1. **Pull before starting.** `git pull --rebase` on `main`, every session, before anything else.
2. **Work on a branch.** Never commit directly to `main`; CI builds and publishes a container
   image from `main`, so a push there is a deployment.
3. **Open a PR** rather than merging locally, so the other person can read what changed.
4. **Update `NOTES.md` at the end of every session** — newest entry at the top. What you changed,
   what you learned, what you left unfinished, and anything you tried that did not work. The last
   one matters most: it is the part the other person cannot reconstruct from the diff.
5. **Say what is in flight.** If you stop mid-task, put that in `NOTES.md` explicitly rather than
   leaving a branch to be discovered.
