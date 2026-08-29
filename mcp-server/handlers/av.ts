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
  'relation: ["<target row id>", ...] | ' +
  'mAsset: ["https://example.com/img.png"]. ' +
  'Dates given as YYYY-MM-DD are interpreted at midnight in the SiYuan instance\'s local timezone, which is what the UI displays and renders with no time shown — ' +
  'passing a UTC midnight timestamp instead renders as the previous day in timezones west of UTC. ' +
  'select/mSelect values are trimmed of leading/trailing whitespace, but NOT case-folded: "Done" and "done" become two separate options, silently, with no warning. ' +
  'Pass null or "" to clear a value. ' +
  'SiYuan\'s verbose Value structs (e.g. {"number":{"content":42,"isNotEmpty":true}}) are still accepted unchanged as an escape hatch.';

/**
 * 单元格值是多态的：它的形状取决于字段类型，所以不能固定成某一个 type。
 * 但完全省略 type 也不行——客户端没有任何类型信号时可能会把对象序列化成字符串再发过来，
 * 于是逐字 JSON 被当成文本写进单元格。用一个宽松的 anyOf 明确声明"对象也是合法参数"。
 */
const CELL_VALUE_TYPES = [
  { type: 'string' },
  { type: 'number' },
  { type: 'boolean' },
  { type: 'array' },
  { type: 'object' },
  { type: 'null' },
];

const FIELD_TYPES_DESCRIPTION =
  'text, number, date, select, mSelect, url, email, phone, mAsset, template, created, updated, checkbox, relation, rollup, lineNumber. ' +
  'Note: relation and rollup fields are created inert and must then be wired up with configure_relation_field / configure_rollup_field before they work. ' +
  'select/mSelect fields have no way to declare their allowed options at creation — the first row written to one creates its options implicitly. Use configure_select_options afterward to set colours or pre-seed a known option set.';

const BLOCKID_NOOP_WARNING =
  'Only takes effect on a database embedded in a document (has a real block_id from embed_database). ' +
  'On a detached database this call fails fast instead of silently no-opping.';

/**
 * 创建游离数据库
 */
export class CreateDatabaseHandler extends BaseToolHandler<
  { name?: string; fields?: Array<{ name: string; type: string; icon?: string }>; keep_default_select?: boolean },
  any
> {
  readonly name = 'create_database';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = `Create a new SiYuan database (attribute view), optionally with its whole field schema in one call. Not yet embedded in any document — call embed_database afterward, which is required before filters, sorts, grouping or layout changes take effect. Always table layout with one primary-key column, placed first in the column order. A default Select column is created by SiYuan and removed automatically unless keep_default_select is set. The primary key is named "Primary Key" — rename it with update_database_field if needed. Pass name to title the database; without it SiYuan shows it as "Untitled", and rename_database is the way to fix that later. Field types: ${FIELD_TYPES_DESCRIPTION}`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Title for the database itself, shown above the embedded table. Omit and it stays "Untitled" — worth setting, since a workspace of identically named databases is hard to navigate.',
      },
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
      const { avID, data } = await context.siyuan.av.createDatabase(args.name);
      return { av_id: avID, data };
    }
    const r = await context.siyuan.av.createDatabaseWithSchema(args.fields, {
      keepDefaultSelect: args.keep_default_select,
      name: args.name,
    });
    return { av_id: r.avID, primary_key_id: r.primaryKeyID, fields: r.fields };
  }
}

/**
 * 给数据库命名
 */
export class RenameDatabaseHandler extends BaseToolHandler<
  { av_id: string; name: string },
  { success: boolean; av_id: string; name: string }
> {
  readonly name = 'rename_database';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description =
    'Set a SiYuan database\'s own title — the name shown above the embedded table, and the one SiYuan displays as "Untitled" when it has never been set. This is the database, not its fields (update_database_field renames those) and not the document holding it (rename_document does that). The name lives on the database, so every document embedding it picks up the change. Leading and trailing whitespace is trimmed, newlines become spaces, and SiYuan truncates past 512 characters.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      name: { type: 'string', description: 'New title for the database' },
    },
    required: ['av_id', 'name'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; av_id: string; name: string }> {
    await context.siyuan.av.setAttributeViewName(args.av_id, args.name);
    return { success: true, av_id: args.av_id, name: args.name.trim().replace(/\n/g, ' ') };
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  { av_id: string; rows: Array<Record<string, any>>; chunk_size?: number; validate_options?: boolean },
  { row_count: number; chunks: number }
> {
  readonly name = 'add_database_rows_with_values';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = `Create detached rows AND set all their cell values in one call — the tool to use for bulk import. Each row is an object mapping field ID to value, including the primary-key field. This replaces the create-then-render-then-set-each-cell sequence: 100 rows of 10 fields is one call here versus roughly 1,002 otherwise. ${CELL_VALUE_DESCRIPTION}
RETRY SAFETY, verified against the kernel: a chunk is atomic, so if it fails nothing in it was written and it is safe to send again. But a chunk that SUCCEEDS and is sent again creates duplicate rows. After a timeout or any uncertain failure, do not blindly retry — either read the database back first, or use item_id. Giving each row an "item_id" pins its row ID, and re-sending a row with an id that already exists updates it instead of duplicating, which makes an import safely resumable. item_id must be 14 digits, a hyphen, then 7 lowercase alphanumerics; derive it from something stable in the source data (deriveItemId in the library helps with this).
An unknown field ID causes SiYuan to reject the whole batch, so this tool checks IDs up front and names the offender. Every row must also carry a non-empty value for the primary-key field — specific to this endpoint (appendAttributeViewDetachedBlocksWithValues): if it is missing, null, or an empty string, SiYuan silently creates no row at all for that entry (row_count still reports the number of rows submitted, not written). Any non-empty string works, even a single space, but genuinely empty never does, and there is no flag to opt around it on this call. If a blank title is genuinely needed, use add_database_rows instead (a different endpoint that does accept an empty or omitted title) and fill in the other fields afterward with set_database_cell. Rejected up front by row index instead of shipped to the kernel. Rows are chunked (default 100, confirmed working up to at least 300 in a single call) because the kernel has historically been unstable under very large or rapid writes. Take a snapshot with create_snapshot before a large import. Rows created this way are detached: they live only in the database and are not bound to document blocks.
select/mSelect values that don't match an existing option are silently created as new options — case-sensitive, whitespace-trimmed but otherwise unvalidated. Set validate_options to catch this instead of discovering it later as a near-duplicate option.
VERIFYING A LARGE IMPORT: row_count and a total from get_database_primary_key_values only prove a count, not that specific rows survived — two batches can sum to the expected total while a contiguous block in the middle went missing (e.g. from partial consumption of a paginated source). Spot-check a handful of known keys with render_database's query param, or get_database_primary_key_values with keyword, rather than trusting the totals alone.`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      rows: {
        type: 'array',
        description: 'One object per row, mapping field ID to value, including the primary-key field ID with a non-empty value. Get field IDs from create_database, add_database_fields, or get_database. Optionally include "item_id" to pin the row ID and make the import idempotent and resumable.',
        items: { type: 'object' },
      },
      chunk_size: {
        type: 'number',
        description: 'Rows per request. Defaults to 100. Lower it if the kernel struggles on very wide databases.',
      },
      validate_options: {
        type: 'boolean',
        description: 'When true, reject the call up front if any select/mSelect value is not already an existing option for its field — instead of letting SiYuan silently create a new, possibly near-duplicate option. Pre-seed the allowed set with configure_select_options first. Defaults to false, since creating new options is often exactly what is wanted.',
      },
    },
    required: ['av_id', 'rows'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ row_count: number; chunks: number }> {
    const r = await context.siyuan.av.appendDetachedRowsWithValues(args.av_id, args.rows, {
      chunkSize: args.chunk_size,
      validateOptions: args.validate_options,
    });
    return { row_count: r.rowCount, chunks: r.chunks };
  }
}

/**
 * 重命名字段或更改其类型
 */
export class UpdateDatabaseFieldHandler extends BaseToolHandler<
  { av_id: string; key_id: string; name?: string; type?: string },
  { success: boolean }
> {
  readonly name = 'update_database_field';
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
  readonly description = `Rename a field, or change its type, without discarding its existing data — the missing counterpart to add_database_field/remove_database_field, which can only add or discard-and-recreate. Works on the primary key too: you can rename SiYuan's default "Primary Key" to something meaningful. The primary key's TYPE cannot be changed, and no other field can be changed to the primary-key type — this tool rejects that itself with a clear error before contacting SiYuan, because the kernel's own rejection of it is silent (reports success, changes nothing, with no way to detect that from the response). Omit name or type to leave that part unchanged. Field types: ${FIELD_TYPES_DESCRIPTION}`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      key_id: { type: 'string', description: 'Field ID to update (including the primary key)' },
      name: { type: 'string', description: 'New field name. Omit to keep the current name.' },
      type: { type: 'string', description: 'New field type. Omit to keep the current type.', enum: KEY_TYPES },
    },
    required: ['av_id', 'key_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.av.updateField(args.av_id, args.key_id, { name: args.name, type: args.type });
    return { success: true };
  }
}

/**
 * 设置 select/mSelect 字段的选项
 */
export class ConfigureSelectOptionsHandler extends BaseToolHandler<
  { av_id: string; key_id: string; options: Array<{ name: string; color?: string; desc?: string }> },
  { success: boolean }
> {
  readonly name = 'configure_select_options';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Explicitly set the options on a select or mSelect field: name, colour, and description. Existing options with a matching name are updated (colour/description); others are added. Options not in the list are left alone, not removed. Matching is exact — same case-sensitivity and whitespace rules as writing a cell value, so an option declared here must be typed identically wherever it is written. Use this to fix the "every implicitly-created option is the same colour" problem (colours default to a 1-14 round-robin here if omitted, rather than SiYuan\'s fixed colour for auto-created options), or to pre-seed a known option set before a bulk import that uses validate_options.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      key_id: { type: 'string', description: 'Field ID (must be select or mSelect)' },
      options: {
        type: 'array',
        description: 'Options to set',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Option name — must match cell values exactly (case, whitespace)' },
            color: { type: 'string', description: 'Palette index 1-14 as a string. Omit for automatic round-robin assignment.' },
            desc: { type: 'string', description: 'Optional description' },
          },
          required: ['name'],
        },
      },
    },
    required: ['av_id', 'key_id', 'options'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean }> {
    await context.siyuan.av.configureSelectOptions(args.av_id, args.key_id, args.options);
    return { success: true };
  }
}

/**
 * 无自增字段类型时的下一个序号助手
 */
export class GetNextSequenceValueHandler extends BaseToolHandler<
  { av_id: string; key_id: string },
  { next_value: number }
> {
  readonly name = 'get_next_sequence_value';
  readonly annotations = { readOnlyHint: true } as const;
  readonly description = 'Suggest the next value for a manually-maintained sequential ID field (e.g. a "BL-#" or "PF-#" style number column), since SiYuan has no auto-increment field type. Reads the current maximum value of the given number field across every row and returns max + 1 (1 if the database is empty). This is a convenience read, not an atomic counter — two near-simultaneous calls can return the same value, so it does not guarantee uniqueness under concurrent writers. It replaces manually scanning for the highest existing number, not a real auto-increment; verify uniqueness after writing if that matters.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      key_id: { type: 'string', description: 'The number field to use as the sequence' },
    },
    required: ['av_id', 'key_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ next_value: number }> {
    return { next_value: await context.siyuan.av.getNextSequenceValue(args.av_id, args.key_id) };
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
 * 行 ID 与绑定块 ID 互查
 */
export class ResolveDatabaseIdsHandler extends BaseToolHandler<
  { av_id: string; item_ids?: string[]; block_ids?: string[] },
  { item_ids?: Record<string, string>; block_ids?: Record<string, string> }
> {
  readonly name = 'resolve_database_ids';
  readonly annotations = { readOnlyHint: true } as const;
  readonly description = 'Translate between a database\'s row IDs and the document block IDs its rows are bound to. These are different identifiers and confusing them is a common source of silent data loss: writing a cell with a block ID where a row ID belongs stores an orphan value that never appears. Pass item_ids to get the bound block IDs, or block_ids to get the row IDs. Each result is an OBJECT keyed by the ID you asked about, not a positional array — an ID that resolves to nothing (a detached row, or a block not in this database) comes back with an empty string, so every input ID is present in the result either way.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      item_ids: { type: 'array', items: { type: 'string' }, description: 'Row IDs to resolve to bound block IDs' },
      block_ids: { type: 'array', items: { type: 'string' }, description: 'Block IDs to resolve to row IDs' },
    },
    required: ['av_id'],
  };

  validate(args: any): args is { av_id: string; item_ids?: string[]; block_ids?: string[] } {
    if (!args.item_ids?.length && !args.block_ids?.length) {
      throw new Error('Provide at least one of: item_ids, block_ids');
    }
    return true;
  }

  async execute(
    args: any,
    context: ExecutionContext
  ): Promise<{ item_ids?: Record<string, string>; block_ids?: Record<string, string> }> {
    const out: { item_ids?: Record<string, string>; block_ids?: Record<string, string> } = {};
    if (args.item_ids?.length) {
      out.block_ids = await context.siyuan.av.getBoundBlockIDsByItemIDs(args.av_id, args.item_ids);
    }
    if (args.block_ids?.length) {
      out.item_ids = await context.siyuan.av.getItemIDsByBoundIDs(args.av_id, args.block_ids);
    }
    return out;
  }
}

/**
 * 批量替换行绑定的块
 */
export class ReplaceDatabaseBlocksHandler extends BaseToolHandler<
  { av_id: string; replacements: Record<string, string>; is_detached?: boolean },
  { replaced: number }
> {
  readonly name = 'replace_database_blocks';
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
  readonly description = 'Re-point database rows from one set of bound blocks to another, given a map of old block ID to new block ID. Use this when the documents a database refers to have been recreated — a re-import, for instance — and the rows would otherwise still point at the old, now-deleted blocks. This changes which block each row is bound to; it does not alter cell values.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      replacements: {
        type: 'object',
        description: 'Map of old block ID to new block ID, e.g. {"20260101120000-aaaaaaa":"20260202120000-bbbbbbb"}',
      },
      is_detached: {
        type: 'boolean',
        description: 'Whether the resulting rows should be detached (not bound to a document block). Defaults to false.',
      },
    },
    required: ['av_id', 'replacements'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ replaced: number }> {
    return await context.siyuan.av.batchReplaceBlocks(args.av_id, args.replacements, args.is_detached ?? false);
  }
}

/**
 * 列出未被引用的数据库
 */
export class ListUnusedDatabasesHandler extends BaseToolHandler<Record<string, never>, any[]> {
  readonly name = 'list_unused_databases';
  readonly annotations = { readOnlyHint: true } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
  readonly description =
    'Permanently delete the named databases, which must currently be unembedded. Irreversible — run list_unused_databases first and pass the ids you mean; create_snapshot beforehand is cheap insurance. There is deliberately no "delete everything unused" form: a database counts as unused for the moment between being created and being embedded, so a blanket sweep destroys whatever another session is midway through building, and the victim sees no error — only a later failure on an id that no longer exists. Every id is re-checked against the current unused list, and if any is not on it the whole call is refused without deleting anything, since that means the list being worked from is stale.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Database IDs to delete, from list_unused_databases. Required — there is no form of this call that deletes everything unused.',
      },
    },
    required: ['av_ids'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; removed: string[] }> {
    const { removed } = await context.siyuan.av.removeUnusedAttributeViews(args.av_ids);
    return { success: true, removed };
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
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
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
            value: { anyOf: CELL_VALUE_TYPES, description: 'Cell value; see the tool description for accepted forms' },
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
 * 把渲染结果裁剪到指定字段。
 *
 * 内核没有"只取某几列"的读法：render 一次就是整行整表，行里带正文的数据库读一格
 * 也要拖上全部长文本。裁剪放在这一层，省的是回到调用方的那份 payload，也就是真正
 * 花钱的那份。
 *
 * 递归处理是为了覆盖分组视图：cells/values 出现在 rows、cards、groups 里各一份，
 * 按 keyID 过滤比按已知结构逐个处理更不容易漏。列定义同样裁剪——它们本身在九列的
 * 数据库上就有一两千 token 的固定开销。
 *
 * 刻意不看视图的 hidden 标记：那会让同一个调用因为解析到哪个视图而返回不同的数据，
 * 把 API 的返回量绑在别人的界面偏好上。要哪几列就明写哪几列。
 */
function pruneRenderedToFields(node: any, allowed: Set<string>): any {
  if (Array.isArray(node)) {
    return node.map((item) => pruneRenderedToFields(item, allowed));
  }
  if (!node || typeof node !== 'object') {
    return node;
  }

  const out: any = {};
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'cells' || key === 'values') && Array.isArray(value)) {
      out[key] = value
        .filter((cell: any) => !cell?.value?.keyID || allowed.has(cell.value.keyID))
        .map((cell: any) => pruneRenderedToFields(cell, allowed));
      continue;
    }
    if ((key === 'columns' || key === 'fields') && Array.isArray(value)) {
      out[key] = value.filter((column: any) => !column?.id || allowed.has(column.id));
      continue;
    }
    out[key] = pruneRenderedToFields(value, allowed);
  }
  return out;
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
    fields?: string[];
  },
  any
> {
  readonly name = 'render_database';
  readonly annotations = { readOnlyHint: true } as const;
  readonly description = 'Read a database\'s computed rows/cards for one view, with pagination. This is the primary read endpoint — use it to discover row IDs (rows[].id for table, cards[].id for gallery/kanban) needed for set_database_cell, add/remove rows, etc. Omit block_id when reading a detached database. Pass fields to return only the columns you need: on a database whose rows carry long text, an all-columns read costs many times what the answer needs, which is how checking your own work quietly becomes too expensive to do.';
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
      fields: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Return only these columns — field IDs, or exact field names (case-insensitive). Column definitions are trimmed to match, not just the cells. Row/card IDs are always returned, so the primary key is only needed here if you want to read it. Omit for every column. This is independent of any view\'s hidden-column settings, which do not affect what the kernel returns.',
      },
    },
    required: ['av_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<any> {
    const rendered = await context.siyuan.av.renderAttributeView(args.av_id, {
      blockID: args.block_id,
      viewID: args.view_id,
      page: args.page,
      pageSize: args.page_size,
      query: args.query,
      targetItemID: args.target_item_id,
      targetGroupID: args.target_group_id,
      createIfNotExist: false,
    });

    if (!args.fields?.length) {
      return rendered;
    }

    const columns: any[] = rendered?.view?.columns || rendered?.view?.fields || [];
    const byID = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const column of columns) {
      if (!column?.id) continue;
      byID.set(column.id, column.id);
      if (column.name) byName.set(String(column.name).trim().toLowerCase(), column.id);
    }

    const allowed = new Set<string>();
    const unknown: string[] = [];
    for (const wanted of args.fields) {
      const key = String(wanted).trim();
      const resolved = byID.get(key) ?? byName.get(key.toLowerCase());
      if (resolved) allowed.add(resolved);
      else unknown.push(key);
    }

    if (unknown.length) {
      const available = columns.map((c: any) => `"${c.name}" (${c.id})`).join(', ');
      throw new Error(
        `Unknown field${unknown.length > 1 ? 's' : ''} ${unknown.map((u) => `"${u}"`).join(', ')} in fields. ` +
          `Silently returning fewer columns than asked for would look identical to a column being empty, so this fails instead. Available: ${available}.`
      );
    }

    return pruneRenderedToFields(rendered, allowed);
  }
}

/**
 * 获取数据库完整定义
 */
export class GetDatabaseHandler extends BaseToolHandler<{ av_id: string }, any> {
  readonly name = 'get_database';
  readonly annotations = { readOnlyHint: true } as const;
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
  readonly annotations = { readOnlyHint: true } as const;
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
  readonly annotations = { readOnlyHint: true } as const;
  readonly description =
    'Look a SiYuan database up by name. Use it to find one database from a distinctive term — NOT to enumerate or audit them. SiYuan caps this search at 12 results, a fixed limit in the kernel with no total and no paging, so a broad keyword silently returns a subset and an absent database is not evidence it does not exist. The response says so: `truncated` is true whenever the cap was hit, and `embedded_database_count` gives the number of databases embedded anywhere in the workspace for comparison. Pass notebook_id to keep only databases embedded in that notebook; a database that is not embedded anywhere belongs to no notebook and is reported separately rather than dropped quietly.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Search keyword, matched against database name. Prefer a distinctive term — a broad one is what the 12-result cap silently truncates.' },
      excludes: { type: 'array', items: { type: 'string' }, description: 'Database IDs to exclude from results' },
      include_view_matches: { type: 'boolean', description: 'Also search view names; matching views are flagged matched: true' },
      notebook_id: { type: 'string', description: 'Keep only databases embedded in this notebook. Filtering happens after the kernel search, so it narrows an already-capped result set rather than searching more widely.' },
    },
    required: ['keyword'],
  };

  async execute(args: any, context: ExecutionContext): Promise<any> {
    const r = await context.siyuan.av.searchAttributeView(
      args.keyword,
      args.excludes ?? [],
      args.include_view_matches ?? false,
      { notebookID: args.notebook_id }
    );
    return {
      results: r.results,
      returned: r.returned,
      truncated: r.truncated,
      embedded_database_count: r.embeddedDatabaseCount,
      ...(r.excludedAsUnembedded !== undefined ? { excluded_by_notebook_filter: r.excludedAsUnembedded } : {}),
      ...(r.note ? { note: r.note } : {}),
    };
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
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
  readonly description = `Set the value of a single cell (one field of one row) in a SiYuan database. ${CELL_VALUE_DESCRIPTION} item_id must be the rendered row/card id from render_database (rows[].id / cards[].id) — it is NOT always the same as the bound block ID; passing the wrong ID stores an orphan value that never appears in the rendered cell.`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      key_id: { type: 'string', description: 'Field (column) ID being updated' },
      item_id: { type: 'string', description: 'Row ID, from render_database rows[].id or cards[].id' },
      value: { anyOf: CELL_VALUE_TYPES, description: CELL_VALUE_DESCRIPTION },
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Add one or more rows to a SiYuan database. Each row either binds an existing block (is_detached: false, with id set to that block\'s ID) or is a detached row that lives only inside the database (is_detached: true, with content as its primary-key text). Unlike add_database_rows_with_values, an empty or omitted content is accepted here and still creates the row — use this two-step path (this call, then set_database_cell for the other fields) when a row genuinely needs a blank title. Returns no row IDs — call render_database afterward to get them before setting cell values.';
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
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  readonly annotations = { readOnlyHint: true } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = `Add a new field (column) to a SiYuan database, appended to every view and registered in the database's global field order. Both of those need doing explicitly: SiYuan prepends a new table column to the left of the primary key when no position is given, and never adds the field to keyIDs at all, so a consumer iterating keyIDs would not see it. Adding a second field with the same name AND type is refused, since two fields sharing a name make later writes addressed by name ambiguous and render_database's name filter would show only one of them — pass allow_duplicate_name if two are genuinely wanted. The block/primary-key type cannot be added this way — it's built in. Valid key_type values: ${KEY_TYPES.join(', ')}.`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      key_name: { type: 'string', description: 'Field display name' },
      key_type: { type: 'string', description: 'Field type', enum: KEY_TYPES },
      key_icon: { type: 'string', description: 'Optional field icon (emoji or empty string)' },
      previous_key_id: { type: 'string', description: 'Insert the new column after this field ID. Omit to append after the last existing field.' },
      allow_duplicate_name: { type: 'boolean', description: 'Permit a second field with the same name and type as an existing one. Off by default; two identically named fields make name-addressed writes ambiguous.' },
    },
    required: ['av_id', 'key_name', 'key_type'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ key_id: string }> {
    const keyId = await context.siyuan.av.addAttributeViewKey(args.av_id, args.key_name, args.key_type, {
      keyIcon: args.key_icon,
      previousKeyID: args.previous_key_id,
      allowDuplicateName: args.allow_duplicate_name,
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
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
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

const NEW_ITEM_FIELD_VALUE_DESCRIPTION =
  'Default value for this field on rows created from the template. { value: <plain form value> } for a fixed default (same plain forms as set_database_cell — see that tool\'s description), ' +
  'or { mode: "current_time" } for a date field to default to the creation time. ' +
  'select/mSelect defaults must already exist as options on the field (configure_select_options first) — unlike a normal cell write, this does not create them implicitly, and SiYuan discards the entire template set if one is missing. That is checked here before the write, along with the field type: only text, number, date, select, mSelect, url, email, phone, mAsset, checkbox and relation fields can carry a default, and current_time only on a date field.';

/**
 * 设置数据库新增条目模板
 */
export class ConfigureNewItemTemplatesHandler extends BaseToolHandler<
  {
    av_id: string;
    templates: Array<{
      id?: string;
      name: string;
      icon?: string;
      target_type: 'detached' | 'document';
      primary_key_template?: string;
      field_values?: Record<string, { mode?: 'static' | 'current_time'; value?: any }>;
      save_location?: { box_id?: string; path_template: string };
      content_template_path?: string;
      hide_in_file_tree?: boolean;
    }>;
    default_template_id?: string;
  },
  { template_ids: Record<string, string> }
> {
  readonly name = 'configure_new_item_templates';
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
  readonly description = `Set the row-creation templates for a SiYuan database — the equivalent of Notion's page templates. A "detached" template only pre-fills field default values; a "document" template additionally binds new rows to a real document, with its body taken from content_template_path (unless overridden per-row via create_database_row_from_template_with_markdown) and saved per save_location.
REPLACES THE WHOLE SET, not a merge: templates omitted from this call are dropped. To amend an existing configuration, read newItemTemplates back from get_database first and include everything that should still exist. Templates without an explicit id get one generated and returned in template_ids (keyed by name) — pass that id back as id on a later call to update the same template in place, or as default_template_id. The returned ids are read back from SiYuan after the write, so they name templates that actually exist; if the write did not land, this call raises an error rather than returning ids for templates that were never stored.
${NEW_ITEM_FIELD_VALUE_DESCRIPTION}`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      templates: {
        type: 'array',
        description: 'The complete set of templates this database should have after the call.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Omit to create a new template; pass an existing template\'s id to update it in place.' },
            name: { type: 'string', description: 'Display name shown when picking a template' },
            icon: { type: 'string', description: 'Optional emoji icon' },
            target_type: { type: 'string', enum: ['detached', 'document'], description: '"detached" pre-fills field defaults only; "document" also creates and binds a real document per row' },
            primary_key_template: { type: 'string', description: 'Optional default text for the primary-key field on new rows, e.g. "Untitled". Applies to EVERY row created from this template and takes precedence over the per-row title argument of create_database_row_from_template_with_markdown, which SiYuan only falls back to when this is empty — leave it unset for any template whose rows should carry their own titles.' },
            field_values: { type: 'object', description: NEW_ITEM_FIELD_VALUE_DESCRIPTION },
            save_location: {
              type: 'object',
              description: 'Document-target only. Omit to inherit the global default document location.',
              properties: {
                box_id: { type: 'string', description: 'Notebook ID. Omit to use the notebook the database itself lives in.' },
                path_template: { type: 'string', description: 'Path template for the new document, e.g. "/Episodes/${title}"' },
              },
              required: ['path_template'],
            },
            content_template_path: { type: 'string', description: 'Document-target only: path of the document whose content is copied into every new row\'s body' },
            hide_in_file_tree: { type: 'boolean', description: 'Document-target only: hide the created documents from the file tree' },
          },
          required: ['name', 'target_type'],
        },
      },
      default_template_id: { type: 'string', description: 'Template id pre-selected when a row is created without specifying one explicitly.' },
    },
    required: ['av_id', 'templates'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ template_ids: Record<string, string> }> {
    const templates = args.templates.map((t: any) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      targetType: t.target_type,
      primaryKeyTemplate: t.primary_key_template,
      fieldValues: t.field_values
        ? Object.fromEntries(
            Object.entries(t.field_values).map(([keyID, fv]: [string, any]) => [
              keyID,
              { mode: fv.mode === 'current_time' ? 'currentTime' : 'static', value: fv.value },
            ])
          )
        : undefined,
      saveLocation: t.save_location ? { boxID: t.save_location.box_id, pathTemplate: t.save_location.path_template } : undefined,
      contentTemplatePath: t.content_template_path,
      hideInFileTree: t.hide_in_file_tree,
    }));
    const { templateIDs } = await context.siyuan.av.setNewItemTemplates(args.av_id, templates, args.default_template_id);
    return { template_ids: templateIDs };
  }
}

/**
 * 按模板创建数据库条目
 */
export class CreateDatabaseRowFromTemplateHandler extends BaseToolHandler<
  { av_id: string; block_id: string; template_id?: string; view_id?: string; previous_id?: string; group_id?: string },
  { item_id: string; block_id: string; content: string; is_detached: boolean; warnings?: string[] }
> {
  readonly name = 'create_database_row_from_template';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Create a new row in a SiYuan database using one of its configured row-creation templates (see configure_new_item_templates), or a blank row if template_id is omitted. For a "document" template this also creates and binds a real document, with content copied from the template\'s content_template_path — to supply custom content instead, use create_database_row_from_template_with_markdown. Requires an embedded database (has a real block_id from embed_database); does not work on a detached database.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block embedding this database, from embed_database' },
      template_id: { type: 'string', description: 'Template to use, from configure_new_item_templates\'s response. Omit for a blank detached row.' },
      view_id: { type: 'string', description: 'Target view. Omit to use the first available view.' },
      previous_id: { type: 'string', description: 'Row ID to insert the new row directly after. Omit to append at the end.' },
      group_id: { type: 'string', description: 'Group to insert into, for a grouped view.' },
    },
    required: ['av_id', 'block_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ item_id: string; block_id: string; content: string; is_detached: boolean; warnings?: string[] }> {
    const r = await context.siyuan.av.createRowFromTemplate(args.av_id, args.block_id, {
      templateID: args.template_id,
      viewID: args.view_id,
      previousID: args.previous_id,
      groupID: args.group_id,
    });
    return { item_id: r.itemID, block_id: r.blockID, content: r.content, is_detached: r.isDetached, warnings: r.warnings };
  }
}

/**
 * 内核只在模板的 primaryKeyTemplate 为空时才使用调用方传入的 title，见
 * kernel/model/attribute_view_new_item.go：两者同时给出时 title 被静默丢弃，
 * 整批条目会得到同一个名字，正文却是对的——没有任何报错。而 title 本身又是内核的必填
 * 参数（kernel/api/av.go 的 BindJsonArg required+notEmpty），所以"不传 title"并不是
 * 出路，只能拦下这个组合。与未知字段 ID、缺失主键同一类失败，做法也一样。
 */
async function assertTitleNotOverriddenByTemplate(
  avID: string,
  templateID: string,
  title: string,
  context: ExecutionContext
): Promise<void> {
  const attributeView = await context.siyuan.av.getAttributeView(avID);
  const templates: any[] = attributeView?.newItemTemplates ?? [];
  const template = templates.find((t: any) => t?.id === templateID);
  const primaryKeyTemplate = String(template?.primaryKeyTemplate ?? '').trim();
  if (!primaryKeyTemplate) {
    return;
  }
  throw new Error(
    `Template ${templateID} sets primary_key_template to "${primaryKeyTemplate}", which SiYuan applies to every row created from it. ` +
      `The title "${title}" would be discarded without an error, naming every row alike while their bodies differ. ` +
      'SiYuan requires a non-empty title on this call regardless, so there is no way to opt out per row: either clear primary_key_template on that template with configure_new_item_templates, ' +
      'or use create_database_row_from_template if the template-generated name and its static content are what you want.'
  );
}

/**
 * 按 document 类型模板创建数据库条目，并提供自定义 Markdown 正文
 */
export class CreateDatabaseRowFromTemplateWithMarkdownHandler extends BaseToolHandler<
  {
    av_id: string;
    block_id: string;
    template_id: string;
    title: string;
    markdown: string;
    view_id?: string;
    previous_id?: string;
    group_id?: string;
    tags?: string;
    with_math?: boolean;
    clipping_href?: string;
    list_doc_tree?: boolean;
  },
  { item_id: string; block_id: string; content: string; is_detached: boolean; warnings?: string[] }
> {
  readonly name = 'create_database_row_from_template_with_markdown';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Create a new row bound to a real document, using a "document"-target template (see configure_new_item_templates) but with the given markdown as the document body instead of the template\'s own content_template_path — the way to generate a fresh, per-row body (e.g. an AI-written brief) rather than copying the same static template content every time. template_id must reference a document-target template; this cannot create a detached row. Requires an embedded database (has a real block_id from embed_database).';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block embedding this database, from embed_database' },
      template_id: { type: 'string', description: 'A document-target template\'s id, from configure_new_item_templates\'s response' },
      title: { type: 'string', description: 'Title of the new bound document, which also becomes the row\'s primary-key text. Required and non-empty — SiYuan rejects an empty one. It is used only when the template\'s primary_key_template is empty; a template that sets both is rejected here rather than silently discarding the title.' },
      markdown: { type: 'string', description: 'Markdown content for the new document\'s body' },
      view_id: { type: 'string', description: 'Target view. Omit to use the first available view.' },
      previous_id: { type: 'string', description: 'Row ID to insert the new row directly after. Omit to append at the end.' },
      group_id: { type: 'string', description: 'Group to insert into, for a grouped view.' },
      tags: { type: 'string', description: 'Comma-separated tags for the new document' },
      with_math: { type: 'boolean', description: 'Enable math rendering for the new document' },
      clipping_href: { type: 'string', description: 'Optional source URL, if this document was clipped from the web' },
      list_doc_tree: { type: 'boolean', description: 'List the new document in its notebook\'s document tree' },
    },
    required: ['av_id', 'block_id', 'template_id', 'title', 'markdown'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ item_id: string; block_id: string; content: string; is_detached: boolean; warnings?: string[] }> {
    await assertTitleNotOverriddenByTemplate(args.av_id, args.template_id, args.title, context);
    const r = await context.siyuan.av.createRowFromTemplateWithMarkdown(
      args.av_id,
      args.block_id,
      args.template_id,
      {
        title: args.title,
        markdown: args.markdown,
        tags: args.tags,
        withMath: args.with_math,
        clippingHref: args.clipping_href,
        listDocTree: args.list_doc_tree,
      },
      { viewID: args.view_id, previousID: args.previous_id, groupID: args.group_id }
    );
    return { item_id: r.itemID, block_id: r.blockID, content: r.content, is_detached: r.isDetached, warnings: r.warnings };
  }
}

/**
 * 批量把已有块绑成行并同时写值
 */
export class AddBoundDatabaseRowsWithValuesHandler extends BaseToolHandler<
  {
    av_id: string;
    rows: Array<{ block_id: string; values?: Record<string, any> }>;
    block_id?: string;
    view_id?: string;
    group_id?: string;
    previous_id?: string;
    chunk_size?: number;
    validate_options?: boolean;
    ignore_default_fill?: boolean;
  },
  { row_count: number; chunks: number; updated: number; item_ids: Record<string, string> }
> {
  readonly name = 'add_bound_database_rows_with_values';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = `Bind existing documents (or blocks) into a database as rows AND set all their cell values, in one call — the bound-row counterpart of add_database_rows_with_values, which can only create detached rows. Use this when the documents already exist. When they do not, it is cheaper to bulk-create detached rows with add_database_rows_with_values and then convert the whole batch with convert_database_rows_to_documents, which creates a document per row.
A bound row takes its name from the document it binds, so the primary-key field is rejected here: writing it succeeds but only overrides the row's display text, leaving it disagreeing with the document's own title. Rename the document instead.
Row IDs are resolved from SiYuan's own block-to-row mapping rather than assumed from ordering, and are returned as item_ids keyed by block ID. ${CELL_VALUE_DESCRIPTION}`;
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      rows: {
        type: 'array',
        description: 'One entry per block to bind, with the cell values that row should carry.',
        items: {
          type: 'object',
          properties: {
            block_id: { type: 'string', description: 'ID of the existing document/block this row binds to' },
            values: { type: 'object', description: 'Field ID to value, excluding the primary-key field. See the tool description for accepted value forms.' },
          },
          required: ['block_id'],
        },
      },
      block_id: { type: 'string', description: 'The database block embedding this database, from embed_database. Resolves the target view/group.' },
      view_id: { type: 'string', description: 'Explicit target view. Omit to use the view resolved from block_id, then the first view.' },
      group_id: { type: 'string', description: 'Target group ID for kanban views. Omit for table/gallery.' },
      previous_id: { type: 'string', description: 'Insert after this row ID. Omit to append at the end.' },
      chunk_size: { type: 'number', description: 'Rows per request. Defaults to 100.' },
      validate_options: { type: 'boolean', description: 'Reject select/mSelect values that are not already options on the field, instead of letting SiYuan create them silently.' },
      ignore_default_fill: { type: 'boolean', description: 'When true, skip auto-filling default values into filter/group fields' },
    },
    required: ['av_id', 'rows'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ row_count: number; chunks: number; updated: number; item_ids: Record<string, string> }> {
    const rows = args.rows.map((r: any) => ({ blockID: r.block_id, values: r.values }));
    const result = await context.siyuan.av.addBoundRowsWithValues(args.av_id, rows, {
      blockID: args.block_id,
      viewID: args.view_id,
      groupID: args.group_id,
      previousID: args.previous_id,
      chunkSize: args.chunk_size,
      validateOptions: args.validate_options,
      ignoreDefaultFill: args.ignore_default_fill,
    });
    return { row_count: result.rowCount, chunks: result.chunks, updated: result.updated, item_ids: result.itemIDs };
  }
}

/**
 * 游离行批量转为绑定文档的行
 */
export class ConvertDatabaseRowsToDocumentsHandler extends BaseToolHandler<
  {
    av_id: string;
    block_id: string;
    item_ids: string[];
    save_mode?: 'sub_doc' | 'template';
    chunk_size?: number;
    apply_template_defaults?: boolean;
    template_id?: string;
  },
  { converted_item_ids: string[]; block_ids: string[]; skipped_item_ids: string[]; warnings: string[] }
> {
  readonly name = 'convert_database_rows_to_documents';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Turn existing detached rows into document-bound rows: SiYuan creates one real document per row, named from the row\'s primary key, and rebinds the row to it while keeping every cell value the row already had. This is the second half of the cheap bulk-import path — create the whole batch with add_database_rows_with_values (detached, one call, all values), then convert it here (one call) instead of creating and wiring each document separately. Rows that are already bound are skipped and reported in skipped_item_ids rather than counted as converted. Each chunk is one kernel transaction that rolls back its own created documents if it fails.\nThis path does NOT apply the database\'s row-creation template field defaults, with either save_mode — the kernel clones each row\'s existing values and never reads the template, which only ever supplies the save location and body. Rows converted here therefore lack any default the template would have set, silently. Pass apply_template_defaults to write them afterward; without it, a warning says so whenever the database has templates carrying defaults. The documents themselves are created with empty bodies either way.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      av_id: { type: 'string', description: 'Database ID' },
      block_id: { type: 'string', description: 'The database block embedding this database, from embed_database. Required — SiYuan resolves the notebook and save location from it.' },
      item_ids: { type: 'array', items: { type: 'string' }, description: 'Row IDs to convert, from render_database (rows[].id / cards[].id)' },
      save_mode: {
        type: 'string',
        enum: ['sub_doc', 'template'],
        description: '"sub_doc" (default) creates each document as a child of the document holding the database. "template" uses the database\'s default row-creation template (see configure_new_item_templates) for save location and body, falling back to SiYuan\'s default location when that template is not document-target.',
      },
      chunk_size: { type: 'number', description: 'Rows per kernel transaction. Defaults to 50. Only affects transaction size; each chunk is still atomic on its own.' },
      apply_template_defaults: {
        type: 'boolean',
        description: 'Write the row-creation template\'s field defaults onto the converted rows afterward, which the conversion itself never does. Uses the database\'s default template unless template_id names another.',
      },
      template_id: {
        type: 'string',
        description: 'Which template\'s defaults to apply, when apply_template_defaults is set and the database has more than one and no default.',
      },
    },
    required: ['av_id', 'block_id', 'item_ids'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ converted_item_ids: string[]; block_ids: string[]; skipped_item_ids: string[]; warnings: string[] }> {
    const result = await context.siyuan.av.createItemDocs(args.av_id, args.block_id, args.item_ids, {
      saveMode: args.save_mode === 'template' ? 'template' : 'subDoc',
      chunkSize: args.chunk_size,
      applyTemplateDefaults: args.apply_template_defaults,
      templateID: args.template_id,
    });
    return {
      converted_item_ids: result.itemIDs,
      block_ids: result.blockIDs,
      skipped_item_ids: result.skippedItemIDs ?? [],
      warnings: result.warnings ?? [],
    };
  }
}
