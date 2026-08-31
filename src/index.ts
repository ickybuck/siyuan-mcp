/**
 * 思源笔记工具库
 * SiYuan Tools - A TypeScript library for SiYuan Note API operations
 *
 * @packageDocumentation
 */

import { SiyuanClient } from './api/client.js';
import { SiyuanSearchApi } from './api/search.js';
import { SiyuanBlockApi } from './api/block.js';
import { SiyuanDocumentApi } from './api/document.js';
import { SiyuanNotebookApi } from './api/notebook.js';
import { SiyuanSnapshotApi } from './api/snapshot.js';
import { SiyuanTagApi } from './api/tag.js';
import { SiyuanAvApi } from './api/av.js';
import { SiyuanIconApi } from './api/icon.js';
import { DailyNoteUtils } from './utils/daily-note.js';
import { SiyuanHelpers } from './utils/helpers.js';

import type { SiyuanConfig } from './types/index.js';

/**
 * 思源笔记工具类
 * 整合了所有 API 操作的主类
 */
export class SiyuanTools {
  private client: SiyuanClient;

  /** 搜索相关 API */
  public readonly search: SiyuanSearchApi;

  /** 块操作相关 API */
  public readonly block: SiyuanBlockApi;

  /** 文档操作相关 API */
  public readonly document: SiyuanDocumentApi;

  /** 笔记本操作相关 API */
  public readonly notebook: SiyuanNotebookApi;

  /** 快照操作相关 API */
  public readonly snapshot: SiyuanSnapshotApi;

  /** 标签操作相关 API */
  public readonly tag: SiyuanTagApi;

  /** 数据库（属性视图）操作相关 API */
  public readonly av: SiyuanAvApi;

  /** 图标设置（文档 / 数据库视图 / 笔记本） */
  public readonly icon: SiyuanIconApi;

  /** 今日笔记工具 */
  public readonly dailyNote: DailyNoteUtils;

  /** 辅助工具方法（提供增强功能，但按需使用以避免上下文过载） */
  public readonly helpers: SiyuanHelpers;

  constructor(config: SiyuanConfig) {
    this.client = new SiyuanClient(config);

    // 初始化各个 API 模块
    this.search = new SiyuanSearchApi(this.client);
    this.block = new SiyuanBlockApi(this.client);
    this.document = new SiyuanDocumentApi(this.client);
    this.notebook = new SiyuanNotebookApi(this.client);
    this.snapshot = new SiyuanSnapshotApi(this.client);
    this.tag = new SiyuanTagApi(this.client);
    this.av = new SiyuanAvApi(this.client);
    this.icon = new SiyuanIconApi(this.client);
    this.dailyNote = new DailyNoteUtils(
      this.client,
      this.document,
      this.notebook,
      this.block
    );
    this.helpers = new SiyuanHelpers(this.client);
  }

  /**
   * 更新配置
   * @param config 新的配置（部分）
   */
  updateConfig(config: Partial<SiyuanConfig>): void {
    this.client.updateConfig(config);
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<SiyuanConfig> {
    return this.client.getConfig();
  }

  // ============ 便捷方法：常用操作的快捷方式 ============

  /**
   * 根据文件名搜索文件
   * @param fileName 文件名关键词
   * @param limit 返回结果数量限制，默认 10
   */
  async searchByFileName(fileName: string, limit?: number) {
    return this.search.searchByFileName(fileName, { limit });
  }

  /**
   * 根据文件内容搜索文件
   * @param content 内容关键词
   * @param limit 返回结果数量限制，默认 10
   */
  async searchByContent(content: string, limit?: number) {
    return this.search.searchByContent(content, { limit });
  }

  /**
   * 查看文件内容
   * @param blockId 块 ID（文档 ID）
   * @returns Markdown 内容
   */
  async getFileContent(blockId: string): Promise<string> {
    return this.block.getBlockMarkdown(blockId);
  }

  /**
   * 将内容全覆盖到文件
   * @param blockId 块 ID
   * @param content Markdown 内容
   */
  async overwriteFile(blockId: string, content: string): Promise<void> {
    await this.replaceDocumentContent(blockId, content);
  }

  /**
   * 用新内容整体替换一个文档的正文。
   *
   * 以前这里就是 block.updateBlock(docID, content) 一行——update_document 从来没有
   * 自己的实现。而 updateBlock 只写一个块：多块 Markdown 会被内核只留第一块、其余丢弃，
   * 还报成功。也就是说这个工具一直在悄悄截断整篇文档，直到 PF-31 给 updateBlock 加上
   * 拦截，才以"被拒绝"的形式暴露出来（PF-51）。拦截本身是对的，错的是它落在了这里。
   *
   * 顺序是先写后删，不是先删后写：写失败时原文还在，最坏是文档里多出一份新内容，看得见
   * 也好收拾；反过来删完再写失败，原文就没了。每一步都读回确认。
   */
  async replaceDocumentContent(
    documentID: string,
    content: string
  ): Promise<{ blocksWritten: number; blocksRemoved: number }> {
    if (!content.trim()) {
      throw new Error(
        'Refusing to replace a document with empty content — that is a deletion, not an update. Use remove_document if that is what you mean.'
      );
    }

    const before = await this.block.getChildBlocks(documentID);
    if (!Array.isArray(before)) {
      throw new Error(
        `Could not read the current blocks of ${documentID}, so its content was left alone. Check that this is a document ID.`
      );
    }
    const oldIDs = before.map((b: any) => b.id);

    await this.block.appendBlock(documentID, content);

    const afterAppend = await this.block.getChildBlocks(documentID);
    const newIDs = (afterAppend || [])
      .map((b: any) => b.id)
      .filter((id: string) => !oldIDs.includes(id));
    if (!newIDs.length) {
      throw new Error(
        `Nothing was written to ${documentID} and the original content is untouched. The append reported success but no new block appeared.`
      );
    }

    let blocksRemoved = 0;
    for (const id of oldIDs) {
      await this.block.deleteBlock(id);
      blocksRemoved++;
    }

    // 删除同样是排队执行的，紧接着读回可能还看得见旧块。轮询几次再下结论，否则会把
    // "还没落盘"误报成"删不掉"，而这条错误信息是要求人去手动清理的，误报代价不小。
    let leftovers: string[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 300 : 500));
      const final = await this.block.getChildBlocks(documentID);
      leftovers = (final || []).map((b: any) => b.id).filter((id: string) => oldIDs.includes(id));
      if (!leftovers.length) break;
    }
    if (leftovers.length) {
      throw new Error(
        `The new content was written to ${documentID} but ${leftovers.length} of the original block(s) could not be removed, so the document now holds both. Remove them with delete_block: ${leftovers.join(', ')}.`
      );
    }

    return { blocksWritten: newIDs.length, blocksRemoved };
  }

  /**
   * 将内容追加到文件
   * @param blockId 块 ID（父块）
   * @param content Markdown 内容
   * @returns 新创建的块 ID
   */
  async appendToFile(blockId: string, content: string): Promise<string> {
    return this.block.appendBlock(blockId, content);
  }

  /**
   * 将内容创建为新的文档
   * @param notebookId 笔记本 ID
   * @param path 文档路径（如 /folder/filename）
   * @param content Markdown 内容
   * @returns 新创建的文档 ID
   */
  async createFile(
    notebookId: string,
    path: string,
    content: string,
    options: { createParents?: boolean } = {}
  ): Promise<string> {
    return this.document.createDocument(notebookId, path, content, options);
  }

  /**
   * 将内容追加到今日笔记
   * @param notebookId 笔记本 ID
   * @param content Markdown 内容
   * @returns 新创建的块 ID
   */
  async appendToDailyNote(notebookId: string, content: string): Promise<string> {
    return this.dailyNote.appendToDailyNote(notebookId, content);
  }

  /**
   * 列出所有笔记本
   */
  async listNotebooks() {
    return this.notebook.listNotebooks();
  }
}

/**
 * 创建 SiyuanTools 实例的工厂函数
 * @param baseUrl 思源笔记服务地址，默认 http://127.0.0.1:6806
 * @param token API Token
 * @returns SiyuanTools 实例
 */
export function createSiyuanTools(baseUrl = 'http://127.0.0.1:6806', token: string): SiyuanTools {
  return new SiyuanTools({ baseUrl, token });
}

// 导出所有类型
export * from './types/index.js';
export * from './types/enhanced.js';

// 导出各个 API 类（供高级用户使用）
export { SiyuanClient } from './api/client.js';
export { SiyuanSearchApi } from './api/search.js';
export { SiyuanBlockApi } from './api/block.js';
export { SiyuanDocumentApi } from './api/document.js';
export { SiyuanNotebookApi } from './api/notebook.js';
export { SiyuanSnapshotApi } from './api/snapshot.js';
export { SiyuanTagApi } from './api/tag.js';
export { SiyuanAvApi, normalizeValue, deriveItemId, ITEM_ID_KEY } from './api/av.js';
export { DailyNoteUtils } from './utils/daily-note.js';
export { SiyuanHelpers } from './utils/helpers.js';
