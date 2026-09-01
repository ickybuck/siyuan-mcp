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
  readonly annotations = { readOnlyHint: true } as const;
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
  { notebook_id: string; path: string; content: string; create_parents?: boolean },
  { document_id: string; notebook_id: string; path: string; title: string }
> {
  readonly name = 'create_document';
  // 空 content 是"建一个空文档"，是个正当用法：占位文档、等着往里填的骨架。
  // 之前被必填非空检查一刀切拦下，只能塞个占位字符绕过去（Chat 在 PF-60 之外顺手记的一条）。
  readonly allowEmpty = ['content'];
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Create a new note document in a SiYuan notebook with markdown content. The parent path must already exist — a missing parent is an error, not an invitation to invent one, because SiYuan would create every missing level silently and leave the real content in a shadow tree. Pass create_parents to make them deliberately. Prefer addressing by parent document ID over a path string where a tool offers it: a path is the whole failure surface, since one encoding difference matches nothing, while an ID cannot half-match.';
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
      create_parents: {
        type: 'boolean',
        description: 'Create the missing levels of the path instead of failing. Off by default: silent parent creation is how a shadow hierarchy appears. Pass true only when you mean to add those levels.',
      },
    },
    required: ['notebook_id', 'path', 'content'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ document_id: string; notebook_id: string; path: string; title: string }> {
    // 返回读回来的落点，而不只是一个 ID：ID 本身分不出"建对了地方"和"建进了影子树"。
    return await context.siyuan.document.createDocumentVerified(args.notebook_id, args.path, args.content, {
      createParents: args.create_parents,
    });
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
  readonly description = 'Replace the entire content of a note in SiYuan with new markdown content. Multi-block markdown is what this tool is for — headings, paragraphs, lists and tables all land. It writes the new content first and only then removes the old blocks, so a failure leaves the original in place rather than an empty document, and it reads back at each step. Use update_block instead to change one block inside a large note without resending the rest.';
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

  async execute(
    args: any,
    context: ExecutionContext
  ): Promise<{ success: boolean; document_id: string; blocks_written: number; blocks_removed: number }> {
    const r = await context.siyuan.replaceDocumentContent(args.document_id, args.content);
    return {
      success: true,
      document_id: args.document_id,
      blocks_written: r.blocksWritten,
      blocks_removed: r.blocksRemoved,
    };
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  readonly annotations = { readOnlyHint: true } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
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
 * 将文档另存为内容模板
 */
export class SaveDocumentAsTemplateHandler extends BaseToolHandler<
  { document_id: string; name: string; overwrite?: boolean },
  { path: string }
> {
  readonly name = 'save_document_as_template';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Save an existing document as a reusable content template, written to data/templates/<name>.md in the workspace. This is what content_template_path on configure_new_item_templates points at — write a document with the structure a new database row\'s body should start from, then save it as a template here, then reference the returned path when configuring a "document"-target row-creation template.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'The document whose content becomes the template' },
      name: { type: 'string', description: 'Template name, without a file extension' },
      overwrite: { type: 'boolean', description: 'Replace an existing template of the same name. Defaults to false, which errors instead of silently overwriting.' },
    },
    required: ['document_id', 'name'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ path: string }> {
    return await context.siyuan.document.saveAsTemplate(args.document_id, args.name, args.overwrite ?? false);
  }
}

/**
 * 根据ID重命名文档
 */
export class RenameDocumentHandler extends BaseToolHandler<
  { document_id: string; title: string },
  { success: boolean; document_id: string; title: string; verified: boolean; note?: string }
> {
  readonly name = 'rename_document';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description =
    'Rename a note document in SiYuan by ID. The rename itself either succeeds or errors; the separate "verified" flag says whether the new title could be read back within about two seconds. verified: false means the read lagged, not that the rename failed — do not retry or roll back on it, just read again in a moment. Searching by the old filename can keep finding the document for minutes afterwards, which is the SQL index trailing and not the rename.';
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

  async execute(
    args: any,
    context: ExecutionContext
  ): Promise<{ success: boolean; document_id: string; title: string; verified: boolean; note?: string }> {
    const outcome = await context.siyuan.document.renameDocumentById(args.document_id, args.title);
    return {
      success: true,
      document_id: args.document_id,
      title: args.title,
      verified: outcome.verified,
      ...(outcome.note ? { note: outcome.note } : {}),
    };
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
    // 先跑基类那套：覆写它会连"参数名写错了"的检查一起丢掉，于是拼错的参数名换来的是
    // 这里这句笼统的"至少给一个"，看不出真正的毛病在名字上（PF-54 第二轮）。
    super.validate(args);

    const notebookSorts = args.notebook_sorts || [];
    const docSorts = args.doc_sorts || [];
    if (notebookSorts.length === 0 && docSorts.length === 0) {
      throw new Error(
        `${this.name}: provide at least one non-empty array of: notebook_sorts, doc_sorts. ` +
          `Accepted arguments: ${Object.keys(this.inputSchema.properties ?? {}).join(', ')}.`
      );
    }
    return true;
  }

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.document.setSort(args.notebook_sorts || [], args.doc_sorts || []);
    return { success: true };
  }
}
