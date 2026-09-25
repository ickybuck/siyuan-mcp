#!/usr/bin/env node
/**
 * SiYuan MCP Server - Stdio Transport
 *
 * 通过标准输入输出通信的 MCP 服务器
 *
 * Usage:
 *   node stdio.js --token <API_TOKEN> [--baseUrl <BASE_URL>]
 *
 * Example:
 *   node stdio.js --token YOUR_API_TOKEN --baseUrl http://127.0.0.1:6806
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SiyuanMCPServer } from '../core/server.js';
import type { ServerConfig } from '../core/types.js';

/**
 * 解析命令行参数
 */
function parseArgs(): Partial<ServerConfig> {
  const args = process.argv.slice(2);
  const config: Partial<ServerConfig> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token':
        if (i + 1 < args.length) {
          config.token = args[++i];
        }
        break;
      case '--baseUrl':
        if (i + 1 < args.length) {
          config.baseUrl = args[++i];
        }
        break;
      case '--tool-prefix':
        if (i + 1 < args.length) {
          config.toolPrefix = args[++i];
        }
        break;
      case '--name':
        if (i + 1 < args.length) {
          config.name = args[++i];
        }
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

/**
 * 打印帮助信息
 */
function printHelp(): void {
  console.error(`
SiYuan MCP Server (Stdio Transport)

Usage:
  node stdio.js --token <API_TOKEN> [OPTIONS]

Required:
  --token <string>      SiYuan API token

Options:
  --baseUrl <string>    SiYuan base URL (default: http://127.0.0.1:6806)
  --tool-prefix <string>  Prefix every advertised tool name (or MCP_TOOL_PREFIX).
                        Use this when more than one instance is connected to the
                        same client, so tools pointed at different workspaces do
                        not share names. Once set, unprefixed calls are rejected.
  --name <string>       Server name reported to clients (or MCP_SERVER_NAME)
  --help, -h            Show this help message

Example:
  node stdio.js --token YOUR_API_TOKEN
  node stdio.js --token YOUR_API_TOKEN --baseUrl http://192.168.1.100:6806
  `);
}

/**
 * 主函数
 */
async function main() {
  const config = parseArgs();

  // 验证必需参数
  if (!config.token) {
    console.error('Error: --token is required\n');
    printHelp();
    process.exit(1);
  }

  // 设置默认值
  const serverConfig: ServerConfig = {
    token: config.token,
    baseUrl: config.baseUrl || 'http://127.0.0.1:6806',
    name: config.name || process.env.MCP_SERVER_NAME || 'siyuan-mcp-server-stdio',
    version: '0.1.0',
    toolPrefix: config.toolPrefix || process.env.MCP_TOOL_PREFIX,
  };

  // 创建服务器
  const server = new SiyuanMCPServer(serverConfig);
  const logger = server.getLogger();

  // 创建 Stdio 传输层
  const transport = new StdioServerTransport();

  // 连接服务器
  await server.getMCPServer().connect(transport);

  logger.info('SiYuan MCP Server started (Stdio transport)');
  logger.info(`Base URL: ${serverConfig.baseUrl}`);
  logger.info(`Token: ${serverConfig.token.substring(0, 8)}...`);
  logger.info(`Registered ${server.getRegistry().getAll().length} tools`);
  if (serverConfig.toolPrefix) {
    logger.info(`Tool prefix: ${serverConfig.toolPrefix} (unprefixed calls are rejected)`);
  }
}

// 错误处理
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.error('\nShutting down...');
  process.exit(0);
});

// 启动服务器
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
