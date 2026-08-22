#!/usr/bin/env node
/**
 * SiYuan MCP Server - HTTP/SSE Transport
 *
 * Usage:
 *   node http.js --token <API_TOKEN> [--baseUrl <BASE_URL>] [--port <PORT>]
 *
 * Example:
 *   node http.js --token YOUR_API_TOKEN --port 3000
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { SiyuanMCPServer } from '../core/server.js';
import type { ServerConfig } from '../core/types.js';

/**
 * 解析命令行参数
 */
function parseArgs(): Partial<ServerConfig> & { port?: number } {
  const args = process.argv.slice(2);
  const config: Partial<ServerConfig> & { port?: number } = {};

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
      case '--port':
      case '-p':
        if (i + 1 < args.length) {
          config.port = parseInt(args[++i]);
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
  console.log(`
SiYuan MCP Server (HTTP/SSE Transport)

Usage:
  node http.js --token <API_TOKEN> [OPTIONS]

Required:
  --token <string>      SiYuan API token (or set SIYUAN_TOKEN)

Options:
  --baseUrl <string>    SiYuan base URL (or SIYUAN_BASE_URL; default: http://127.0.0.1:6806)
  --port, -p <number>   HTTP server port (or PORT; default: 3000)
  --help, -h            Show this help message

Environment variables:
  SIYUAN_TOKEN          SiYuan API token. Preferred for container deployments,
                        since it keeps the token out of the process arguments.
  SIYUAN_BASE_URL       SiYuan base URL
  PORT                  HTTP server port

Command-line flags take precedence over environment variables.

Example:
  node http.js --token YOUR_API_TOKEN
  node http.js --token YOUR_API_TOKEN --port 3000
  node http.js --token YOUR_API_TOKEN --baseUrl http://192.168.1.100:6806 --port 8080

Endpoints:
  GET  /mcp    - Establish SSE connection
  POST /mcp    - Send JSON-RPC message
  DELETE /mcp  - Close session
  `);
}

/**
 * 解析请求体
 */
async function parseRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : undefined);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

/**
 * 主函数
 */
async function main() {
  const config = parseArgs();

  // 命令行参数优先，其次环境变量。容器部署时使用环境变量可避免令牌出现在进程参数中
  const token = config.token || process.env.SIYUAN_TOKEN;
  const baseUrl = config.baseUrl || process.env.SIYUAN_BASE_URL || 'http://127.0.0.1:6806';
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;

  // 验证必需参数
  if (!token) {
    console.error('Error: a token is required (pass --token or set SIYUAN_TOKEN)\n');
    printHelp();
    process.exit(1);
  }

  const serverConfig: ServerConfig = {
    token,
    baseUrl,
    name: 'siyuan-mcp-server-http',
    version: '0.1.0',
  };

  const port = config.port || envPort || 3000;

  // 每个会话一个 transport + Server 实例。
  //
  // 之前的实现共用单个 transport 并只 connect 一次，结果是服务器只接受第一个
  // 客户端：第二次 initialize 会返回 "Server already initialized"，必须重启进程
  // 才能换一个客户端连接。对于多客户端共享的 MCP 端点来说这是不可用的。
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  // 仅用于启动期日志和工具计数
  const bootstrapLogger = new SiyuanMCPServer(serverConfig).getLogger();

  async function createSession(): Promise<StreamableHTTPServerTransport> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: async (id: string) => {
        sessions.set(id, transport);
        bootstrapLogger.info(`Session initialized: ${id} (active: ${sessions.size})`);
      },
      onsessionclosed: async (id: string) => {
        sessions.delete(id);
        bootstrapLogger.info(`Session closed: ${id} (active: ${sessions.size})`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    // 每个会话都需要自己的 Server 实例：一个 Server 只能绑定一个 transport
    const sessionServer = new SiyuanMCPServer(serverConfig);
    await sessionServer.getMCPServer().connect(transport);
    return transport;
  }

  const logger = bootstrapLogger;

  // 创建 HTTP 服务器
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');

    // 处理 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 只处理 /mcp 路径
    if (req.url !== '/mcp') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    try {
      // 解析请求体（对于 POST 请求）
      const parsedBody = req.method === 'POST' ? await parseRequestBody(req) : undefined;

      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      let transport: StreamableHTTPServerTransport | undefined;
      if (sessionId) {
        transport = sessions.get(sessionId);
        if (!transport) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32001, message: 'Session not found or expired' },
              id: null,
            })
          );
          return;
        }
      } else if (isInitializeRequest(parsedBody)) {
        // 新客户端：为其建立独立会话
        transport = await createSession();
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: Mcp-Session-Id header is required for non-initialize requests',
            },
            id: null,
          })
        );
        return;
      }

      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      logger.error(`Request error: ${error}`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(`Internal Server Error: ${error}`);
      }
    }
  });

  // 启动服务器
  httpServer.listen(port, () => {
    console.log(`
✅ SiYuan MCP Server (HTTP/SSE) is running!

Server Info:
  - Port: ${port}
  - Endpoint: http://localhost:${port}/mcp
  - SiYuan Base URL: ${serverConfig.baseUrl}

Available Methods:
  - GET  http://localhost:${port}/mcp - Establish SSE connection
  - POST http://localhost:${port}/mcp - Send JSON-RPC message
  - DELETE http://localhost:${port}/mcp - Close session

Example:
  curl -X POST http://localhost:${port}/mcp \\
    -H "Content-Type: application/json" \\
    -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

Press Ctrl+C to stop the server.
    `);
  });

  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('\nShutting down server...');
    httpServer.close();
    await Promise.allSettled([...sessions.values()].map((t) => t.close()));
    sessions.clear();
    process.exit(0);
  });
}

// 错误处理
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// 启动服务器
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
