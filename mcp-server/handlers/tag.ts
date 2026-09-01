/**
 * 标签相关工具处理器
 */

import { BaseToolHandler } from './base.js';
import type { ExecutionContext, JSONSchema } from '../core/types.js';
import type { ReplaceTagResult } from '../../src/api/tag.js';

/**
 * 列出所有标签
 */
export class ListAllTagsHandler extends BaseToolHandler<
  { prefix?: string; depth?: number },
  Array<{ label: string; document_count: number }>
> {
  readonly name = 'list_all_tags';
  readonly annotations = { readOnlyHint: true } as const;
  readonly description =
    'List all tags used across your SiYuan notes with usage counts. Useful for discovering how you organize your knowledge. Supports filtering by prefix and limiting by hierarchy depth';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      prefix: {
        type: 'string',
        description:
          'Optional: Filter tags by prefix. Only tags starting with this prefix will be returned (e.g., "project" will match "project", "project/frontend", etc.)',
      },
      depth: {
        type: 'number',
        description:
          'Optional: Limit tag hierarchy depth (starts from 1). For example, depth=1 returns only top-level tags (e.g., "project"), depth=2 includes second level (e.g., "project/frontend"). Tags are split by "/" separator.',
      },
    },
  };

  async execute(args: any, context: ExecutionContext): Promise<Array<{ label: string; document_count: number }>> {
    return await context.siyuan.search.listAllTags(args.prefix, args.depth);
  }
}

/**
 * 替换标签
 */
export class ReplaceTagHandler extends BaseToolHandler<
  { old_tag: string; new_tag?: string },
  ReplaceTagResult
> {
  readonly name = 'batch_replace_tag';
  // 空串是"删除这个标签"。之前是把 new_tag 改成可选来绕开空串检查的，那是绕，不是修：
  // 同样的冲突在 set_icon 上就再没人绕（PF-54 第二轮）。现在两处走同一条规则。
  readonly allowEmpty = ['new_tag'];
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
  readonly description =
    'Rename or remove a tag across all notes in SiYuan. Omit new_tag (or pass an empty string) to remove the tag entirely. A tag that matches nothing is an error rather than a success, since a misspelled tag name would otherwise be indistinguishable from a completed rename. The counts come from the SQL index, which trails block writes by a second or two, so count is a FLOOR and not a total: a block tagged moments earlier can be renamed without being counted. verified: false means the counts did not settle, which is usually the index lagging rather than the rename failing — read the tags again before acting on it, and do not re-issue the call blindly.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      old_tag: {
        type: 'string',
        description: 'Old tag name to replace (without # symbol, e.g., "old-tag")',
      },
      new_tag: {
        type: 'string',
        description:
          'New tag name to replace with (without # symbol, e.g., "new-tag"). Omit it, or pass an empty string, to remove the tag.',
      },
    },
    required: ['old_tag'],
  };

  async execute(args: any, context: ExecutionContext): Promise<ReplaceTagResult> {
    const oldTag = args.old_tag;
    const newTag = args.new_tag || '';
    return await context.siyuan.tag.replaceTag(oldTag, newTag);
  }
}
