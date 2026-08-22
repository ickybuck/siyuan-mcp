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

/**
 * 将友好值规范化为思源的 Value 结构。
 *
 * 思源的单元格值要求写成内部结构（如 `{number:{content:42,isNotEmpty:true}}`），
 * 直接暴露给调用方既冗长又容易出错——尤其是日期：日期以毫秒时间戳存储、按
 * 实例本地时区渲染，传入 UTC 零点会显示成前一天。
 *
 * 这里接受直观的值（字符串、数字、布尔、数组），按字段类型转换。已经是完整
 * Value 结构的输入会原样透传，作为逃生出口。
 *
 * @param keyType 字段类型
 * @param value 友好值，或已构造好的 Value 对象
 */
export function normalizeValue(keyType: AvKeyType | 'block', value: any): any {
  // 已经是 Value 结构（包含该类型对应的键）时原样透传
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const verboseKeys = [
      'block', 'text', 'number', 'date', 'mSelect', 'url', 'email',
      'phone', 'mAsset', 'checkbox', 'template', 'relation', 'rollup',
    ];
    if (verboseKeys.some((k) => k in value)) {
      return value;
    }
  }

  const isEmpty = value === null || value === undefined || value === '';

  switch (keyType) {
    case 'block':
      return { block: { content: String(value ?? '') } };

    case 'text':
    case 'template':
      return { [keyType === 'template' ? 'template' : 'text']: { content: String(value ?? '') } };

    case 'number':
      if (isEmpty) return { number: { isNotEmpty: false } };
      return { number: { content: Number(value), isNotEmpty: true } };

    case 'date':
      if (isEmpty) return { date: { isNotEmpty: false } };
      return { date: { content: toEpochMillis(value), isNotEmpty: true } };

    case 'select':
      if (isEmpty) return { mSelect: [] };
      return { mSelect: [toSelectOption(value)] };

    case 'mSelect':
      if (isEmpty) return { mSelect: [] };
      return { mSelect: (Array.isArray(value) ? value : [value]).map(toSelectOption) };

    case 'url':
    case 'email':
    case 'phone':
      return { [keyType]: { content: String(value ?? '') } };

    case 'checkbox':
      return { checkbox: { checked: Boolean(value) } };

    case 'mAsset':
      if (isEmpty) return { mAsset: [] };
      return {
        mAsset: (Array.isArray(value) ? value : [value]).map((a: any) =>
          typeof a === 'string' ? { type: 'file', name: '', content: a } : a
        ),
      };

    default:
      // created/updated/lineNumber 由思源自行计算；relation/rollup 需要额外配置
      return value;
  }
}

/** 选项值可以是字符串，也可以是 {content,color} */
function toSelectOption(v: any): { content: string; color: string } {
  if (v !== null && typeof v === 'object' && 'content' in v) {
    return { content: String(v.content), color: String(v.color ?? '1') };
  }
  return { content: String(v), color: '1' };
}

/**
 * 将日期转换为毫秒时间戳。
 *
 * 关键点：纯日期字符串（YYYY-MM-DD）按**本地时区**解析为当天零点，而不是 UTC 零点。
 * 思源按实例本地时区渲染日期，若按 UTC 解析，在 UTC 以西的时区会显示成前一天。
 * 因此容器的 TZ 必须与用户所在时区一致。
 */
function toEpochMillis(value: any): number {
  if (typeof value === 'number') return value;

  const s = String(value).trim();

  // 纯日期：按本地时区构造当天零点
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
  }

  // 不带时区标识的日期时间：同样按本地时区解析（JS 默认行为）
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid date value: ${JSON.stringify(value)}. Use YYYY-MM-DD, an ISO datetime, or a millisecond timestamp.`
    );
  }
  return parsed.getTime();
}

export class SiyuanAvApi {
  constructor(private client: SiyuanClient) {}

  /**
   * 获取字段 ID 到字段类型的映射，用于值规范化
   */
  async getKeyTypes(avID: string): Promise<Map<string, AvKeyType | 'block'>> {
    const av = await this.getAttributeView(avID);
    const map = new Map<string, AvKeyType | 'block'>();
    for (const kv of av.keyValues || []) {
      if (kv?.key?.id) map.set(kv.key.id, kv.key.type);
    }
    return map;
  }

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
    // 友好值（字符串/数字/布尔/数组）会按字段类型规范化；完整 Value 结构原样透传
    const keyTypes = await this.getKeyTypes(avID);
    const keyType = keyTypes.get(keyID);
    if (!keyType) {
      throw new Error(
        `Unknown field ID "${keyID}". Values written to unknown fields are silently discarded; check the schema with get_database.`
      );
    }
    const normalized = normalizeValue(keyType, value);

    const response = await this.client.request('/api/av/setAttributeViewBlockAttr', {
      avID,
      keyID,
      itemID,
      value: normalized,
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
   * 批量追加游离行并同时写入各单元格的值（一次请求完成建行 + 填值）
   *
   * 这是批量导入的主力接口：相比 addAttributeViewBlocks + render + 逐格
   * setAttributeViewBlockAttr，可把 N 行 × M 列从 1 + 1 + N*M 次请求压缩为 1 次。
   *
   * @param avID 数据库 ID
   * @param rows 每行一个 {keyID: 友好值} 映射；值会按字段类型自动规范化
   * @param options chunkSize 分块大小（默认 100），过大可能导致内核不稳定
   * @returns 实际写入的行数与分块数
   */
  async appendDetachedRowsWithValues(
    avID: string,
    rows: Array<Record<string, any>>,
    options: { chunkSize?: number; keyTypes?: Map<string, AvKeyType | 'block'> } = {}
  ): Promise<{ rowCount: number; chunks: number }> {
    if (!rows.length) return { rowCount: 0, chunks: 0 };

    const keyTypes = options.keyTypes ?? (await this.getKeyTypes(avID));
    const chunkSize = Math.max(1, options.chunkSize ?? 100);

    // 未知字段 ID 会被内核静默忽略，值就此丢失且没有任何提示——提前报错
    for (const row of rows) {
      for (const keyID of Object.keys(row)) {
        if (!keyTypes.has(keyID)) {
          throw new Error(
            `Unknown field ID "${keyID}". Values for unknown fields are silently discarded by SiYuan; check the database schema with get_database.`
          );
        }
      }
    }

    const blocksValues = rows.map((row) =>
      Object.entries(row).map(([keyID, value]) => ({
        keyID,
        ...normalizeValue(keyTypes.get(keyID)!, value),
      }))
    );

    let chunks = 0;
    for (let i = 0; i < blocksValues.length; i += chunkSize) {
      const slice = blocksValues.slice(i, i + chunkSize);
      const response = await this.client.request(
        '/api/av/appendAttributeViewDetachedBlocksWithValues',
        { avID, blocksValues: slice }
      );

      if (response.code !== 0) {
        throw new Error(
          `Failed to append rows (chunk ${chunks + 1}, rows ${i + 1}-${i + slice.length}): ${response.msg}`
        );
      }
      chunks++;
    }

    return { rowCount: rows.length, chunks };
  }

  /**
   * 批量设置已有行的单元格值
   *
   * @param avID 数据库 ID
   * @param updates 每项 {itemID, keyID, value}；value 会按字段类型自动规范化
   */
  async batchSetCells(
    avID: string,
    updates: Array<{ itemID: string; keyID: string; value: any }>,
    options: { chunkSize?: number } = {}
  ): Promise<{ updated: number; chunks: number }> {
    if (!updates.length) return { updated: 0, chunks: 0 };

    const keyTypes = await this.getKeyTypes(avID);
    const chunkSize = Math.max(1, options.chunkSize ?? 100);

    for (const u of updates) {
      if (!keyTypes.has(u.keyID)) {
        throw new Error(`Unknown field ID "${u.keyID}" in batch update.`);
      }
    }

    let chunks = 0;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const slice = updates.slice(i, i + chunkSize).map((u) => ({
        avID,
        keyID: u.keyID,
        rowID: u.itemID,
        value: { keyID: u.keyID, ...normalizeValue(keyTypes.get(u.keyID)!, u.value) },
      }));

      const response = await this.client.request('/api/av/batchSetAttributeViewBlockAttrs', {
        avID,
        values: slice,
      });

      if (response.code !== 0) {
        throw new Error(`Failed to batch set cells (chunk ${chunks + 1}): ${response.msg}`);
      }
      chunks++;
    }

    return { updated: updates.length, chunks };
  }

  /**
   * 批量添加字段。内核没有对应的批量端点，这里内部循环，仍可减少往返次数。
   * @returns 字段名到新字段 ID 的映射
   */
  async addFields(
    avID: string,
    fields: Array<{ name: string; type: AvKeyType; icon?: string }>
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    let previousKeyID = '';
    for (const f of fields) {
      const keyID = await this.addAttributeViewKey(avID, f.name, f.type, {
        keyIcon: f.icon,
        previousKeyID,
      });
      result[f.name] = keyID;
      previousKeyID = keyID;
    }
    return result;
  }

  /**
   * 创建数据库并一次性建好字段结构
   *
   * 新建的数据库自带一个主键列和一个默认的 Select 列；后者是 createIfNotExist
   * 的产物而非调用方想要的，这里默认清理掉。
   *
   * @returns 数据库 ID 与字段名到字段 ID 的映射
   */
  async createDatabaseWithSchema(
    fields: Array<{ name: string; type: AvKeyType; icon?: string }> = [],
    options: { keepDefaultSelect?: boolean } = {}
  ): Promise<{ avID: string; fields: Record<string, string>; primaryKeyID: string }> {
    const { avID } = await this.createDatabase();

    const before = await this.getAttributeView(avID);
    const primaryKey = (before.keyValues || []).find((kv: any) => kv?.key?.type === 'block');
    const defaultSelect = (before.keyValues || []).find((kv: any) => kv?.key?.type === 'select');

    const created = await this.addFields(avID, fields);

    if (defaultSelect && !options.keepDefaultSelect) {
      await this.removeAttributeViewKey(avID, defaultSelect.key.id, false);
    }

    return { avID, fields: created, primaryKeyID: primaryKey?.key?.id ?? '' };
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
