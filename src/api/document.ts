/**
 * 思源笔记文档操作相关 API
 */

import type { SiyuanClient } from './client.js';
import type { DocTreeNodeResponse } from '../types/index.js';
import { extractTitle } from '../utils/format.js';
import { readBackUntil, unverifiedNote } from '../utils/readback.js';
import { rejectHtmlEntities } from '../utils/entities.js';

export class SiyuanDocumentApi {
  constructor(private client: SiyuanClient) {}

  /**
   * 创建文档（使用 Markdown）
   * @param notebookId 笔记本 ID
   * @param path 文档路径（如 /folder/filename）
   * @param markdown Markdown 内容
   * @returns 新创建的文档 ID
   */
  async createDocument(
    notebookId: string,
    path: string,
    markdown: string,
    options: { createParents?: boolean } = {}
  ): Promise<string> {
    // 路径里出现 HTML 实体几乎一定是调用方那侧转义过了。&amp; 与 & 是两个不同的名字，
    // 于是路径匹配不上任何既有文档——而下面那条内核行为会把匹配不上变成"凭空造一棵树"。
    // 一次这样的调用造出过三个空壳文档，真正的正文在影子树里躺了一天（PF-48）。
    rejectHtmlEntities(path, 'path', 'Nothing was created.');

    // 父路径不存在时，内核会把缺失的每一层都悄悄建出来，然后报成功。一个编码差异就能
    // 长出一整棵看起来像模像样的影子目录。默认改为报错，要自动建父级得显式开口。
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 1 && !options.createParents) {
      const parentPath = '/' + segments.slice(0, -1).join('/');
      const existing = await this.getDocIdsByPath(notebookId, parentPath);
      if (!existing.length) {
        throw new Error(
          `The parent path "${parentPath}" does not exist in this notebook, and creating the missing levels silently is exactly how a shadow hierarchy appears — one encoding difference and the real tree gains a plausible-looking duplicate. Nothing was created. ` +
            `Create the parents deliberately, or pass create_parents to have them made here. Addressing by parent document ID rather than by path avoids this class of problem entirely, since an ID cannot half-match.`
        );
      }
    }

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
   * 建文档并读回它真正落在哪里。
   *
   * 只回一个 ID 时，调用方无从分辨"建在了要的位置"和"建在了内核顺手造出来的影子树里"——
   * 两种情况的返回值一模一样。把 box 和 hpath 读回来一并返回，位置不对当场就看得见（PF-48）。
   */
  async createDocumentVerified(
    notebookId: string,
    path: string,
    markdown: string,
    options: { createParents?: boolean } = {}
  ): Promise<{ document_id: string; notebook_id: string; path: string; title: string }> {
    const id = await this.createDocument(notebookId, path, markdown, options);

    const attrs = await this.client.request<Record<string, string>>('/api/attr/getBlockAttrs', { id });
    return {
      document_id: id,
      notebook_id: attrs.data?.box || notebookId,
      // hpath 是标题串成的人类可读路径，正是要核对的那个；读不到就退回请求里的值。
      path: attrs.data?.['custom-hpath'] || attrs.data?.hpath || path,
      title: attrs.data?.title ?? '',
    };
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
  async renameDocumentById(
    id: string,
    title: string
  ): Promise<{ verified: boolean; observed?: string; note?: string }> {
    // create_document 拦 HTML 实体，rename_document 一点不拦，于是同一个坑隔着一次
    // 调用照样能踩，还会把 &amp; 原样存成标题（PF-60）。两处现在走同一个检查。
    rejectHtmlEntities(title, 'title', 'Nothing was renamed.');

    const response = await this.client.request('/api/filetree/renameDocByID', { id, title });

    if (response.code !== 0) {
      throw new Error(`Failed to rename document: ${response.msg}`);
    }

    const wanted = title.trim();

    // 改名是立刻生效的，但读回来的每一条路都可能慢一拍：blocks.content 里的旧标题能留
    // 好几分钟，块属性也不是每次都同步更新。第一版在这里直接抛错，结果每一次首次改名
    // 都报"失败"并引用旧标题，而改名其实已经成功——写完立刻误报失败比原来的静默成功
    // 更危险，调用方会去重试或回滚一件已经做完的事（PF-49）。
    //
    // 所以：轮询，读到就算确认；读不到只说没确认，不说失败。
    // 读 kramdown，不读块属性：文档块的 IAL 里带着 title=，改名后立刻就是新值，而
    // /api/attr/getBlockAttrs 和 blocks.content 都会慢一拍——实测新建文档首次改名后，
    // 属性接口连读 2 秒仍是旧标题，kramdown 当场就对了。属性作为兜底再读一次。
    const outcome = await readBackUntil(
      async () => {
        const kramdown = await this.client.request<{ kramdown: string }>('/api/block/getBlockKramdown', { id });
        const matched = /\btitle="([^"]*)"/.exec(kramdown.data?.kramdown ?? '');
        if (matched) return matched[1];

        const attrs = await this.client.request<Record<string, string>>('/api/attr/getBlockAttrs', { id });
        return attrs.data?.title ?? '';
      },
      (stored) => stored === wanted
    );

    if (outcome.verified) return { verified: true, observed: wanted };

    return {
      verified: false,
      observed: outcome.observed,
      note: unverifiedNote(`the title of ${id}`, outcome.observed),
    };
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

    // moveDocs 要的是 .sy 文件路径（blocks.path，形如 /20260821193048-xxxxxxx.sy），
    // 不是标题拼出来的 hpath。之前取的是 hpath，内核解析不到对应文件，于是回一句
    // "block not found"——听起来像文档不存在，其实文档好好的，是路径给错了类型（PF-59）。
    const fromPaths: string[] = [];
    const missing: string[] = [];
    for (const docId of fromIdArray) {
      const stmt = `SELECT path FROM blocks WHERE id = '${docId.replace(/'/g, "''")}' AND type = 'd' LIMIT 1`;
      const response = await this.client.request<any[]>('/api/query/sql', { stmt });
      const path = (response.data || [])[0]?.path;
      if (path) {
        fromPaths.push(path);
      } else {
        missing.push(docId);
      }
    }

    if (missing.length) {
      throw new Error(
        `No document found for ${missing.map((id) => `"${id}"`).join(', ')}. Nothing was moved. ` +
          `Note the SQL index trails writes by a second or two, so a document created moments ago may not be findable yet.`
      );
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

    // id 不是文档时，这里原本直接把它当笔记本 ID 用；传错 ID（例如把数据库的
    // av_id 当成文档 ID）就会查到一个不存在的 box，返回空数组，看起来像"这个文档
    // 没有子文档"。空结果和"ID 不对"必须分得开，否则又是一次静默误报。
    if (!selfRow) {
      const notebooks = await this.client.request<{ notebooks?: Array<{ id: string }> }>(
        '/api/notebook/lsNotebooks'
      );
      const isNotebook = (notebooks.data?.notebooks || []).some((n) => n.id === id);
      if (!isNotebook) {
        throw new Error(
          `"${id}" is neither a document nor a notebook, so it has no document tree. An empty result would be indistinguishable from a document with no children, so this fails instead. Note that a database's av_id is not a document ID — use the ID of the document the database is embedded in.`
        );
      }
    }

    // id 是文档：box 取该文档所在笔记本，锚点路径为该文档自身（去掉 .sy 后缀）
    // id 是笔记本：box 就是 id 本身，锚点路径为空（笔记本根目录）
    const box = selfRow ? selfRow.box : id;
    const anchorPath: string = selfRow ? String(selfRow.path).replace(/\.sy$/, '') : '';
    const prefix = `${anchorPath}/`;

    // 两处都要紧，缺一个就会静默少报（PF-33）：
    // 1. 前缀过滤放进 SQL。原先是把整个笔记本的文档都取回来再在内存里筛，
    //    结果内核的行数上限先砍在"整个笔记本"那一层，跟这次要找的子树无关。
    // 2. 显式分页。/api/query/sql 对没有 LIMIT 的语句套用 Conf.Search.Limit
    //    （默认 64）且不作任何提示，所以"没写 LIMIT"不等于"不限行数"，而是
    //    "限 64 行且不告诉你"。实测：某笔记本 181 篇文档，无 LIMIT 返回 64。
    const escapedPrefix = prefix.replace(/'/g, "''");
    const pageSize = 512;
    const rows: any[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const pageResponse = await this.client.request<any[]>('/api/query/sql', {
        stmt:
          `SELECT id, path, hpath, content FROM blocks WHERE type = 'd' AND box = '${box}' ` +
          `AND path LIKE '${escapedPrefix}%' ORDER BY path LIMIT ${pageSize} OFFSET ${offset}`,
      });

      if (pageResponse.code !== 0) {
        throw new Error(`Failed to get document tree: ${pageResponse.msg}`);
      }

      const page = pageResponse.data || [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }

    const allResponse = { code: 0, msg: '', data: rows };

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
