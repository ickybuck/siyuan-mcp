/**
 * 数据库（属性视图 / attribute view）相关工具处理器
 */

import { BaseToolHandler } from './base.js';
import type { ExecutionContext, JSONSchema } from '../core/types.js';

const KEY_TYPES = [
  'text', 'number', 'date', 'select', 'mSelect', 'url', 'email', 'phone',
  'mAsset', 'template', 'created', 'updated', 'checkbox', 'relation', 'rollup', 'lineNumber',
];

const CELL_VALUE_DESCRIPTION =
  'Cell value in plain form — the field type determines how it is interpreted, so you do not need SiYuan\'s internal value structs. ' +
  'text: "some text" | number: 42 | date: "2026-05-25" or an ISO datetime or a millisecond timestamp | ' +
  'select: "Done" | mSelect: ["A","B"] | url/email/phone: "https://..." | checkbox: true | ' +
  'mAsset: ["https://example.com/img.png"]. ' +
  'Dates given as YYYY-MM-DD are interpreted at midnight in the SiYuan instance\'s local timezone, which is what the UI displays — ' +
  'passing a UTC midnight timestamp instead renders as the previous day in timezones west of UTC. ' +
  'Pass null or "" to clear a value. ' +
  'SiYuan\'s verbose Value structs (e.g. {"number":{"content":42,"isNotEmpty":true}}) are still accepted unchanged as an escape hatch.';

const FIELD_TYPES_DESCRIPTION =
  'text, number, date, select, mSelect, url, email, phone, mAsset, template, created, updated, checkbox, relation, rollup, lineNumber. ' +
  'Note: relation and rollup fields are created inert and must then be wired up with configure_relation_field / configure_rollup_field before they work.';

const BLOCKID_NOOP_WARNING =
  'Only takes effect on a database embedded in a document (has a real block_id from embed_database). ' +
  'On a detached database this call fails fast instead of silently no-opping.';

/**
 * 创建游离数据库
 */
export class CreateDatabaseHandler extends BaseToolHandler<
  { fields?: Array<{ name: string; type: string; icon?: string }>; keep_default_select?: boolean },
  any
> {
  readonly name = 'create_database';
  readonly description = `Create a new SiYuan database (attribute view), optionally with its whole field schema in one call. Not yet embedded in any document — call embed_database afterward, which is required before filters, sorts, grouping or layout changes take effect. Always table layout with one primary-key column. A default Select column is created by SiYuan and removed automatically unless keep_default_select is set. Field types: ${FIELD_TYPES_DESCRIPTION}`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description: 'Fields to create, in order. Omit to create a bare database.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Field display name' },
            type: { type: 'string', description: 'Field type', enum: KEY_TYPES },
            icon: { type: 'string', description: 'Optional emoji icon' },
          },
          required: ['name', 'type'],
        },
      },
      keep_default_select: {
        type: 'boolean',
        description: 'Keep SiYuan\'s auto-created default Select column. Defaults to false.',
      },
    },
    required: [],
  };

  async execute(args: any, context: ExecutionContext): Promise<any> {
    if (!args.fields || args.fields.length === 0) {
      const { avID, data } = await context.siyuan.av.createDatabase();
      return { av_id: avID, data };
    }
    const r = await context.siyuan.av.createDatabaseWithSchema(args.fields, {
      keepDefaultSelect: args.keep_default_select,
    });
    return { av_id: r.avID, primary_key_id: r.primaryKeyID, fields: r.fields };
  }
}

/**
 * 批量添加字段
 */
export class AddDatabaseFieldsHandler extends BaseToolHandler<
  { av_id: string; fields: Array<{ name: string; type: string; icon?: string }> },
  { fields: Record<string, string> }
> {
  readonly name = 'add_database_fields';
  readonly description = `Add several fields (columns) to an existing SiYuan database in one call, in the order given. Returns a map of field name to new field ID. Field types: ${FIELD_TYPES_DESCRIPTION}`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      fields: {
        type: 'array',
        description: 'Fields to create, in order',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Field display name' },
            type: { type: 'string', description: 'Field type', enum: KEY_TYPES },
            icon: { type: 'string', description: 'Optional emoji icon' },
          },
          required: ['name', 'type'],
        },
      },
    },
    required: ['av_id', 'fields'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ fields: Record<string, string> }> {
    return { fields: await context.siyuan.av.addFields(args.av_id, args.fields) };
  }
}

/**
 * 批量创建行并同时写入值
 */
export class AddDatabaseRowsWithValuesHandler extends BaseToolHandler<
  { av_id: string; rows: Array<Record<string, any>>; chunk_size?: number },
  { row_count: number; chunks: number }
> {
  readonly name = 'add_database_rows_with_values';
  readonly description = `Create detached rows AND set all their cell values in one call — the tool to use for bulk import. Each row is an object mapping field ID to value, including the primary-key field. This replaces the create-then-render-then-set-each-cell sequence: 100 rows of 10 fields is one call here versus roughly 1,002 otherwise. ${CELL_VALUE_DESCRIPTION}
RETRY SAFETY, verified against the kernel: a chunk is atomic, so if it fails nothing in it was written and it is safe to send again. But a chunk that SUCCEEDS and is sent again creates duplicate rows. After a timeout or any uncertain failure, do not blindly retry — either read the database back first, or use item_id. Giving each row an "item_id" pins its row ID, and re-sending a row with an id that already exists updates it instead of duplicating, which makes an import safely resumable. item_id must be 14 digits, a hyphen, then 7 lowercase alphanumerics; derive it from something stable in the source data.
An unknown field ID causes SiYuan to reject the whole batch, so this tool checks IDs up front and names the offender. Rows are chunked (default 100) because the kernel has historically been unstable under very large or rapid writes. Take a snapshot with create_snapshot before a large import. Rows created this way are detached: they live only in the database and are not bound to document blocks.`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      rows: {
        type: 'array',
        description: 'One object per row, mapping field ID to value. Get field IDs from create_database, add_database_fields, or get_database. Optionally include "item_id" to pin the row ID and make the import idempotent and resumable.',
        items: { type: 'object' },
      },
      chunk_size: {
        type: 'number',
        description: 'Rows per request. Defaults to 100. Lower it if the kernel struggles on very wide databases.',
      },
    },
    required: ['av_id', 'rows'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ row_count: number; chunks: number }> {
    const r = await context.siyuan.av.appendDetachedRowsWithValues(args.av_id, args.rows, {
      chunkSize: args.chunk_size,
    });
    return { row_count: r.rowCount, chunks: r.chunks };
  }
}

const CALC_OPERATORS = [
  'Count all', 'Count values', 'Count unique values', 'Count empty', 'Count not empty',
  'Percent empty', 'Percent not empty', 'Percent unique values', 'Unique values',
  'Sum', 'Average', 'Median', 'Min', 'Max', 'Range',
  'Earliest', 'Latest', 'Checked', 'Unchecked', 'Percent checked', 'Percent unchecked',
];

/**
 * 配置关联字段
 */
export class ConfigureRelationFieldHandler extends BaseToolHandler<
  { av_id: string; key_id: string; target_av_id: string; field_name: string; two_way?: boolean; back_field_name?: string },
  { success: boolean; back_key_id?: string }
> {
  readonly name = 'configure_relation_field';
  readonly description = 'Point a relation field at the database it relates to. This is REQUIRED after creating a field of type "relation" — add_database_field creates it with no target, and until it is configured the field exists but relates to nothing and cannot hold values. When two_way is true, a matching back-relation field is created in the target database and its new field ID is returned. Once configured, write relation values as an array of target row IDs, e.g. ["20260101120000-abc1234"].';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database containing the relation field' },
      key_id: { type: 'string', description: 'The relation field ID to configure' },
      target_av_id: { type: 'string', description: 'Database this field should relate to. May be the same database for a self-relation.' },
      field_name: { type: 'string', description: 'Name for the relation field. Required — the kernel overwrites the field name with this value, so passing an empty string blanks it.' },
      two_way: { type: 'boolean', description: 'Create a matching back-relation field in the target database. Defaults to false.' },
      back_field_name: { type: 'string', description: 'Name of the back-relation field created in the target database. Only used when two_way is true.' },
    },
    required: ['av_id', 'key_id', 'target_av_id', 'field_name'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; back_key_id?: string }> {
    const r = await context.siyuan.av.configureRelationField(args.av_id, args.key_id, args.target_av_id, {
      fieldName: args.field_name,
      twoWay: args.two_way,
      backFieldName: args.back_field_name,
    });
    return { success: true, ...(r.backKeyID ? { back_key_id: r.backKeyID } : {}) };
  }
}

/**
 * 配置汇总字段
 */
export class ConfigureRollupFieldHandler extends BaseToolHandler<
  { av_id: string; rollup_key_id: string; relation_key_id: string; target_key_id: string; calc?: string },
  { success: boolean }
> {
  readonly name = 'configure_rollup_field';
  readonly description = `Configure a rollup field so it summarises a field from related rows. REQUIRED after creating a field of type "rollup", which is otherwise inert. The relation field it builds on must already be configured with configure_relation_field first. calc must be one of: ${CALC_OPERATORS.join(', ')}. Rollup values are computed by SiYuan and cannot be written directly.`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database containing the rollup field' },
      rollup_key_id: { type: 'string', description: 'The rollup field ID to configure' },
      relation_key_id: { type: 'string', description: 'The already-configured relation field this rollup follows' },
      target_key_id: { type: 'string', description: 'Field ID in the related database whose values are summarised' },
      calc: { type: 'string', description: 'How to aggregate. Defaults to "Count all".', enum: CALC_OPERATORS },
    },
    required: ['av_id', 'rollup_key_id', 'relation_key_id', 'target_key_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.av.configureRollupField(
      args.av_id, args.rollup_key_id, args.relation_key_id, args.target_key_id, args.calc ?? 'Count all'
    );
    return { success: true };
  }
}

/**
 * 列出未被引用的数据库
 */
export class ListUnusedDatabasesHandler extends BaseToolHandler<Record<string, never>, any[]> {
  readonly name = 'list_unused_databases';
  readonly description = 'List databases that are not embedded in any document. A failed or abandoned import leaves these behind, where they are invisible in the UI but still occupying the workspace. Use before remove_unused_databases to see what would be deleted.';
  readonly inputSchema: JSONSchema = { type: 'object', properties: {}, required: [] };

  async execute(_args: any, context: ExecutionContext): Promise<any[]> {
    return await context.siyuan.av.getUnusedAttributeViews();
  }
}

/**
 * 删除未被引用的数据库
 */
export class RemoveUnusedDatabasesHandler extends BaseToolHandler<Record<string, never>, { success: boolean }> {
  readonly name = 'remove_unused_databases';
  readonly description = 'Permanently delete every database not embedded in any document. Irreversible — run list_unused_databases first to see what will go, and create_snapshot before running it. Note that a database you just created but have not yet embedded counts as unused, so do not run this in the middle of building one.';
  readonly inputSchema: JSONSchema = { type: 'object', properties: {}, required: [] };

  async execute(_args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.av.removeUnusedAttributeViews();
    return { success: true };
  }
}

/**
 * 批量设置已有行的单元格
 */
export class SetDatabaseCellsHandler extends BaseToolHandler<
  { av_id: string; updates: Array<{ item_id: string; key_id: string; value: any }>; chunk_size?: number },
  { updated: number; chunks: number }
> {
  readonly name = 'set_database_cells';
  readonly description = `Set many cell values on EXISTING rows in one call. Use add_database_rows_with_values when creating rows; use this to correct or update rows that already exist. ${CELL_VALUE_DESCRIPTION} item_id is the rendered row id from render_database (rows[].id / cards[].id), which is NOT the same as the bound block ID — passing the wrong one stores an orphan value that never appears in the cell.`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      updates: {
        type: 'array',
        description: 'Cell updates to apply',
        items: {
          type: 'object',
          properties: {
            item_id: { type: 'string', description: 'Row ID from render_database' },
            key_id: { type: 'string', description: 'Field (column) ID' },
            value: { description: 'Cell value; see the tool description for accepted forms' },
          },
          required: ['item_id', 'key_id', 'value'],
        },
      },
      chunk_size: { type: 'number', description: 'Updates per request. Defaults to 100.' },
    },
    required: ['av_id', 'updates'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ updated: number; chunks: number }> {
    const updates = args.updates.map((u: any) => ({ itemID: u.item_id, keyID: u.key_id, value: u.value }));
    return await context.siyuan.av.batchSetCells(args.av_id, updates, { chunkSize: args.chunk_size });
  }
}

/**
 * 将数据库嵌入文档
 */
export class EmbedDatabaseHandler extends BaseToolHandler<
  { av_id: string; parent_id?: string; previous_id?: string; next_id?: string; layout?: string },
  { block_id: string }
> {
  readonly name = 'embed_database';
  readonly description = 'Embed an existing SiYuan database into a document by inserting a database block. Provide exactly one anchor: next_id, previous_id, or parent_id (priority in that order if multiple given). Once embedded, the returned block_id is required for set_database_filters, set_database_sorts, set_database_group, and change_database_layout.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'The database ID to embed (from create_database)' },
      parent_id: { type: 'string', description: 'Parent block ID to insert under, as the last child' },
      previous_id: { type: 'string', description: 'Insert immediately after this block ID' },
      next_id: { type: 'string', description: 'Insert immediately before this block ID' },
      layout: {
        type: 'string',
        description: 'Layout to declare on the block: table, gallery, or kanban. Should match the database\'s actual current view layout. Default table.',
        enum: ['table', 'gallery', 'kanban'],
      },
    },
    required: ['av_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ block_id: string }> {
    if (!args.parent_id && !args.previous_id && !args.next_id) {
      throw new Error('Must provide at least one of: next_id, previous_id, parent_id');
    }
    const blockId = await context.siyuan.av.embedDatabase(
      args.av_id,
      { parentID: args.parent_id, previousID: args.previous_id, nextID: args.next_id },
      args.layout || 'table'
    );
    return { block_id: blockId };
  }
}

/**
 * 渲染数据库视图
 */
export class RenderDatabaseHandler extends BaseToolHandler<
  {
    av_id: string;
    block_id?: string;
    view_id?: string;
    page?: number;
    page_size?: number;
    query?: string;
    target_item_id?: string;
    target_group_id?: string;
  },
  any
> {
  readonly name = 'render_database';
  readonly description = 'Read a database\'s computed rows/cards for one view, with pagination. This is the primary read endpoint — use it to discover row IDs (rows[].id for table, cards[].id for gallery/kanban) needed for set_database_cell, add/remove rows, etc. Omit block_id when reading a detached database.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block embedding this database (resolves active view). Omit for a detached database.' },
      view_id: { type: 'string', description: 'Explicit view to render. Omit to resolve from block_id, falling back to the first view.' },
      page: { type: 'number', description: 'Page number, 1-based. Default 1.' },
      page_size: { type: 'number', description: 'Items per page. Default is the view\'s own default (50).' },
      query: { type: 'string', description: 'Optional full-text filter on primary-key values' },
      target_item_id: { type: 'string', description: 'Optional item ID to locate; response includes its location metadata' },
      target_group_id: { type: 'string', description: 'Optional group hint used with target_item_id' },
    },
    required: ['av_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<any> {
    return await context.siyuan.av.renderAttributeView(args.av_id, {
      blockID: args.block_id,
      viewID: args.view_id,
      page: args.page,
      pageSize: args.page_size,
      query: args.query,
      targetItemID: args.target_item_id,
      targetGroupID: args.target_group_id,
      createIfNotExist: false,
    });
  }
}

/**
 * 获取数据库完整定义
 */
export class GetDatabaseHandler extends BaseToolHandler<{ av_id: string }, any> {
  readonly name = 'get_database';
  readonly description = 'Get a SiYuan database\'s raw definition: fields (keyValues), field ordering, and every view\'s raw layout config and item ordering. Does not return computed/paginated rows — use render_database for that.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
    },
    required: ['av_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<any> {
    return await context.siyuan.av.getAttributeView(args.av_id);
  }
}

/**
 * 获取数据库主键值列表
 */
export class GetDatabasePrimaryKeyValuesHandler extends BaseToolHandler<
  { av_id: string; keyword?: string; page?: number; page_size?: number },
  any
> {
  readonly name = 'get_database_primary_key_values';
  readonly description = 'List a database\'s primary-key (row) values, optionally filtered by keyword, sorted by last-updated descending, paginated.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      keyword: { type: 'string', description: 'Optional case-insensitive substring filter on primary-key text' },
      page: { type: 'number', description: 'Page number, 1-based. Default 1.' },
      page_size: { type: 'number', description: 'Items per page. Default 16.' },
    },
    required: ['av_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<any> {
    return await context.siyuan.av.getAttributeViewPrimaryKeyValues(
      args.av_id,
      args.keyword ?? '',
      args.page ?? 1,
      args.page_size ?? 16
    );
  }
}

/**
 * 搜索数据库
 */
export class SearchDatabasesHandler extends BaseToolHandler<
  { keyword: string; excludes?: string[]; include_view_matches?: boolean },
  any
> {
  readonly name = 'search_databases';
  readonly description = 'Search SiYuan databases by name.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Search keyword, matched against database name' },
      excludes: { type: 'array', items: { type: 'string' }, description: 'Database IDs to exclude from results' },
      include_view_matches: { type: 'boolean', description: 'Also search view names; matching views are flagged matched: true' },
    },
    required: ['keyword'],
  };

  async execute(args: any, context: ExecutionContext): Promise<any> {
    return await context.siyuan.av.searchAttributeView(args.keyword, args.excludes ?? [], args.include_view_matches ?? false);
  }
}

/**
 * 设置单元格值
 */
export class SetDatabaseCellHandler extends BaseToolHandler<
  { av_id: string; key_id: string; item_id: string; value: any },
  any
> {
  readonly name = 'set_database_cell';
  readonly description = `Set the value of a single cell (one field of one row) in a SiYuan database. ${CELL_VALUE_DESCRIPTION} item_id must be the rendered row/card id from render_database (rows[].id / cards[].id) — it is NOT always the same as the bound block ID; passing the wrong ID stores an orphan value that never appears in the rendered cell.`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      key_id: { type: 'string', description: 'Field (column) ID being updated' },
      item_id: { type: 'string', description: 'Row ID, from render_database rows[].id or cards[].id' },
      value: { type: 'object', description: CELL_VALUE_DESCRIPTION },
    },
    required: ['av_id', 'key_id', 'item_id', 'value'],
  };

  async execute(args: any, context: ExecutionContext): Promise<any> {
    return await context.siyuan.av.setAttributeViewBlockAttr(args.av_id, args.key_id, args.item_id, args.value);
  }
}

/**
 * 添加行
 */
export class AddDatabaseRowsHandler extends BaseToolHandler<
  {
    av_id: string;
    srcs: Array<{ id?: string; is_detached: boolean; content?: string; item_id?: string }>;
    block_id?: string;
    view_id?: string;
    group_id?: string;
    previous_id?: string;
    ignore_default_fill?: boolean;
  },
  { success: boolean }
> {
  readonly name = 'add_database_rows';
  readonly description = 'Add one or more rows to a SiYuan database. Each row either binds an existing block (is_detached: false, with id set to that block\'s ID) or is a detached row that lives only inside the database (is_detached: true, with content as its primary-key text). Returns no row IDs — call render_database afterward to get them before setting cell values.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      srcs: {
        type: 'array',
        description: 'Rows to add',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Block ID to bind (required when is_detached is false)' },
            is_detached: { type: 'boolean', description: 'true for a detached row, false to bind an existing block' },
            content: { type: 'string', description: 'Primary-key display text (required for detached rows; overrides bound-block content otherwise)' },
            item_id: { type: 'string', description: 'Optional explicit row ID; auto-generated when omitted' },
          },
          required: ['is_detached'],
        },
      },
      block_id: { type: 'string', description: 'The database block that owns this database (resolves target view/group)' },
      view_id: { type: 'string', description: 'Explicit target view. Omit to use the view resolved from block_id, then the first view.' },
      group_id: { type: 'string', description: 'Target group ID for kanban views. Omit for table/gallery.' },
      previous_id: { type: 'string', description: 'Insert after this row ID. Omit to append at the end.' },
      ignore_default_fill: { type: 'boolean', description: 'When true, skip auto-filling default values into filter/group fields' },
    },
    required: ['av_id', 'srcs'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    const srcs = args.srcs.map((s: any) => ({
      id: s.id,
      isDetached: s.is_detached,
      content: s.content,
      itemID: s.item_id,
    }));
    await context.siyuan.av.addAttributeViewBlocks(args.av_id, srcs, {
      blockID: args.block_id,
      viewID: args.view_id,
      groupID: args.group_id,
      previousID: args.previous_id,
      ignoreDefaultFill: args.ignore_default_fill,
    });
    return { success: true };
  }
}

/**
 * 删除行
 */
export class RemoveDatabaseRowsHandler extends BaseToolHandler<
  { av_id: string; item_ids: string[] },
  { success: boolean }
> {
  readonly name = 'remove_database_rows';
  readonly description = 'Remove one or more rows from a SiYuan database, by row ID (render_database rows[].id / cards[].id). Detached rows are deleted outright; bound blocks are only unbound from the database — the underlying document block is not deleted.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      item_ids: { type: 'array', items: { type: 'string' }, description: 'Row IDs to remove' },
    },
    required: ['av_id', 'item_ids'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.av.removeAttributeViewBlocks(args.av_id, args.item_ids);
    return { success: true };
  }
}

/**
 * 切换布局
 */
export class ChangeDatabaseLayoutHandler extends BaseToolHandler<
  { av_id: string; block_id: string; layout: string },
  any
> {
  readonly name = 'change_database_layout';
  readonly description = `Switch a SiYuan database view between table, gallery, and kanban layout. Returns the re-rendered view (same shape as render_database). ${BLOCKID_NOOP_WARNING}`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block that owns the view (from embed_database)' },
      layout: { type: 'string', description: 'Target layout', enum: ['table', 'gallery', 'kanban'] },
    },
    required: ['av_id', 'block_id', 'layout'],
  };

  async execute(args: any, context: ExecutionContext): Promise<any> {
    return await context.siyuan.av.changeAttrViewLayout(args.av_id, args.block_id, args.layout);
  }
}

/**
 * 设置分组
 */
export class SetDatabaseGroupHandler extends BaseToolHandler<
  {
    av_id: string;
    block_id: string;
    field?: string;
    method?: number;
    order?: number;
    range?: { num_start: number; num_end: number; num_step: number };
    hide_empty?: boolean;
  },
  any
> {
  readonly name = 'set_database_group';
  readonly description = `Set or clear the grouping rule for a kanban database view. Pass an empty field to remove grouping. Returns the re-rendered view (same shape as render_database). ${BLOCKID_NOOP_WARNING}`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block that owns the view (from embed_database)' },
      field: { type: 'string', description: 'Field (column) ID to group by. Empty or omitted removes grouping.' },
      method: {
        type: 'number',
        description: 'Group method: 0=by value, 1=number range, 2=relative date, 3=day, 4=week, 5=month, 6=year',
      },
      order: { type: 'number', description: 'Group ordering: 0=ascending, 1=descending, 2=manual, 3=follow select-option order' },
      range: {
        type: 'object',
        description: 'Required when method is 1 (number range)',
        properties: {
          num_start: { type: 'number' },
          num_end: { type: 'number' },
          num_step: { type: 'number' },
        },
      },
      hide_empty: { type: 'boolean', description: 'Whether to hide empty groups' },
    },
    required: ['av_id', 'block_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<any> {
    return await context.siyuan.av.setAttrViewGroup(args.av_id, args.block_id, {
      field: args.field ?? '',
      method: args.method ?? 0,
      order: args.order,
      range: args.range
        ? { numStart: args.range.num_start, numEnd: args.range.num_end, numStep: args.range.num_step }
        : undefined,
      hideEmpty: args.hide_empty,
    });
  }
}

/**
 * 获取筛选与排序规则
 */
export class GetDatabaseFilterSortHandler extends BaseToolHandler<
  { av_id: string; block_id: string },
  { filters: any[]; sorts: any[] }
> {
  readonly name = 'get_database_filter_sort';
  readonly description = 'Get the current filter and sort rules of a SiYuan database view.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block that owns the view' },
    },
    required: ['av_id', 'block_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ filters: any[]; sorts: any[] }> {
    return await context.siyuan.av.getAttributeViewFilterSort(args.av_id, args.block_id);
  }
}

const FILTER_DESCRIPTION =
  'Array of ViewFilter nodes (leaf: {column, operator, value, relativeDate?} or group: {combination:"and"|"or", filters:[...]}). ' +
  'operator is one of: =, !=, >, >=, <, <=, Contains, Does not contains, Is empty, Is not empty, Starts with, Ends with, Is between, Is true, Is false. ' +
  'value is a partial cell Value object matching the field type — see set_database_cell.';

/**
 * 设置筛选规则
 */
export class SetDatabaseFiltersHandler extends BaseToolHandler<
  { av_id: string; block_id: string; filters: any[] },
  { success: boolean }
> {
  readonly name = 'set_database_filters';
  readonly description = `Replace a SiYuan database view's entire filter set. Pass an empty array to clear all filters. ${FILTER_DESCRIPTION} ${BLOCKID_NOOP_WARNING}`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block that owns the view (from embed_database)' },
      filters: { type: 'array', description: FILTER_DESCRIPTION },
    },
    required: ['av_id', 'block_id', 'filters'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.av.setAttrViewFilters(args.av_id, args.block_id, args.filters);
    return { success: true };
  }
}

/**
 * 设置排序规则
 */
export class SetDatabaseSortsHandler extends BaseToolHandler<
  { av_id: string; block_id: string; sorts: Array<{ column: string; order: 'ASC' | 'DESC' }> },
  { success: boolean }
> {
  readonly name = 'set_database_sorts';
  readonly description = `Replace a SiYuan database view's entire sort set. Pass an empty array to clear all sorts. ${BLOCKID_NOOP_WARNING}`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block that owns the view (from embed_database)' },
      sorts: {
        type: 'array',
        description: 'Array of {column, order}',
        items: {
          type: 'object',
          properties: {
            column: { type: 'string', description: 'Field (column) ID' },
            order: { type: 'string', enum: ['ASC', 'DESC'] },
          },
          required: ['column', 'order'],
        },
      },
    },
    required: ['av_id', 'block_id', 'sorts'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.av.setAttrViewSorts(args.av_id, args.block_id, args.sorts);
    return { success: true };
  }
}

/**
 * 添加字段
 */
export class AddDatabaseFieldHandler extends BaseToolHandler<
  { av_id: string; key_name: string; key_type: string; key_icon?: string; previous_key_id?: string },
  { key_id: string }
> {
  readonly name = 'add_database_field';
  readonly description = `Add a new field (column) to a SiYuan database, appended to every view. The block/primary-key type cannot be added this way — it's built in. Valid key_type values: ${KEY_TYPES.join(', ')}.`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      key_name: { type: 'string', description: 'Field display name' },
      key_type: { type: 'string', description: 'Field type', enum: KEY_TYPES },
      key_icon: { type: 'string', description: 'Optional field icon (emoji or empty string)' },
      previous_key_id: { type: 'string', description: 'Insert the new column after this field ID. Omit to use the layout default.' },
    },
    required: ['av_id', 'key_name', 'key_type'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ key_id: string }> {
    const keyId = await context.siyuan.av.addAttributeViewKey(args.av_id, args.key_name, args.key_type, {
      keyIcon: args.key_icon,
      previousKeyID: args.previous_key_id,
    });
    return { key_id: keyId };
  }
}

/**
 * 删除字段
 */
export class RemoveDatabaseFieldHandler extends BaseToolHandler<
  { av_id: string; key_id: string; remove_relation_dest?: boolean },
  { success: boolean }
> {
  readonly name = 'remove_database_field';
  readonly description = 'Remove a field (column) from a SiYuan database, along with all of its values.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      key_id: { type: 'string', description: 'Field ID to remove' },
      remove_relation_dest: { type: 'boolean', description: 'When true and the field is a relation, also remove the corresponding back-relation field from the destination database' },
    },
    required: ['av_id', 'key_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.av.removeAttributeViewKey(args.av_id, args.key_id, args.remove_relation_dest ?? false);
    return { success: true };
  }
}

/**
 * 全局字段排序
 */
export class SortDatabaseFieldHandler extends BaseToolHandler<
  { av_id: string; key_id: string; previous_key_id?: string },
  { success: boolean }
> {
  readonly name = 'sort_database_field';
  readonly description = 'Reorder a field (column) globally in a SiYuan database, moving it to the position after previous_key_id. Affects every view. Omit previous_key_id to move it to the first position.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      key_id: { type: 'string', description: 'Field ID to move' },
      previous_key_id: { type: 'string', description: 'Field ID after which key_id should be placed. Omit for the first position.' },
    },
    required: ['av_id', 'key_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.av.sortAttributeViewKey(args.av_id, args.key_id, args.previous_key_id ?? '');
    return { success: true };
  }
}

/**
 * 单视图字段排序
 */
export class SortDatabaseViewFieldHandler extends BaseToolHandler<
  { av_id: string; view_id?: string; key_id: string; previous_key_id?: string },
  { success: boolean }
> {
  readonly name = 'sort_database_view_field';
  readonly description = 'Reorder a field (column) within a single database view\'s layout (e.g. one table\'s column order), without changing the global field ordering. Omit previous_key_id to move it to the first position.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      view_id: { type: 'string', description: 'Target view. Omit to use the first available view.' },
      key_id: { type: 'string', description: 'Field ID to move' },
      previous_key_id: { type: 'string', description: 'Field ID after which key_id should be placed. Omit for the first position.' },
    },
    required: ['av_id', 'key_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.av.sortAttributeViewViewKey(args.av_id, args.view_id ?? '', args.key_id, args.previous_key_id ?? '');
    return { success: true };
  }
}
