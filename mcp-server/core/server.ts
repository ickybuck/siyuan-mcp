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
import { getUsageGuide } from './usage-guide.js';

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
        const guide = getUsageGuide();
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
