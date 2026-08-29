/**
 * 数据库视图与图标相关工具处理器
 */

import { BaseToolHandler } from './base.js';
import type { ExecutionContext, JSONSchema } from '../core/types.js';

/**
 * 新建数据库视图
 */
export class CreateDatabaseViewHandler extends BaseToolHandler<
  { av_id: string; block_id: string; name?: string; layout?: 'table' | 'gallery' | 'kanban' },
  { view_id: string; name?: string }
> {
  readonly name = 'create_database_view';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description =
    'Add a view to a SiYuan database — a second way of looking at the same rows, with its own filters, sorts, grouping, layout and column visibility. Until now a filtered view had to be built by hand in the SiYuan interface. Requires an embedded database, since SiYuan resolves the block when creating a view, and the database must already have at least one view. Note what a view does NOT change: hiding a column here does not reduce what render_database returns — cell values come from the data layer and the hidden flag is presentation only. Use render_database\'s fields parameter to read less.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block embedding this database, from embed_database' },
      name: { type: 'string', description: 'Name for the new view. Omit to accept SiYuan\'s default.' },
      layout: { type: 'string', enum: ['table', 'gallery', 'kanban'], description: 'Layout for the new view. Defaults to table.' },
    },
    required: ['av_id', 'block_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ view_id: string; name?: string }> {
    const { viewID } = await context.siyuan.av.addAttributeViewView(args.av_id, args.block_id, {
      name: args.name,
      layout: args.layout,
    });
    return { view_id: viewID, ...(args.name ? { name: args.name } : {}) };
  }
}

/**
 * 显示/隐藏视图中的某一列
 */
export class SetDatabaseFieldVisibilityHandler extends BaseToolHandler<
  { av_id: string; key_id: string; hidden: boolean; view_id?: string; block_id?: string },
  { success: boolean; key_id: string; hidden: boolean }
> {
  readonly name = 'set_database_field_visibility';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description =
    'Show or hide one field in one view of a SiYuan database. Presentation only: a hidden column is still returned in full by render_database, because cell values come from the data layer and the hidden flag never reaches them — use render_database\'s fields parameter if the goal is a smaller response rather than a tidier table. Give view_id to target a specific view, or block_id to use whichever view that block currently shows.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      key_id: { type: 'string', description: 'Field (column) ID to show or hide' },
      hidden: { type: 'boolean', description: 'true hides the column, false shows it' },
      view_id: { type: 'string', description: 'View to change. Omit to resolve the view from block_id.' },
      block_id: { type: 'string', description: 'Database block whose current view should be changed. Needed when view_id is omitted.' },
    },
    required: ['av_id', 'key_id', 'hidden'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; key_id: string; hidden: boolean }> {
    await context.siyuan.av.setAttributeViewColumnHidden(args.av_id, args.key_id, args.hidden, {
      viewID: args.view_id,
      blockID: args.block_id,
    });
    return { success: true, key_id: args.key_id, hidden: args.hidden };
  }
}

/**
 * 切换数据库块当前显示的视图
 */
export class SetDatabaseBlockViewHandler extends BaseToolHandler<
  { av_id: string; block_id: string; view_id: string },
  { success: boolean; view_id: string }
> {
  readonly name = 'set_database_block_view';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description =
    'Choose which view a database block displays. This is also the only way to configure a view that is not the active one: SiYuan resolves the target view from the block for filters, sorts, grouping and layout — none of those endpoints take a view id at all — so configuring a second view means switching the block to it, applying the change, and switching back if needed.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block to point at a different view' },
      view_id: { type: 'string', description: 'View to display, from create_database_view or get_database' },
    },
    required: ['av_id', 'block_id', 'view_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; view_id: string }> {
    await context.siyuan.av.setDatabaseBlockView(args.block_id, args.av_id, args.view_id);
    return { success: true, view_id: args.view_id };
  }
}

/**
 * 统一的图标设置工具
 */
export class SetIconHandler extends BaseToolHandler<
  { target_type: 'document' | 'database' | 'notebook'; id: string; icon: string; view_id?: string },
  { success: boolean; icon: string; target_type: string }
> {
  readonly name = 'set_icon';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description =
    'Set the icon on a document, a database, or a notebook — one tool for all three, though SiYuan stores each differently. Pass the emoji itself ("📖") or SiYuan\'s own form, which is lowercase hex codepoints joined by hyphens ("1f4d6"); the conversion is handled here, and it matters because the kernel silently blanks a value it does not recognise, and a bare emoji character is one of those. An empty icon clears it. Note that a database has no icon of its own: the icon belongs to a view, so this sets it on the view named by view_id, or on the database\'s first view.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      target_type: { type: 'string', enum: ['document', 'database', 'notebook'], description: 'What the id refers to' },
      id: { type: 'string', description: 'Document ID, database (av) ID, or notebook ID, matching target_type' },
      icon: { type: 'string', description: 'The emoji, e.g. "📖", or hex codepoints, e.g. "1f4d6". Empty string clears the icon.' },
      view_id: { type: 'string', description: 'Databases only: which view to set the icon on. Omit for the first view.' },
    },
    required: ['target_type', 'id', 'icon'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; icon: string; target_type: string }> {
    const { emojiToCodepoints } = await import('../../src/api/icon.js');

    if (args.target_type === 'document') {
      const r = await context.siyuan.icon.setDocumentIcon(args.id, args.icon);
      return { success: true, icon: r.icon, target_type: 'document' };
    }

    if (args.target_type === 'notebook') {
      const r = await context.siyuan.icon.setNotebookIcon(args.id, args.icon);
      return { success: true, icon: r.icon, target_type: 'notebook' };
    }

    const value = emojiToCodepoints(args.icon);
    let viewID = args.view_id;
    if (!viewID) {
      const av = await context.siyuan.av.getAttributeView(args.id);
      viewID = (av.views || [])[0]?.id;
      if (!viewID) {
        throw new Error(`Database ${args.id} has no views, so there is nothing to put an icon on.`);
      }
    }
    await context.siyuan.av.setAttributeViewViewIcon(args.id, viewID, value);
    return { success: true, icon: value, target_type: 'database' };
  }
}
