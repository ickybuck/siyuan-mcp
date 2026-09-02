# SiYuan MCP Server

[中文文档](./README_zh.md) | English

A Model Context Protocol (MCP) server for SiYuan Note, enabling AI assistants like Claude, Cursor, and other MCP-compatible tools to interact with your SiYuan notes seamlessly.

## ⚠️ Important Notice | 重要声明

**English:**

The code in this project is primarily developed with AI assistance. While functional testing has been performed, comprehensive code review has not been completed. **This applies to the fork as much as to the code it inherits:** the block, database, history and verification layers added here were written by Claude Code and have not had a comprehensive human review either. Before using this project, please be aware of and accept the following:

- The code may contain undiscovered issues or potential risks
- Conduct necessary code reviews and testing before use
- Users assume all risks and responsibilities arising from the use of this project
- Thorough validation is recommended before production use

Every added endpoint has been exercised against a live SiYuan 3.8.1 kernel, including negative cases, and every write path reads its result back rather than trusting a success response. That is a statement about what has been *tested*; it is not a substitute for the caveat above.

**Use with caution and at your own risk.**

---

**中文：**

本项目代码主要由 AI 辅助开发，仅进行了功能性测试，未对所有代码进行完整审查。**这一点对本 fork 自身的代码同样成立**：这里新增的块级编辑、数据库、历史回滚与写后校验各层由 Claude Code 编写，同样没有经过完整的人工审查。使用本项目前，请充分了解并接受以下内容：

- 代码可能存在未发现的问题或潜在风险
- 请在使用前进行必要的代码审查和测试
- 使用者需自行承担使用本项目所产生的风险和责任
- 建议在生产环境使用前进行充分的验证

**请谨慎使用，并对自己的选择负责。**

## 🍴 About This Fork

This is a fork of [porkll/siyuan-mcp](https://github.com/porkll/siyuan-mcp) that expands the tool
surface from 16 to 76 tools. Upstream exposed only document-granular operations, which meant editing
one paragraph of a large note required rewriting the whole document. This fork adds **block-level
editing** and a complete **database (attribute view)** layer.

The practical difference: a 148-byte `update_block` call can edit a single paragraph inside a
10,000-word document, instead of sending the entire document back.

**What this fork adds:**

| Area | Upstream | This fork |
| --- | --- | --- |
| Block operations | 0 tools | 11 tools |
| Databases (attribute views) | 0 tools | 27 tools |
| Filetree | partial | +4 tools |
| **Total** | **16** | **76** |

All added endpoints were verified against a live SiYuan 3.8.1 kernel, including negative cases.
See [Notes & Gotchas](#-notes--gotchas) for behaviours that are easy to get wrong.

## ✨ Features

- 🚀 Full MCP (Model Context Protocol) implementation
- 📝 76 tools covering documents, blocks, databases, notebooks, tags, history and snapshots
- 🧱 **Block-level editing** — edit, insert, move, fold, and delete individual blocks
- 🗃️ **Database support** — create databases, add fields and rows, set cell values, filter, sort, group, switch layouts
- 🔍 Unified search (content, filename, tag, and combinations)
- 📁 Document management (create, read, update, rename, remove, move, sort, tree)
- 📅 Daily note support with auto-creation
- 📚 Notebook operations
- 📸 Snapshot management (backup & restore)
- 🏷️ Tag management (list, replace)
- 💻 Written in TypeScript with full type definitions
- 🌐 Works with Claude Desktop, Cursor, and any MCP-compatible client

## 📦 Installation

### Option 1: Install from Source (Recommended)

```bash
# Clone the repository
git clone https://github.com/ickybuck/siyuan-mcp.git
cd siyuan-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Install globally
npm install -g .
```

### Option 2: Install from npm

```bash
# Install globally
npm install -g siyuan-mcp-blocks

# Or use npx (no installation needed)
npx siyuan-mcp-blocks
```

After global installation, the `siyuan-mcp` command will be available globally.

## 🔧 Configuration

### Prerequisites

1. **Get your SiYuan API Token:**
   - Open SiYuan Note
   - Go to Settings → About → API Token
   - Copy the token

2. **Ensure SiYuan is running:**
   - Default URL: `http://127.0.0.1:6806`
   - If using a different port, adjust the `baseUrl` accordingly

### Configure for Cursor

Edit your MCP configuration file at `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "siyuan-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "siyuan-mcp-blocks",
        "stdio",
        "--token",
        "YOUR_API_TOKEN_HERE",
        "--baseUrl",
        "http://127.0.0.1:6806"
      ]
    }
  }
}
```

**Note**: If you installed globally, you can use `"command": "siyuan-mcp"` instead of `"command": "npx"`.

### Configure for Claude Desktop

Edit the configuration file at:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "siyuan-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "siyuan-mcp-blocks",
        "stdio",
        "--token",
        "YOUR_API_TOKEN_HERE",
        "--baseUrl",
        "http://127.0.0.1:6806"
      ]
    }
  }
}
```

**Note**: If you installed globally, you can use `"command": "siyuan-mcp"` instead of `"command": "npx"`.

### Verify Installation

After configuration, restart your MCP client (Cursor/Claude Desktop) and try:
- "List all my SiYuan notebooks"
- "Search for documents containing 'project plan'"
- "Create a new meeting note in my work notebook"
- "Show me the 5 most recently modified documents"

## 🛠️ Available MCP Tools

Once configured, you can interact with SiYuan through natural language. The server provides 76 tools:

### 🔍 Search
- **unified_search** - Unified search tool: search by content, filename, tag, or any combination

### 📄 Document Operations
- **get_document_content** - Get the markdown content of a document
- **create_document** - Create a new document
- **append_to_document** - Append content to an existing document
- **update_document** - Update (overwrite) document content
- **remove_document** - Permanently delete a document and its children
- **rename_document** - Rename a document by ID
- **move_documents** - Move one or more documents to a new location
- **get_document_tree** - Get document tree structure with specified depth
- **set_document_sort_mode** - Set how a document's children are sorted (modes 0–14)
- **set_sort** - Set manual sort order for notebooks and documents

### 🧱 Block Operations

Block-level editing is the main reason this fork exists. Use **get_child_blocks** to discover the
block IDs that the other tools need.

- **get_child_blocks** - List the direct child blocks of a block or document
- **get_block_kramdown** - Get a block's raw Kramdown source, including IAL attributes
- **update_block** - Replace a single block's content in place
- **append_block** - Append a new block as the last child of a parent
- **prepend_block** - Insert a new block as the first child of a parent
- **insert_block_before** - Insert a new block directly before a reference block
- **insert_block_after** - Insert a new block directly after a reference block
- **move_block** - Move a block to a new position or parent
- **delete_block** - Delete a single block
- **fold_block** / **unfold_block** - Collapse or expand a block in the outliner

### 🗃️ Database (Attribute View) Operations

SiYuan databases are called *attribute views*. A database can exist **detached** (not shown in any
document) or **embedded** in a document as a block. Several view operations only work on embedded
databases — see [Notes & Gotchas](#-notes--gotchas).

- **create_database** - Create a new (detached) database, optionally with its whole field schema in one call
- **embed_database** - Embed a database into a document, returning the block ID
- **render_database** - Read computed rows/cards for a view, paginated (the main read tool)
- **get_database** - Get the raw definition: fields, ordering, view layouts
- **get_database_primary_key_values** - List primary-key row values, filtered and paginated
- **search_databases** - Search databases by name
- **add_database_rows** - Add rows, either bound to blocks or detached
- **add_database_rows_with_values** - Create rows AND set every cell in one call (bulk import)
- **set_database_cells** - Set many cells on existing rows in one call
- **remove_database_rows** - Remove rows by row ID
- **set_database_cell** - Set one cell's value
- **add_database_field** - Add a field/column (16 field types)
- **add_database_fields** - Add several fields in one call
- **configure_relation_field** - Point a relation field at its target database (required; relations are inert until configured)
- **configure_rollup_field** - Configure a rollup over a configured relation
- **remove_database_field** - Remove a field and all its values
- **sort_database_field** - Reorder a field globally, across all views
- **sort_database_view_field** - Reorder a field within a single view
- **get_database_filter_sort** - Read the current filter and sort rules
- **set_database_filters** - Replace a view's filters
- **set_database_sorts** - Replace a view's sorts
- **set_database_group** - Set or clear kanban grouping
- **change_database_layout** - Switch between table, gallery, and kanban
- **resolve_database_ids** - Translate between row IDs and bound block IDs
- **replace_database_blocks** - Re-point rows at different bound blocks
- **list_unused_databases** / **remove_unused_databases** - Find and clear orphaned databases

### 📅 Daily Note
- **append_to_daily_note** - Append to today's daily note (auto-creates if needed)

### 📚 Notebook Management
- **list_notebooks** - List all notebooks
- **get_recently_updated_documents** - Get recently updated documents

### 📸 Snapshot Management
- **create_snapshot** - Create a data snapshot for backup
- **list_snapshots** - List available snapshots
- **rollback_to_snapshot** - Rollback to a specific snapshot

### 🏷️ Tag Management
- **list_all_tags** - List all unique tags in workspace
  - Supports filtering by prefix (`prefix` parameter)
  - Supports limiting by depth level (`depth` parameter, starts from 1, tags separated by `/`)
- **batch_replace_tag** - Batch replace or remove tags across all documents

### Usage Examples

Ask your AI assistant naturally:

```
"List all my SiYuan notebooks"
"Search for documents about machine learning"
"Create a new document called 'Project Ideas' in my Work notebook"
"Show me the 10 most recently modified documents"
"Append 'Meeting notes: discussed Q4 goals' to today's daily note"
"Create a snapshot before I make major changes"
"What's the tree structure of my 'Projects' notebook?"
"Move document X to the root of my Work notebook"
"Move documents X and Y under document Z"
```

## 📥 Working with databases (and bulk import)

SiYuan databases are *attribute views*. The tools are designed so that a bulk import is a handful
of calls rather than thousands.

### Build a database in ~4 calls

```
create_database(fields: [...])          → av_id, primary_key_id, field name→id map
add_database_rows_with_values(rows)     → creates rows AND sets every cell
embed_database(av_id, parent_id)        → makes it visible in a document
```

Writing one cell at a time instead costs roughly `1 + N + N×M` calls. For a 1,739-row × 13-field
sleep log that is about 22,000 calls versus about 19.

### Values are written plainly

The field's declared type determines interpretation, so you don't build SiYuan's internal structs:

| Field type | Write |
| --- | --- |
| `text` | `"some text"` |
| `number` | `42` |
| `date` | `"2026-05-25"`, an ISO datetime, or ms epoch |
| `select` | `"Done"` |
| `mSelect` | `["A", "B"]` |
| `url` / `email` / `phone` | `"https://…"` |
| `checkbox` | `true` |
| `relation` | `["<target row id>"]` |

`YYYY-MM-DD` is interpreted at **local midnight in the instance's timezone**, matching what the UI
shows. Passing a UTC-midnight timestamp renders as the *previous day* west of UTC. Set the
container's `TZ` to the user's timezone.

### Make imports resumable

Give each row an `item_id`. The kernel adopts it as the row ID, and re-sending a row whose ID
already exists **updates** rather than duplicates — so an interrupted import can just be re-run.

```js
import { deriveItemId } from 'siyuan-mcp-blocks';
const item_id = deriveItemId(avID, sourceRecordKey); // stable, correct format
```

Verified behaviour of the batch endpoint:

| Situation | Behaviour |
| --- | --- |
| Chunk contains an invalid value or unknown field ID | **Atomic reject** — nothing written, safe to resend |
| Chunk succeeds and is sent again | **Duplicates**, unless rows carry `item_id` |
| Chunk succeeds and is resent *with* `item_id` | No-op — rows are updated in place |

Because a timeout doesn't tell you which case you're in, `item_id` is the only safe basis for retry.

### Relations must be configured

A `relation` or `rollup` field is created **inert** — it exists but points at nothing, and values
written to it vanish without error. There is no REST endpoint for this; it goes through
`/api/transactions`, which is why wrapping the `av` API alone isn't enough.

Order matters when migrating databases that reference each other:

1. Create and populate the **target** database first
2. `configure_relation_field` — point the relation at that database (optionally two-way, which
   creates the back-relation field and returns its ID)
3. Write relation values as an array of target row IDs
4. `configure_rollup_field` **last** — it depends on a configured relation

### Clean up after failures

A database created but never embedded is invisible in the UI yet still present.
`list_unused_databases` finds them, `remove_unused_databases` clears them. Don't run the latter
mid-build — a database you haven't embedded yet counts as unused.

### Ask the server itself

The server exposes an MCP **prompt**, `siyuan-usage-guide`, covering tool choice, ordering
constraints, and the silent failure modes. MCP clients can fetch it directly — it's aimed at the
model doing the calling rather than at a human reader.

## ⚠️ Notes & Gotchas

Behaviours found by testing against a live kernel. Most of these fail silently or in a misleading
way, so they are worth knowing before you rely on a result.

**View operations silently no-op on a detached database.** `set_database_filters`,
`set_database_sorts`, `set_database_group`, and `change_database_layout` return **HTTP 200 with an
empty body** and change nothing unless the database is embedded in a document and a valid
`block_id` is passed. These wrappers therefore require `block_id` and fail fast rather than
reporting a success that did nothing. Embed a database with `embed_database` first.

**Row IDs are not block IDs.** `set_database_cell` takes an `item_id`, which is the rendered row's
`id` from `render_database` (`rows[].id`, or `cards[].id` for gallery/kanban). For a row bound to an
existing block, the bound block's ID is a *different* value. Passing the wrong one stores an orphan
value that never appears in the rendered cell, with no error.

**Grouping and filters can hide rows.** A view with active grouping or filters can return an empty
`rows[]` while `rowCount` is greater than zero. Grouping also persists across a layout switch. If
rows unexpectedly vanish, clear the group before concluding the data is gone.

**Sort modes are 0–14, not 0–15.** `set_document_sort_mode` rejects 15 and 256, and rejects
notebook root document IDs. For notebook-level sorting, use the notebook configuration instead.

**Empty filters normalise, they don't clear to `[]`.** Clearing filters leaves a single empty root
group node (`{combination: "and"}`) rather than an empty array. This is expected.

**Node IDs must match `^[0-9]{14}-[a-z0-9]{7}$` exactly.** A shorter or differently shaped random
suffix yields `invalid id` or `invalid attribute view id`. Tools that create IDs generate conforming
ones automatically.

**The SQL index lags writes by roughly 1–2 seconds.** `get_document_tree` and anything else backed by
`/api/query/sql` may not see a document that was just created. Allow a short delay before reading
back.

**Document hierarchy is not in `parent_id`.** A child document's `blocks.parent_id` is empty — it is
the root of its own block tree. The real hierarchy is encoded in `path`
(`/parentID/childID.sy`). `get_document_tree` reconstructs the tree from paths for this reason.

**New select options are created implicitly.** Setting a `select`/`mSelect` cell to an option that
does not exist yet registers it on the field automatically.

## 📖 Tool Parameters Reference

### move_documents

Move one or more documents to a new location.

**Parameters:**
- `from_ids` (string[]) - **Required**. Array of document IDs to move
  - For a single document, use an array with one element: `["20210101000000-abc1234"]`
  - For multiple documents: `["20210101000000-abc1234", "20210102000000-def5678"]`
- `to_parent_id` (string) - **OPTION 1**: Target parent document ID. Documents will be moved under this document as children. Cannot be used together with `to_notebook_root`.
- `to_notebook_root` (string) - **OPTION 2**: Target notebook ID. Documents will be moved to the root (top level) of this notebook. Cannot be used together with `to_parent_id`.

**Important:** You must provide EXACTLY ONE destination: either `to_parent_id` OR `to_notebook_root`.

**Examples:**
```typescript
// Move single document to notebook root
{
  from_ids: ["20210101000000-abc1234"],
  to_notebook_root: "20210101000000-notebook1"
}

// Move multiple documents under another document
{
  from_ids: ["20210101000000-abc1234", "20210102000000-def5678"],
  to_parent_id: "20210103000000-parent99"
}
```

### batch_replace_tag

Batch replace all occurrences of a tag across all documents.

**Parameters:**
- `old_tag` (string) - **Required**. Tag name to replace (without # symbol)
- `new_tag` (string) - **Required**. New tag name (without # symbol, use empty string to remove)

**Examples:**
```typescript
// Replace tag
{
  old_tag: "project",
  new_tag: "work-project"
}

// Remove tag
{
  old_tag: "deprecated",
  new_tag: ""
}
```

## 🔧 Advanced: Using as TypeScript Library

While primarily designed as an MCP server, you can also use this package as a TypeScript library in your own projects:

```typescript
import { createSiyuanTools } from 'siyuan-mcp-blocks';

// Create an instance
const siyuan = createSiyuanTools('http://127.0.0.1:6806', 'your-token');

// Search operations
const files = await siyuan.searchByFileName('keyword', 10);
const blocks = await siyuan.searchByContent('content', 20);

// Document operations
const content = await siyuan.getFileContent(documentId);
await siyuan.createFile('notebookId', '/path/to/doc', '# Title\n\nContent');
await siyuan.appendToFile(documentId, 'New content');
await siyuan.overwriteFile(documentId, 'Replaced content');

// Daily note
await siyuan.appendToDailyNote('notebookId', 'Today I learned...');

// Notebook operations
const notebooks = await siyuan.listNotebooks();

// SQL queries
const results = await siyuan.search.query(`
  SELECT * FROM blocks 
  WHERE type='d' AND content LIKE '%keyword%'
  ORDER BY updated DESC
  LIMIT 10
`);

// Direct API access
await siyuan.block.insertBlockAfter(blockId, 'New block content');
await siyuan.document.moveDocument(['doc1', 'doc2'], 'targetNotebookId');
const tree = await siyuan.document.getDocTree('notebookId', 2);
```

### Type Definitions

Full TypeScript types are included:

```typescript
import type {
  SiyuanConfig,
  SiyuanApiResponse,
  Block,
  Notebook,
  NotebookConf,
  DocTreeNode,
  SearchOptions
} from 'siyuan-mcp-blocks';
```

## 🤝 Getting started for a new collaborator

This fork is maintained by two developers working asynchronously, from separate Claude Code
accounts, never at the same time. Neither can see the other's session history, so two files carry
everything that is not in the diff:

- **[CLAUDE.md](./CLAUDE.md)** — how the project is laid out, which commands actually work (and
  which look like they should but do not), the conventions to follow, and the working agreement:
  pull, branch, PR, update the log.
- **[NOTES.md](./NOTES.md)** — the running handoff log, newest first. Read the top entry before
  starting, and add one before you stop — including whatever you tried that did not work.

Short version: `npm install`, then `npm run build`. Neither `npm test` nor `npm run lint`
currently runs clean on a fresh clone — see CLAUDE.md for what is wrong with each — so
`npm run build` is the check to run before committing. Work on a branch: pushing to `main` builds
and publishes a container image.

---

## 💻 Development

### Setup

```bash
# Clone and install
git clone https://github.com/ickybuck/siyuan-mcp.git
cd siyuan-mcp
npm install

# Build
npm run build

# Watch mode (auto-rebuild)
npm run watch

# Lint
npm run lint

# Format
npm run format
```

### Manual Testing

```bash
# Start stdio server manually
npm run mcp:stdio -- --token YOUR_TOKEN --baseUrl http://127.0.0.1:6806

# Start HTTP server (for web clients)
npm run mcp:http -- --token YOUR_TOKEN --port 3000 --baseUrl http://127.0.0.1:6806
```

## 🏗️ Architecture

```
siyuan-mcp/
├── src/                    # Core TypeScript library
│   ├── api/               # SiYuan API clients
│   ├── types/             # Type definitions
│   └── utils/             # Helper utilities
├── mcp-server/            # MCP server implementation
│   ├── bin/               # CLI entry points
│   ├── core/              # MCP server core
│   ├── handlers/          # Tool handlers
│   └── transports/        # Stdio/HTTP transports
└── dist/                  # Compiled JavaScript
```

## 🔧 Tech Stack

- **Language**: TypeScript 5.3+
- **Runtime**: Node.js 18+
- **Module System**: ES Modules
- **MCP SDK**: @modelcontextprotocol/sdk
- **Protocol**: MCP (Model Context Protocol)

## ❓ FAQ

### How do I get my SiYuan API Token?
1. Open SiYuan Note
2. Go to Settings → About → API Token
3. Copy the token

### How do I find my notebook ID?
Ask your MCP client: "List all my SiYuan notebooks" and it will show IDs.

Or programmatically:
```typescript
const notebooks = await siyuan.listNotebooks();
console.log(notebooks.map(nb => `${nb.name}: ${nb.id}`));
```

### The server isn't working, what should I check?
1. Is SiYuan running? (default: http://127.0.0.1:6806)
2. Is your API token correct?
3. Did you restart your MCP client after configuration?
4. Check the logs in your MCP client

### Can I use a different SiYuan port?
Yes! Just update the `baseUrl` parameter:
```json
"--baseUrl", "http://127.0.0.1:YOUR_PORT"
```

### Does this work with remote SiYuan instances?
Yes! Point `baseUrl` to your remote instance:
```json
"--baseUrl", "http://your-server.com:6806"
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## 📄 License

Apache License 2.0 — the same licence as the project this is forked from, and it stays that way.
See [LICENSE](./LICENSE) for the full text.

This is a fork of [porkll/siyuan-mcp](https://github.com/porkll/siyuan-mcp), Copyright 2024 lei.
[NOTICE](./NOTICE) carries the attribution, and [MODIFICATIONS.md](./MODIFICATIONS.md) records
every inherited file that was changed along with everything added, as section 4(b) of the licence
requires. This project is not affiliated with, endorsed by, or sponsored by the upstream project
or its author, nor by SiYuan Note.

## 🔗 Related Projects

- [porkll/siyuan-mcp](https://github.com/porkll/siyuan-mcp) - The upstream project this forked from
- [SiYuan Note](https://github.com/siyuan-note/siyuan) - Official SiYuan Note repository
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP documentation
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Official MCP SDK

## 🙏 Acknowledgments

Built on [porkll/siyuan-mcp](https://github.com/porkll/siyuan-mcp) by lei, which supplied the MCP
scaffolding, the document tools and the client this expands — and on the excellent
[SiYuan Note](https://github.com/siyuan-note/siyuan) project, whose kernel API all of this talks to.
Developed primarily with AI assistance; see the notice at the top of this file.
