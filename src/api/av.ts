/**
 * 思源笔记数据库（属性视图 / attribute view）相关 API
 */

import type { SiyuanClient } from './client.js';

/** 生成符合思源节点 ID 规则的 ID：14 位时间戳 + '-' + 7 位随机小写字母数字 */
function newNodeId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 7; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${ts}-${suffix}`;
}

export type AvLayoutType = 'table' | 'gallery' | 'kanban';

export type AvKeyType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'mSelect'
  | 'url'
  | 'email'
  | 'phone'
  | 'mAsset'
  | 'template'
  | 'created'
  | 'updated'
  | 'checkbox'
  | 'relation'
  | 'rollup'
  | 'lineNumber';

export interface AvGroup {
  field: string;
  method: number;
  order?: number;
  range?: { numStart: number; numEnd: number; numStep: number };
  hideEmpty?: boolean;
}

export interface AvFilter {
  column?: string;
  operator?: string;
  value?: any;
  relativeDate?: { count: number; unit: number; direction: number };
  combination?: 'and' | 'or';
  filters?: AvFilter[];
}

export interface AvSort {
  column: string;
  order: 'ASC' | 'DESC';
}

export interface AvBlockSrc {
  id?: string;
  isDetached: boolean;
  content?: string;
  itemID?: string;
}

export class SiyuanAvApi {
  constructor(private client: SiyuanClient) {}

  /**
   * 创建一个游离（未嵌入文档）数据库。新数据库总是 table 布局——
   * renderAttributeView 的 createIfNotExist 不支持指定布局；
   * 需要 gallery/kanban 时先 embedDatabase 嵌入文档，再用 changeAttrViewLayout 切换
   * （该操作要求 blockID，游离数据库无法直接切换布局）
   * @returns 新数据库的 ID 及渲染结果
   */
  async createDatabase(): Promise<{ avID: string; data: any }> {
    const avID = newNodeId();
    const data = await this.renderAttributeView(avID, {
      viewID: '',
      createIfNotExist: true,
    });
    return { avID, data };
  }

  /**
   * 将已有数据库嵌入到文档中（插入一个 NodeAttributeView 块）
   * @param avID 要嵌入的数据库 ID
   * @param anchor 插入位置：parentID/previousID/nextID 三选一
   * @param layout 数据库块声明的布局类型（应与数据库当前视图类型一致）
   * @returns 新插入的数据库块 ID
   */
  async embedDatabase(
    avID: string,
    anchor: { parentID?: string; previousID?: string; nextID?: string },
    layout: AvLayoutType = 'table'
  ): Promise<string> {
    const blockID = newNodeId();
    const dom = `<div class="av" data-node-id="${blockID}" data-av-id="${avID}" data-type="NodeAttributeView" data-av-type="${layout}"></div>`;

    const response = await this.client.request<Array<{ doOperations: Array<{ id: string }> }>>(
      '/api/block/insertBlock',
      {
        dataType: 'dom',
        data: dom,
        nextID: anchor.nextID,
        previousID: anchor.previousID,
        parentID: anchor.parentID,
      }
    );

    if (response.code !== 0) {
      throw new Error(`Failed to embed database: ${response.msg}`);
    }

    return response.data[0].doOperations[0].id;
  }

  /**
   * 渲染数据库视图（分页读取字段与行）
   */
  async renderAttributeView(
    id: string,
    options: {
      blockID?: string;
      viewID?: string;
      page?: number;
      pageSize?: number;
      query?: string;
      groupPaging?: any;
      targetItemID?: string;
      targetGroupID?: string;
      createIfNotExist?: boolean;
      persistView?: boolean;
    } = {}
  ): Promise<any> {
    const response = await this.client.request('/api/av/renderAttributeView', {
      id,
      ...options,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to render database: ${response.msg}`);
    }

    return response.data;
  }

  /**
   * 获取数据库完整定义（字段、视图原始布局配置），不含渲染后的行
   */
  async getAttributeView(id: string): Promise<any> {
    const response = await this.client.request('/api/av/getAttributeView', { id });

    if (response.code !== 0) {
      throw new Error(`Failed to get database: ${response.msg}`);
    }

    return response.data.av;
  }

  /**
   * 获取数据库主键（行）值列表，支持关键字过滤与分页
   */
  async getAttributeViewPrimaryKeyValues(
    id: string,
    keyword = '',
    page = 1,
    pageSize = 16
  ): Promise<any> {
    const response = await this.client.request('/api/av/getAttributeViewPrimaryKeyValues', {
      id,
      keyword,
      page,
      pageSize,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get primary key values: ${response.msg}`);
    }

    return response.data;
  }

  /**
   * 按名称搜索数据库
   */
  async searchAttributeView(
    keyword: string,
    excludes: string[] = [],
    includeViewMatches = false
  ): Promise<any> {
    const response = await this.client.request('/api/av/searchAttributeView', {
      keyword,
      excludes,
      includeViewMatches,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to search databases: ${response.msg}`);
    }

    return response.data;
  }

  /**
   * 设置单个单元格的值
   * @param avID 数据库 ID
   * @param keyID 字段（列）ID
   * @param itemID 行 ID（Render 结果中的 rows[].id / cards[].id）
   * @param value 部分 Value 对象，形状取决于字段类型
   */
  async setAttributeViewBlockAttr(
    avID: string,
    keyID: string,
    itemID: string,
    value: any
  ): Promise<any> {
    const response = await this.client.request('/api/av/setAttributeViewBlockAttr', {
      avID,
      keyID,
      itemID,
      value,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to set cell value: ${response.msg}`);
    }

    return response.data.value;
  }

  /**
   * 添加一行或多行
   */
  async addAttributeViewBlocks(
    avID: string,
    srcs: AvBlockSrc[],
    options: {
      blockID?: string;
      viewID?: string;
      groupID?: string;
      previousID?: string;
      ignoreDefaultFill?: boolean;
    } = {}
  ): Promise<void> {
    const response = await this.client.request('/api/av/addAttributeViewBlocks', {
      avID,
      blockID: options.blockID ?? '',
      viewID: options.viewID ?? '',
      groupID: options.groupID ?? '',
      previousID: options.previousID ?? '',
      srcs,
      ignoreDefaultFill: options.ignoreDefaultFill ?? false,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to add rows: ${response.msg}`);
    }
  }

  /**
   * 删除一行或多行（游离行会被删除，绑定块只会被解绑，不会删除原文档块）
   */
  async removeAttributeViewBlocks(avID: string, srcIDs: string[]): Promise<void> {
    const response = await this.client.request('/api/av/removeAttributeViewBlocks', {
      avID,
      srcIDs,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to remove rows: ${response.msg}`);
    }
  }

  /**
   * 切换视图布局（table / gallery / kanban）
   * @returns 切换后的渲染结果（同 renderAttributeView）
   */
  async changeAttrViewLayout(avID: string, blockID: string, layoutType: AvLayoutType): Promise<any> {
    if (!blockID) {
      throw new Error('blockID is required: layout changes silently no-op on a detached database');
    }
    const response = await this.client.request('/api/av/changeAttrViewLayout', {
      avID,
      blockID,
      layoutType,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to change layout: ${response.msg}`);
    }

    return response.data;
  }

  /**
   * 设置（或清除）看板分组规则
   * @returns 切换后的渲染结果（同 renderAttributeView）
   */
  async setAttrViewGroup(avID: string, blockID: string, group: AvGroup): Promise<any> {
    if (!blockID) {
      throw new Error('blockID is required: grouping silently no-ops on a detached database');
    }
    const response = await this.client.request('/api/av/setAttrViewGroup', {
      avID,
      blockID,
      group,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to set group: ${response.msg}`);
    }

    return response.data;
  }

  /**
   * 获取当前筛选与排序规则
   */
  async getAttributeViewFilterSort(id: string, blockID: string): Promise<{ filters: AvFilter[]; sorts: AvSort[] }> {
    const response = await this.client.request<{ filters: AvFilter[]; sorts: AvSort[] }>(
      '/api/av/getAttributeViewFilterSort',
      { id, blockID }
    );

    if (response.code !== 0) {
      throw new Error(`Failed to get filter/sort: ${response.msg}`);
    }

    return response.data;
  }

  /**
   * 设置筛选规则（整体替换）。传入空数组清除所有筛选
   *
   * 注意：仅当数据库已嵌入文档（即拥有有效的 blockID）时才会生效；
   * 对游离数据库调用会静默返回 HTTP 200 但不产生任何效果。
   */
  async setAttrViewFilters(avID: string, blockID: string, filters: AvFilter[]): Promise<void> {
    if (!blockID) {
      throw new Error('blockID is required: filters silently no-op on a detached database');
    }
    const response = await this.client.request('/api/av/setAttrViewFilters', {
      avID,
      blockID,
      data: filters,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to set filters: ${response.msg}`);
    }
  }

  /**
   * 设置排序规则（整体替换）。传入空数组清除所有排序
   *
   * 注意：仅当数据库已嵌入文档（即拥有有效的 blockID）时才会生效；
   * 对游离数据库调用会静默返回 HTTP 200 但不产生任何效果。
   */
  async setAttrViewSorts(avID: string, blockID: string, sorts: AvSort[]): Promise<void> {
    if (!blockID) {
      throw new Error('blockID is required: sorts silently no-op on a detached database');
    }
    const response = await this.client.request('/api/av/setAttrViewSorts', {
      avID,
      blockID,
      data: sorts,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to set sorts: ${response.msg}`);
    }
  }

  /**
   * 添加字段（列）
   * @param avID 数据库 ID
   * @param keyName 字段名
   * @param keyType 字段类型
   * @param options keyIcon（图标）、previousKeyID（插入到该字段之后）
   * @returns 新字段的 ID
   */
  async addAttributeViewKey(
    avID: string,
    keyName: string,
    keyType: AvKeyType,
    options: { keyIcon?: string; previousKeyID?: string } = {}
  ): Promise<string> {
    const keyID = newNodeId();
    const response = await this.client.request('/api/av/addAttributeViewKey', {
      avID,
      keyID,
      keyName,
      keyType,
      keyIcon: options.keyIcon ?? '',
      previousKeyID: options.previousKeyID ?? '',
    });

    if (response.code !== 0) {
      throw new Error(`Failed to add field: ${response.msg}`);
    }

    return keyID;
  }

  /**
   * 删除字段（列）及其所有值
   */
  async removeAttributeViewKey(avID: string, keyID: string, removeRelationDest = false): Promise<void> {
    const response = await this.client.request('/api/av/removeAttributeViewKey', {
      avID,
      keyID,
      removeRelationDest,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to remove field: ${response.msg}`);
    }
  }

  /**
   * 全局调整字段顺序（影响所有视图）
   */
  async sortAttributeViewKey(avID: string, keyID: string, previousKeyID = ''): Promise<void> {
    const response = await this.client.request('/api/av/sortAttributeViewKey', {
      avID,
      keyID,
      previousKeyID,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to sort field: ${response.msg}`);
    }
  }

  /**
   * 在单个视图内调整字段顺序（不影响全局字段顺序）
   */
  async sortAttributeViewViewKey(
    avID: string,
    viewID: string,
    keyID: string,
    previousKeyID = ''
  ): Promise<void> {
    const response = await this.client.request('/api/av/sortAttributeViewViewKey', {
      avID,
      viewID,
      keyID,
      previousKeyID,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to sort view field: ${response.msg}`);
    }
  }
}
