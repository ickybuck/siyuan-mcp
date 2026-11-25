/**
 * Task-list web page: a small browser UI over ONE SiYuan database (a to-do list), served by the
 * HTTP entry point next to /mcp.
 *
 * 为什么放在这里而不是做成 MCP 工具：这是给人用的网页，不是给模型用的工具。它复用同一个
 * 进程里的 SiYuan 令牌，令牌只在服务端使用，从不发到浏览器。
 *
 * 安全边界（这个服务器本身没有认证）：
 * - 只有设置了 TASKS_AV_ID 才启用；同一镜像的其它实例不设置就完全没有 /tasks。
 * - 只读写这一个数据库；行 ID 必须属于它；可写字段是白名单。
 * - 写请求必须带自定义头 X-Tasks-Client 且为 application/json，跨站表单/简单请求无法伪造；
 *   /tasks 不发送 CORS 头，跨源预检必然失败。
 * - 对外暴露范围由部署方决定（只挂载 /tasks 路径，不要把 /mcp 一起暴露）。
 *
 * 写后读回：/api/av/batchSetAttributeViewBlockAttrs 返回 code 0 不代表已落盘，所以每次写入
 * 之后都重新渲染视图、逐字段比对，比对不上就明确报错。
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SiyuanTools } from '../../src/index.js';
import { ITEM_ID_KEY } from '../../src/api/av.js';
import { randomBytes } from 'node:crypto';
import { readBackUntil } from '../../src/utils/readback.js';
import { TASKS_PAGE_HTML } from './tasks-page.js';

export interface TasksConfig {
  avID: string;
  /** An unfiltered view of the database (every row, done or not). */
  viewID: string;
}

/** Field names the page understands. Required ones must exist or the page refuses to start. */
const FIELD_NAMES = {
  task: 'Task',
  slug: 'ID',
  done: 'Done',
  doneAt: 'Done date',
  scope: 'Scope',
  routine: 'Routine',
  source: 'Source',
  topic: 'Topic',
  who: 'Who',
  client: 'Client',
  priority: 'Priority',
  due: 'Due',
  waitingOn: 'Waiting on',
  nextAction: 'Next action',
  notes: 'Notes',
  added: 'Added',
  lastTouched: 'Last touched',
  order: 'Order',
} as const;
type FieldKey = keyof typeof FIELD_NAMES;
const REQUIRED: FieldKey[] = ['task', 'done', 'doneAt', 'scope', 'lastTouched'];

/**
 * API field name -> database field and the type it must have. These are the only fields a caller
 * may set (plus done, which also sets Done date). ID, Added and Last touched are set by the server.
 */
const EDITABLE: Record<string, { field: FieldKey; type: string }> = {
  text: { field: 'task', type: 'block' },
  scope: { field: 'scope', type: 'mSelect' },
  routine: { field: 'routine', type: 'select' },
  source: { field: 'source', type: 'select' },
  topic: { field: 'topic', type: 'select' },
  who: { field: 'who', type: 'select' },
  client: { field: 'client', type: 'checkbox' },
  priority: { field: 'priority', type: 'select' },
  due: { field: 'due', type: 'date' },
  waitingOn: { field: 'waitingOn', type: 'text' },
  nextAction: { field: 'nextAction', type: 'text' },
  notes: { field: 'notes', type: 'text' },
  order: { field: 'order', type: 'number' },
};
const SELECT_FIELDS: FieldKey[] = ['scope', 'routine', 'source', 'topic', 'who', 'priority'];
/** API names whose select options may be extended on request (new_options). */
const SELECT_API_FIELDS = ['scope', 'routine', 'source', 'topic', 'who', 'priority'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROW_ID_RE = /^\d{14}-[a-z0-9]{7}$/;
const MAX_BODY = 64 * 1024;
const MAX_TEXT = 4000;

interface Column {
  id: string;
  name: string;
  type: string;
  options?: Array<{ name: string }>;
}

interface Rendered {
  columns: Column[];
  rows: any[];
}

export interface TaskRow {
  row: string;
  text: string;
  slug: string;
  done: boolean;
  doneAt: string | null;
  scope: string[];
  routine: string;
  source: string;
  topic: string;
  who: string;
  client: boolean;
  priority: string;
  due: string | null;
  waitingOn: string;
  nextAction: string;
  notes: string;
  added: string | null;
  lastTouched: string | null;
  order: number;
}

/** ms timestamp -> YYYY-MM-DD in this process's time zone (the zone SiYuan dates are written in). */
function ymd(ms: number): string {
  const d = new Date(ms);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function cellValue(v: any): any {
  if (!v) return null;
  switch (v.type) {
    case 'block':
      return v.block ? v.block.content ?? '' : '';
    case 'text':
      return v.text ? v.text.content ?? '' : '';
    case 'checkbox':
      return !!(v.checkbox && v.checkbox.checked);
    case 'select':
      return v.mSelect && v.mSelect[0] ? v.mSelect[0].content : '';
    case 'mSelect':
      return (v.mSelect || []).map((m: any) => m.content);
    case 'number':
      return v.number && v.number.isNotEmpty !== false ? v.number.content : null;
    case 'date':
      return v.date && v.date.isNotEmpty ? ymd(v.date.content) : null;
    default:
      return null;
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export class TasksService {
  constructor(
    private siyuan: SiyuanTools,
    private config: TasksConfig
  ) {}

  /** Render every row of the configured view (all pages). */
  private async renderAll(): Promise<Rendered> {
    const pageSize = 500;
    let page = 1;
    let columns: Column[] = [];
    const rows: any[] = [];
    for (;;) {
      const data = await this.siyuan.av.renderAttributeView(this.config.avID, {
        viewID: this.config.viewID,
        page,
        pageSize,
      });
      const view = data?.view;
      if (!view) throw new Error('SiYuan returned no view for the task database.');
      if (data.viewID && data.viewID !== this.config.viewID) {
        throw new Error(
          `View ${this.config.viewID} was not found in the task database (SiYuan rendered ${data.viewID} instead). Check TASKS_VIEW_ID.`
        );
      }
      columns = view.columns || view.fields || [];
      const got: any[] = view.rows || [];
      rows.push(...got);
      const total = typeof view.rowCount === 'number' ? view.rowCount : rows.length;
      if (got.length < pageSize || rows.length >= total) break;
      page++;
      if (page > 100) throw new Error('Task database has more rows than this page will read.');
    }
    return { columns, rows };
  }

  private fieldMap(columns: Column[]): Partial<Record<FieldKey, Column>> {
    const map: Partial<Record<FieldKey, Column>> = {};
    for (const key of Object.keys(FIELD_NAMES) as FieldKey[]) {
      const col = columns.find((c) => c.name === FIELD_NAMES[key]);
      if (col) map[key] = col;
    }
    const missing = REQUIRED.filter((k) => !map[k]).map((k) => `"${FIELD_NAMES[k]}"`);
    if (missing.length) {
      throw new Error(
        `The task database view is missing required field(s) ${missing.join(', ')}. ` +
          `Available: ${columns.map((c) => `"${c.name}"`).join(', ')}.`
      );
    }
    return map;
  }

  private toRow(r: any, fm: Partial<Record<FieldKey, Column>>): TaskRow {
    const byKey = new Map<string, any>();
    for (const c of r.cells || []) if (c.value) byKey.set(c.value.keyID, cellValue(c.value));
    const get = (k: FieldKey) => (fm[k] ? byKey.get(fm[k]!.id) : undefined);
    return {
      row: r.id,
      text: get('task') ?? '',
      slug: get('slug') ?? '',
      done: !!get('done'),
      doneAt: get('doneAt') ?? null,
      scope: get('scope') ?? [],
      routine: get('routine') ?? '',
      source: get('source') ?? '',
      topic: get('topic') ?? '',
      who: get('who') ?? '',
      client: !!get('client'),
      priority: get('priority') ?? '',
      due: get('due') ?? null,
      waitingOn: get('waitingOn') ?? '',
      nextAction: get('nextAction') ?? '',
      notes: get('notes') ?? '',
      added: get('added') ?? null,
      lastTouched: get('lastTouched') ?? null,
      order: Number(get('order') ?? 0) || 0,
    };
  }

  /**
   * Rows, optionally filtered. scope: a Scope value ("All" or omitted = every scope).
   * status: "open" | "done" | "all" (default "all").
   */
  async list(
    filter: { scope?: string; status?: string } = {}
  ): Promise<{ rows: TaskRow[]; options: Record<string, string[]>; editable: string[] }> {
    const status = filter.status || 'all';
    if (!['open', 'done', 'all'].includes(status)) {
      throw new HttpError(400, `status must be open, done or all, got ${JSON.stringify(status)}.`);
    }
    const { columns, rows } = await this.renderAll();
    const fm = this.fieldMap(columns);
    const options: Record<string, string[]> = {};
    for (const k of SELECT_FIELDS) {
      if (fm[k]) options[k] = (fm[k]!.options || []).map((o) => o.name);
    }
    const editable = Object.keys(EDITABLE).filter((k) => fm[EDITABLE[k].field]);
    let out = rows.map((r) => this.toRow(r, fm));
    if (filter.scope && filter.scope !== 'All') out = out.filter((t) => t.scope.includes(filter.scope!));
    if (status !== 'all') out = out.filter((t) => t.done === (status === 'done'));
    return { rows: out, options, editable };
  }

  /**
   * Turn one API field into a cell write. Select values must already be options unless the
   * field is named in newOptions (protocol: a new repo scope, a new topic or source code).
   */
  private encode(
    name: string,
    raw: any,
    fm: Partial<Record<FieldKey, Column>>,
    put: (k: FieldKey, value: any, readAs: any) => void,
    newOptions: string[]
  ): void {
    const spec = EDITABLE[name];
    if (!spec) {
      throw new HttpError(
        400,
        `Field "${name}" cannot be set here. Allowed: done, ${Object.keys(EDITABLE).join(', ')}.`
      );
    }
    const col = fm[spec.field];
    if (!col) throw new HttpError(400, `The database has no "${FIELD_NAMES[spec.field]}" field.`);
    if (col.type !== spec.type) {
      throw new HttpError(500, `Field "${col.name}" is type ${col.type}, expected ${spec.type}; refusing to write.`);
    }
    const allowed = (col.options || []).map((o) => o.name);
    // 默认不允许写出新选项：内核会静默创建，拼写错误就会变成一个新的分类
    const checkOption = (v: string) => {
      if (v && !allowed.includes(v) && !newOptions.includes(name)) {
        throw new HttpError(
          400,
          `"${v}" is not an option of ${col.name}. Options: ${allowed.join(', ')}. ` +
            `If a new one is really meant, pass "new_options": ["${name}"].`
        );
      }
    };
    switch (spec.type) {
      case 'date':
        if (raw === null || raw === '') put(spec.field, null, null);
        else if (typeof raw === 'string' && DATE_RE.test(raw)) put(spec.field, raw, raw);
        else throw new HttpError(400, `"${name}" must be YYYY-MM-DD or null.`);
        return;
      case 'select': {
        const v = raw === null ? '' : String(raw).trim();
        checkOption(v);
        put(spec.field, v || null, v);
        return;
      }
      case 'mSelect': {
        const arr = raw === null ? [] : Array.isArray(raw) ? raw.map((x) => String(x).trim()) : [String(raw).trim()];
        if (arr.some((v) => !v)) throw new HttpError(400, `"${name}" has an empty value.`);
        arr.forEach(checkOption);
        put(spec.field, arr, arr);
        return;
      }
      case 'checkbox':
        if (typeof raw !== 'boolean') throw new HttpError(400, `"${name}" must be true or false.`);
        put(spec.field, raw, raw);
        return;
      case 'number': {
        if (raw === null || raw === '') {
          put(spec.field, null, 0);
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new HttpError(400, `"${name}" must be a number.`);
        put(spec.field, n, n);
        return;
      }
      default: {
        const v = raw === null ? '' : String(raw);
        if (v.length > MAX_TEXT) throw new HttpError(400, `"${name}" is longer than ${MAX_TEXT} characters.`);
        if (spec.field === 'task' && !v.trim()) throw new HttpError(400, 'The task text cannot be empty.');
        put(spec.field, v, v);
      }
    }
  }

  /** Poll the row until every expected value shows, or fail loudly naming the differences. */
  private async verify(
    row: string,
    fm: Partial<Record<FieldKey, Column>>,
    expected: Partial<Record<FieldKey, any>>
  ): Promise<TaskRow> {
    // FieldKey 与 TaskRow 属性名只在主键上不同（task -> text）
    const prop = (k: FieldKey) => (k === 'task' ? 'text' : k);
    const same = (got: any, want: any) =>
      want === null ? got === null || got === '' : JSON.stringify(got) === JSON.stringify(want);
    const readRow = async () => {
      const r = await this.renderAll();
      const found = r.rows.find((x) => x.id === row);
      if (!found) throw new Error('row not visible yet');
      return this.toRow(found, fm);
    };
    const keys = Object.keys(expected) as FieldKey[];
    const outcome = await readBackUntil(readRow, (t) => keys.every((k) => same((t as any)[prop(k)], expected[k])), {
      attempts: 6,
    });
    if (!outcome.verified) {
      const got = outcome.observed;
      const diff = got
        ? keys
            .filter((k) => !same((got as any)[prop(k)], expected[k]))
            .map((k) => `${FIELD_NAMES[k]}: wanted ${JSON.stringify(expected[k])}, SiYuan shows ${JSON.stringify((got as any)[prop(k)])}`)
            .join('; ')
        : 'the row could not be read back';
      throw new HttpError(502, `SiYuan did not confirm the change (${diff}). Re-read before retrying.`);
    }
    return outcome.observed!;
  }

  /**
   * Apply one row's changes. `today` (YYYY-MM-DD) should come from the caller, so "done today" is
   * the user's day; without it the owner's fixed UTC-6 date is used.
   */
  async update(body: any): Promise<{ row: TaskRow; verified: true }> {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected a JSON object.');
    const { row, changes } = body;
    const today = checkToday(body.today);
    const newOptions = checkNewOptions(body.new_options);
    if (typeof row !== 'string' || !ROW_ID_RE.test(row)) {
      throw new HttpError(400, `Invalid row id ${JSON.stringify(row)}.`);
    }
    if (!changes || typeof changes !== 'object' || !Object.keys(changes).length) {
      throw new HttpError(400, 'Nothing to change: "changes" is empty.');
    }

    const { columns, rows } = await this.renderAll();
    const fm = this.fieldMap(columns);
    if (!rows.some((r) => r.id === row)) {
      throw new HttpError(404, `Row ${row} is not in the task database.`);
    }

    const updates: Array<{ itemID: string; keyID: string; value: any }> = [];
    const expected: Partial<Record<FieldKey, any>> = {};
    const put = (k: FieldKey, value: any, readAs: any) => {
      updates.push({ itemID: row, keyID: fm[k]!.id, value });
      expected[k] = readAs;
    };

    for (const [name, raw] of Object.entries(changes)) {
      if (name === 'done') {
        if (typeof raw !== 'boolean') throw new HttpError(400, '"done" must be true or false.');
        put('done', raw, raw);
        put('doneAt', raw ? today : null, raw ? today : null);
        continue;
      }
      this.encode(name, raw, fm, put, newOptions);
    }
    put('lastTouched', today, today);

    await this.siyuan.av.batchSetCells(this.config.avID, updates);
    return { row: await this.verify(row, fm, expected), verified: true };
  }

  /**
   * Add one open task. Required: task, id, scope, source, topic, who. The ID must be unused
   * (protocol: search before adding; if taken, add a date suffix). Never deletes anything.
   */
  async add(body: any): Promise<{ row: TaskRow; verified: true }> {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected a JSON object.');
    const today = checkToday(body.today);
    const newOptions = checkNewOptions(body.new_options);
    const required = ['task', 'id', 'scope', 'source', 'topic', 'who'];
    const missing = required.filter((k) => body[k] === undefined || body[k] === null || body[k] === '' ||
      (Array.isArray(body[k]) && !body[k].length));
    if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}.`);
    const slug = String(body.id).trim();
    if (!SLUG_RE.test(slug)) {
      throw new HttpError(400, `ID "${slug}" must be lowercase letters, digits and hyphens (e.g. nas-fix-backup).`);
    }
    const allowedKeys = new Set([...Object.keys(EDITABLE), 'task', 'id', 'today', 'new_options']);
    const unknown = Object.keys(body).filter((k) => !allowedKeys.has(k));
    if (unknown.length) {
      throw new HttpError(400, `Unknown field(s) ${unknown.join(', ')}. Allowed: task, id, ${Object.keys(EDITABLE).filter((k) => k !== 'text').join(', ')}, today, new_options.`);
    }

    const { columns, rows } = await this.renderAll();
    const fm = this.fieldMap(columns);
    if (!fm.slug) throw new HttpError(500, 'The database has no "ID" field; cannot add safely.');
    const existing = rows.map((r) => this.toRow(r, fm));
    const clash = existing.find((t) => t.slug.toLowerCase() === slug.toLowerCase());
    if (clash) {
      throw new HttpError(
        409,
        `ID "${slug}" is already used by row ${clash.row} (${clash.done ? 'done' : 'open'}: "${clash.text.slice(0, 80)}"). ` +
          `If this is new work, use "${slug}-${today.replace(/-/g, '')}"; if it is the same work, update that row instead.`
      );
    }

    const values: Record<string, any> = {};
    const expected: Partial<Record<FieldKey, any>> = {};
    const put = (k: FieldKey, value: any, readAs: any) => {
      values[fm[k]!.id] = value;
      expected[k] = readAs;
    };
    this.encode('text', body.task, fm, put, newOptions);
    put('slug', slug, slug);
    for (const name of Object.keys(EDITABLE)) {
      if (name !== 'text' && body[name] !== undefined) this.encode(name, body[name], fm, put, newOptions);
    }
    put('done', false, false);
    if (fm.added) put('added', today, today);
    put('lastTouched', today, today);

    // 与思源自身的 ID 同形：当前时间 + 7 位随机；ID 唯一性已在上面按 slug 检查过
    const itemID = newBlockId();
    await this.siyuan.av.appendDetachedRowsWithValues(this.config.avID, [{ [ITEM_ID_KEY]: itemID, ...values }], {
      onExistingItem: 'reject',
    });
    return { row: await this.verify(itemID, fm, expected), verified: true };
  }
}

/** A SiYuan-shaped ID: local yyyyMMddHHmmss + '-' + 7 lowercase alphanumerics. */
function newBlockId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const r = [...randomBytes(7)].map((b) => abc[b % abc.length]).join('');
  return ts + '-' + r;
}

/** Today in the owner's zone: fixed UTC-6 all year (not Mountain Time). */
function defaultToday(): string {
  return new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
}

function checkToday(v: any): string {
  if (v === undefined || v === null) return defaultToday();
  if (typeof v !== 'string' || !DATE_RE.test(v)) {
    throw new HttpError(400, `"today" must be YYYY-MM-DD, got ${JSON.stringify(v)}.`);
  }
  return v;
}

function checkNewOptions(v: any): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => !SELECT_API_FIELDS.includes(x))) {
    throw new HttpError(400, `"new_options" must be a list drawn from ${SELECT_API_FIELDS.join(', ')}.`);
  }
  return v;
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  res.writeHead(status, {
    'Content-Type': type + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(type === 'text/html'
      ? {
          'Content-Security-Policy':
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        }
      : {}),
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        reject(new HttpError(400, 'Body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Handle a request under /tasks. Returns false if the path is not ours, so the caller can carry
 * on routing.
 */
export async function handleTasksRequest(
  service: TasksService,
  req: IncomingMessage,
  res: ServerResponse,
  log: (msg: string) => void
): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/tasks' && !path.startsWith('/tasks/')) return false;

  try {
    if (path === '/tasks' && req.method === 'GET') {
      send(res, 200, TASKS_PAGE_HTML, 'text/html');
    } else if (path === '/tasks/api/rows' && req.method === 'GET') {
      send(res, 200, await service.list({
        scope: url.searchParams.get('scope') || undefined,
        status: url.searchParams.get('status') || undefined,
      }));
    } else if ((path === '/tasks/api/update' || path === '/tasks/api/add') && req.method === 'POST') {
      if (req.headers['x-tasks-client'] !== '1') {
        throw new HttpError(403, 'Missing X-Tasks-Client header.');
      }
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        throw new HttpError(415, 'Content-Type must be application/json.');
      }
      const origin = req.headers.origin;
      // 反向代理可能改写 Host，所以也接受 X-Forwarded-Host
      const hosts = [req.headers.host, req.headers['x-forwarded-host']].flat().filter(Boolean);
      if (origin && !hosts.includes(new URL(origin).host)) {
        throw new HttpError(403, `Cross-origin write from ${origin} refused.`);
      }
      const body = await readBody(req);
      send(res, 200, path === '/tasks/api/add' ? await service.add(body) : await service.update(body));
    } else {
      send(res, 404, { error: `No ${req.method} ${path}.` });
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const msg = e instanceof Error ? e.message : String(e);
    if (status >= 500) log(`tasks: ${req.method} ${path} failed: ${msg}`);
    if (!res.headersSent) send(res, status, { error: msg });
  }
  return true;
}
