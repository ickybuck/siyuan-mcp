/**
 * 搜索相关工具处理器
 */

import { BaseToolHandler } from './base.js';
import type { ExecutionContext, JSONSchema } from '../core/types.js';
import type { SearchResultResponse } from '../../src/types/index.js';

/**
 * 统一搜索工具：支持内容、标签、文件名等多种条件
 */
export class UnifiedSearchHandler extends BaseToolHandler<
  {
    content?: string;
    tag?: string;
    filename?: string;
    limit?: number;
    notebook_id?: string;
    types?: string[];
  },
  SearchResultResponse[]
> {
  readonly name = 'unified_search';
  readonly annotations = { readOnlyHint: true } as const;
  readonly description =
    'Search notes in SiYuan by content keywords, tags, note titles, or combined filters. Two behaviours worth knowing, both handled here rather than left to trip you up. A single occurrence of a phrase matches its paragraph AND every ancestor block containing it — list item, list, and so on — because an ancestor carries its descendants text; those ancestors are dropped so counts are not inflated roughly threefold and so editing each hit cannot rewrite the same content twice. Pass keep_nested_hits to see the raw ancestor blocks. And a content search restricted to types:["d"] used to return nothing at all, since a document block content is only its title: it now searches every block and returns the documents those hits belong to, which is what asking for documents means.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Optional: Content keyword to search for',
      },
      tag: {
        type: 'string',
        description: 'Optional: Tag to filter by (without # symbol, e.g., "项目")',
      },
      filename: {
        type: 'string',
        description: 'Optional: Note title keyword to search for',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 10)',
        default: 10,
      },
      notebook_id: {
        type: 'string',
        description: 'Optional: Limit to specific notebook ID',
      },
      keep_nested_hits: {
        type: 'boolean',
        description: 'Return ancestor blocks that matched only because they contain a descendant match. Off by default; on, result counts overstate real occurrences and editing every hit can rewrite the same text more than once.',
      },
      types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: Block types to search (e.g., ["d"] for documents)',
      },
    },
  };

  async execute(args: any, context: ExecutionContext): Promise<SearchResultResponse[]> {
    return await context.siyuan.search.search({
      content: args.content,
      tag: args.tag,
      filename: args.filename,
      limit: args.limit || 10,
      notebook: args.notebook_id,
      types: args.types,
      keepNestedHits: args.keep_nested_hits,
    });
  }
}
