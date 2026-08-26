/**
 * SiYuan MCP 服务器核心
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createSiyuanTools } from '../../src/index.js';
import type { ServerConfig, ExecutionContext, MCPTool } from './types.js';
import { DefaultToolRegistry } from './registry.js';
import { ConsoleLogger } from './logger.js';
import { createAllHandlers } from '../handlers/index.js';

/**
 * SiYuan MCP 服务器
 */
export class SiyuanMCPServer {
  private mcpServer: Server;
  private registry = new DefaultToolRegistry();
  private context: ExecutionContext;
  private logger = new ConsoleLogger();

  constructor(config: ServerConfig) {
    // 初始化 SiYuan 工具
    const siyuan = createSiyuanTools(config.baseUrl, config.token);

    // 创建执行上下文
    this.context = {
      siyuan,
      config,
      logger: this.logger,
    };

    // 注册所有工具处理器
    this.registerHandlers();

    // 创建 MCP 服务器实例
    this.mcpServer = new Server(
      {
        name: config.name || 'siyuan-mcp-server',
        version: config.version || '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      }
    );

    // 设置请求处理器
    this.setupRequestHandlers();
  }

  /**
   * 注册所有工具处理器
   */
  private registerHandlers(): void {
    const handlers = createAllHandlers();
    for (const handler of handlers) {
      this.registry.register(handler);
      this.logger.debug(`Registered tool: ${handler.name}`);
    }
  }

  /**
   * 设置 MCP 请求处理器
   */
  private setupRequestHandlers(): void {
    // 处理工具列表请求
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: MCPTool[] = this.registry.getAll().map((handler) => ({
        name: handler.name,
        description: handler.description,
        inputSchema: handler.inputSchema,
        annotations: handler.annotations,
      }));

      this.logger.debug(`Listing ${tools.length} tools`);
      return { tools };
    });

    // 处理提示词列表请求
    this.mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [
          {
            name: 'siyuan-usage-guide',
            description:
              'How to use this server effectively: which tool to reach for, the ordering constraints that matter, and the failure modes that are silent rather than loud. Worth reading before bulk imports or any database work.',
          },
        ],
      };
    });

    // 处理获取提示词请求
    this.mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name } = request.params;

      if (name === 'siyuan-usage-guide') {
        const guide = this.getUsageGuide();
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: '请阅读 SiYuan MCP 服务器的使用指南',
              },
            },
            {
              role: 'assistant',
              content: {
                type: 'text',
                text: guide,
              },
            },
          ],
        };
      }

      throw new Error(`Unknown prompt: ${name}`);
    });

    // 处理工具调用请求
    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      this.logger.info(`Tool called: ${name}`);

      try {
        const handler = this.registry.get(name);
        if (!handler) {
          throw new Error(`Unknown tool: ${name}`);
        }

        // 执行工具
        const result = await handler.execute(args || {}, this.context);

        // 格式化返回结果（符合 MCP 协议）
        // 处理 void 返回值（undefined）
        let text: string;
        if (result === undefined) {
          text = 'Success';
        } else if (typeof result === 'string') {
          text = result;
        } else {
          text = JSON.stringify(result, null, 2);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Tool execution failed: ${errorMessage}`);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * 获取使用指南内容
   */
  private getUsageGuide(): string {
    return `# SiYuan MCP — usage guide

This guide is generic to any source system and any client — it is not written around one
particular migration. Report anything wrong or missing to the project's Findings queue rather
than silently working around it; a fix here reaches every caller.

## Structure

Notebooks contain documents, which can nest arbitrarily deep as sub-documents — there is no
separate space/page distinction to worry about. Nesting is set by the \`path\` argument on
\`create_document\` (e.g. \`/parent/child\`); there is no separate move step for a document created
in the right place. Titles and paths take raw text, not HTML-escaped entities — see
\`create_document\`'s own description. Em dashes, \`®\`, and emoji all pass through cleanly.

## Choosing a tool

**Editing note text.** Prefer block-level tools over document-level ones. \`update_document\`
rewrites an entire note; \`update_block\` changes one block and leaves the rest byte-identical;
\`append_to_document\` adds to the end without resubmitting anything that already exists. On a
10,000-word note, block-level editing is the difference between resending the whole document and
sending a few hundred bytes. Use \`get_child_blocks\` to find block IDs first — that is the
discovery path for every block tool.

**Reading.** \`get_document_content\` for whole notes, \`get_block_kramdown\` for one block's exact
source including its attributes, \`unified_search\` to find things, \`get_document_tree\` for
structure.

**Databases.** \`render_database\` is the main read: it returns computed rows and the row IDs that
every write tool needs. \`get_database\` returns the schema and raw view config but no rows.
\`add_database_rows_with_values\` creates rows; to correct or update rows that already exist, use
\`set_database_cell\` (one cell) or \`set_database_cells\` (many, across one or more rows, in one
call — the batch path for corrections the way \`add_database_rows_with_values\` is the batch path
for creation). Both accept the same plain-form values described below.

## Cross-document links

Block references use \`((document-id "Display Text"))\` and are bidirectional — a backlink appears
automatically on the target, with no separate step. The \`siyuan://blocks/<id>\` URL form also
works but is one-directional (no backlink). Document IDs come from \`create_document\`'s return
value. When a branch of documents references each other, create all of them first and add the
links in a second pass — referencing an ID that doesn't exist yet fails, so single-pass creation
with forward references doesn't work.

## Bulk import

Do not create rows one at a time. \`add_database_rows_with_values\` creates rows and sets every
cell in one request; \`create_database\` accepts a whole field schema in one call. A 3-row,
10-field database takes about 4 calls this way and roughly 45 without.

Every row must include a non-empty value for the primary-key field. \`add_database_rows_with_values\`
rejects the whole call up front, naming the row index, rather than let SiYuan silently create no
row at all for that one entry while still reporting it as written. This check is specific to that
tool's endpoint — if a row genuinely needs a blank title, use \`add_database_rows\` instead (accepts
an empty or omitted title) and fill in the other fields afterward with \`set_database_cell\`.

Recommended order:

1. \`create_snapshot\` — bulk writes are hard to undo without one
2. \`create_database\` with its \`fields\` schema
3. \`add_database_rows_with_values\`, giving each row an \`item_id\`
4. \`embed_database\` to place it in a document
5. filters, sorts, grouping, layout — only after embedding
6. \`render_database\` at a small \`page_size\` to verify — \`rowCount\` alone confirms the total; no
   need to re-fetch every row

**\`item_id\` scheme, for a resumable import.** Format is 14 digits, a hyphen, then 7 lowercase
alphanumerics, e.g. \`20230713000000-a3f9c2d\`. Recommended construction: prefix = the source row's
*date only* (\`YYYYMMDD\` + \`000000\`) — deliberately excluding any time-of-day component, since
freeform or ambiguous time fields are exactly what produces silent collisions; suffix = the last 7
characters of the source system's own record ID, which inherits uniqueness from the source rather
than computing it. This construction is generic — it works for any source, not just one particular
migration. Re-sending a row whose \`item_id\` already exists **updates it in place** rather than
duplicating it, which is what makes an interrupted import safely re-runnable from the start.
Without \`item_id\`, a retry after a timeout silently doubles the data.

**Migration-fidelity principle.** When a source field is ambiguous or inconsistently formatted,
do not resolve the ambiguity during migration — copy it verbatim, and log the data-quality issue
as a separate follow-up. Reinterpreting source data mid-migration silently changes what it means;
this is also why the \`item_id\` scheme above deliberately avoids parsing time-of-day fields.

**Token-efficient bulk writes.** Build and validate the row payload programmatically (row count,
a uniqueness check, one sample) rather than previewing the full payload in conversation before
calling the tool — dumping it first and then passing the same data as a parameter doubles the
token cost for no benefit. Select only the columns actually needed from the source query, not
every column. \`chunk_size\` controls round-trip/tool-call overhead, not the token floor set by the
row data itself — a larger \`chunk_size\` reduces call count, not total token cost.

**SiYuan's write limits, versus a source system's read limits.** These are unrelated and worth not
conflating: \`add_database_rows_with_values\` chunks internally, default 100 rows per request
(\`chunk_size\` is adjustable), and single unchunked calls of at least 300 rows have been confirmed
to work cleanly — the true ceiling above that is still unmeasured, so do not assume a hard number
beyond "300+ proven fine." If a bulk operation is failing or throttling, check which side is
actually the bottleneck before changing SiYuan-side batch sizes: a rate limit on the system you are
*reading from* (e.g. a source API's own query limits) calls for backing off or paginating those
reads, not for shrinking the SiYuan write batches, which were never the constraint in that case.

## Building a database schema

\`create_database\`'s primary key is auto-named "Primary Key" and placed first in the column order
when created with a \`fields\` schema — rename it with \`update_database_field\` if a more specific
name is wanted. \`update_database_field\` renames a field or changes its type without discarding
existing data (the primary key can be renamed but not retyped, and no other field can become the
primary key). \`configure_select_options\` sets the option list for a select/mSelect field
explicitly — useful both to control colours (implicit option creation always assigns the same
colour) and to pre-seed a known option set before an import that uses \`validate_options\`.

**select/mSelect options are created on write, with no validation, no case-folding.** A value not
already an existing option becomes a new option silently — \`"Done"\` and \`"done"\` are two separate
options with no warning either way, and this is easy to miss because it looks identical in a table
view until filters start silently missing rows. Whitespace is trimmed automatically (there being
no legitimate use for a leading or trailing space in an option name), but case is not folded, since
folding it automatically could just as easily merge two options that were meant to be distinct.
Prefer passing values through unchanged from a canonical source rather than retyping them by hand.
For anything where a stray near-duplicate option would matter, set \`validate_options: true\` on
\`add_database_rows_with_values\` to reject unknown values instead of silently creating them —
pair it with \`configure_select_options\` to declare the allowed set first.

**No auto-increment field type exists.** \`lineNumber\` is row position, not a stable identifier —
it renumbers on delete or reorder, silently reassigning what a given number refers to, which is
worse than having no ID column at all. For a manually-maintained sequential ID (e.g. a "BL-#" or
"PF-#" style scheme), \`get_next_sequence_value\` reads the current maximum of a number field and
suggests max+1. This is a convenience read, not an atomic counter, and does not guarantee
uniqueness under concurrent writers — it replaces scanning for the highest existing value by hand,
not a real auto-increment.

## Row-creation templates

\`configure_new_item_templates\` sets a database's row-creation templates — SiYuan's equivalent of
Notion's page templates. A "detached" template just pre-fills field defaults; a "document"
template additionally binds each new row to a real document, with a body copied from a template
document (or supplied fresh per row — see below). Requires the database to be embedded
(\`block_id\` from \`embed_database\`) before rows can actually be created from a template, though
the templates themselves can be configured on a detached database.

This call **replaces the whole template set**, not a merge — read \`newItemTemplates\` back from
\`get_database\` first if amending rather than replacing. select/mSelect default values must
already exist as options on the field (\`configure_select_options\` first); unlike a normal cell
write, an unknown option here is rejected rather than created.

A "document" template's \`content_template_path\` is **not** a document ID or path in the notebook
tree — it resolves against the workspace's \`data/templates/\` folder, SiYuan's own template-file
mechanism, unrelated to regular documents. Write a document with the structure a new row's body
should start from, then call \`save_document_as_template\` to turn it into a template file, and
pass the path it returns as \`content_template_path\`.

To use a template: \`create_database_row_from_template\` creates a row from it (or a blank row if
no template is given), reusing a "document" template's own content unchanged.
\`create_database_row_from_template_with_markdown\` does the same but takes fresh markdown for the
new document's body instead — the one to use when each row's content should be generated per-row
(e.g. an AI-written brief from a fixed structural template) rather than starting from identical
boilerplate every time. It only works with a document-target template.

A template's \`primary_key_template\` wins over the per-row \`title\`. SiYuan falls back to \`title\`
only when \`primary_key_template\` is empty, so a template that sets both names every row alike
while their bodies still differ, with no error anywhere. Supplying both is rejected up front
rather than silently ignored; omit \`title\` to accept the generated name, or clear
\`primary_key_template\` on that template.

A document-target template creates each row's document as a **child of the document holding the
database**, unless the template's own save location says otherwise. So removing the host document
removes those row documents with it — there is no need to delete them separately, and trying to
is what surfaces the misleading \`indexing\` error described below.

## Relations between databases

A field of type \`relation\` or \`rollup\` is created inert. It exists, and it points at nothing.
Values written to it go nowhere and no error is raised. Wire it up:

1. Create and populate the target database first
2. \`configure_relation_field\` to point the relation at that database
3. Write relation values as an array of target row IDs
4. \`configure_rollup_field\` last — it depends on a configured relation

Migrating databases that reference each other in the wrong order silently loses the links.

## Failure modes that are silent

These fail without raising an error, so they are worth knowing rather than discovering:

- **View operations on a detached database.** \`set_database_filters\`, \`set_database_sorts\`,
  \`set_database_group\` and \`change_database_layout\` do nothing unless the database is embedded
  in a document. These tools require a \`block_id\` and fail fast instead.
- **Row ID versus bound block ID.** They are different identifiers. Writing a cell with the wrong
  one stores a value that never appears anywhere. \`resolve_database_ids\` converts between them.
- **Unconfigured relation and rollup fields**, as above.
- **select/mSelect option case-sensitivity**, as above — the whitespace half of this is now
  handled automatically, the case-folding half is not, deliberately.
- **Changing a primary key's type, or changing another field to the primary-key type.**
  \`update_database_field\` refuses this itself with a clear error before contacting SiYuan,
  precisely because the kernel's own refusal is silent — it reports success and changes nothing,
  with no way to detect that from the response.
- **The SQL index lags writes by one to two seconds.** A document created a moment ago may not
  appear in \`get_document_tree\` yet.
- **\`indexing\` is what "no such document" often looks like.** Not silent, but misleading: when a
  block ID is not in the block tree, SiYuan falls back to searching the filesystem for it, and
  that search is rate-limited to one call every three seconds. A second miss inside that window
  is refused with the error \`indexing\` instead of \`tree not found\`. During a burst of writes and
  deletes this reads like a transient kernel problem when the real cause is a stale ID — usually
  a document already removed as a child of something else. Re-check the ID before retrying.
- **Grouping hides rows.** A grouped view can report \`rowCount\` above zero while returning an
  empty \`rows\` array, and grouping survives a layout change. Clear the group before concluding
  data is missing.

## Values

Write cell values plainly — \`42\`, \`"2026-05-25"\`, \`"Done"\`, \`["A","B"]\`, \`true\`. The server
converts them according to each field's type. Dates given as \`YYYY-MM-DD\` are interpreted at
local midnight in the instance's timezone and rendered with no time shown, matching what the
interface displays; passing a UTC timestamp instead renders as the previous day west of UTC.

## Known limitations, not planned

- **Formula/\`template\` fields cannot be configured.** They can be created but the expression
  cannot be set through this server. Deliberately not built: a survey of every database in one
  full workspace migration found exactly one formula column in use, and it was worked around by
  dropping it. Revisit only if a specific need for a computed column shows up.
- **The real ceiling above ~300 rows per unchunked \`add_database_rows_with_values\` call is
  unmeasured**, as above.

## Reporting problems

This guide is generic, so it lags reality — anything found wrong or missing belongs in the
Project Findings database under 3.9.1 (\`Owner\` set to \`Code\`), not worked around silently. A
finding is only as useful as what it lets the other side reproduce without asking follow-up
questions. Before filing one:

- **Verify it is actually a tool bug, not a caller mistake**, by reading the result back — a
  success response is not proof of anything written; a thrown error is not proof the tool is
  broken (it may be doing exactly what it should with bad input). Several fixes on this project
  turned out to require correction after a first pass overstated how broadly a limitation applied
  (see the PF-18 entry in the Decisions log) — scope a claim to the specific tool and endpoint
  actually tested, not "the kernel" or "the connector" in general.
- **Quote the exact error text**, verbatim, not a paraphrase — silent-failure classes on this
  project have repeatedly turned on one specific wrong word in a JSON key or action name.
- **Name the exact tool called and the arguments that triggered it** (redact real data, keep
  structure/shape), and what \`render_database\` or the equivalent read-back actually showed
  afterward, not just what was expected.
- **Give a minimal reproduction** where possible — the smallest call that reproduces it, not the
  full migration context it was found in.

## Safety

- \`create_snapshot\` before bulk or destructive work; \`list_snapshots\` and \`rollback_to_snapshot\`
  to recover.
- \`remove_document\` deletes child documents too.
- \`remove_database_rows\` deletes detached rows outright but only unbinds rows backed by real
  blocks; the underlying documents survive.
- \`remove_unused_databases\` is irreversible and counts any database you have created but not yet
  embedded as unused. Do not run it while building one.
`;
  }

  /**
   * 获取底层 MCP 服务器实例
   */
  getMCPServer(): Server {
    return this.mcpServer;
  }

  /**
   * 获取工具注册表
   */
  getRegistry(): DefaultToolRegistry {
    return this.registry;
  }

  /**
   * 获取日志记录器
   */
  getLogger(): ConsoleLogger {
    return this.logger;
  }
}
