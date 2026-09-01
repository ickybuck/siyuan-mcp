/**
 * 文档历史相关工具处理器
 *
 * 三个工具刻意分成三步：列版本、读版本、回滚。中间那步不能省——不读就回滚，
 * 等于拿一个没看过的版本盖掉当前内容。
 */

import { BaseToolHandler } from './base.js';
import type { ExecutionContext, JSONSchema } from '../core/types.js';
import type { DocumentHistoryEntry } from '../../src/api/history.js';

/**
 * 列出一个文档的历史版本
 */
export class ListDocumentHistoryHandler extends BaseToolHandler<
  { document_id: string; limit?: number; max_timestamps?: number },
  { entries: DocumentHistoryEntry[]; scanned: number; exhaustive: boolean }
> {
  readonly name = 'list_document_history';
  readonly annotations = { readOnlyHint: true, destructiveHint: false } as const;
  readonly description =
    'List the retained history versions of ONE document, newest first — the per-document alternative to a workspace snapshot, so recovering one clobbered note does not roll anything else back. Each entry carries a history_path, which is what get_document_history_content and rollback_document take. op says what produced the version (update, delete, format, clean). SiYuan prunes history on its retention setting, so this covers recent loss, not last month\'s; anything older needs a snapshot. exhaustive: false means the scan hit its cap and older versions may exist — raise max_timestamps to look further back.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'The document to list versions for' },
      limit: { type: 'number', description: 'Maximum versions to return. Default 20.' },
      max_timestamps: {
        type: 'number',
        description:
          'How many history points to scan before giving up. Default 40. Each one is a request, so raise it deliberately when looking further back.',
      },
    },
    required: ['document_id'],
  };

  async execute(
    args: any,
    context: ExecutionContext
  ): Promise<{ entries: DocumentHistoryEntry[]; scanned: number; exhaustive: boolean }> {
    return await context.siyuan.history.listDocumentHistory(args.document_id, {
      limit: args.limit,
      maxTimestamps: args.max_timestamps,
    });
  }
}

/**
 * 读某个历史版本的内容
 */
export class GetDocumentHistoryContentHandler extends BaseToolHandler<
  { history_path: string; format?: 'text' | 'html' },
  { format: string; content: string }
> {
  readonly name = 'get_document_history_content';
  readonly annotations = { readOnlyHint: true, destructiveHint: false } as const;
  readonly description =
    'Read what one history version of a document actually contains, without changing anything. Take history_path from list_document_history. Read the version BEFORE rolling back to it: rollback overwrites the current content, and this is how you confirm the version holds what you think it does rather than restoring blind. Returns plain text by default; pass format "html" for the editor DOM when you need an exact comparison.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      history_path: { type: 'string', description: 'From list_document_history entries[].history_path' },
      format: {
        type: 'string',
        enum: ['text', 'html'],
        description: 'text (default) strips the editor markup; html returns it verbatim.',
      },
    },
    required: ['history_path'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ format: string; content: string }> {
    return await context.siyuan.history.getHistoryContent(args.history_path, args.format || 'text');
  }
}

/**
 * 把文档回滚到某个历史版本
 */
export class RollbackDocumentHandler extends BaseToolHandler<
  { document_id: string; history_path: string; notebook_id: string },
  {
    success: boolean;
    document_id: string;
    history_path: string;
    previous_content: string;
    verified: boolean;
    note?: string;
  }
> {
  readonly name = 'rollback_document';
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
  readonly description =
    'Restore ONE document to a history version, leaving the rest of the workspace untouched — unlike rollback_to_snapshot, which reverts everything. THIS OVERWRITES THE CURRENT CONTENT. Read the version first with get_document_history_content, and take a snapshot with create_snapshot if the current content matters and you are not certain: history is pruned on a retention timer and is not a substitute for one. The response returns previous_content, the document exactly as it stood immediately before the rollback — that is the only copy of it this tool guarantees, so keep it until you have confirmed the right version was restored. verified says whether the change could be read back; verified: false means the read lagged or the restored version was identical, not that the rollback failed.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'The document to restore' },
      history_path: { type: 'string', description: 'From list_document_history entries[].history_path' },
      notebook_id: {
        type: 'string',
        description: 'The notebook the document belongs to — list_document_history returns it as entries[].notebook',
      },
    },
    required: ['document_id', 'history_path', 'notebook_id'],
  };

  async execute(
    args: any,
    context: ExecutionContext
  ): Promise<{
    success: boolean;
    document_id: string;
    history_path: string;
    previous_content: string;
    verified: boolean;
    note?: string;
  }> {
    return await context.siyuan.history.rollbackDocument(args.document_id, args.history_path, args.notebook_id);
  }
}
