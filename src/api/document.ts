/**
 * 思源笔记文档操作相关 API
 */

import type { SiyuanClient } from './client.js';
import type { DocTreeNodeResponse } from '../types/index.js';
import { extractTitle } from '../utils/format.js';

export class SiyuanDocumentApi {
  constructor(private client: SiyuanClient) {}

  /**
   * 创建文档（使用 Markdown）
   * @param notebookId 笔记本 ID
   * @param path 文档路径（如 /folder/filename）
   * @param markdown Markdown 内容
   * @returns 新创建的文档 ID
   */
  async createDocument(notebookId: string, path: string, markdown: string): Promise<string> {
    const response = await this.client.request<string>('/api/filetree/createDocWithMd', {
      notebook: notebookId,
      path: path,
      markdown: markdown,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to create document: ${response.msg}`);
    }

    return response.data;
  }

  /**
   * 将已有文档另存为内容模板（写入 <workspace>/data/templates/<name>.md），
   * 用于 configure_new_item_templates 的 content_template_path。
   *
   * 返回的 path 是按内核的命名规则推算出来的（name + ".md"，超长文件名会被内核
   * 截断）；如果 content_template_path 传入这个值后仍报 "not found"，说明名字触发
   * 了截断或字符过滤，需要用更短、更简单的 name 重试。
   *
   * @param documentID 作为模板内容来源的文档 ID
   * @param name 模板名（不含扩展名）
   * @param overwrite 同名模板已存在时是否覆盖，默认 false
   */
  async saveAsTemplate(documentID: string, name: string, overwrite = false): Promise<{ path: string }> {
    const response = await this.client.request('/api/template/docSaveAsTemplate', {
      id: documentID,
      name,
      overwrite,
    });

    if (response.code === 1) {
      throw new Error(
        `A template named "${name}" already exists in data/templates/ and overwrite was not set. Pass overwrite: true to replace it, or pick a different name.`
      );
    }
    if (response.code !== 0) {
      throw new Error(`Failed to save document as template: ${response.msg}`);
    }

    return { path: `${name}.md` };
  }

  /**
   * 删除文档
   * @param notebookId 笔记本 ID
   * @param path 文档路径
   */
  async removeDocument(notebookId: string, path: string): Promise<void> {
    const response = await this.client.request('/api/filetree/removeDoc', {
      notebook: notebookId,
      path: path,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to remove document: ${response.msg}`);
    }
  }

  /**
   * 重命名文档
   * @param notebookId 笔记本 ID
   * @param path 文档路径
   * @param newName 新名称
   */
  async renameDocument(notebookId: string, path: string, newName: string): Promise<void> {
    const response = await this.client.request('/api/filetree/renameDoc', {
      notebook: notebookId,
      path: path,
      title: newName,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to rename document: ${response.msg}`);
    }
  }

  /**
   * 根据ID删除文档
   * @param id 文档 ID
   */
  async removeDocumentById(id: string): Promise<void> {
    const response = await this.client.request('/api/filetree/removeDocByID', { id });

    if (response.code !== 0) {
      throw new Error(`Failed to remove document: ${response.msg}`);
    }
  }

  /**
   * 根据ID重命名文档
   * @param id 文档 ID
   * @param title 新标题
   */
  async renameDocumentById(id: string, title: string): Promise<void> {
    const response = await this.client.request('/api/filetree/renameDocByID', { id, title });

    if (response.code !== 0) {
      throw new Error(`Failed to rename document: ${response.msg}`);
    }
  }

  /**
   * 设置文档树/笔记本手动排序
   * @param notebookSorts 笔记本排序项
   * @param docSorts 文档排序项
   */
  async setSort(
    notebookSorts: Array<{ id: string; sort: number }>,
    docSorts: Array<{ id: string; sort: number }>
  ): Promise<void> {
    const response = await this.client.request('/api/filetree/setSort', {
      notebookSorts,
      docSorts,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to set sort: ${response.msg}`);
    }
  }

  /**
   * 设置文档子文档的排序方式（笔记本根文档 ID 不被接受；笔记本级排序请使用 notebook.setNotebookConf 的 conf.sort）
   * @param id 常规文档 ID
   * @param sortMode 排序方式（0-14），传 null 取消显式设置，跟随最近的父文档/笔记本/全局默认排序规则
   */
  async setDocSortMode(id: string, sortMode: number | null): Promise<void> {
    const response = await this.client.request('/api/filetree/setDocSortMode', {
      id,
      sortMode,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to set doc sort mode: ${response.msg}`);
    }
  }

  /**
   * 根据ID移动文档到另一个文档下
   * @param fromIds 要移动的文档ID列表（可以是单个或多个）
   * @param toId 目标文档ID
   */
  async moveDocumentsByIds(fromIds: string | string[], toId: string): Promise<void> {
    const fromIdArray = Array.isArray(fromIds) ? fromIds : [fromIds];

    const response = await this.client.request('/api/filetree/moveDocsByID', {
      fromIDs: fromIdArray,
      toID: toId,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to move documents: ${response.msg}`);
    }
  }

  /**
   * 根据ID移动文档到笔记本根目录
   * @param fromIds 要移动的文档ID列表（可以是单个或多个）
   * @param toNotebookId 目标笔记本ID
   */
  async moveDocumentsToNotebookRoot(fromIds: string | string[], toNotebookId: string): Promise<void> {
    const fromIdArray = Array.isArray(fromIds) ? fromIds : [fromIds];

    // 首先获取所有文档的路径
    const fromPaths: string[] = [];
    for (const docId of fromIdArray) {
      const stmt = `SELECT hpath FROM blocks WHERE id = '${docId}' AND type = 'd'`;
      const response = await this.client.request<any[]>('/api/query/sql', { stmt });
      const blocks = response.data || [];
      if (blocks.length > 0) {
        fromPaths.push(blocks[0].hpath);
      }
    }

    if (fromPaths.length === 0) {
      throw new Error('No valid documents found to move');
    }

    // 使用 moveDocs API 移动到笔记本根目录
    const response = await this.client.request('/api/filetree/moveDocs', {
      fromPaths: fromPaths,
      toNotebook: toNotebookId,
      toPath: '/',  // "/" 表示笔记本根目录
    });

    if (response.code !== 0) {
      throw new Error(`Failed to move documents to notebook root: ${response.msg}`);
    }
  }

  /**
   * 根据路径获取文档 ID
   * @param notebookId 笔记本 ID
   * @param path 文档路径
   * @returns 文档 ID 列表
   */
  async getDocIdsByPath(notebookId: string, path: string): Promise<string[]> {
    const response = await this.client.request<string[]>('/api/filetree/getIDsByHPath', {
      notebook: notebookId,
      path: path,
    });

    return response.data || [];
  }

  /**
   * 获取人类可读的文档路径
   * @param blockId 块 ID
   * @returns 人类可读路径
   */
  async getHumanReadablePath(blockId: string): Promise<string> {
    const response = await this.client.request<{ hPath: string }>(
      '/api/filetree/getHPathByID',
      {
        id: blockId,
      }
    );

    return response.data.hPath;
  }

  /**
   * 获取文档树结构（带深度限制）
   *
   * 注意：文档间的父子关系并不体现在 blocks.parent_id 上（子文档是自己块树的根，
   * 其 parent_id 为空）——真正的层级关系编码在 path 中（如 "/父文档ID/子文档ID.sy"）。
   * 因此这里通过 path 前缀匹配重建树，而不是用 parent_id 做递归 SQL。
   *
   * @param id 文档ID或笔记本ID
   * @param maxDepth 最大深度（1表示只返回直接子节点，默认为1）
   * @returns 文档树响应节点数组
   */
  async getDocumentTree(id: string, maxDepth: number = 1): Promise<DocTreeNodeResponse[]> {
    const selfResponse = await this.client.request<any[]>('/api/query/sql', {
      stmt: `SELECT box, path FROM blocks WHERE id = '${id}' AND type = 'd'`,
    });
    const selfRow = (selfResponse.data || [])[0];

    // id 是文档：box 取该文档所在笔记本，锚点路径为该文档自身（去掉 .sy 后缀）
    // id 是笔记本：box 就是 id 本身，锚点路径为空（笔记本根目录）
    const box = selfRow ? selfRow.box : id;
    const anchorPath: string = selfRow ? String(selfRow.path).replace(/\.sy$/, '') : '';
    const prefix = `${anchorPath}/`;

    const allResponse = await this.client.request<any[]>('/api/query/sql', {
      stmt: `SELECT id, path, hpath, content FROM blocks WHERE type = 'd' AND box = '${box}'`,
    });

    if (allResponse.code !== 0) {
      throw new Error(`Failed to get document tree: ${allResponse.msg}`);
    }

    interface TreeEntry {
      node: DocTreeNodeResponse;
      parentId: string | null;
    }
    const entries = new Map<string, TreeEntry>();

    for (const row of allResponse.data || []) {
      const path: string = row.path;
      if (!path.startsWith(prefix)) continue;

      const relative = path.slice(prefix.length).replace(/\.sy$/, '');
      const segments = relative.split('/');
      const depth = segments.length;
      if (depth > maxDepth) continue;

      entries.set(row.id, {
        node: {
          id: row.id as string,
          name: extractTitle(row.content || ''),
          path: row.hpath as string,
          children: [],
        },
        parentId: depth === 1 ? null : segments[segments.length - 2],
      });
    }

    const roots: DocTreeNodeResponse[] = [];
    for (const entry of entries.values()) {
      const parent = entry.parentId ? entries.get(entry.parentId) : undefined;
      if (parent) {
        parent.node.children!.push(entry.node);
      } else {
        roots.push(entry.node);
      }
    }
    return roots;
  }
}
