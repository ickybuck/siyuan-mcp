/**
 * 思源笔记标签相关 API
 * 用于管理文档标签
 */

import type { SiyuanClient } from './client.js';

export interface ReplaceTagResult {
  /** 改动前带该标签的块数 */
  count: number;
  /** 改动前带该标签的块 ID（最多 200 个，够核对，不至于把响应撑爆） */
  updatedIds: string[];
  /** 改完之后仍然带旧标签的块数，正常为 0 */
  remaining: number;
}

export class SiyuanTagApi {
  constructor(private client: SiyuanClient) {}

  /**
   * 批量替换标签
   *
   * 以前只回一个恒为 true 的布尔：改了 800 个块和一个都没匹配上，返回值一模一样，
   * 而拼错标签名恰恰是最容易犯的错。改成动手前先数一遍、动完再数一遍（PF-54）。
   *
   * @param oldTag 旧标签名(不需要包含#符号)
   * @param newTag 新标签名(不需要包含#符号,空字符串表示删除标签)
   */
  async replaceTag(oldTag: string, newTag: string): Promise<ReplaceTagResult> {
    // 清理标签名
    const cleanOldTag = oldTag.replace(/#/g, '').trim();
    const cleanNewTag = newTag.replace(/#/g, '').trim();

    if (!cleanOldTag) {
      throw new Error('old_tag cannot be empty.');
    }

    const before = await this.blocksWithTag(cleanOldTag);
    if (!before.length) {
      throw new Error(
        `No block carries the tag "#${cleanOldTag}#", so nothing would change. A misspelled tag name used to be indistinguishable from a successful rename here. Check the spelling with list_all_tags. Nothing was changed.`
      );
    }

    // 如果新标签为空,使用官方删除API
    if (!cleanNewTag) {
      await this.client.request<any>('/api/tag/removeTag', {
        label: cleanOldTag,
      });
    } else {
      // 如果新标签不为空,使用官方重命名API
      await this.client.request<any>('/api/tag/renameTag', {
        oldLabel: cleanOldTag,
        newLabel: cleanNewTag,
      });
    }

    // 索引落后于写入，读回来之前给它一点时间；仍有残留就照实报，不猜。
    await new Promise((resolve) => setTimeout(resolve, 800));
    const after = await this.blocksWithTag(cleanOldTag);

    return {
      count: before.length,
      updatedIds: before.slice(0, 200),
      remaining: after.length,
    };
  }

  /**
   * 查出带某个标签的块 ID。
   */
  private async blocksWithTag(cleanTag: string): Promise<string[]> {
    const escaped = cleanTag.replace(/'/g, "''");
    const response = await this.client.request<Array<{ id: string }>>('/api/query/sql', {
      // 显式给 LIMIT：不给的话内核会悄悄套上 Conf.Search.Limit（默认 64），
      // 于是"改了多少个"永远最多报 64。
      stmt: `SELECT id FROM blocks WHERE tag LIKE '%#${escaped}#%' LIMIT 10000`,
    });
    return (response.data || []).map((block) => block.id).filter(Boolean);
  }

  /**
   * 删除指定标签(从所有文档中移除)
   * @param tag 标签名(不需要包含#符号)
   */
  async removeTag(tag: string): Promise<ReplaceTagResult> {
    return this.replaceTag(tag, '');
  }
}
