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
  lastTouched: 'Last touched',
  order: 'Order',
} as const;
type FieldKey = keyof typeof FIELD_NAMES;
const REQUIRED: FieldKey[] = ['task', 'done', 'doneAt', 'scope', 'lastTouched'];

/** Fields a browser may change, and the type each must have in SiYuan. */
const EDITABLE: Record<string, { field: FieldKey; type: string }> = {
  text: { field: 'task', type: 'block' },
  due: { field: 'due', type: 'date' },
  priority: { field: 'priority', type: 'select' },
  who: { field: 'who', type: 'select' },
  waitingOn: { field: 'waitingOn', type: 'text' },
  nextAction: { field: 'nextAction', type: 'text' },
  notes: { field: 'notes', type: 'text' },
};

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
      lastTouched: get('lastTouched') ?? null,
      order: Number(get('order') ?? 0) || 0,
    };
  }

  async list(): Promise<{ rows: TaskRow[]; options: Record<string, string[]>; editable: string[] }> {
    const { columns, rows } = await this.renderAll();
    const fm = this.fieldMap(columns);
    const options: Record<string, string[]> = {};
    for (const k of ['priority', 'who', 'scope', 'source', 'routine'] as FieldKey[]) {
      if (fm[k]) options[k] = (fm[k]!.options || []).map((o) => o.name);
    }
    const editable = Object.keys(EDITABLE).filter((k) => fm[EDITABLE[k].field]);
    return { rows: rows.map((r) => this.toRow(r, fm)), options, editable };
  }

  /**
   * Apply one row's changes. `today` comes from the browser so "done today" is the user's day,
   * not the server's.
   */
  async update(body: any): Promise<{ row: TaskRow; verified: true }> {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected a JSON object.');
    const { row, changes, today } = body;
    if (typeof row !== 'string' || !ROW_ID_RE.test(row)) {
      throw new HttpError(400, `Invalid row id ${JSON.stringify(row)}.`);
    }
    if (typeof today !== 'string' || !DATE_RE.test(today)) {
      throw new HttpError(400, `"today" must be YYYY-MM-DD, got ${JSON.stringify(today)}.`);
    }
    if (!changes || typeof changes !== 'object' || !Object.keys(changes).length) {
      throw new HttpError(400, 'Nothing to change: "changes" is empty.');
    }

    const { columns, rows } = await this.renderAll();
    const fm = this.fieldMap(columns);
    if (!rows.some((r) => r.id === row)) {
      throw new HttpError(404, `Row ${row} is not in the task database.`);
    }

    // expected: field key -> value as the page reads it back (for verification)
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
      const spec = EDITABLE[name];
      if (!spec) {
        throw new HttpError(
          400,
          `Field "${name}" cannot be changed here. Allowed: done, ${Object.keys(EDITABLE).join(', ')}.`
        );
      }
      const col = fm[spec.field];
      if (!col) throw new HttpError(400, `The database has no "${FIELD_NAMES[spec.field]}" field.`);
      if (col.type !== spec.type) {
        throw new HttpError(
          500,
          `Field "${col.name}" is type ${col.type}, expected ${spec.type}; refusing to write.`
        );
      }
      if (spec.type === 'date') {
        if (raw === null || raw === '') put(spec.field, null, null);
        else if (typeof raw === 'string' && DATE_RE.test(raw)) put(spec.field, raw, raw);
        else throw new HttpError(400, `"${name}" must be YYYY-MM-DD or empty.`);
      } else if (spec.type === 'select') {
        const v = raw === null ? '' : String(raw);
        const allowed = (col.options || []).map((o) => o.name);
        // 不允许写出新选项：内核会静默创建，页面上的拼写错误就会变成一个新的分类
        if (v && !allowed.includes(v)) {
          throw new HttpError(400, `"${v}" is not an option of ${col.name}. Options: ${allowed.join(', ')}.`);
        }
        put(spec.field, v || null, v);
      } else {
        const v = raw === null ? '' : String(raw);
        if (v.length > MAX_TEXT) throw new HttpError(400, `"${name}" is longer than ${MAX_TEXT} characters.`);
        if (spec.field === 'task' && !v.trim()) throw new HttpError(400, 'The task text cannot be empty.');
        put(spec.field, v, v);
      }
    }
    put('lastTouched', today, today);

    await this.siyuan.av.batchSetCells(this.config.avID, updates);

    const readRow = async () => {
      const r = await this.renderAll();
      const found = r.rows.find((x) => x.id === row);
      if (!found) throw new Error('row vanished');
      return this.toRow(found, fm);
    };
    // FieldKey 与 TaskRow 属性名只在主键上不同（task -> text）
    const prop = (k: FieldKey) => (k === 'task' ? 'text' : k);
    const matches = (t: TaskRow) =>
      (Object.keys(expected) as FieldKey[]).every((k) => {
        const got = (t as any)[prop(k)];
        const want = expected[k];
        if (want === null) return got === null || got === '';
        return got === want;
      });
    const outcome = await readBackUntil(readRow, matches, { attempts: 6 });
    if (!outcome.verified) {
      const got = outcome.observed;
      const diff = got
        ? (Object.keys(expected) as FieldKey[])
            .filter((k) => (got as any)[prop(k)] !== expected[k])
            .map((k) => `${FIELD_NAMES[k]}: wanted ${JSON.stringify(expected[k])}, SiYuan shows ${JSON.stringify((got as any)[prop(k)])}`)
            .join('; ')
        : 'the row could not be read back';
      throw new HttpError(502, `SiYuan did not confirm the change (${diff}). Reload to see the real state.`);
    }
    return { row: outcome.observed!, verified: true };
  }
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
      send(res, 200, await service.list());
    } else if (path === '/tasks/api/update' && req.method === 'POST') {
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
      send(res, 200, await service.update(await readBody(req)));
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
