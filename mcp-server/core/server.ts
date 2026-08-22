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

## Choosing a tool

**Editing note text.** Prefer block-level tools over document-level ones. \`update_document\`
rewrites an entire note; \`update_block\` changes one block and leaves the rest byte-identical.
On a 10,000-word note that is the difference between resending the whole document and sending a
few hundred bytes. Use \`get_child_blocks\` to find the block IDs first — that is the discovery
path for every block tool.

**Reading.** \`get_document_content\` for whole notes, \`get_block_kramdown\` for one block's exact
source including its attributes, \`unified_search\` to find things, \`get_document_tree\` for
structure.

**Databases.** \`render_database\` is the main read: it returns computed rows and the row IDs that
every write tool needs. \`get_database\` returns the schema and raw view config but no rows.

## Bulk import

Do not create rows one at a time. \`add_database_rows_with_values\` creates rows and sets every
cell in one request; \`create_database\` accepts a whole field schema in one call. A 3-row,
10-field database takes about 4 calls this way and roughly 45 without.

Recommended order:

1. \`create_snapshot\` — bulk writes are hard to undo without one
2. \`create_database\` with its \`fields\` schema
3. \`add_database_rows_with_values\`, giving each row an \`item_id\`
4. \`embed_database\` to place it in a document
5. filters, sorts, grouping, layout — only after embedding

Give every row an \`item_id\`. Re-sending a row whose id already exists updates it instead of
creating a duplicate, which means an interrupted import can simply be re-run from the start.
Without it, a retry after a timeout silently doubles your data.

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
- **The SQL index lags writes by one to two seconds.** A document created a moment ago may not
  appear in \`get_document_tree\` yet.
- **Grouping hides rows.** A grouped view can report \`rowCount\` above zero while returning an
  empty \`rows\` array, and grouping survives a layout change. Clear the group before concluding
  data is missing.

## Values

Write cell values plainly — \`42\`, \`"2026-05-25"\`, \`"Done"\`, \`["A","B"]\`, \`true\`. The server
converts them according to each field's type. Dates given as \`YYYY-MM-DD\` are interpreted at
local midnight in the instance's timezone, which is what the interface displays; passing a UTC
timestamp instead renders as the previous day.

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
