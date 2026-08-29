/**
 * 思源笔记搜索相关 API
 */

import type { SiyuanClient } from './client.js';
import type { Block, SearchOptions, SearchResultResponse, TagResponse } from '../types/index.js';
import { extractTitle, truncateContent } from '../utils/format.js';

export class SiyuanSearchApi {
  constructor(private client: SiyuanClient) {}

  /**
   * 根据文件名搜索文档
   * @param fileName 文件名关键词
   * @param options 搜索选项
   * @returns 搜索结果响应
   */
  async searchByFileName(fileName: string, options: SearchOptions = {}): Promise<SearchResultResponse[]> {
    const { limit = 10, notebook } = options;

    let stmt = `SELECT * FROM blocks WHERE type='d' AND content LIKE '%${this.escapeSql(fileName)}%'`;

    if (notebook) {
      stmt += ` AND box='${this.escapeSql(notebook)}'`;
    }

    stmt += ` LIMIT ${limit}`;

    const response = await this.client.request<Block[]>('/api/query/sql', { stmt });
    const blocks = response.data || [];
    return this.toSearchResultResponse(blocks);
  }

  /**
   * 根据文件内容搜索块
   * @param content 内容关键词
   * @param options 搜索选项
   * @returns 搜索结果响应
   */
  async searchByContent(content: string, options: SearchOptions = {}): Promise<SearchResultResponse[]> {
    const { limit = 10, notebook, types } = options;
    const keepNested = (options as any).keepNestedHits === true;
    const needle = this.escapeSql(content);

    // types:['d'] 配合内容搜索以前必然返回空：文档块的 content 只有标题，正文在子块上。
    // 空数组读起来像"没有匹配"，而这恰恰是最不该误判的场合，所以改成按内容搜全部块，
    // 再归并到各自所属的文档（PF-35）。
    const documentsOnly = !!types && types.length === 1 && types[0] === 'd';
    if (documentsOnly) {
      const scope = notebook ? ` AND box='${this.escapeSql(notebook)}'` : '';
      const hits = await this.client.request<Block[]>('/api/query/sql', {
        stmt: `SELECT DISTINCT root_id FROM blocks WHERE content LIKE '%${needle}%'${scope} LIMIT ${Math.max(limit * 8, 64)}`,
      });
      const rootIDs = [...new Set((hits.data || []).map((b: any) => b.root_id).filter(Boolean))].slice(0, limit);
      if (!rootIDs.length) return [];
      const docs = await this.client.request<Block[]>('/api/query/sql', {
        stmt: `SELECT * FROM blocks WHERE type='d' AND id IN (${rootIDs.map((id: string) => `'${this.escapeSql(id)}'`).join(',')}) LIMIT ${limit}`,
      });
      return this.toSearchResultResponse(docs.data || []);
    }

    let stmt = `SELECT * FROM blocks WHERE content LIKE '%${needle}%'`;

    if (notebook) {
      stmt += ` AND box='${this.escapeSql(notebook)}'`;
    }

    if (types && types.length > 0) {
      const typeConditions = types.map((t) => `'${this.escapeSql(t)}'`).join(',');
      stmt += ` AND type IN (${typeConditions})`;
    }

    // 折叠时多取一些，因为祖先块被丢掉后还要凑够 limit 条
    stmt += ` LIMIT ${keepNested ? limit : Math.max(limit * 4, 32)}`;

    const response = await this.client.request<Block[]>('/api/query/sql', { stmt });
    let blocks = response.data || [];
    if (!keepNested) blocks = this.dropAncestorHits(blocks).slice(0, limit);
    return this.toSearchResultResponse(blocks);
  }

  /**
   * 丢掉那些"只因为包含了后代文本才命中"的祖先块。
   *
   * 一处文本出现一次，列表块(l)、列表项(i) 和段落(p) 会各命中一次，因为祖先块的
   * content 含有后代的文本。后果有两个：条数虚高约三倍，据此估算规模必然错；更糟的是
   * 逐条改写命中项时，改 l 或 i 会连带重写它的全部子块，波及本来不该动的兄弟内容。
   * 真正该编辑的是最内层那个块，而响应里没有任何标记指出是哪个（PF-35）。
   */
  private dropAncestorHits(blocks: Block[]): Block[] {
    const byID = new Map((blocks as any[]).map((b) => [b.id, b]));
    const ancestors = new Set<string>();

    for (const block of blocks as any[]) {
      let parentID = block.parent_id;
      // 只沿着同样命中的祖先往上走：中间没命中的块不影响判断
      while (parentID && byID.has(parentID)) {
        ancestors.add(parentID);
        parentID = byID.get(parentID).parent_id;
      }
    }

    return (blocks as any[]).filter((b) => !ancestors.has(b.id));
  }

  /**
   * 使用 SQL 查询
   * @param sql SQL 语句
   * @returns 查询结果
   */
  async query(sql: string): Promise<Block[]> {
    const response = await this.client.request<Block[]>('/api/query/sql', { stmt: sql });
    return response.data || [];
  }


  /**
   * 将Block数组转换为搜索结果响应
   */
  private toSearchResultResponse(blocks: Block[]): SearchResultResponse[] {
    return blocks.map(block => ({
      id: block.id,
      name: block.name || extractTitle(block.content),
      path: block.hpath || block.path,
      content: truncateContent(block.content, 200), // 截取前200字符作为摘要
      type: block.type,
      updated: block.updated
    }));
  }

  /**
   * 列出所有标签
   * @param prefix 可选的标签前缀过滤
   * @param depth 可选的层级限制(从1开始计数,例如 depth=1 只返回顶层标签)
   * @returns 标签数组,包含标签名和使用次数
   */
  async listAllTags(prefix?: string, depth?: number): Promise<TagResponse[]> {
    // 使用思源官方的标签 API,传递 sort 参数
    // 注意:此 API 有 512 条的软限制(Conf.FileTree.MaxListCount)
    // 但对于大多数用户来说足够使用
    const response = await this.client.request<Array<{
      name: string;
      label: string;
      children?: any[];
      type: string;
      depth: number;
      count: number;
    }>>('/api/tag/getTag', { sort: 4 });

    const tags = response.data || [];

    // 递归提取所有标签的 label 和 count(包括子标签)
    const tagMap = new Map<string, number>();
    const extractTags = (tagList: any[]) => {
      for (const tag of tagList) {
        if (tag.label) {
          tagMap.set(tag.label, tag.count || 0);
        }
        // 递归处理子标签
        if (tag.children && tag.children.length > 0) {
          extractTags(tag.children);
        }
      }
    };
    extractTags(tags);

    // 转换为 TagResponse 数组
    let result: TagResponse[] = Array.from(tagMap.entries()).map(([label, count]) => ({
      label,
      document_count: count
    }));

    // 应用前缀过滤
    if (prefix) {
      result = result.filter(tag => tag.label.startsWith(prefix));
    }

    // 应用层级限制
    if (depth && depth > 0) {
      result = result.filter(tag => {
        // 计算标签的层级(通过分隔符 '/' 来判断)
        const level = tag.label.split('/').length;
        return level <= depth;
      });
    }

    // 按标签名排序
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * 根据标签查找相关文档
   * @param tag 标签名(不需要包含#符号)
   * @param limit 返回结果数量限制,默认 50
   * @returns 搜索结果响应
   */
  async searchByTag(tag: string, limit: number = 50): Promise<SearchResultResponse[]> {
    // 查询包含指定标签的块(文档类型)
    const cleanTag = tag.replace(/#/g, '').trim();
    const stmt = `SELECT * FROM blocks WHERE type='d' AND tag LIKE '%#${this.escapeSql(cleanTag)}#%' LIMIT ${limit}`;

    const response = await this.client.request<Block[]>('/api/query/sql', { stmt });
    const blocks = response.data || [];
    return this.toSearchResultResponse(blocks);
  }

  /**
   * 统一搜索接口:支持按内容、标签、文件名等多种条件搜索
   * @param options 搜索选项
   * @returns 搜索结果响应
   */
  async search(options: {
    content?: string;
    tag?: string;
    filename?: string;
    limit?: number;
    notebook?: string;
    types?: string[];
    keepNestedHits?: boolean;
  }): Promise<SearchResultResponse[]> {
    const { content, tag, filename, limit = 10, notebook, types } = options;

    // 构建SQL查询条件
    const conditions: string[] = [];

    // 如果指定了文件名,搜索文档类型
    if (filename) {
      conditions.push(`type='d'`);
      conditions.push(`content LIKE '%${this.escapeSql(filename)}%'`);
    }

    // 如果指定了内容,搜索内容
    if (content) {
      conditions.push(`content LIKE '%${this.escapeSql(content)}%'`);
    }

    // 如果指定了标签,搜索标签
    if (tag) {
      const cleanTag = tag.replace(/#/g, '').trim();
      conditions.push(`tag LIKE '%#${this.escapeSql(cleanTag)}#%'`);
    }

    // 如果指定了笔记本
    if (notebook) {
      conditions.push(`box='${this.escapeSql(notebook)}'`);
    }

    // 如果指定了类型
    if (types && types.length > 0) {
      const typeConditions = types.map((t) => `'${this.escapeSql(t)}'`).join(',');
      conditions.push(`type IN (${typeConditions})`);
    }

    // 如果没有任何条件,返回空数组
    if (conditions.length === 0) {
      return [];
    }

    const keepNested = (options as any).keepNestedHits === true;

    // 按内容搜且只要文档时，直接过滤 type='d' 必然落空：文档块的 content 只有标题，
    // 正文在子块上。空数组读起来像"没有匹配"，恰恰是最不该误判的场合。改成搜全部块
    // 再归并到所属文档（PF-35）。filename 走的是标题匹配，不受影响。
    const documentsOnly = !filename && !!content && !!types && types.length === 1 && types[0] === 'd';
    if (documentsOnly) {
      const scoped = conditions.filter((c) => !c.startsWith('type IN ('));
      const hits = await this.client.request<Block[]>('/api/query/sql', {
        stmt: `SELECT DISTINCT root_id FROM blocks WHERE ${scoped.join(' AND ')} LIMIT ${Math.max(limit * 8, 64)}`,
      });
      const rootIDs = [...new Set((hits.data || []).map((b: any) => b.root_id).filter(Boolean))].slice(0, limit);
      if (!rootIDs.length) return [];
      const docs = await this.client.request<Block[]>('/api/query/sql', {
        stmt: `SELECT * FROM blocks WHERE type='d' AND id IN (${rootIDs.map((id: string) => `'${this.escapeSql(id)}'`).join(',')}) LIMIT ${limit}`,
      });
      return this.toSearchResultResponse(docs.data || []);
    }

    // 折叠祖先命中时多取一些，丢掉之后还要凑够 limit 条
    const fetchLimit = keepNested || !content ? limit : Math.max(limit * 4, 32);
    const stmt = `SELECT * FROM blocks WHERE ${conditions.join(' AND ')} LIMIT ${fetchLimit}`;

    const response = await this.client.request<Block[]>('/api/query/sql', { stmt });
    let blocks = response.data || [];
    if (content && !keepNested) blocks = this.dropAncestorHits(blocks).slice(0, limit);
    return this.toSearchResultResponse(blocks);
  }

  /**
   * 转义 SQL 特殊字符
   */
  private escapeSql(str: string): string {
    return str.replace(/'/g, "''");
  }
}
