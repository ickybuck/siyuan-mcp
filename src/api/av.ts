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

/** 行对象中用于指定行 ID 的保留键。字段 ID 一律符合节点 ID 格式，不会与之冲突 */
export const ITEM_ID_KEY = 'item_id';

/**
 * 内核对数据库名称搜索结果的硬上限，写死在 sortAndLimitAttributeViewSearchResults
 * 里，不可配置也不分页。这里只用来判断"是不是刚好顶到上限"，以便把截断报出来。
 */
const KERNEL_AV_SEARCH_LIMIT = 12;

/**
 * 行创建模板能预设默认值的字段类型，对应内核的 isNewItemTemplateEditableKeyType
 * （kernel/av/new_item_template.go）。其余类型内核会直接拒绝整批模板。
 */
const NEW_ITEM_TEMPLATE_EDITABLE_KEY_TYPES = new Set<string>([
  'text', 'number', 'date', 'select', 'mSelect', 'url', 'email', 'phone', 'mAsset', 'checkbox', 'relation',
]);

/** 思源节点 ID 格式：14 位数字 + '-' + 7 位小写字母数字 */
const NODE_ID_PATTERN = /^[0-9]{14}-[a-z0-9]{7}$/;

/**
 * 由稳定的业务键派生出确定性的行 ID，使批量导入可重试、可续传。
 *
 * 相同的 avID + key 始终得到相同的 ID；重复提交不会产生重复行。
 *
 * @param avID 数据库 ID，用于隔离不同数据库的同名键
 * @param key 源数据中的稳定标识（如 Notion 页面 ID、日期、行号）
 */
export function deriveItemId(avID: string, key: string): string {
  // FNV-1a：无需依赖，分布足够均匀
  let h1 = 0x811c9dc5;
  for (let i = 0; i < (avID + '\0' + key).length; i++) {
    h1 ^= (avID + '\0' + key).charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  let h2 = 0x811c9dc5 ^ h1;
  for (let i = key.length - 1; i >= 0; i--) {
    h2 ^= key.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }

  const digits = String(h1).padStart(10, '0').slice(0, 10);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  let n = h2;
  for (let i = 0; i < 7; i++) {
    suffix += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length) + 7;
  }
  // 前 4 位固定为 2000，保证 14 位整体仍是合法的数字串且不会与真实时间戳混淆
  return `2000${digits}-${suffix}`;
}

/** 汇总字段可用的计算方式（内核 av.CalcOperator） */
export const AV_CALC_OPERATORS = [
  'Count all', 'Count values', 'Count unique values', 'Count empty', 'Count not empty',
  'Percent empty', 'Percent not empty', 'Percent unique values', 'Unique values',
  'Sum', 'Average', 'Median', 'Min', 'Max', 'Range',
  'Earliest', 'Latest', 'Checked', 'Unchecked', 'Percent checked', 'Percent unchecked',
] as const;

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

/** createAttributeViewItemDocs 的结果：转换成功的行、新建的文档、跳过的行与告警 */
export interface CreateItemDocsResult {
  itemIDs: string[];
  blockIDs: string[];
  skippedItemIDs?: string[];
  warnings?: string[];
}

export type NewItemTargetType = 'detached' | 'document';
export type NewItemFieldValueMode = 'static' | 'currentTime';

export interface NewItemFieldValueInput {
  /** 'currentTime' only applies to date fields and ignores `value`. Defaults to 'static'. */
  mode?: NewItemFieldValueMode;
  /** Friendly value (same forms as a normal cell write); required when mode is 'static'. */
  value?: any;
}

export interface NewItemTemplateInput {
  /** Omit to generate a new template; pass an existing template's id to update it in place. */
  id?: string;
  name: string;
  icon?: string;
  targetType: NewItemTargetType;
  /** Kramdown template string for the primary-key text, e.g. "Untitled ${now}". Detached rows only need this if a non-blank default title is wanted. */
  primaryKeyTemplate?: string;
  /** Default values applied to new rows created from this template. Select/mSelect values must already exist as options on the field — this does not create them implicitly. */
  fieldValues?: Record<string, NewItemFieldValueInput>;
  /** Document-target only: where the new bound document is saved. Omit to inherit the global default location. */
  saveLocation?: { boxID?: string; pathTemplate: string };
  /** Document-target only: path to the document used as the content template for the new row's body. */
  contentTemplatePath?: string;
  /** Document-target only: hide the created document from the file tree. */
  hideInFileTree?: boolean;
}

export interface NewItemFromTemplateResult {
  itemID: string;
  blockID: string;
  content: string;
  isDetached: boolean;
  warnings?: string[];
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

    case 'date': {
      if (isEmpty) return { date: { isNotEmpty: false } };
      const { content, isNotTime } = parseDateInput(value);
      return { date: { content, isNotEmpty: true, isNotTime } };
    }

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

    case 'relation':
      // 友好形式：目标行 ID 数组（或单个 ID）
      if (isEmpty) return { relation: { blockIDs: [] } };
      return { relation: { blockIDs: Array.isArray(value) ? value.map(String) : [String(value)] } };

    default:
      // created/updated/lineNumber/rollup 由思源自行计算，不接受直接写入
      return value;
  }
}

/**
 * 选项值可以是字符串，也可以是 {content,color}。
 *
 * 前后空白会被去除——内核对选项名不做任何规范化：`"Done"`、`"done"`、`"Done "` 会
 * 被视为三个不同选项，且互不合并、互不提示。大小写差异无法安全地自动合并（可能是
 * 有意的两个值），但空白没有任何合理用途，属于纯粹的输入噪音，因此在这里去除。
 */
function toSelectOption(v: any): { content: string; color: string } {
  if (v !== null && typeof v === 'object' && 'content' in v) {
    return { content: String(v.content).trim(), color: String(v.color ?? '1') };
  }
  return { content: String(v).trim(), color: '1' };
}

/**
 * 解析日期输入，返回内核所需的毫秒时间戳，以及是否为"仅日期，无时间"。
 *
 * 两个独立的坑：
 * 1. 纯日期字符串（YYYY-MM-DD）必须按**本地时区**解析为当天零点，而不是 UTC 零点。
 *    思源按实例本地时区渲染日期，若按 UTC 解析，在 UTC 以西的时区会显示成前一天。
 *    因此容器的 TZ 必须与用户所在时区一致。
 * 2. `isNotTime` 是单元格值上的独立字段（`ValueDate.IsNotTime`），不是从时间戳本身
 *    推断出来的——只设置 content 而不设置 isNotTime 会导致界面显示多余的 "00:00"。
 *    纯日期字符串 → isNotTime: true；带时间的字符串或调用方直接给出的毫秒数
 *    （可能携带具体时刻）→ isNotTime: false。
 */
function parseDateInput(value: any): { content: number; isNotTime: boolean } {
  if (typeof value === 'number') return { content: value, isNotTime: false };

  const s = String(value).trim();

  // 纯日期：按本地时区构造当天零点，且标记为"无时间"
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return { content: new Date(Number(y), Number(m) - 1, Number(d)).getTime(), isNotTime: true };
  }

  // 带时间的字符串：同样按本地时区解析（JS 默认行为），标记为"有时间"
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid date value: ${JSON.stringify(value)}. Use YYYY-MM-DD, an ISO datetime, or a millisecond timestamp.`
    );
  }
  return { content: parsed.getTime(), isNotTime: false };
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
  async createDatabase(name?: string): Promise<{ avID: string; data: any }> {
    const avID = newNodeId();
    const data = await this.renderAttributeView(avID, {
      viewID: '',
      createIfNotExist: true,
    });
    if (name?.trim()) {
      await this.setAttributeViewName(avID, name);
    }
    return { avID, data };
  }

  /**
   * 给数据库命名（重命名）。
   *
   * 没有 REST 端点，走事务动作 setAttrViewName。注意这个操作的字段名与同类操作不同：
   * avID 放在 id 里，名字放在 data 里（内核 setAttributeViewName 读的是 operation.ID
   * 和 operation.Data），传成 avID/name 不会报错，只是什么也不会发生。
   *
   * 内核会顺带更新所有嵌入该数据库的块的 av-names 属性，所以文档里显示的名字会跟着变，
   * 不需要另外刷新。名字会去掉首尾空白、换行替换为空格，超过 512 个字符会被截断。
   */
  async setAttributeViewName(avID: string, name: string): Promise<void> {
    const wanted = name.trim().replace(/\n/g, ' ');

    await this.performOperation({
      action: 'setAttrViewName',
      id: avID,
      data: wanted,
    });

    await this.confirmApplied(
      `name database ${avID} "${wanted}"`,
      async () => {
        const attributeView = await this.getAttributeView(avID);
        // 内核在 512 个字符处截断，比较时按同样的规则来，否则长名字会被误判为没写进去
        const stored = String(attributeView?.name ?? '');
        return stored === wanted || (wanted.length > 512 && wanted.startsWith(stored) && stored.length > 0);
      },
      'Check that the database ID exists — a name is stored on the database itself, not on the block embedding it.'
    );
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
   * 按名称搜索数据库。
   *
   * 内核对结果数量有一个写死的上限 12（kernel/model/attribute_view.go 的
   * sortAndLimitAttributeViewSearchResults：`if 12 < len(results) { return results[:12] }`），
   * 既没有总数也没有分页参数，返回里也没有任何被截断的迹象。所以"没搜到"不等于
   * "不存在"，而这正是有人拿它来清点数据库时会踩的坑（PF-32）。这里做不到把上限
   * 提高——它在内核里，不可配置——能做的是把截断本身变成可见的：返回条数正好等于
   * 上限时明确标出来，并附上工作区里实际有多少个已嵌入的数据库作为对照。
   *
   * 笔记本过滤（PF-35）只能在返回之后做：数据库自己不属于任何笔记本，是嵌入它的块
   * 属于笔记本。所以先用一条 SQL 把 av 块和它们的 box 查出来，再按此过滤。没有被
   * 嵌入过的数据库因此没有笔记本可言，用了过滤就必然排除它们——这一点单独计数报出来，
   * 不静默丢弃。
   */
  async searchAttributeView(
    keyword: string,
    excludes: string[] = [],
    includeViewMatches = false,
    options: { notebookID?: string } = {}
  ): Promise<{
    results: any[];
    returned: number;
    truncated: boolean;
    embeddedDatabaseCount: number;
    excludedAsUnembedded?: number;
    note?: string;
  }> {
    const response = await this.client.request('/api/av/searchAttributeView', {
      keyword,
      excludes,
      includeViewMatches,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to search databases: ${response.msg}`);
    }

    const data: any = response.data;
    let results: any[] = Array.isArray(data) ? data : data?.results || [];
    const truncated = results.length >= KERNEL_AV_SEARCH_LIMIT;

    // av 块与其所在笔记本的对照表，同时用于笔记本过滤和"工作区里共有多少个已嵌入
    // 数据库"这个对照数字
    const placement = await this.getEmbeddedDatabasePlacement();

    let excludedAsUnembedded: number | undefined;
    if (options.notebookID) {
      const before = results.length;
      results = results.filter((r: any) => {
        const avID = r?.avID || r?.id;
        const boxes = placement.get(avID);
        return !!boxes && boxes.has(options.notebookID!);
      });
      excludedAsUnembedded = before - results.length;
    }

    const notes: string[] = [];
    if (truncated) {
      notes.push(
        `SiYuan caps this search at ${KERNEL_AV_SEARCH_LIMIT} results — a fixed limit in the kernel, with no total and no paging. ` +
          `Exactly ${KERNEL_AV_SEARCH_LIMIT} came back, so there are very likely more matches that are not shown. ` +
          `An absent database is NOT evidence it does not exist. Search a more distinctive term rather than a broad one, ` +
          `and do not use this tool to enumerate or audit databases. The workspace currently holds ${placement.size} embedded database(s) in total.`
      );
    }
    if (options.notebookID && excludedAsUnembedded) {
      notes.push(
        `${excludedAsUnembedded} result(s) were dropped by the notebook filter. A database belongs to a notebook only through the block embedding it, so a database that is not embedded anywhere has no notebook and can never satisfy this filter.`
      );
    }
    if (truncated && options.notebookID && results.length === 0) {
      notes.push(
        `THIS RESULT IS UNINFORMATIVE: the kernel returned its maximum before the notebook filter was applied, and the filter then removed everything. A matching database in that notebook could easily exist and simply not be among the ${KERNEL_AV_SEARCH_LIMIT} the kernel chose to return. Search a more distinctive term before concluding anything.`
      );
    }

    return {
      results,
      returned: results.length,
      truncated,
      embeddedDatabaseCount: placement.size,
      ...(excludedAsUnembedded !== undefined ? { excludedAsUnembedded } : {}),
      ...(notes.length ? { note: notes.join(' ') } : {}),
    };
  }

  /**
   * 每个已嵌入数据库 -> 嵌入它的块所在的笔记本集合。
   *
   * 同一个数据库可以被嵌到多个文档里，所以是集合而不是单值。分页取，理由同
   * getDocumentTree：/api/query/sql 对没有 LIMIT 的语句静默套用 Conf.Search.Limit。
   */
  private async getEmbeddedDatabasePlacement(): Promise<Map<string, Set<string>>> {
    const placement = new Map<string, Set<string>>();
    const pageSize = 512;

    for (let offset = 0; ; offset += pageSize) {
      const response = await this.client.request<any[]>('/api/query/sql', {
        stmt: `SELECT box, markdown FROM blocks WHERE type = 'av' ORDER BY id LIMIT ${pageSize} OFFSET ${offset}`,
      });

      if (response.code !== 0) {
        throw new Error(`Failed to resolve database placement: ${response.msg}`);
      }

      const page = response.data || [];
      for (const row of page) {
        const match = /data-av-id="([^"]+)"/.exec(row.markdown || '');
        if (!match) continue;
        if (!placement.has(match[1])) placement.set(match[1], new Set());
        placement.get(match[1])!.add(row.box);
      }
      if (page.length < pageSize) break;
    }

    return placement;
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
    options: {
      chunkSize?: number;
      keyTypes?: Map<string, AvKeyType | 'block'>;
      validateOptions?: boolean;
    } = {}
  ): Promise<{ rowCount: number; chunks: number }> {
    if (!rows.length) return { rowCount: 0, chunks: 0 };

    const keyTypes = options.keyTypes ?? (await this.getKeyTypes(avID));
    const chunkSize = Math.max(1, options.chunkSize ?? 100);

    // 未知字段 ID 会让内核整块拒绝（key not found），提前报错可省一次往返并给出更明确的信息
    for (const row of rows) {
      for (const keyID of Object.keys(row)) {
        if (keyID === ITEM_ID_KEY) continue;
        if (!keyTypes.has(keyID)) {
          throw new Error(
            `Unknown field ID "${keyID}". SiYuan rejects the entire batch when a field ID does not exist; check the schema with get_database.`
          );
        }
      }
    }

    // 主键（block 类型字段）内容为空（缺失、null 或空字符串）时，这个特定的内核端点
    // （appendAttributeViewDetachedBlocksWithValues）不会创建该行的底层块——不报错，
    // row_count 仍会照报交出去的行数，但实际写入的行数更少，且没有任何信号指出是哪一
    // 行。实测确认哪怕显式传空字符串也一样被丢弃（不是"字段缺失"才触发），而一个纯
    // 空格字符串则可以正常建行。
    // 注意：这是这一个端点的限制，不是内核范围内的通用规则——addAttributeViewBlocks
    // （add_database_rows 用的那个端点）实测对空标题或完全省略标题都能正常建行。所以
    // 真要建一个空标题的行，走 add_database_rows 再用 set_database_cell 补其余字段
    // 值即可；这里没有为 appendDetachedRowsWithValues 本身加旁路开关，是因为在这一个
    // 端点上确实没有安全的办法既保留批量建行+填值合一的效率、又允许空标题，加一个
    // "允许空主键"选项只会制造一个看似生效实则仍在这一路径上静默丢数据的假出口。
    // 这类"报成功但数据没写"的静默失败已经在别处见过（updateAttrViewColumn 空操作、
    // 主键改类型被拒绝），这里同样在调用内核之前本地拦截，而不是依赖响应发现问题。
    const primaryKeyID = [...keyTypes.entries()].find(([, t]) => t === 'block')?.[0];
    if (primaryKeyID) {
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i][primaryKeyID];
        if (v === undefined || v === null || v === '') {
          throw new Error(
            `Row ${i + 1} has no value for the primary-key field "${primaryKeyID}". This specific endpoint ` +
              `(appendAttributeViewDetachedBlocksWithValues) silently creates no row at all when the primary-key ` +
              `content is empty — row_count would report success while the row never exists. Any non-empty string ` +
              `works (even a single space). If a genuinely blank title is needed, use add_database_rows instead ` +
              `(a different kernel endpoint that does accept an empty/omitted title) and set the other field ` +
              `values afterward with set_database_cell — this call cannot safely opt around the check.`
          );
        }
      }
    }

    // select/mSelect 隐式创建选项时不做任何校验：大小写不折叠、空白不去除
    // （已在实测中确认——见 configureSelectOptions 的说明）。validateOptions 打开时，
    // 对照字段当前已有的选项集逐值检查，把"静默产生一个几乎一样的新选项"变成一个
    // 明确的错误。这是预防措施，不是默认行为——很多合法场景本来就是要新建选项。
    if (options.validateOptions) {
      const av = await this.getAttributeView(avID);
      const knownOptions = new Map<string, Set<string>>();
      for (const kv of av.keyValues || []) {
        if (kv?.key?.type === 'select' || kv?.key?.type === 'mSelect') {
          knownOptions.set(kv.key.id, new Set((kv.key.options || []).map((o: any) => o.name)));
        }
      }

      for (let i = 0; i < rows.length; i++) {
        for (const [keyID, value] of Object.entries(rows[i])) {
          if (keyID === ITEM_ID_KEY) continue;
          const allowed = knownOptions.get(keyID);
          if (!allowed) continue;

          const values =
            value === null || value === undefined || value === ''
              ? []
              : Array.isArray(value)
                ? value
                : [value];

          for (const v of values) {
            const name = typeof v === 'string' ? v.trim() : String(v);
            if (!allowed.has(name)) {
              throw new Error(
                `validate_options: "${name}" is not an existing option for field "${keyID}" (row ${i + 1}). ` +
                  `Configure it first with configure_select_options, or omit validate_options to let SiYuan create it automatically.`
              );
            }
          }
        }
      }
    }

    const blocksValues = rows.map((row) => {
      // 显式 item_id 会被内核采纳为行 ID，重复提交同一 ID 不会重复建行——
      // 这是让批量导入可安全重试、可断点续传的唯一手段
      const itemID = row[ITEM_ID_KEY] as string | undefined;
      if (itemID && !NODE_ID_PATTERN.test(itemID)) {
        throw new Error(
          `Invalid item_id "${itemID}". Must match 14 digits, a hyphen, then 7 lowercase alphanumerics (e.g. 20260101120000-abc1234).`
        );
      }
      return Object.entries(row)
        .filter(([k]) => k !== ITEM_ID_KEY)
        .map(([keyID, value]) => ({
          keyID,
          ...(itemID ? { blockID: itemID } : {}),
          ...normalizeValue(keyTypes.get(keyID)!, value),
        }));
    });

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
        // itemID, not rowID — rowID is deprecated (siyuan-note/siyuan#15727) and
        // the kernel rejects it outright as of the version this connector targets.
        itemID: u.itemID,
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
   * 新增字段会被追加在主键之后，导致主键在视图列顺序中排到最后（标题列排在最右侧，
   * 几乎总是错的）。这里在建好字段结构后，把主键重新排到第一位。
   *
   * 注意：字段顺序有两层——sortAttributeViewKey 调整的是全局 keyIDs 顺序，
   * 但实际渲染表格列顺序的是每个视图自己的 table.columns，由
   * sortAttributeViewViewKey（单视图）控制。两者不同步：只调整全局顺序，
   * 表格里主键仍然排在最后。这里必须用单视图版本。
   *
   * @returns 数据库 ID 与字段名到字段 ID 的映射
   */
  async createDatabaseWithSchema(
    fields: Array<{ name: string; type: AvKeyType; icon?: string }> = [],
    options: { keepDefaultSelect?: boolean; name?: string } = {}
  ): Promise<{ avID: string; fields: Record<string, string>; primaryKeyID: string }> {
    const { avID } = await this.createDatabase(options.name);

    const before = await this.getAttributeView(avID);
    const primaryKey = (before.keyValues || []).find((kv: any) => kv?.key?.type === 'block');
    const defaultSelect = (before.keyValues || []).find((kv: any) => kv?.key?.type === 'select');
    const primaryKeyID = primaryKey?.key?.id ?? '';

    const created = await this.addFields(avID, fields);

    if (defaultSelect && !options.keepDefaultSelect) {
      await this.removeAttributeViewKey(avID, defaultSelect.key.id, false);
    }

    if (primaryKeyID && fields.length > 0) {
      await this.sortAttributeViewKey(avID, primaryKeyID, '');
      await this.sortAttributeViewViewKey(avID, '', primaryKeyID, '');
    }

    return { avID, fields: created, primaryKeyID };
  }

  /**
   * 执行一个事务操作。
   *
   * 关联/汇总字段的配置没有对应的 REST 端点，只能通过事务接口下发——
   * 这也是为什么单靠 addAttributeViewKey 建出来的 relation/rollup 字段是空壳。
   *
   * 这里的 code 0 只表示"事务已入队"，不表示它做成了：内核的 PerformTransactions
   * 把事务追加进队列就返回，真正执行在异步的刷新协程里，失败只推给界面。所以每个
   * 调用点都要自己读回确认，见 confirmApplied。
   */
  private async performOperation(operation: Record<string, any>): Promise<void> {
    const response = await this.client.request('/api/transactions', {
      reqId: Date.now(),
      transactions: [{ doOperations: [operation], undoOperations: [] }],
    });

    if (response.code !== 0) {
      throw new Error(`Transaction ${operation.action} failed: ${response.msg}`);
    }
  }

  /**
   * 读回确认一个事务操作真的生效了，没生效就报错。
   *
   * 事务是异步执行的（见 performOperation），响应里的 code 0 什么也不保证。轮询是
   * 因为写入落库有延迟，不是因为结果不确定：check 一旦为真就立即返回。
   *
   * @param what 这次操作在错误信息里怎么称呼，例如 'configure the relation field "x"'
   * @param check 读回并判断是否已生效
   * @param hint 失败时补充的排查提示
   */
  private async confirmApplied(what: string, check: () => Promise<boolean>, hint = ''): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 150 : 300));
      if (await check()) return;
    }

    throw new Error(
      `SiYuan accepted the request to ${what}, but reading the database back shows it did not take effect. ` +
        `Transaction writes are queued and reported as successful before they run, and failures are surfaced only in the SiYuan interface, ` +
        `so the kernel's own reason is not visible here.${hint ? ' ' + hint : ''}`
    );
  }

  /** 从 getAttributeView 的结果里取出某个字段定义 */
  private static findKey(attributeView: any, keyID: string): any {
    for (const kv of attributeView?.keyValues || []) {
      if (kv?.key?.id === keyID) return kv.key;
    }
    return null;
  }

  /**
   * 配置关联（relation）字段：指定它指向哪个数据库
   *
   * addAttributeViewKey 只会建出一个没有目标的空关联字段，必须再调用本方法才可用。
   *
   * @param srcAvID 关联字段所在的数据库
   * @param keyID 关联字段 ID
   * @param destAvID 目标数据库 ID
   * @param options fieldName 关联字段名（必填，内核会用它覆写字段名）；
   *                twoWay 是否双向；backFieldName 目标库中反向字段的名称
   * @returns 双向关联时返回新建的反向字段 ID
   */
  async configureRelationField(
    srcAvID: string,
    keyID: string,
    destAvID: string,
    options: { fieldName: string; twoWay?: boolean; backFieldName?: string } = { fieldName: '' }
  ): Promise<{ backKeyID?: string }> {
    const twoWay = options.twoWay ?? false;
    const backKeyID = twoWay ? newNodeId() : '';

    await this.performOperation({
      action: 'updateAttrViewColRelation',
      avID: srcAvID,
      id: destAvID,
      keyID,
      isTwoWay: twoWay,
      backRelationKeyID: backKeyID,
      name: options.backFieldName ?? '',
      format: options.fieldName,
    });

    await this.confirmApplied(
      `point the relation field "${keyID}" at database ${destAvID}`,
      async () => {
        const key = SiyuanAvApi.findKey(await this.getAttributeView(srcAvID), keyID);
        if (key?.relation?.avID !== destAvID) return false;
        if (!twoWay) return true;
        return key.relation.isTwoWay === true && !!SiyuanAvApi.findKey(await this.getAttributeView(destAvID), backKeyID);
      },
      'Check that the field is really of type relation and that the target database exists.'
    );

    return twoWay ? { backKeyID } : {};
  }

  /**
   * 配置汇总（rollup）字段：基于某个关联字段，汇总目标库中某字段的值
   *
   * @param avID 汇总字段所在数据库
   * @param rollupKeyID 汇总字段 ID
   * @param relationKeyID 汇总所依据的关联字段 ID（必须已配置好目标库）
   * @param targetKeyID 目标库中被汇总的字段 ID
   * @param calc 计算方式，必须是内核认可的字符串，见 AV_CALC_OPERATORS
   *
   * 注意：`data` 必须是对象。内核在 `operation.Data` 为空时会在保存之前提前 return，
   * 导致配置只存在于内存中而不落盘——表现为调用成功但字段依然是空壳。
   */
  async configureRollupField(
    avID: string,
    rollupKeyID: string,
    relationKeyID: string,
    targetKeyID: string,
    calc: string = 'Count all'
  ): Promise<void> {
    // 内核会照单全收地把汇总字段指向一个 text 字段（实测确认），配置写得进去，
    // 汇总却永远算不出东西——和未配置的空壳一样，只是更难发现
    const attributeView = await this.getAttributeView(avID);
    const relationKey = SiyuanAvApi.findKey(attributeView, relationKeyID);
    if (!relationKey) {
      throw new Error(`Unknown field ID "${relationKeyID}" for relation_key_id. Check the schema with get_database.`);
    }
    if (relationKey.type !== 'relation') {
      throw new Error(
        `relation_key_id must name a relation field; "${relationKey.name}" (${relationKeyID}) is of type "${relationKey.type}". SiYuan accepts the configuration anyway and the rollup then never resolves.`
      );
    }
    if (!relationKey.relation?.avID) {
      throw new Error(
        `The relation field "${relationKey.name}" (${relationKeyID}) has no target database yet — a rollup follows a configured relation. Wire it with configure_relation_field first.`
      );
    }
    if (!SiyuanAvApi.findKey(await this.getAttributeView(relationKey.relation.avID), targetKeyID)) {
      throw new Error(
        `Field "${targetKeyID}" does not exist in the related database ${relationKey.relation.avID}, so there is nothing for the rollup to summarise.`
      );
    }

    await this.performOperation({
      action: 'updateAttrViewColRollup',
      avID,
      id: rollupKeyID,
      parentID: relationKeyID,
      keyID: targetKeyID,
      data: { calc: { operator: calc } },
    });

    await this.confirmApplied(
      `configure the rollup field "${rollupKeyID}"`,
      async () => {
        const key = SiyuanAvApi.findKey(await this.getAttributeView(avID), rollupKeyID);
        return key?.rollup?.relationKeyID === relationKeyID && key?.rollup?.keyID === targetKeyID;
      },
      'A rollup depends on an already-configured relation field — wire that with configure_relation_field first.'
    );
  }

  /**
   * 由行 ID 查绑定的块 ID
   *
   * 行 ID（itemID）与绑定块 ID 是两个不同的概念，写单元格时用错会静默产生孤儿值。
   * 这两个方法把二者的映射关系变成可查询的，而不是只能靠约定。
   */
  async getBoundBlockIDsByItemIDs(avID: string, itemIDs: string[]): Promise<Record<string, string>> {
    const response = await this.client.request<Record<string, string>>(
      '/api/av/getAttributeViewBoundBlockIDsByItemIDs',
      { avID, itemIDs }
    );

    if (response.code !== 0) {
      throw new Error(`Failed to resolve bound block IDs: ${response.msg}`);
    }

    return response.data || {};
  }

  /**
   * 由绑定的块 ID 反查行 ID
   *
   * 内核返回的是 blockID -> itemID 的映射（GetAttributeViewItemIDs），不是数组，
   * 查不到的键值为空串。映射比数组更可靠：不依赖返回顺序与入参一一对应。
   */
  async getItemIDsByBoundIDs(avID: string, blockIDs: string[]): Promise<Record<string, string>> {
    const response = await this.client.request<Record<string, string>>(
      '/api/av/getAttributeViewItemIDsByBoundIDs',
      { avID, blockIDs }
    );

    if (response.code !== 0) {
      throw new Error(`Failed to resolve item IDs: ${response.msg}`);
    }

    return response.data || {};
  }

  /**
   * 批量替换行所绑定的块
   *
   * @param avID 数据库 ID
   * @param replacements 旧块 ID 到新块 ID 的映射
   * @param isDetached 替换后是否为游离行
   */
  async batchReplaceBlocks(
    avID: string,
    replacements: Record<string, string>,
    isDetached = false
  ): Promise<{ replaced: number; requested: number; itemIDs: string[] }> {
    const entries = Object.entries(replacements);
    if (!entries.length) return { replaced: 0, requested: 0, itemIDs: [] };

    // 键是行 ID（item ID），不是行当前绑定的块 ID——与旧描述里写的相反。内核对匹配
    // 不上的键既不报错也不计数，而返回值以前只是回显提交条数，所以整批写错也会得到
    // 一个自信的成功（PF-36）。先按当前行 ID 校验，写完再读回来数实际生效的条数。
    const bindingsOf = async () => {
      const av = await this.getAttributeView(avID);
      const blockKV = (av.keyValues || []).find((kv: any) => kv?.key?.type === 'block');
      const map = new Map<string, string>();
      for (const value of blockKV?.values || []) {
        if (value?.blockID) map.set(value.blockID, value?.block?.id ?? '');
      }
      return map;
    };

    const before = await bindingsOf();
    const unknown = entries.map(([itemID]) => itemID).filter((itemID) => !before.has(itemID));
    if (unknown.length) {
      throw new Error(
        `Not row ids of this database: ${unknown.map((id) => `"${id}"`).join(', ')}. ` +
          `The keys of this map are ROW ids, not the block ids those rows are currently bound to. SiYuan ignores an unmatched key without any error, ` +
          `so passing bound block ids returns a confident success and changes nothing. ` +
          `Take row ids from render_database (rows[].id / cards[].id), or from get_database_primary_key_values — where the row id is the field named "blockID" and the bound block is nested under "block.id", a naming trap worth reading twice. Nothing was changed.`
      );
    }

    const response = await this.client.request('/api/av/batchReplaceAttributeViewBlocks', {
      avID,
      isDetached,
      oldNew: entries.map(([oldID, newID]) => ({ [oldID]: newID })),
    });

    if (response.code !== 0) {
      throw new Error(`Failed to replace blocks: ${response.msg}`);
    }

    const after = await bindingsOf();
    const applied = entries.filter(([itemID, target]) => after.get(itemID) === target);

    if (!applied.length) {
      throw new Error(
        `SiYuan accepted the request but not one row changed its binding, checked by reading the database back. ` +
          `Verify the target block ids exist — retrying the same call unchanged will do the same nothing.`
      );
    }

    return {
      replaced: applied.length,
      requested: entries.length,
      itemIDs: applied.map(([itemID]) => itemID),
    };
  }

  /**
   * 列出未被任何文档引用的数据库（导入失败会留下这类孤儿）
   */
  async getUnusedAttributeViews(): Promise<any[]> {
    const response = await this.client.request<any>('/api/av/getUnusedAttributeViews', {});

    if (response.code !== 0) {
      throw new Error(`Failed to list unused databases: ${response.msg}`);
    }

    const data: any = response.data;
    return data?.unusedAttributeViews ?? (Array.isArray(data) ? data : []);
  }

  /**
   * 删除点名的未被引用数据库。不可撤销。
   *
   * 不再提供"删掉所有未引用的"这条路径（PF-36）。理由不是谨慎，是并发：建库和嵌入
   * 是两次调用，中间那一瞬新库就是"未被引用"的，另一个会话此时做一次清扫就会把它
   * 删掉。受害方拿不到任何错误，只会在下一次调用时遇到一个已经不存在的 ID，报错还
   * 指向错误的操作。笔记本隔离在这里帮不上忙——未嵌入的数据库本来就不属于任何笔记本，
   * 那正是它"未被引用"的定义。
   *
   * 每个 ID 都先对照当前的未引用列表核对；只要有一个不在列表里就整批拒绝，一个都不删。
   * 这样"手里这份清单已经过期"会变成一个明确的错误，而不是删掉别人刚建的东西。
   *
   * @param avIDs 要删除的数据库 ID，通常取自 getUnusedAttributeViews
   * @returns 实际删除的 ID
   */
  async removeUnusedAttributeViews(avIDs: string[]): Promise<{ removed: string[] }> {
    if (!avIDs?.length) {
      throw new Error(
        'Name the databases to remove. This call used to delete every unused database in the workspace, which is not safe once more than one session is at work: a database is "unused" for the moment between creating it and embedding it, so a sweep deletes whatever someone else is midway through building. List them with list_unused_databases and pass the ones you mean.'
      );
    }

    const unused = await this.getUnusedAttributeViews();
    const unusedIDs = new Set(
      unused
        .map((entry: any) => (typeof entry === 'string' ? entry : entry?.item ?? entry?.id))
        .filter(Boolean)
    );

    const notUnused = avIDs.filter((id) => !unusedIDs.has(id));
    if (notUnused.length) {
      throw new Error(
        `Refusing to delete: ${notUnused.map((id) => `"${id}"`).join(', ')} ${notUnused.length === 1 ? 'is' : 'are'} not in the current unused list. ` +
          `Either the id is wrong, or the database has been embedded since that list was taken — in which case deleting it would destroy something in use. ` +
          `Nothing was deleted. Re-read list_unused_databases and pass ids from the fresh list.`
      );
    }

    const removed: string[] = [];
    for (const avID of avIDs) {
      const response = await this.client.request('/api/av/removeUnusedAttributeView', { id: avID });
      if (response.code !== 0) {
        throw new Error(
          `Failed to remove database ${avID}: ${response.msg}. ` +
            (removed.length
              ? `Already removed before this failure: ${removed.join(', ')}.`
              : 'Nothing was removed.')
        );
      }
      removed.push(avID);
    }

    return { removed };
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
   * 重命名字段，或更改其类型（主键只能改名，不能改类型；反之，普通字段也不能
   * 被改成主键类型）。
   *
   * 关于主键类型边界的重要说明：内核确实拒绝跨越主键边界的类型更改
   * （错误信息 "cannot change type of primary key field"），但这个错误**不会
   * 传播到事务响应**——顶层 code 仍是 0，回显的 doOperations 看起来完全正常，
   * 只有真正读回字段并比对才能发现什么都没变。这是一个真实存在、且无法从
   * API 响应本身探测的静默失败。所以这里改为在调用内核之前，本地先做同样的
   * 边界检查并直接抛出清晰的错误——不依赖内核的响应来发现这个问题。
   * 因此本方法总是先读取字段当前状态（不再只在省略参数时才读）。
   *
   * 没有对应的 REST 端点，通过 /api/transactions 的操作实现。
   *
   * @param avID 数据库 ID
   * @param keyID 字段 ID
   * @param options name（新字段名，省略则保持不变）、type（新类型，省略则保持不变）
   */
  async updateField(
    avID: string,
    keyID: string,
    options: { name?: string; type?: AvKeyType | 'block' } = {}
  ): Promise<void> {
    const current = await this.getAttributeView(avID);
    const kv = (current.keyValues || []).find((k: any) => k?.key?.id === keyID);
    if (!kv) {
      throw new Error(`Field "${keyID}" not found in database ${avID}`);
    }

    const currentType = kv.key.type;
    const name = options.name ?? kv.key.name;
    const type = options.type ?? currentType;

    const isPrimaryKeyNow = currentType === 'block';
    const wouldBePrimaryKey = type === 'block';
    if (isPrimaryKeyNow !== wouldBePrimaryKey) {
      throw new Error(
        isPrimaryKeyNow
          ? 'Cannot change the primary key field to a different type. The kernel silently refuses this (returns success, changes nothing) rather than erroring, so this is rejected here before the request is even sent.'
          : 'Cannot change a field to the primary key type. The kernel silently refuses this (returns success, changes nothing) rather than erroring, so this is rejected here before the request is even sent.'
      );
    }

    await this.performOperation({
      // 两个坑都在这一个操作上：
      // 1. action 字符串是 "updateAttrViewCol"，不是从 Go 函数名 doUpdateAttrViewColumn /
      //    updateAttributeViewColumn 直接推出来的 "updateAttrViewColumn"（这个不存在，
      //    分发表里没有匹配的 case，事务照样返回 code 0，什么也不做）。真正的 action
      //    字符串是在 transaction.go 的 dispatch switch 里确认的，不是从函数名猜的。
      // 2. 该操作结构体里这个字段的 Go 名是 Typ，JSON tag 却是 "type" 不是 "typ"。
      // 两处都不会让事务报错——回显的 doOperations 看起来完全正常，code 是 0，
      // 只有真正读回数据库、检查字段是否变化，才会发现什么都没发生。
      action: 'updateAttrViewCol',
      avID,
      id: keyID,
      type,
      name,
    });

    await this.confirmApplied(
      `update the field "${keyID}" to name "${name}" and type "${type}"`,
      async () => {
        const key = SiyuanAvApi.findKey(await this.getAttributeView(avID), keyID);
        return key?.name === name && key?.type === type;
      },
      'The kernel refuses some field-type changes outright and reports nothing when it does.'
    );
  }

  /**
   * 显式设置 select/mSelect 字段的选项（名称、颜色、描述）。
   *
   * 已存在的同名选项会被更新颜色/描述；不存在的会被新建。不在列表中的现有选项
   * 不受影响（不会被删除）。名称匹配区分大小写、不做去除空白处理，与写入单元格
   * 值时隐式创建选项的行为完全一致——所以用这个方法预先声明的选项名，必须和
   * 之后写入单元格时使用的值完全一致，才能对上号。
   *
   * 用途：避免隐式创建的选项全部同色（内核对隐式创建的选项固定使用 color "1"，
   * 这里默认按调色板 1-14 循环分配，除非调用方显式指定颜色）；或用于预先声明一组
   * 带颜色的选项，供后续 add_database_rows_with_values 的 validateOptions 校验使用。
   *
   * @param avID 数据库 ID
   * @param keyID 字段 ID（须是 select 或 mSelect 类型）
   * @param options 选项列表；color 缺省时按 1-14 循环分配（内核调色板仅接受 1-14，
   *                超出范围的值会被内核静默清空为无色）
   */
  async configureSelectOptions(
    avID: string,
    keyID: string,
    options: Array<{ name: string; color?: string; desc?: string }>
  ): Promise<void> {
    if (!options.length) return;

    // 内核不拒绝把选项写到 text 之类的字段上（实测确认），写进去也不会有任何效果，
    // 之后读回还看得见——所以只能自己挡
    const key = SiyuanAvApi.findKey(await this.getAttributeView(avID), keyID);
    if (!key) {
      throw new Error(`Unknown field ID "${keyID}". Check the schema with get_database.`);
    }
    if (key.type !== 'select' && key.type !== 'mSelect') {
      throw new Error(
        `Field "${key.name}" (${keyID}) is of type "${key.type}", which has no options. SiYuan stores options written to it anyway, where they do nothing, so this is rejected here instead.`
      );
    }

    const data = options.map((o, i) => ({
      name: o.name,
      color: o.color ?? String((i % 14) + 1),
      desc: o.desc ?? '',
    }));

    await this.performOperation({
      action: 'updateAttrViewColOptions',
      avID,
      id: keyID,
      data,
    });

    await this.confirmApplied(
      `set the options on field "${keyID}"`,
      async () => {
        const key = SiyuanAvApi.findKey(await this.getAttributeView(avID), keyID);
        const stored = new Set((key?.options || []).map((o: any) => o.name));
        return data.every((o) => stored.has(o.name));
      },
      'Options can only be set on a select or mSelect field.'
    );
  }

  /**
   * 在没有真正自增字段类型的情况下，读取某个 number 字段当前的最大值并返回 max+1，
   * 用作"下一个 ID"的建议值。
   *
   * 明确的局限：这只是读取后计算，不是原子操作。并发写入下存在竞态——两次几乎同时
   * 的调用可能拿到相同的值。这是已知且被接受的限制，不是缺陷；对一致性要求高的场景，
   * 调用方仍需在写入后自行校验唯一性。给了单个人类加一两个并发 AI 线程的场景，这个
   * 竞态窗口通常可以接受；用它替代手动翻查最大值已经是明显改进。
   *
   * @param avID 数据库 ID
   * @param numberKeyID 用作序号的 number 字段 ID
   * @returns 建议的下一个值（当前最大值 + 1；数据库为空时返回 1）
   */
  async getNextSequenceValue(avID: string, numberKeyID: string): Promise<number> {
    let max = 0;
    let page = 1;
    const pageSize = 100;

    // 分页遍历该字段全部已有值取最大值。数据库规模不大（这是该功能的预期使用场景）
    // 时代价可接受；数据库很大时，调用方更应该考虑真正的唯一标识方案而不是这个助手。
    for (;;) {
      const rendered = await this.renderAttributeView(avID, { page, pageSize });
      const items = rendered?.view?.rows || rendered?.view?.cards || [];
      if (!items.length) break;

      for (const item of items) {
        const cell = (item.cells || []).find((c: any) => c?.value?.keyID === numberKeyID);
        const n = cell?.value?.number?.content;
        if (typeof n === 'number' && n > max) max = n;
      }

      if (items.length < pageSize) break;
      page++;
    }

    return max + 1;
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

  /**
   * 设置（整体替换）数据库的新增条目模板配置。这是思源对 Notion "page templates"
   * 的对应实现：目标为 detached 的模板只预填字段默认值；目标为 document 的模板会在
   * 创建条目时绑定一个真实文档，内容来自 contentTemplatePath 指向的模板文档，保存
   * 位置由 saveLocation 控制。
   *
   * 注意是整体替换，不是合并：调用时传入的列表就是之后的全部模板，未包含在内的
   * 现有模板会被丢弃。如果是要在现有模板基础上增删，先用 get_database 读出
   * newItemTemplates 再据此构造完整列表，不要只传增量。
   *
   * fieldValues 里的 select/mSelect 默认值要求选项已经存在于字段上——这一点和普通
   * 单元格写入不同，普通写入会隐式创建未知选项，这里不会。内核确实会为此报错
   * （normalizeNewItemTemplateFieldValues 返回 "option [x] not found"），但这个错误
   * 到不了调用方：/api/transactions 只是把事务排进队列就返回 code 0，真正执行在异步
   * 的队列里，失败只推给界面。结果就是整批模板被丢弃而调用看起来成功了（PF-23）。
   * 所以这里在发送前照内核的规则自己校验一遍，发送后再读回来确认真的落库。
   *
   * @returns 每个模板名对应的最终 id（未显式提供 id 的模板会在这里拿到新生成的 id，
   *          用于后续引用为 default_template_id 或再次调用时的更新目标）
   */
  async setNewItemTemplates(
    avID: string,
    templates: NewItemTemplateInput[],
    defaultTemplateID?: string
  ): Promise<{ templateIDs: Record<string, string> }> {
    const attributeView = await this.getAttributeView(avID);
    const keyTypes = new Map<string, AvKeyType | 'block'>();
    const keyOptions = new Map<string, Set<string>>();
    for (const kv of attributeView.keyValues || []) {
      if (!kv?.key?.id) continue;
      keyTypes.set(kv.key.id, kv.key.type);
      if (kv.key.type === 'select' || kv.key.type === 'mSelect') {
        keyOptions.set(kv.key.id, new Set((kv.key.options || []).map((o: any) => o.name)));
      }
    }
    const templateIDs: Record<string, string> = {};

    const payloadTemplates = templates.map((t) => {
      const id = t.id ?? newNodeId();
      // 内核对模板 ID 有格式要求，不合规会丢弃整批（同样不报错给调用方）
      if (t.id && !NODE_ID_PATTERN.test(t.id)) {
        throw new Error(
          `Invalid template id "${t.id}" on template "${t.name}". Must match 14 digits, a hyphen, then 7 lowercase alphanumerics (e.g. 20260101120000-abc1234) — pass an id only to update an existing template, and omit it to have one generated.`
        );
      }
      templateIDs[t.name] = id;

      let fieldValues: Record<string, any> | undefined;
      if (t.fieldValues && Object.keys(t.fieldValues).length > 0) {
        fieldValues = {};
        for (const [keyID, fv] of Object.entries(t.fieldValues)) {
          const mode = fv.mode ?? 'static';
          const keyType = keyTypes.get(keyID);
          if (!keyType) {
            throw new Error(
              `Unknown field ID "${keyID}" in template "${t.name}". Check the schema with get_database.`
            );
          }
          if (!NEW_ITEM_TEMPLATE_EDITABLE_KEY_TYPES.has(keyType)) {
            throw new Error(
              `Field "${keyID}" in template "${t.name}" is of type "${keyType}", which a row-creation template cannot set a default for. ` +
                `Settable types: ${[...NEW_ITEM_TEMPLATE_EDITABLE_KEY_TYPES].join(', ')}.`
            );
          }
          if (mode === 'currentTime') {
            if (keyType !== 'date') {
              throw new Error(
                `Field "${keyID}" in template "${t.name}" uses mode "current_time", which SiYuan allows only on a date field; this one is "${keyType}".`
              );
            }
            fieldValues[keyID] = { mode: 'currentTime' };
            continue;
          }
          if (keyType === 'select' || keyType === 'mSelect') {
            // 内核要求选项已存在，但它的报错走不到调用方——见方法注释（PF-23）
            const allowed = keyOptions.get(keyID) ?? new Set<string>();
            const wanted = fv.value === null || fv.value === undefined || fv.value === ''
              ? []
              : Array.isArray(fv.value)
                ? fv.value
                : [fv.value];
            for (const v of wanted) {
              const name = typeof v === 'string' ? v.trim() : String(v);
              if (!allowed.has(name)) {
                throw new Error(
                  `Template "${t.name}" sets field "${keyID}" to the option "${name}", which does not exist on that field yet. ` +
                    `A row-creation template cannot create select options the way a normal cell write does, and SiYuan discards the ` +
                    `entire template set when one is missing — without reporting it, because template writes run on an asynchronous ` +
                    `transaction queue. Create the option first with configure_select_options. ` +
                    (allowed.size
                      ? `Existing options on that field: ${[...allowed].map((o) => `"${o}"`).join(', ')}.`
                      : `That field has no options at all yet.`)
                );
              }
            }
          }
          fieldValues[keyID] = { mode: 'static', value: normalizeValue(keyType, fv.value) };
        }
      }

      return {
        id,
        name: t.name,
        icon: t.icon ?? '',
        targetType: t.targetType,
        primaryKeyTemplate: t.primaryKeyTemplate ?? '',
        fieldValues,
        saveLocation: t.saveLocation,
        contentTemplatePath: t.contentTemplatePath ?? '',
        hideInFileTree: t.hideInFileTree ?? false,
      };
    });

    if (defaultTemplateID && !payloadTemplates.some((t) => t.id === defaultTemplateID)) {
      throw new Error(
        `default_template_id "${defaultTemplateID}" is not one of the templates in this call. Because this call replaces the whole template set, the default must name a template being written here.`
      );
    }

    await this.performOperation({
      action: 'setAttrViewNewItemTemplates',
      avID,
      data: { templates: payloadTemplates, defaultTemplateID: defaultTemplateID ?? '' },
    });

    await this.confirmNewItemTemplatesPersisted(avID, payloadTemplates.map((t) => t.id));

    return { templateIDs };
  }

  /**
   * 读回确认模板真的落库了。
   *
   * /api/transactions 把事务排队后立刻返回 code 0，执行是异步的，失败只推给界面，
   * 所以"调用成功"什么都不保证。这里轮询读回，把静默丢弃变成一个明确的错误，也保证
   * 返回的 template_ids 是真实存在的 id，而不是本地生成后从未落库的假 id（PF-23）。
   */
  private async confirmNewItemTemplatesPersisted(avID: string, expectedIDs: string[]): Promise<void> {
    const expected = new Set(expectedIDs);
    let persisted: string[] = [];

    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 150 : 300));
      const attributeView = await this.getAttributeView(avID);
      persisted = (attributeView.newItemTemplates || []).map((t: any) => t?.id).filter(Boolean);
      const missing = [...expected].filter((id) => !persisted.includes(id));
      if (!missing.length && (expected.size > 0 || persisted.length === 0)) {
        return;
      }
    }

    const missing = [...expected].filter((id) => !persisted.includes(id));
    throw new Error(
      expected.size === 0
        ? `The template set was not cleared: SiYuan still reports ${persisted.length} template(s). Template writes run on an asynchronous transaction queue that reports failures only to the SiYuan interface, so read newItemTemplates back with get_database to see the current state.`
        : `SiYuan accepted the request but did not store ${missing.length} of ${expected.size} template(s) (${missing.join(', ')}). ` +
          `Template writes run on an asynchronous transaction queue that returns success immediately and reports failures only to the SiYuan interface, so the rejection reason is not visible here. ` +
          `The usual cause is a field default the kernel refuses — most often a select/mSelect option that does not exist on the field. Check the kernel log, or re-check the field defaults against get_database.`
    );
  }

  /**
   * 按模板（或空白，templateID 省略时）在一个已嵌入的数据库中创建一个新条目。
   * 目标为 document 的模板会创建并绑定一个真实文档，内容取自模板自身的
   * contentTemplatePath；需要为这次创建提供自定义正文时用
   * createRowFromTemplateWithMarkdown 代替。
   *
   * 要求数据库已嵌入文档（有真实 blockID）——这是内核 API 本身的要求，不是本连接器
   * 的限制，游离数据库无法通过这个接口建条目。
   */
  async createRowFromTemplate(
    avID: string,
    blockID: string,
    options: { templateID?: string; viewID?: string; previousID?: string; groupID?: string } = {}
  ): Promise<NewItemFromTemplateResult> {
    if (!blockID) {
      throw new Error('blockID is required: createAttributeViewItem only works on an embedded database, not a detached one.');
    }
    const response = await this.client.request<NewItemFromTemplateResult>('/api/av/createAttributeViewItem', {
      avID,
      blockID,
      viewID: options.viewID ?? '',
      templateID: options.templateID ?? '',
      previousID: options.previousID ?? '',
      groupID: options.groupID ?? '',
    });

    if (response.code !== 0) {
      throw new Error(`Failed to create row from template: ${response.msg}`);
    }

    return response.data;
  }

  /**
   * 按一个目标为 document 的模板创建条目，并用调用方提供的 Markdown 作为新文档的
   * 正文（覆盖模板自身的 contentTemplatePath）。templateID 必须指向一个 targetType
   * 为 document 的模板，否则内核报错拒绝——这个接口不能创建游离行。
   */
  async createRowFromTemplateWithMarkdown(
    avID: string,
    blockID: string,
    templateID: string,
    document: {
      title: string;
      markdown: string;
      tags?: string;
      withMath?: boolean;
      clippingHref?: string;
      listDocTree?: boolean;
    },
    options: { viewID?: string; previousID?: string; groupID?: string } = {}
  ): Promise<NewItemFromTemplateResult> {
    if (!blockID) {
      throw new Error('blockID is required: createAttributeViewItemWithMarkdown only works on an embedded database, not a detached one.');
    }
    if (!templateID) {
      throw new Error('templateID is required and must reference a document-target template — this call cannot create a detached row.');
    }
    const response = await this.client.request<NewItemFromTemplateResult>(
      '/api/av/createAttributeViewItemWithMarkdown',
      {
        avID,
        blockID,
        viewID: options.viewID ?? '',
        templateID,
        previousID: options.previousID ?? '',
        groupID: options.groupID ?? '',
        title: document.title,
        markdown: document.markdown,
        tags: document.tags ?? '',
        withMath: document.withMath ?? false,
        clippingHref: document.clippingHref ?? '',
        listDocTree: document.listDocTree ?? false,
      }
    );

    if (response.code !== 0) {
      throw new Error(`Failed to create row from template with markdown: ${response.msg}`);
    }

    return response.data;
  }

  /**
   * 把已有的游离行批量转成绑定真实文档的行，保留行上已有的所有单元格值。
   *
   * 这是"先用 appendDetachedRowsWithValues 一次建好 N 行带值的游离行，再一次性
   * 把它们绑上文档"这条路径的后半段：整批导入从"每行十几次调用"降到两次调用。
   * 内核侧是一个事务（createAttributeViewItemDocs），失败会回滚已创建的文档，
   * 已经绑定的行会被跳过并在 skippedItemIDs 里报出来，不会当成写入成功。
   *
   * @param avID 数据库 ID
   * @param blockID 嵌入该数据库的块 ID——内核要拿它定位笔记本与视图，不能省
   * @param itemIDs 要转换的游离行 ID
   * @param options saveMode：subDoc 建为数据库所在文档的子文档；template 走数据库
   *                默认模板（模板不是 document 目标时退回内核默认位置）。
   *                chunkSize 只影响一次事务的大小，每块自身仍是原子的。
   */
  async createItemDocs(
    avID: string,
    blockID: string,
    itemIDs: string[],
    options: {
      saveMode?: 'subDoc' | 'template';
      chunkSize?: number;
      applyTemplateDefaults?: boolean;
      templateID?: string;
    } = {}
  ): Promise<CreateItemDocsResult> {
    if (!blockID) {
      throw new Error(
        'blockID is required: createAttributeViewItemDocs resolves the notebook and view from the database block, so it only works on an embedded database.'
      );
    }

    const merged: CreateItemDocsResult = { itemIDs: [], blockIDs: [], skippedItemIDs: [], warnings: [] };
    if (!itemIDs.length) return merged;

    const saveMode = options.saveMode ?? 'subDoc';
    const chunkSize = Math.max(1, options.chunkSize ?? 50);

    for (let i = 0; i < itemIDs.length; i += chunkSize) {
      const slice = itemIDs.slice(i, i + chunkSize);
      const response = await this.client.request<CreateItemDocsResult & { unavailableNotebook?: boolean }>(
        '/api/av/createAttributeViewItemDocs',
        { avID, blockID, saveMode, itemIDs: slice }
      );

      // 内核对"笔记本不存在"用 code 1 + data.unavailableNotebook 回复，而不是错误消息
      if (response.code === 1 && (response.data as any)?.unavailableNotebook) {
        throw new Error(
          'Failed to convert rows to documents: the notebook the template saves into is unavailable (closed or missing). Check the template\'s save_location, or use save_mode "sub_doc".'
        );
      }
      if (response.code !== 0) {
        throw new Error(`Failed to convert rows to documents: ${response.msg}`);
      }

      const data = response.data ?? ({} as CreateItemDocsResult);
      merged.itemIDs.push(...(data.itemIDs ?? []));
      merged.blockIDs.push(...(data.blockIDs ?? []));
      merged.skippedItemIDs!.push(...(data.skippedItemIDs ?? []));
      merged.warnings!.push(...(data.warnings ?? []));
    }

    // 这条路径不经过行创建模板：内核克隆行上已有的值再绑定文档，从不读取模板的
    // fieldValues（kernel/model/attribute_view_new_item.go 的 CreateAttributeViewItemDocs）。
    // 对 saveMode "template" 也一样——模板只用来定保存位置和正文模板。默认字段值因此
    // 静默缺席，而缺席的往往正是"待办""未完成"这类标记，于是最不完整的那批行看起来
    // 最干净（PF-25）。要么这里补上，要么至少告诉调用方它没发生。
    const attributeView = await this.getAttributeView(avID);
    const templates: any[] = attributeView?.newItemTemplates || [];
    const withDefaults = templates.filter((t) => t?.fieldValues && Object.keys(t.fieldValues).length > 0);

    if (!options.applyTemplateDefaults) {
      if (withDefaults.length && merged.itemIDs.length) {
        merged.warnings!.push(
          `Row-creation template defaults were NOT applied to the ${merged.itemIDs.length} converted row(s): this path never consults them. ` +
            `${withDefaults.length === 1 ? `Template "${withDefaults[0].name}" sets` : `${withDefaults.length} templates set`} field defaults that these rows do not have. ` +
            `Pass apply_template_defaults to have them written, or set the fields yourself with set_database_cells.`
        );
      }
      return merged;
    }

    if (!merged.itemIDs.length) return merged;

    let template = options.templateID
      ? templates.find((t) => t?.id === options.templateID)
      : templates.find((t) => t?.id === attributeView?.defaultTemplateID) ?? (templates.length === 1 ? templates[0] : undefined);

    if (!template) {
      throw new Error(
        options.templateID
          ? `Template ${options.templateID} was not found on this database. Read newItemTemplates back with get_database to see what exists.`
          : templates.length
            ? `apply_template_defaults needs to know which template to take defaults from: this database has ${templates.length} and no default_template_id. Name one with template_id.`
            : 'apply_template_defaults was requested but this database has no row-creation templates configured.'
      );
    }

    const fieldValues: Record<string, any> = template.fieldValues || {};
    if (!Object.keys(fieldValues).length) {
      merged.warnings!.push(`Template "${template.name}" sets no field defaults, so apply_template_defaults had nothing to write.`);
      return merged;
    }

    const now = Date.now();
    const updates: Array<{ itemID: string; keyID: string; value: any }> = [];
    for (const itemID of merged.itemIDs) {
      for (const [keyID, fieldValue] of Object.entries<any>(fieldValues)) {
        const value =
          fieldValue?.mode === 'currentTime'
            ? { date: { content: now, isNotEmpty: true, isNotTime: false } }
            : fieldValue?.value;
        if (value === undefined) continue;
        updates.push({ itemID, keyID, value });
      }
    }

    if (updates.length) {
      await this.batchSetCells(avID, updates, { chunkSize: options.chunkSize });
      merged.warnings!.push(
        `Applied ${Object.keys(fieldValues).length} field default(s) from template "${template.name}" to ${merged.itemIDs.length} converted row(s) — the conversion itself does not do this.`
      );
    }

    return merged;
  }

  /**
   * 批量把已有的块绑成数据库行，并在同一次调用里写完各行的单元格值。
   *
   * 用于文档已经存在的情况（appendDetachedRowsWithValues 只能建游离行，
   * addAttributeViewBlocks 能绑定但不写值）。绑定与写值仍是两个内核请求，
   * 但对调用方是一次调用，且行 ID 由内核的 blockID -> itemID 映射查得，
   * 不依赖返回顺序。
   *
   * 主键值不接受：绑定行的名字来自它绑定的文档，在这里写主键只会让行显示的文本
   * 与文档标题分叉，且不报错。要改名就改文档标题。
   */
  async addBoundRowsWithValues(
    avID: string,
    rows: Array<{ blockID: string; values?: Record<string, any> }>,
    options: {
      blockID?: string;
      viewID?: string;
      groupID?: string;
      previousID?: string;
      chunkSize?: number;
      validateOptions?: boolean;
      ignoreDefaultFill?: boolean;
    } = {}
  ): Promise<{ rowCount: number; chunks: number; updated: number; itemIDs: Record<string, string> }> {
    if (!rows.length) return { rowCount: 0, chunks: 0, updated: 0, itemIDs: {} };

    const keyTypes = await this.getKeyTypes(avID);
    const primaryKeyID = [...keyTypes.entries()].find(([, t]) => t === 'block')?.[0];

    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].blockID) {
        throw new Error(`Row ${i + 1} has no block_id. Every row here binds an existing block; use add_database_rows_with_values for detached rows.`);
      }
      for (const keyID of Object.keys(rows[i].values ?? {})) {
        if (!keyTypes.has(keyID)) {
          throw new Error(
            `Unknown field ID "${keyID}". SiYuan rejects the entire batch when a field ID does not exist; check the schema with get_database.`
          );
        }
        if (keyID === primaryKeyID) {
          throw new Error(
            `Row ${i + 1} sets the primary-key field "${keyID}". A bound row takes its name from the document it is bound to — ` +
              `writing the primary key here succeeds silently but only overrides the row's display text, leaving it disagreeing with the ` +
              `document's own title. Rename the document with rename_document instead, or use add_database_rows plus set_database_cell if ` +
              `the divergence is genuinely wanted.`
          );
        }
      }
    }

    if (options.validateOptions) {
      await this.assertKnownSelectOptions(avID, rows.map((r) => r.values ?? {}));
    }

    const chunkSize = Math.max(1, options.chunkSize ?? 100);
    let chunks = 0;
    let updated = 0;
    const itemIDs: Record<string, string> = {};

    for (let i = 0; i < rows.length; i += chunkSize) {
      const slice = rows.slice(i, i + chunkSize);
      await this.addAttributeViewBlocks(
        avID,
        slice.map((r) => ({ id: r.blockID, isDetached: false })),
        {
          blockID: options.blockID,
          viewID: options.viewID,
          groupID: options.groupID,
          previousID: options.previousID,
          ignoreDefaultFill: options.ignoreDefaultFill,
        }
      );
      chunks++;

      const resolved = await this.getItemIDsByBoundIDs(avID, slice.map((r) => r.blockID));
      const updates: Array<{ itemID: string; keyID: string; value: any }> = [];
      for (const row of slice) {
        const itemID = resolved[row.blockID];
        if (!itemID) {
          throw new Error(
            `Block ${row.blockID} was added but no row ID came back for it, so its values were not written. ` +
              `Check the block exists and is not already bound to this database.`
          );
        }
        itemIDs[row.blockID] = itemID;
        for (const [keyID, value] of Object.entries(row.values ?? {})) {
          updates.push({ itemID, keyID, value });
        }
      }

      if (updates.length) {
        const result = await this.batchSetCells(avID, updates, { chunkSize });
        updated += result.updated;
      }
    }

    return { rowCount: rows.length, chunks, updated, itemIDs };
  }

  /**
   * 逐值对照字段已有的选项集检查 select/mSelect 值，把"静默新建一个几乎一样的选项"
   * 变成一个明确的错误。与 appendDetachedRowsWithValues 里的 validateOptions 同义。
   */
  private async assertKnownSelectOptions(avID: string, rows: Array<Record<string, any>>): Promise<void> {
    const attributeView = await this.getAttributeView(avID);
    const knownOptions = new Map<string, Set<string>>();
    for (const kv of attributeView.keyValues || []) {
      if (kv?.key?.type === 'select' || kv?.key?.type === 'mSelect') {
        knownOptions.set(kv.key.id, new Set((kv.key.options || []).map((o: any) => o.name)));
      }
    }

    for (let i = 0; i < rows.length; i++) {
      for (const [keyID, value] of Object.entries(rows[i])) {
        const allowed = knownOptions.get(keyID);
        if (!allowed) continue;

        const values =
          value === null || value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value];

        for (const v of values) {
          const name = typeof v === 'string' ? v.trim() : String(v);
          if (!allowed.has(name)) {
            throw new Error(
              `validate_options: "${name}" is not an existing option for field "${keyID}" (row ${i + 1}). ` +
                `Configure it first with configure_select_options, or omit validate_options to let SiYuan create it automatically.`
            );
          }
        }
      }
    }
  }
}
