/**
 * 文档相关工具处理器
 */

import { BaseToolHandler } from './base.js';
import type { ExecutionContext, JSONSchema } from '../core/types.js';
import type { DocTreeNodeResponse } from '../../src/types/index.js';

/**
 * 获取文档内容
 */
export class GetDocumentContentHandler extends BaseToolHandler<{ document_id: string; offset?: number; limit?: number }, string> {
  readonly name = 'get_document_content';
  readonly description = 'Read the markdown content of a note in SiYuan. Returns the full note content in markdown format, with optional pagination support';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'The note document ID (block ID)',
      },
      offset: {
        type: 'number',
        description: 'Starting line number (0-based index). Default is 0 (start from beginning)',
        default: 0,
      },
      limit: {
        type: 'number',
        description: 'Number of lines to return. If not specified, returns all lines from offset to end',
      },
    },
    required: ['document_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<string> {
    // 获取完整内容用于计算总行数
    const fullContent = await context.siyuan.getFileContent(args.document_id);
    const lines = fullContent.split('\n');
    const totalLines = lines.length;

    // 如果没有指定 offset 和 limit，返回完整内容（带元信息）
    if (args.offset === undefined && args.limit === undefined) {
      const metaInfo = `--- Document Info ---\nTotal Lines: ${totalLines}\n--- End Info ---\n\n`;
      return metaInfo + fullContent;
    }

    // 进行分页处理
    const offset = args.offset ?? 0;
    const startLine = offset;

    // 如果起始行超出范围，返回元信息说明
    if (startLine >= totalLines) {
      return `--- Document Info ---\nTotal Lines: ${totalLines}\nRequested Range: ${startLine}-${startLine + (args.limit || 0)}\nStatus: Out of range\n--- End Info ---\n`;
    }

    // 计算结束行
    const endLine = args.limit !== undefined ? startLine + args.limit : totalLines;
    const actualEndLine = Math.min(endLine, totalLines);

    // 构建元信息
    const metaInfo = `--- Document Info ---\nTotal Lines: ${totalLines}\nCurrent Range: ${startLine}-${actualEndLine - 1} (showing ${actualEndLine - startLine} lines)\n--- End Info ---\n\n`;

    // 截取指定范围的行
    const selectedContent = lines.slice(startLine, actualEndLine).join('\n');
    return metaInfo + selectedContent;
  }
}

/**
 * 创建文档
 */
export class CreateDocumentHandler extends BaseToolHandler<
  { notebook_id: string; path: string; content: string },
  string
> {
  readonly name = 'create_document';
  readonly description = 'Create a new note document in a SiYuan notebook with markdown content';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      notebook_id: {
        type: 'string',
        description: 'The target notebook ID where the note will be created',
      },
      path: {
        type: 'string',
        description: 'Note path within the notebook (e.g., /folder/note-title). The final segment becomes the note title. Pass raw text, not HTML-escaped — e.g. "&", not "&amp;". SiYuan does not decode entities, so an escaped ampersand ends up literally in the title. Em dashes, ®, and emoji all pass through correctly unescaped.',
      },
      content: {
        type: 'string',
        description: 'Markdown content for the new note',
      },
    },
    required: ['notebook_id', 'path', 'content'],
  };

  async execute(args: any, context: ExecutionContext): Promise<string> {
    return await context.siyuan.createFile(args.notebook_id, args.path, args.content);
  }
}

/**
 * 追加到文档
 */
export class AppendToDocumentHandler extends BaseToolHandler<
  { document_id: string; content: string },
  string
> {
  readonly name = 'append_to_document';
  readonly description = 'Append markdown content to the end of an existing note in SiYuan';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'The target note document ID',
      },
      content: {
        type: 'string',
        description: 'Markdown content to append to the note',
      },
    },
    required: ['document_id', 'content'],
  };

  async execute(args: any, context: ExecutionContext): Promise<string> {
    return await context.siyuan.appendToFile(args.document_id, args.content);
  }
}

/**
 * 更新文档
 */
export class UpdateDocumentHandler extends BaseToolHandler<
  { document_id: string; content: string },
  { success: boolean; document_id: string }
> {
  readonly name = 'update_document';
  readonly description = 'Replace the entire content of a note in SiYuan with new markdown content (overwrites existing content)';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'The note document ID to update',
      },
      content: {
        type: 'string',
        description: 'New markdown content that will replace the existing note content',
      },
    },
    required: ['document_id', 'content'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; document_id: string }> {
    await context.siyuan.overwriteFile(args.document_id, args.content);
    return { success: true, document_id: args.document_id };
  }
}

/**
 * 追加到今日笔记
 */
export class AppendToDailyNoteHandler extends BaseToolHandler<
  { notebook_id: string; content: string },
  string
> {
  readonly name = 'append_to_daily_note';
  readonly description = "Append markdown content to today's daily note in SiYuan (automatically creates the daily note if it doesn't exist)";
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      notebook_id: {
        type: 'string',
        description: 'The notebook ID where the daily note resides',
      },
      content: {
        type: 'string',
        description: 'Markdown content to append to today\'s daily note',
      },
    },
    required: ['notebook_id', 'content'],
  };

  async execute(args: any, context: ExecutionContext): Promise<string> {
    return await context.siyuan.appendToDailyNote(args.notebook_id, args.content);
  }
}

/**
 * 移动文档（通过ID）
 */
export class MoveDocumentsHandler extends BaseToolHandler<
  { from_ids: string | string[]; to_parent_id?: string; to_notebook_root?: string },
  { success: boolean; moved_count: number; from_ids: string[]; to_parent_id?: string; to_notebook_root?: string }
> {
  readonly name = 'move_documents';
  readonly description = 'Move one or more notes to a new location in SiYuan. Provide EXACTLY ONE destination: either to_parent_id (to nest notes under a parent note) OR to_notebook_root (to move notes to notebook top level).';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      from_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of note document IDs to move. For a single note, use an array with one element: ["note-id"]',
      },
      to_parent_id: {
        type: 'string',
        description: 'OPTION 1: Parent note document ID. Notes will be nested under this parent note as children. Cannot be used together with to_notebook_root.',
      },
      to_notebook_root: {
        type: 'string',
        description: 'OPTION 2: Notebook ID. Notes will be moved to the top level of this notebook. Cannot be used together with to_parent_id.',
      },
    },
    required: ['from_ids'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; moved_count: number; from_ids: string[]; to_parent_id?: string; to_notebook_root?: string }> {
    // 处理 from_ids，支持单个ID或数组
    let fromIds: string[];

    if (Array.isArray(args.from_ids)) {
      fromIds = args.from_ids;
    } else if (typeof args.from_ids === 'string') {
      // 如果是JSON数组字符串，解析它
      if (args.from_ids.startsWith('[')) {
        try {
          fromIds = JSON.parse(args.from_ids);
        } catch {
          fromIds = [args.from_ids];
        }
      } else {
        fromIds = [args.from_ids];
      }
    } else {
      throw new Error('from_ids must be a string or array of strings');
    }

    // 验证参数：必须提供其中一个，且只能提供一个
    const hasParentId = !!args.to_parent_id;
    const hasNotebookRoot = !!args.to_notebook_root;

    if (!hasParentId && !hasNotebookRoot) {
      throw new Error('Must provide exactly one of: to_parent_id (for nested placement) or to_notebook_root (for root placement)');
    }

    if (hasParentId && hasNotebookRoot) {
      throw new Error('Cannot provide both to_parent_id and to_notebook_root - choose only one target location');
    }

    // 情况1: 移动到父文档下（嵌套）
    if (hasParentId) {
      await context.siyuan.document.moveDocumentsByIds(fromIds, args.to_parent_id);
    }
    // 情况2: 移动到笔记本根目录（顶级）
    else {
      await context.siyuan.document.moveDocumentsToNotebookRoot(fromIds, args.to_notebook_root);
    }

    return {
      success: true,
      moved_count: fromIds.length,
      from_ids: fromIds,
      to_parent_id: args.to_parent_id,
      to_notebook_root: args.to_notebook_root
    };
  }
}

/**
 * 获取文档树
 */
export class GetDocumentTreeHandler extends BaseToolHandler<
  { id: string; depth?: number },
  DocTreeNodeResponse[]
> {
  readonly name = 'get_document_tree';
  readonly description = 'Get the hierarchical structure of notes in SiYuan with specified depth. Returns the note tree starting from a notebook or parent note. Relies on the SQL index, which lags block writes by roughly 1-2 seconds — a just-created document may not appear yet.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Starting point: note document ID or notebook ID',
      },
      depth: {
        type: 'number',
        description: 'How deep to traverse the note hierarchy (1 = direct children only, 2 = children and grandchildren, etc.). Default is 1.',
        default: 1,
      },
    },
    required: ['id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<DocTreeNodeResponse[]> {
    const depth = args.depth || 1;
    return await context.siyuan.document.getDocumentTree(args.id, depth);
  }
}

const SORT_MODE_DESCRIPTION =
  'Sort mode, integer 0-14: 0=name asc, 1=name desc, 2=updated asc, 3=updated desc, 4=natural-number asc, ' +
  '5=natural-number desc, 6=custom (manual order via set_sort), 7=ref-count asc, 8=ref-count desc, ' +
  '9=created asc, 10=created desc, 11=size asc, 12=size desc, 13=sub-doc-count asc, 14=sub-doc-count desc. ' +
  'Pass null to clear the explicit setting and inherit from the nearest parent document, notebook, or global default.';

/**
 * 根据ID删除文档
 */
export class RemoveDocumentHandler extends BaseToolHandler<
  { document_id: string },
  { success: boolean; document_id: string }
> {
  readonly name = 'remove_document';
  readonly description = 'Permanently delete a note document in SiYuan by ID, including all its child documents and blocks.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'The note document ID to delete',
      },
    },
    required: ['document_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; document_id: string }> {
    await context.siyuan.document.removeDocumentById(args.document_id);
    return { success: true, document_id: args.document_id };
  }
}

/**
 * 根据ID重命名文档
 */
export class RenameDocumentHandler extends BaseToolHandler<
  { document_id: string; title: string },
  { success: boolean; document_id: string; title: string }
> {
  readonly name = 'rename_document';
  readonly description = 'Rename a note document in SiYuan by ID.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'The note document ID to rename',
      },
      title: {
        type: 'string',
        description: 'The new title',
      },
    },
    required: ['document_id', 'title'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; document_id: string; title: string }> {
    await context.siyuan.document.renameDocumentById(args.document_id, args.title);
    return { success: true, document_id: args.document_id, title: args.title };
  }
}

/**
 * 设置笔记本或文档的排序方式
 */
export class SetDocSortModeHandler extends BaseToolHandler<
  { id: string; sort_mode: number | null },
  { success: boolean; id: string }
> {
  readonly name = 'set_document_sort_mode';
  readonly description = `Set how a document's children are sorted in the SiYuan outliner. Document ID only — for notebook-level sort mode, use the notebook config tools instead. ${SORT_MODE_DESCRIPTION} To manually reorder items, first set sort_mode to 6 (custom), then call set_sort.`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The document ID whose children sort order is being set. Must be a regular document, not a notebook root document ID.',
      },
      sort_mode: {
        type: 'number',
        description: `${SORT_MODE_DESCRIPTION} Pass JSON null (not omitted) to unset.`,
      },
    },
    required: ['id', 'sort_mode'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; id: string }> {
    await context.siyuan.document.setDocSortMode(args.id, args.sort_mode);
    return { success: true, id: args.id };
  }
}

/**
 * 设置文档树/笔记本手动排序
 */
export class SetSortHandler extends BaseToolHandler<
  {
    notebook_sorts?: Array<{ id: string; sort: number }>;
    doc_sorts?: Array<{ id: string; sort: number }>;
  },
  { success: boolean }
> {
  readonly name = 'set_sort';
  readonly description = 'Set the manual sort order of notebooks and/or documents in SiYuan by assigning each ID a sort number (lower sorts first; array order does not matter). Only takes visible effect on items whose sort_mode is 6 (custom) — set that first with set_document_sort_mode if needed. doc_sorts entries must belong to an opened, unlocked notebook; notebook root document IDs are not accepted. At least one of notebook_sorts or doc_sorts must be non-empty.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      notebook_sorts: {
        type: 'array',
        description: 'Notebook sort assignments',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Notebook ID' },
            sort: { type: 'number', description: 'Sort order number, lower sorts first' },
          },
          required: ['id', 'sort'],
        },
      },
      doc_sorts: {
        type: 'array',
        description: 'Document sort assignments',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Document ID' },
            sort: { type: 'number', description: 'Sort order number, lower sorts first' },
          },
          required: ['id', 'sort'],
        },
      },
    },
    required: [],
  };

  validate(args: any): args is {
    notebook_sorts?: Array<{ id: string; sort: number }>;
    doc_sorts?: Array<{ id: string; sort: number }>;
  } {
    const notebookSorts = args.notebook_sorts || [];
    const docSorts = args.doc_sorts || [];
    if (notebookSorts.length === 0 && docSorts.length === 0) {
      throw new Error('Must provide at least one non-empty array of: notebook_sorts, doc_sorts');
    }
    return true;
  }

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.document.setSort(args.notebook_sorts || [], args.doc_sorts || []);
    return { success: true };
  }
}
