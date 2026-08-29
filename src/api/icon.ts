/**
 * 图标设置相关 API
 *
 * 三种目标、三套机制，看起来是一个功能（PF-42）：
 *  - 文档：图标是块属性，走 /api/attr/setBlockAttrs 的 icon 属性，传 null 表示清除。
 *  - 数据库：AttributeView 结构里没有图标字段，图标属于 View，所以"数据库的图标"其实是
 *    某个视图的图标，由事务动作 setAttrViewViewIcon 设置。
 *  - 笔记本：自己的端点 /api/notebook/setNotebookIcon。
 *
 * 值的格式是小写十六进制码点、以连字符相连，不是 emoji 字符本身：📖 是 1f4d6，
 * ✍️ 是 270d-fe0f，👨‍👩‍👧 是 1f468-200d-1f469-200d-1f467。这一点最容易踩：内核的
 * util.FilterIconValue 只接受码点串、带点的文件名或图标 URL，其余一律置空且不报错
 * ——一个裸 emoji 恰好属于"其余"，于是看起来写成功了，实际存进去的是空字符串。
 */

import type { SiyuanClient } from './client.js';

/** emoji 字符转成内核使用的码点串；已经是码点串的原样返回 */
export function emojiToCodepoints(icon: string): string {
  const trimmed = icon.trim();
  if (!trimmed) return '';
  // 已经是码点串（或文件名/URL）时不要再转一次
  if (/^[0-9a-f]{2,6}(-[0-9a-f]{2,6})*$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.includes('/') || trimmed.includes('.')) return trimmed;
  return [...trimmed].map((c) => c.codePointAt(0)!.toString(16)).join('-');
}

export class SiyuanIconApi {
  constructor(private client: SiyuanClient) {}

  /** 文档图标：块属性 icon，传空串清除 */
  async setDocumentIcon(documentID: string, icon: string): Promise<{ icon: string }> {
    const value = emojiToCodepoints(icon);
    const response = await this.client.request('/api/attr/setBlockAttrs', {
      id: documentID,
      attrs: { icon: value === '' ? null : value },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to set the document icon: ${response.msg}`);
    }

    const after = await this.client.request<Record<string, string>>('/api/attr/getBlockAttrs', {
      id: documentID,
    });
    const stored = after.data?.icon ?? '';
    if (stored !== value) {
      throw new Error(
        `SiYuan reported success but the icon stored on ${documentID} is ${JSON.stringify(stored)}, not ${JSON.stringify(value)}. ` +
          `Icons are hex codepoints such as "1f4d6", not the emoji character; a value the kernel rejects is blanked without an error.`
      );
    }

    return { icon: stored };
  }

  /** 笔记本图标 */
  async setNotebookIcon(notebookID: string, icon: string): Promise<{ icon: string }> {
    const value = emojiToCodepoints(icon);
    const response = await this.client.request('/api/notebook/setNotebookIcon', {
      notebook: notebookID,
      icon: value,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to set the notebook icon: ${response.msg}`);
    }

    const after = await this.client.request<{ notebooks?: Array<{ id: string; icon: string }> }>(
      '/api/notebook/lsNotebooks',
      {}
    );
    const stored = (after.data?.notebooks || []).find((n) => n.id === notebookID)?.icon ?? '';
    if (stored !== value) {
      throw new Error(
        `SiYuan reported success but the icon on notebook ${notebookID} is ${JSON.stringify(stored)}, not ${JSON.stringify(value)}.`
      );
    }

    return { icon: stored };
  }
}
