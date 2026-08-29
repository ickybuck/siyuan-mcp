/**
 * 思源笔记块操作相关 API
 */

import type { SiyuanClient } from './client.js';

/**
 * 数一段 Markdown 会解析成几个顶层块。
 *
 * 判据是"围栏之外的空行"，因为这正是 Markdown 分块的地方。围栏内部的空行不算，
 * 否则一段带空行的代码块会被误判成多块。这个判断偏保守：条目之间带空行的松散列表
 * 实际上仍是一个列表块，但这里会算成多块——宁可多报一次让调用方改写，也好过把内容
 * 悄悄丢掉（PF-31）。
 */
export function countTopLevelMarkdownBlocks(markdown: string): number {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  let blocks = 0;
  let inBlock = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inFence) {
        inFence = true;
        if (!inBlock) {
          inBlock = true;
          blocks++;
        }
      } else {
        inFence = false;
      }
      continue;
    }

    if (inFence) continue;

    if (line.trim() === '') {
      inBlock = false;
      continue;
    }

    if (!inBlock) {
      inBlock = true;
      blocks++;
    }
  }

  return blocks;
}

export class SiyuanBlockApi {
  constructor(private client: SiyuanClient) {}

  /**
   * 获取块内容（Kramdown 格式）
   * @param blockId 块 ID
   * @returns 块内容
   */
  async getBlockKramdown(blockId: string): Promise<string> {
    const response = await this.client.request<{ id: string; kramdown: string }>(
      '/api/block/getBlockKramdown',
      { id: blockId }
    );
    return response.data.kramdown;
  }

  /**
   * 获取块的 Markdown 内容
   * @param blockId 块 ID
   * @returns Markdown 内容（纯净内容，不含元信息）
   */
  async getBlockMarkdown(blockId: string): Promise<string> {
    const response = await this.client.request<{ content: string }>(
      '/api/export/exportMdContent',
      { id: blockId }
    );
    return response.data.content;
  }

  /**
   * 更新块内容（覆盖模式）
   *
   * 只能写一个块。传入多块 Markdown 时内核只保留第一块，其余内容既不落到兄弟块也不
   * 落到子块，直接丢弃，而且返回成功——调用方无从察觉（PF-31）。所以这里在写之前
   * 拦下来：写之后再读回已经晚了，原块内容那时已经被覆盖，丢失已经发生。
   *
   * @param blockId 块 ID
   * @param content Markdown 内容
   * @returns 操作结果
   */
  async updateBlock(blockId: string, content: string): Promise<void> {
    const blockCount = countTopLevelMarkdownBlocks(content);
    if (blockCount > 1) {
      throw new Error(
        `update_block writes exactly one block, but this markdown parses as ${blockCount} blocks separated by blank lines. ` +
          `SiYuan would store the first and discard the rest without an error, so this is rejected instead. ` +
          `Use update_document to replace a whole note, append_block to add children, or insert_block_after once per sibling. ` +
          `If this really is one block, remove the blank lines inside it — a list whose items are separated by blank lines will trip this check.`
      );
    }

    const response = await this.client.request('/api/block/updateBlock', {
      id: blockId,
      dataType: 'markdown',
      data: content,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to update block: ${response.msg}`);
    }
  }

  /**
   * 在父块下追加子块
   * @param parentId 父块 ID
   * @param content Markdown 内容
   * @returns 新创建的块 ID
   */
  async appendBlock(parentId: string, content: string): Promise<string> {
    interface BlockOperation {
      doOperations: Array<{ id: string; action: string }>;
    }
    const response = await this.client.request<BlockOperation[]>(
      '/api/block/appendBlock',
      {
        parentID: parentId,
        dataType: 'markdown',
        data: content,
      }
    );

    if (response.code !== 0) {
      throw new Error(`Failed to append block: ${response.msg}`);
    }

    return response.data[0].doOperations[0].id;
  }

  /**
   * 在指定块之前插入块
   *
   * 内核 insertBlock 的锚点是站在新块的角度命名的：previousID 是"新块的前一个块"，
   * 即插到它后面；nextID 是"新块的后一个块"，即插到它前面。这两个方法原先各自传了
   * 与自身名字相反的那一个，于是 before 插到后面、after 插到前面，且不报错——内容
   * 都在，只有顺序是反的，链式插入会整段倒序（PF-31）。
   *
   * @param referenceId 参考块 ID，新块插到它之前
   * @param content Markdown 内容
   * @returns 新创建的块 ID
   */
  async insertBlockBefore(referenceId: string, content: string): Promise<string> {
    interface BlockOperation {
      doOperations: Array<{ id: string; action: string }>;
    }
    const response = await this.client.request<BlockOperation[]>(
      '/api/block/insertBlock',
      {
        nextID: referenceId,
        dataType: 'markdown',
        data: content,
      }
    );

    if (response.code !== 0) {
      throw new Error(`Failed to insert block: ${response.msg}`);
    }

    return response.data[0].doOperations[0].id;
  }

  /**
   * 在指定块之后插入块。锚点语义见 insertBlockBefore 的说明（PF-31）。
   *
   * @param referenceId 参考块 ID，新块插到它之后
   * @param content Markdown 内容
   * @returns 新创建的块 ID
   */
  async insertBlockAfter(referenceId: string, content: string): Promise<string> {
    interface BlockOperation {
      doOperations: Array<{ id: string; action: string }>;
    }
    const response = await this.client.request<BlockOperation[]>(
      '/api/block/insertBlock',
      {
        previousID: referenceId,
        dataType: 'markdown',
        data: content,
      }
    );

    if (response.code !== 0) {
      throw new Error(`Failed to insert block: ${response.msg}`);
    }

    return response.data[0].doOperations[0].id;
  }

  /**
   * 删除块
   * @param blockId 块 ID
   */
  async deleteBlock(blockId: string): Promise<void> {
    const response = await this.client.request('/api/block/deleteBlock', { id: blockId });

    if (response.code !== 0) {
      throw new Error(`Failed to delete block: ${response.msg}`);
    }
  }

  /**
   * 移动块
   * @param blockId 要移动的块 ID
   * @param previousId 目标位置的前一个块 ID（可选）
   * @param parentId 目标父块 ID（可选）
   */
  async moveBlock(blockId: string, previousId?: string, parentId?: string): Promise<void> {
    const response = await this.client.request('/api/block/moveBlock', {
      id: blockId,
      previousID: previousId,
      parentID: parentId,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to move block: ${response.msg}`);
    }
  }

  /**
   * 获取块的直接子块列表
   * @param blockId 父块 ID
   * @returns 子块列表（id、type、subType）
   */
  async getChildBlocks(
    blockId: string
  ): Promise<Array<{ id: string; type: string; subType?: string }>> {
    const response = await this.client.request<
      Array<{ id: string; type: string; subType?: string }>
    >('/api/block/getChildBlocks', { id: blockId });

    if (response.code !== 0) {
      throw new Error(`Failed to get child blocks: ${response.msg}`);
    }

    return response.data;
  }

  /**
   * 在父块下前置子块（插入为第一个子块）
   * @param parentId 父块 ID
   * @param content Markdown 内容
   * @returns 新创建的块 ID
   */
  async prependBlock(parentId: string, content: string): Promise<string> {
    interface BlockOperation {
      doOperations: Array<{ id: string; action: string }>;
    }
    const response = await this.client.request<BlockOperation[]>(
      '/api/block/prependBlock',
      {
        parentID: parentId,
        dataType: 'markdown',
        data: content,
      }
    );

    if (response.code !== 0) {
      throw new Error(`Failed to prepend block: ${response.msg}`);
    }

    return response.data[0].doOperations[0].id;
  }

  /**
   * 折叠块
   * @param blockId 块 ID
   */
  async foldBlock(blockId: string): Promise<void> {
    const response = await this.client.request('/api/block/foldBlock', { id: blockId });

    if (response.code !== 0) {
      throw new Error(`Failed to fold block: ${response.msg}`);
    }
  }

  /**
   * 展开块
   * @param blockId 块 ID
   */
  async unfoldBlock(blockId: string): Promise<void> {
    const response = await this.client.request('/api/block/unfoldBlock', { id: blockId });

    if (response.code !== 0) {
      throw new Error(`Failed to unfold block: ${response.msg}`);
    }
  }
}
