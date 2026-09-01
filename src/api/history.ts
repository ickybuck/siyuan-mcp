/**
 * 思源笔记文档历史相关 API
 *
 * 存在的理由：快照（/api/repo/*）是整个工作区的，回滚一个被写坏的文档就得把别的东西
 * 一起退回去。内核自己按保留期给每个文档留了历史版本，粒度正好是"一个文档"。
 *
 * 三件事分开做，顺序是有意的：先列出有哪些版本，再读某个版本的内容，最后才回滚。
 * 中间那步不是多余的——不读就回滚，等于拿一个没看过的版本覆盖当前内容，而这类操作
 * 在本项目里已经吃过亏。
 */

import type { SiyuanClient } from './client.js';
import { readBackUntil } from '../utils/readback.js';

export interface DocumentHistoryEntry {
  /** 版本时间戳（内核用的秒级字符串） */
  created: string;
  /** 人类可读时间 */
  created_at: string;
  /** 回滚和读取内容都要用这个路径 */
  history_path: string;
  /** 这条历史是什么操作留下的：update / delete / format / clean / sync 等 */
  op: string;
  /** 当时的文档标题——改过名的话，这里是当时的名字 */
  title: string;
  notebook: string;
}

export class SiyuanHistoryApi {
  constructor(private client: SiyuanClient) {}

  /**
   * 列出某个文档的历史版本。
   *
   * 内核没有"按文档 ID 查历史"的接口：searchHistory 按关键词给出有匹配的时间点，
   * getHistoryItems 再按时间点给出当时涉及的文档。所以这里先拿标题去缩小时间点，
   * 再按 ID 精确过滤——标题只用来省调用次数，认不认这条历史始终以 ID 为准。
   *
   * 改过名的文档，用当前标题搜不到早期版本，所以标题搜不到东西时退回按时间倒序扫。
   */
  async listDocumentHistory(
    documentID: string,
    options: { title?: string; limit?: number; maxTimestamps?: number } = {}
  ): Promise<{ entries: DocumentHistoryEntry[]; scanned: number; exhaustive: boolean }> {
    const limit = options.limit ?? 20;
    const maxTimestamps = options.maxTimestamps ?? 40;

    const title = options.title ?? (await this.currentTitle(documentID));

    let timestamps = title ? await this.historyTimestamps(title, maxTimestamps) : [];
    let query = title;

    // 标题搜不到（多半是改过名），退回不带关键词的全量时间点，按时间倒序扫前若干个
    if (!timestamps.length) {
      timestamps = await this.historyTimestamps('', maxTimestamps);
      query = '';
    }

    const entries: DocumentHistoryEntry[] = [];
    let scanned = 0;

    for (const created of timestamps) {
      if (entries.length >= limit) break;
      scanned++;

      const response = await this.client.request<{ items: any[] }>('/api/history/getHistoryItems', {
        created,
        query,
        op: 'all',
        type: 0,
      });

      for (const item of response.data?.items || []) {
        if (item?.id !== documentID) continue;
        entries.push({
          created,
          created_at: new Date(Number(created) * 1000).toISOString(),
          history_path: item.path,
          op: item.op || '',
          title: item.title || '',
          notebook: item.notebook || '',
        });
      }
    }

    return {
      entries,
      scanned,
      // 扫完了所有时间点才算把话说全，否则更早的版本可能还在，只是没扫到
      exhaustive: scanned < maxTimestamps,
    };
  }

  /**
   * 读某个历史版本的内容。
   *
   * 内核回的是编辑器 DOM，读起来很吵。默认剥成纯文本，够回答"我丢的东西在不在里面"；
   * 要原样对比再要 html。
   */
  async getHistoryContent(
    historyPath: string,
    format: 'text' | 'html' = 'text'
  ): Promise<{ format: string; content: string }> {
    const response = await this.client.request<{ content: string }>('/api/history/getDocHistoryContent', {
      historyPath,
      k: '',
    });

    if (response.code !== 0) {
      throw new Error(
        `Failed to read history version: ${response.msg}. History paths are timestamped and pruned on the retention setting, so one that worked earlier can simply be gone — list the versions again.`
      );
    }

    const html = response.data?.content ?? '';
    return { format, content: format === 'html' ? html : stripBlockDom(html) };
  }

  /**
   * 把文档回滚到某个历史版本。
   *
   * 回滚会覆盖当前内容。调用方拿到的 previous_content 是当前内容在被覆盖前的最后一份
   * 拷贝——回滚回错了版本时，它就是把东西找回来的唯一凭据，别丢。
   */
  async rollbackDocument(
    documentID: string,
    historyPath: string,
    notebook: string
  ): Promise<{
    success: boolean;
    document_id: string;
    history_path: string;
    previous_content: string;
    verified: boolean;
    note?: string;
  }> {
    // 先把当前内容抓下来。抓不到就不动手：没有退路的覆盖不做。
    const before = await this.client.request<{ kramdown: string }>('/api/block/getBlockKramdown', {
      id: documentID,
    });
    const previousContent = before.data?.kramdown ?? '';
    if (!previousContent) {
      throw new Error(
        `Could not read the current content of ${documentID} before rolling it back. Refusing to overwrite content that has not been captured — check the document ID exists.`
      );
    }

    const response = await this.client.request('/api/history/rollbackDocHistory', {
      notebook,
      historyPath,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to roll back ${documentID}: ${response.msg}. Nothing was changed.`);
    }

    // 回滚落地要一会儿；读回来确认内容确实变了。变没变以内容为准，不看返回码。
    const outcome = await readBackUntil(
      async () => {
        const now = await this.client.request<{ kramdown: string }>('/api/block/getBlockKramdown', {
          id: documentID,
        });
        return now.data?.kramdown ?? '';
      },
      (now) => now !== previousContent
    );

    return {
      success: true,
      document_id: documentID,
      history_path: historyPath,
      previous_content: previousContent,
      verified: outcome.verified,
      note: outcome.verified
        ? 'previous_content is the document as it stood immediately before this rollback. It is not stored anywhere else — keep it if there is any chance the wrong version was restored.'
        : 'The rollback was accepted but the document still reads the same as before it. Either the restored version is identical to what was there, or the write has not surfaced yet. previous_content holds what was there before; read the document again before acting.',
    };
  }

  /** 取文档当前标题，用于缩小历史搜索范围 */
  private async currentTitle(documentID: string): Promise<string> {
    try {
      const kramdown = await this.client.request<{ kramdown: string }>('/api/block/getBlockKramdown', {
        id: documentID,
      });
      const matched = /\btitle="([^"]*)"/.exec(kramdown.data?.kramdown ?? '');
      if (matched) return matched[1];
    } catch {
      // 读不到标题不是错误，退回全量扫描
    }
    return '';
  }

  /** 按关键词取历史时间点，最多取 max 个（内核每页 32 个） */
  private async historyTimestamps(query: string, max: number): Promise<string[]> {
    const timestamps: string[] = [];

    for (let page = 1; timestamps.length < max; page++) {
      const response = await this.client.request<{ histories: string[]; pageCount: number }>(
        '/api/history/searchHistory',
        { query, page, op: 'all', type: 0 }
      );
      const histories = response.data?.histories || [];
      if (!histories.length) break;

      timestamps.push(...histories);
      if (page >= (response.data?.pageCount ?? 1)) break;
    }

    return timestamps.slice(0, max);
  }
}

/**
 * 把编辑器 DOM 剥成纯文本，块与块之间留空行。
 *
 * 不追求还原成 markdown——这段文本是用来看"内容还在不在"的，不是用来回写的。
 */
function stripBlockDom(html: string): string {
  return html
    .replace(/<div[^>]*class="protyle-attr"[^>]*>[\s\S]*?<\/div>/g, '')
    .replace(/<\/div>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/​/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
