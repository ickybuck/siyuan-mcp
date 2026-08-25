/**
 * 块相关工具处理器
 */

import { BaseToolHandler } from './base.js';
import type { ExecutionContext, JSONSchema } from '../core/types.js';

/**
 * 获取块的 Kramdown 内容（含 IAL 属性）
 */
export class GetBlockKramdownHandler extends BaseToolHandler<{ block_id: string }, string> {
  readonly name = 'get_block_kramdown';
  readonly annotations = { readOnlyHint: true } as const;
  readonly description = 'Get the raw Kramdown content of a single block in SiYuan, including its IAL attributes. Use this when you need the exact source (not just rendered markdown) of one block, e.g. before an update_block call.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The block ID',
      },
    },
    required: ['block_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<string> {
    return await context.siyuan.block.getBlockKramdown(args.block_id);
  }
}

/**
 * 更新块内容（覆盖模式）
 */
export class UpdateBlockHandler extends BaseToolHandler<
  { block_id: string; content: string },
  { success: boolean; block_id: string }
> {
  readonly name = 'update_block';
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
  readonly description = 'Replace the content of a single block in SiYuan with new markdown content, in place. Unlike update_document, this edits only the target block and leaves the rest of the note untouched — use it for single-paragraph edits in large notes.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The block ID to update',
      },
      content: {
        type: 'string',
        description: 'New markdown content that will replace the block content',
      },
    },
    required: ['block_id', 'content'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; block_id: string }> {
    await context.siyuan.block.updateBlock(args.block_id, args.content);
    return { success: true, block_id: args.block_id };
  }
}

/**
 * 在父块下追加子块
 */
export class AppendBlockHandler extends BaseToolHandler<
  { parent_id: string; content: string },
  string
> {
  readonly name = 'append_block';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Append a new block with markdown content as the last child of a parent block in SiYuan. Returns the new block ID.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      parent_id: {
        type: 'string',
        description: 'The parent block ID (or document ID) to append the new block under',
      },
      content: {
        type: 'string',
        description: 'Markdown content for the new block',
      },
    },
    required: ['parent_id', 'content'],
  };

  async execute(args: any, context: ExecutionContext): Promise<string> {
    return await context.siyuan.block.appendBlock(args.parent_id, args.content);
  }
}

/**
 * 在指定块之前插入块
 */
export class InsertBlockBeforeHandler extends BaseToolHandler<
  { block_id: string; content: string },
  string
> {
  readonly name = 'insert_block_before';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Insert a new block with markdown content immediately before a reference block in SiYuan. Returns the new block ID.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The reference block ID; the new block is inserted directly before it',
      },
      content: {
        type: 'string',
        description: 'Markdown content for the new block',
      },
    },
    required: ['block_id', 'content'],
  };

  async execute(args: any, context: ExecutionContext): Promise<string> {
    return await context.siyuan.block.insertBlockBefore(args.block_id, args.content);
  }
}

/**
 * 在指定块之后插入块
 */
export class InsertBlockAfterHandler extends BaseToolHandler<
  { block_id: string; content: string },
  string
> {
  readonly name = 'insert_block_after';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Insert a new block with markdown content immediately after a reference block in SiYuan. Returns the new block ID.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The reference block ID; the new block is inserted directly after it',
      },
      content: {
        type: 'string',
        description: 'Markdown content for the new block',
      },
    },
    required: ['block_id', 'content'],
  };

  async execute(args: any, context: ExecutionContext): Promise<string> {
    return await context.siyuan.block.insertBlockAfter(args.block_id, args.content);
  }
}

/**
 * 删除块
 */
export class DeleteBlockHandler extends BaseToolHandler<
  { block_id: string },
  { success: boolean; block_id: string }
> {
  readonly name = 'delete_block';
  readonly annotations = { readOnlyHint: false, destructiveHint: true } as const;
  readonly description = 'Delete a single block from SiYuan by ID.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The block ID to delete',
      },
    },
    required: ['block_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; block_id: string }> {
    await context.siyuan.block.deleteBlock(args.block_id);
    return { success: true, block_id: args.block_id };
  }
}

/**
 * 移动块
 */
export class MoveBlockHandler extends BaseToolHandler<
  { block_id: string; previous_id?: string; parent_id?: string },
  { success: boolean; block_id: string }
> {
  readonly name = 'move_block';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Move an existing block to a new position in SiYuan. Provide previous_id to place it directly after that block, and/or parent_id to reparent it; at least one must be given.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The block ID to move',
      },
      previous_id: {
        type: 'string',
        description: 'Target position: the block to place block_id directly after (optional)',
      },
      parent_id: {
        type: 'string',
        description: 'Target parent block ID to move block_id under (optional)',
      },
    },
    required: ['block_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; block_id: string }> {
    if (!args.previous_id && !args.parent_id) {
      throw new Error('Must provide at least one of: previous_id or parent_id');
    }
    await context.siyuan.block.moveBlock(args.block_id, args.previous_id, args.parent_id);
    return { success: true, block_id: args.block_id };
  }
}

/**
 * 获取块的直接子块列表
 */
export class GetChildBlocksHandler extends BaseToolHandler<
  { block_id: string },
  Array<{ id: string; type: string; subType?: string }>
> {
  readonly name = 'get_child_blocks';
  readonly annotations = { readOnlyHint: true } as const;
  readonly description = 'List the direct child blocks of a block or document in SiYuan (id, type, subType). Use this to find block IDs to target with update_block, insert_block_before/after, move_block, etc.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The parent block ID (or document ID)',
      },
    },
    required: ['block_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<Array<{ id: string; type: string; subType?: string }>> {
    return await context.siyuan.block.getChildBlocks(args.block_id);
  }
}

/**
 * 在父块下前置子块（插入为第一个子块）
 */
export class PrependBlockHandler extends BaseToolHandler<
  { parent_id: string; content: string },
  string
> {
  readonly name = 'prepend_block';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Insert a new block with markdown content as the first child of a parent block in SiYuan. Returns the new block ID.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      parent_id: {
        type: 'string',
        description: 'The parent block ID (or document ID) to prepend the new block under',
      },
      content: {
        type: 'string',
        description: 'Markdown content for the new block',
      },
    },
    required: ['parent_id', 'content'],
  };

  async execute(args: any, context: ExecutionContext): Promise<string> {
    return await context.siyuan.block.prependBlock(args.parent_id, args.content);
  }
}

/**
 * 折叠块
 */
export class FoldBlockHandler extends BaseToolHandler<
  { block_id: string },
  { success: boolean; block_id: string }
> {
  readonly name = 'fold_block';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Collapse (fold) a block in SiYuan so its children are hidden in the outliner UI. Content is unaffected — this only changes the UI-visible fold state.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The block ID to fold',
      },
    },
    required: ['block_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; block_id: string }> {
    await context.siyuan.block.foldBlock(args.block_id);
    return { success: true, block_id: args.block_id };
  }
}

/**
 * 展开块
 */
export class UnfoldBlockHandler extends BaseToolHandler<
  { block_id: string },
  { success: boolean; block_id: string }
> {
  readonly name = 'unfold_block';
  readonly annotations = { readOnlyHint: false, destructiveHint: false } as const;
  readonly description = 'Expand (unfold) a previously folded block in SiYuan so its children are visible again in the outliner UI.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The block ID to unfold',
      },
    },
    required: ['block_id'],
  };

  async execute(args: any, context: ExecutionContext): Promise<{ success: boolean; block_id: string }> {
    await context.siyuan.block.unfoldBlock(args.block_id);
    return { success: true, block_id: args.block_id };
  }
}
