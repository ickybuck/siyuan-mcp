/**
 * MCP 服务器核心类型定义
 */

import type { SiyuanTools } from '../../src/index.js';

/**
 * 服务器配置
 */
export interface ServerConfig {
  /** SiYuan API Token */
  token: string;
  /** SiYuan Base URL */
  baseUrl: string;
  /** 服务器名称 */
  name?: string;
  /** 服务器版本 */
  version?: string;
}

/**
 * 工具执行上下文
 */
export interface ExecutionContext {
  /** SiYuan 工具实例 */
  siyuan: SiyuanTools;
  /** 服务器配置 */
  config: ServerConfig;
  /** 日志记录器 */
  logger: Logger;
}

/**
 * 日志记录器接口
 */
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * MCP tool annotation hints — advisory metadata clients use to group and
 * gate tools (e.g. Claude's connector permission UI splits Read-only vs
 * Write/delete based on readOnlyHint/destructiveHint).
 * https://modelcontextprotocol.io — ToolAnnotations
 */
export interface ToolAnnotations {
  /** If true, the tool does not modify its environment. */
  readonly readOnlyHint: boolean;
  /**
   * If true, the tool may perform destructive/overwriting updates.
   * Only meaningful when readOnlyHint is false.
   */
  readonly destructiveHint?: boolean;
}

/**
 * 工具处理器接口
 */
export interface ToolHandler<TArgs = any, TResult = any> {
  /** 工具名称 */
  readonly name: string;

  /** 工具描述 */
  readonly description: string;

  /** 输入参数的 JSON Schema */
  readonly inputSchema: JSONSchema;

  /** 工具注解（只读/破坏性提示，供客户端权限 UI 分组使用） */
  readonly annotations: ToolAnnotations;

  /**
   * 执行工具
   * @param args 输入参数
   * @param context 执行上下文
   * @returns 执行结果
   */
  execute(args: TArgs, context: ExecutionContext): Promise<TResult>;

  /**
   * 验证参数（可选）
   * @param args 输入参数
   * @returns 是否有效
   */
  validate?(args: any): args is TArgs;
}

/**
 * JSON Schema 类型
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  [key: string]: any;
}

export interface JSONSchemaProperty {
  /** Omit for a polymorphic value (e.g. a cell value whose shape depends on field type) — valid JSON Schema, matches any type. */
  type?: string;
  description?: string;
  default?: any;
  enum?: any[];
  [key: string]: any;
}

/**
 * 工具注册表接口
 */
export interface ToolRegistry {
  /** 注册工具 */
  register(handler: ToolHandler): void;

  /** 获取工具 */
  get(name: string): ToolHandler | undefined;

  /** 获取所有工具 */
  getAll(): ToolHandler[];

  /** 检查工具是否存在 */
  has(name: string): boolean;
}

/**
 * MCP 工具定义（符合 MCP 协议）
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  annotations?: ToolAnnotations;
}

/**
 * MCP 工具执行结果
 */
export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}
