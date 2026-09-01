/**
 * 思源笔记标签相关 API
 * 用于管理文档标签
 */

import type { SiyuanClient } from './client.js';
import { readBackUntil } from '../utils/readback.js';

export interface ReplaceTagResult {
  /** 改动前索引里带旧标签的块数。来自 SQL 索引，见 counted_via */
  count: number;
  /** 改动前带旧标签的块 ID（最多 200 个，够核对，不至于把响应撑爆） */
  updatedIds: string[];
  /** 改完之后索引里仍然带旧标签的块数 */
  remaining: number;
  /** 改完之后索引里带新标签的块数；删除标签时为 0 */
  nowCarryingNewTag: number;
  /** 计数的来源，恒为 sql-index——提醒读数的人这数字有滞后 */
  counted_via: 'sql-index';
  /** count 是否可信：只有改完之后新旧两边对得上才为 true */
  verified: boolean;
  /** verified 为 false 时说明为什么 */
  note?: string;
}

export class SiyuanTagApi {
  constructor(private client: SiyuanClient) {}

  /**
   * 批量替换标签
   *
   * 两版之前只回一个恒为 true 的布尔：改了 800 个块和一个都没匹配上，返回值一模一样，
   * 而拼错标签名恰恰是最容易犯的错。
   *
   * 上一版改成了写前写后各数一遍，但两次都数的是 SQL 索引——索引落后块写入 1–2 秒，
   * 于是刚打上标签的块根本不在里面。实测两个相隔约 2 秒打标签的块，返回
   * { count: 1, remaining: 0 }：两个都改成功了，第一个数漏了，而 remaining 用同一个
   * 滞后的源头给这次漏数盖了章（PF-54 第二轮）。
   *
   * 索引是这里唯一能按标签枚举块的途径，换不掉。能做的是别拿它当见证：数字照给，但
   * 明说它来自索引，并且只有"新标签这边的数 ≥ 旧标签这边少掉的数"时才敢说 verified。
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

    // 一次读不到就多读几次：块刚打上标签时索引里还没有它，直接判"没有这个标签"会把
    // 一次合法的改名挡下来。
    const before = await readBackUntil(
      () => this.blocksWithTag(cleanOldTag),
      (ids) => ids.length > 0,
      { attempts: 4 }
    );
    const beforeIds = before.observed ?? [];

    if (!beforeIds.length) {
      throw new Error(
        `No block carries the tag "#${cleanOldTag}#" — checked repeatedly over about a second, in case the tag had only just been written. ` +
          `A misspelled tag name used to be indistinguishable from a successful rename here. Check the spelling with list_all_tags. Nothing was changed.`
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

    // 旧标签这边等它清零；清不了零就照实报，不改口。
    const after = await readBackUntil(
      () => this.blocksWithTag(cleanOldTag),
      (ids) => ids.length === 0
    );
    const remaining = (after.observed ?? []).length;

    let nowCarryingNewTag = 0;
    if (cleanNewTag) {
      const renamed = await readBackUntil(
        () => this.blocksWithTag(cleanNewTag),
        (ids) => ids.length >= beforeIds.length
      );
      nowCarryingNewTag = (renamed.observed ?? []).length;
    }

    // verified 的门槛：旧标签清空了，并且（改名时）新标签这边至少接住了同样多的块。
    // 两边都从索引读，所以这只是"索引自洽"，不是"内核确认"——note 里把这句说清楚。
    const consistent = remaining === 0 && (!cleanNewTag || nowCarryingNewTag >= beforeIds.length);

    return {
      count: beforeIds.length,
      updatedIds: beforeIds.slice(0, 200),
      remaining,
      nowCarryingNewTag,
      counted_via: 'sql-index',
      verified: consistent,
      note: consistent
        ? `Counts come from the SQL index, which trails block writes by a second or two. A block tagged moments before this call can be missing from count without being missing from the rename — treat count as a floor, not a total.`
        : `Counts come from the SQL index and did not settle: ${remaining} block(s) still read as carrying "#${cleanOldTag}#"` +
          (cleanNewTag ? `, and ${nowCarryingNewTag} read as carrying "#${cleanNewTag}#" against ${beforeIds.length} seen before the write` : '') +
          `. This is more often the index lagging than the rename failing, so do not re-issue it blindly — read the tags again in a moment, and only act if the numbers still disagree.`,
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
