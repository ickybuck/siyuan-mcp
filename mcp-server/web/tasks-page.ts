/**
 * The task-list page served at GET /tasks. One self-contained HTML document: no external scripts,
 * fonts or styles, so the Content-Security-Policy in tasks.ts can stay at 'self' + inline.
 *
 * 行为照搬原来的 claude.ai 任务页（Master Task List artifact）：范围选择器、按来源分组、
 * D/W/M 例行标记、客户与到期高亮、复制按钮。硬性规则：只有复选框能勾选任务；点击任务文字
 * 只展开/收起，绝不勾选（文字是普通元素，绝不是绑定复选框的 <label>）。
 *
 * 注意：这里是 String.raw 模板，页面脚本里不要使用反引号或 "${"。
 */
export const TASKS_PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Tasks</title>
<link rel="icon" href="/tasks/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/tasks/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="/tasks/apple-touch-icon.png">
<meta name="theme-color" content="#2f6f5e">
<style>
:root {
  --bg: #f6f7f5; --panel: #ffffff; --fg: #1d2421; --muted: #66706b; --line: #dde2de;
  --accent: #2f6f5e; --track: #e3e8e4; --warn: #a3440f; --warn-bg: #fbeee4;
  --bar-done: #2f6f5e; --bar-near: #c9a227; --bar-open: #c0392b;
  --r-d: #8a4fb8; --r-w: #2f6f5e; --r-m: #2b63a8;
  --client: #b0347a; --client-bg: #fbeef5; --err: #b3261e;
  --ui: system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #141917; --panel: #1b211e; --fg: #e3e8e5; --muted: #95a09a; --line: #2b3430;
  --accent: #6fbfa6; --track: #2a332f; --warn: #f0a073; --warn-bg: #33241b; color-scheme: dark;
  --bar-done: #6fbfa6; --bar-near: #e0c050; --bar-open: #e0675a;
  --r-d: #c39be6; --r-w: #6fbfa6; --r-m: #86b2ea;
  --client: #f08cc4; --client-bg: #34202b; --err: #f2b8b5 } }
:root[data-theme="dark"] {
  --bg: #141917; --panel: #1b211e; --fg: #e3e8e5; --muted: #95a09a; --line: #2b3430;
  --accent: #6fbfa6; --track: #2a332f; --warn: #f0a073; --warn-bg: #33241b; color-scheme: dark;
  --bar-done: #6fbfa6; --bar-near: #e0c050; --bar-open: #e0675a;
  --r-d: #c39be6; --r-w: #6fbfa6; --r-m: #86b2ea;
  --client: #f08cc4; --client-bg: #34202b; --err: #f2b8b5 }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.35 var(--ui);
  padding-block: 10px 16px; padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.wrap { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 6px; }
h1 { font-size: 15px; margin: 0 0 2px; font-weight: 600; }
.bar { display: flex; gap: 10px; align-items: center; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
.overall { flex: 1; min-width: 120px; }
select, input, textarea { font: 12px var(--ui); color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 2px 4px; }
select#scope { font-weight: 600; }
select:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.group { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; }
.gh { display: grid; grid-template-columns: 1fr 110px auto; gap: 8px; align-items: center;
  padding: 4px 8px; cursor: pointer; user-select: none; }
.gh:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.gname { font-weight: 600; min-width: 0; }
.track { height: 6px; background: var(--track); border-radius: 3px; overflow: hidden; }
.fill { height: 100%; background: var(--bar-open); transition: width .2s; }
.fill.near { background: var(--bar-near); }
.fill.done { background: var(--bar-done); }
.count { font: 11px var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; min-width: 32px; text-align: right; }
ul { list-style: none; margin: 0; padding: 0 8px 4px 8px; border-top: 1px solid var(--line); }
li { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; padding: 2px 4px; margin-inline: -4px; border-radius: 3px; }
li input[type=checkbox] { margin: 2px 0 0; accent-color: var(--accent); flex: none; cursor: pointer; }
.body { flex: 1; min-width: 0; }
.txt { display: block; overflow-wrap: anywhere; }
li.clamp .txt { cursor: pointer; }
li.clamp:not(.open) .txt { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; }
li.done .tx { color: var(--muted); text-decoration: line-through; }
.seemore { display: none; margin-left: auto; font: inherit; font-size: 12px; color: var(--accent); background: none; border: 0; padding: 0 0 1px; cursor: pointer; }
li.clamp .seemore { display: block; }
.seemore:hover { text-decoration: underline; }
li.client { background: var(--client-bg); box-shadow: inset 3px 0 0 var(--client); }
li.client .tx { font-weight: 600; }
li.saving { opacity: .6; }
.chip { display: inline-block; font: 600 9px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
  border: 1px solid var(--line); border-radius: 3px; padding: 2px 4px; margin-right: 4px; vertical-align: 1px; white-space: nowrap; }
.chip.client { color: var(--client); border-color: var(--client); }
li.due { background: var(--warn-bg); box-shadow: inset 3px 0 0 var(--warn); }
li.due.client { box-shadow: inset 3px 0 0 var(--client); }
.chip.due { color: var(--warn); border-color: var(--warn); }
.chip.claude { border-color: var(--accent); font-size: 11px; padding: 0 3px; vertical-align: 0; }
.chip.p1 { color: var(--warn); border-color: var(--warn); }
.rt { flex: none; width: 16px; height: 16px; border-radius: 3px; color: var(--panel); font: 700 10px/16px var(--mono);
  text-align: center; margin-top: 1px; background: transparent; }
.rt.d { background: var(--r-d); } .rt.w { background: var(--r-w); } .rt.m { background: var(--r-m); }
.icon { flex: none; background: none; border: 0; padding: 1px 2px; margin-top: 1px; color: var(--muted); cursor: pointer; border-radius: 3px; line-height: 0; }
.icon:hover { color: var(--accent); }
.icon:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.icon.ok { color: var(--bar-done); }
.icon svg { width: 14px; height: 14px; }
.group.collapsed ul { display: none; }
li.more { padding: 3px 0 1px; }
li.more button, .note button { font: inherit; font-size: 12px; color: var(--accent); background: none; border: 0; padding: 0; cursor: pointer; }
li.more button:hover, .note button:hover { text-decoration: underline; }
.filters { display: inline-flex; gap: 4px; }
.filters button { font: 600 10px/1 var(--mono); letter-spacing: .06em; color: var(--muted);
  background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 3px 6px; cursor: pointer; }
.filters button[aria-pressed="true"] { color: var(--accent); border-color: var(--accent); }
.empty, .note { color: var(--muted); font-size: 12px; padding: 4px 0; }
.note.err { color: var(--err); }
/* Edit form: opens under its row, full width. */
form.edit { flex-basis: 100%; display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center;
  margin: 4px 0 6px 22px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); }
form.edit label { font-size: 11px; color: var(--muted); }
form.edit textarea { width: 100%; min-height: 4.5em; resize: vertical; }
form.edit input[type=text] { width: 100%; }
form.edit .actions { grid-column: 1 / -1; display: flex; gap: 8px; justify-content: flex-end; }
form.edit .actions button { font: 600 12px var(--ui); border-radius: 3px; padding: 3px 10px; cursor: pointer; border: 1px solid var(--line); background: var(--panel); color: var(--fg); }
form.edit .actions button.save { background: var(--accent); border-color: var(--accent); color: var(--panel); }
@media (max-width: 480px) { .gh { grid-template-columns: 1fr auto; } .gh .track { grid-column: 1 / -1; grid-row: 2; }
  form.edit { grid-template-columns: 1fr; margin-left: 0; } }
@media (prefers-reduced-motion: reduce) { .fill { transition: none; } }
</style>
</head>
<body>
<div class="wrap">
  <h1 id="heading">Tasks</h1>
  <div class="bar">
    <select id="scope" aria-label="Show tasks for"></select>
    <div class="overall"><div class="track"><div class="fill" id="overall-fill" style="width:0"></div></div></div>
    <span class="count" id="overall-count">–</span>
    <div class="filters" id="filters" role="group" aria-label="Show tasks from routine">
      <button type="button" data-tag="" title="All">All</button>
      <button type="button" data-tag="Daily" title="Daily routine">D</button>
      <button type="button" data-tag="Weekly" title="Weekly routine">W</button>
      <button type="button" data-tag="Monthly" title="Monthly routine">M</button>
    </div>
  </div>
  <div id="list"><div class="empty">Loading the task list from SiYuan…</div></div>
  <div class="note" id="status" role="status"></div>
</div>
<script>
'use strict';
// Scope: ?scope=truenas (or the old #truenas) picks the list; with neither, Routines.
var DEFAULT_SCOPE = 'Routines';
var SOURCES = ['TvH', 'PE', 'VV', 'GM', 'BD', 'Personal'];
var LETTER = { Daily: 'D', Weekly: 'W', Monthly: 'M' };
var KEEP_DONE_DAYS = 7;
var REFRESH_MS = 60000;
var COPY_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M3.5 10.5h-.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5"/></svg>';
var EDIT_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>';
var API = location.pathname.replace(/\/+$/, '') + '/api/';

var listEl = document.getElementById('list');
var statusEl = document.getElementById('status');
var scopeEl = document.getElementById('scope');
var items = [], options = {}, editable = [], loaded = false;
var pending = new Map();   // row -> done value written, not yet confirmed
var saving = new Set();    // rows with a write in flight
var editing = null;        // row whose edit form is open
var collapsed = new Set(JSON.parse(safeGet('collapsed') || '[]'));
var showDone = new Set(JSON.parse(safeGet('showDone') || '[]'));
var expanded = new Set();
var tagFilter = safeGet('tagFilter') || '';

function validScope(s) { return /^[A-Za-z0-9._~-]+$/.test(s || '') ? s : ''; }
var params = new URLSearchParams(location.search);
var scope = validScope(params.get('scope')) || validScope(location.hash.slice(1)) || DEFAULT_SCOPE;

function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function today() { return ymd(new Date()); }
function addDays(s, n) { var p = s.split('-'); return ymd(new Date(+p[0], +p[1] - 1, +p[2] + n)); }
function fmtDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

function setScope(s) {
  scope = s;
  var u = new URL(location.href); u.hash = '';
  if (s === DEFAULT_SCOPE) u.searchParams.delete('scope'); else u.searchParams.set('scope', s);
  history.replaceState(null, '', u.toString());
  var label = s === 'All' ? 'All' : s;
  document.title = label + ' Tasks';
  document.getElementById('heading').textContent = label + ' tasks';
}
setScope(scope);

document.querySelectorAll('#filters button').forEach(function (b) {
  b.addEventListener('click', function () { tagFilter = b.dataset.tag; safeSet('tagFilter', tagFilter); render(); });
});
scopeEl.addEventListener('change', function () { setScope(scopeEl.value); render(); });

function setFill(el, d, n) {
  var pct = n ? 100 * d / n : 0;
  el.style.width = pct + '%';
  el.className = 'fill' + (n && d === n ? ' done' : pct >= 90 ? ' near' : '');
}
function isUrgent(it) { return !it.done && !!it.due && it.due <= addDays(today(), 7); }
function copyLine(it) {
  return '[' + [it.routine, it.source, it.topic, it.client ? 'Client' : '', it.slug].filter(Boolean).join(' · ') + '] ' + it.text;
}
function iconButton(svg, title, onClick) {
  var b = document.createElement('button'); b.type = 'button'; b.className = 'icon';
  b.title = title; b.setAttribute('aria-label', title); b.innerHTML = svg;
  b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); onClick(b); });
  return b;
}
function copyButton(it) {
  return iconButton(COPY_SVG, 'Copy this task', function (b) {
    navigator.clipboard.writeText(copyLine(it)).then(function () {
      b.classList.add('ok'); b.title = 'Copied';
      setTimeout(function () { b.classList.remove('ok'); b.title = 'Copy this task'; }, 1500);
    }, function () {
      var lb = b.parentElement.querySelector('.tx');
      if (lb) { var r = document.createRange(); r.selectNodeContents(lb); var s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      say('Copying is blocked here. The task text is selected; press Ctrl+C.');
    });
  });
}
function rt(routine) {
  var s = document.createElement('span'); var l = LETTER[routine] || '';
  s.className = 'rt ' + l.toLowerCase(); s.textContent = l; s.title = routine ? routine + ' routine' : 'Not from a routine';
  return s;
}
function chip(text, cls) { var c = document.createElement('span'); c.className = 'chip' + (cls ? ' ' + cls : ''); c.textContent = text; return c; }
function say(msg, isErr) { statusEl.textContent = msg || ''; statusEl.className = 'note' + (isErr ? ' err' : ''); }

function measureClamps() {
  listEl.querySelectorAll('li[data-row]').forEach(function (li) {
    var txt = li.querySelector('.txt');
    var wasOpen = li.classList.contains('open');
    li.classList.remove('open'); li.classList.add('clamp');
    var over = txt.scrollHeight > txt.clientHeight + 1;
    li.classList.toggle('clamp', over);
    if (wasOpen) li.classList.add('open');
  });
}
var resizeTimer = 0;
new ResizeObserver(function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(measureClamps, 80); }).observe(listEl);

function fillScopes() {
  var fixed = ['All', 'Routines', 'General'];
  var seen = new Set(fixed);
  (options.scope || []).forEach(function (s) { seen.add(s); });
  items.forEach(function (it) { it.scope.forEach(function (s) { seen.add(s); }); });
  seen.add(scope);
  var list = fixed.concat(Array.from(seen).filter(function (s) { return fixed.indexOf(s) < 0; }).sort());
  var same = scopeEl.options.length === list.length && Array.prototype.every.call(scopeEl.options, function (o, i) { return o.value === list[i]; });
  if (!same) {
    scopeEl.replaceChildren.apply(scopeEl, list.map(function (s) {
      var o = document.createElement('option'); o.value = s; o.textContent = s === 'All' ? 'All scopes' : s; return o;
    }));
  }
  scopeEl.value = scope;
}

function selectEl(name, values, current) {
  var s = document.createElement('select'); s.name = name;
  [''].concat(values).forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = v || '—'; s.appendChild(o); });
  s.value = current || '';
  return s;
}

function editForm(it) {
  var f = document.createElement('form'); f.className = 'edit';
  function row(label, el) {
    var id = 'e-' + el.name + '-' + it.row; el.id = id;
    var l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
    f.append(l, el);
  }
  var fields = [];
  if (editable.indexOf('text') >= 0) { var t = document.createElement('textarea'); t.name = 'text'; t.value = it.text; t.required = true; row('Task', t); fields.push('text'); }
  if (editable.indexOf('due') >= 0) { var d = document.createElement('input'); d.type = 'date'; d.name = 'due'; d.value = it.due || ''; row('Due', d); fields.push('due'); }
  if (editable.indexOf('priority') >= 0) { row('Priority', selectEl('priority', options.priority || [], it.priority)); fields.push('priority'); }
  if (editable.indexOf('who') >= 0) { row('Who', selectEl('who', options.who || [], it.who)); fields.push('who'); }
  [['waitingOn', 'Waiting on'], ['nextAction', 'Next action'], ['notes', 'Notes']].forEach(function (p) {
    if (editable.indexOf(p[0]) < 0) return;
    var i = document.createElement('input'); i.type = 'text'; i.name = p[0]; i.value = it[p[0]] || ''; row(p[1], i); fields.push(p[0]);
  });
  var act = document.createElement('div'); act.className = 'actions';
  var cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', function () { editing = null; render(); });
  var save = document.createElement('button'); save.type = 'submit'; save.className = 'save'; save.textContent = 'Save';
  act.append(cancel, save); f.appendChild(act);
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var changes = {};
    fields.forEach(function (k) {
      var v = f.elements[k].value;
      var old = it[k] == null ? '' : it[k];
      if (v !== old) changes[k] = v === '' ? null : v;
    });
    if (!Object.keys(changes).length) { editing = null; render(); return; }
    if (changes.text === null) { say('The task text cannot be empty.', true); return; }
    save.disabled = true; save.textContent = 'Saving…';
    write(it, changes).then(function (ok) { if (ok) { editing = null; render(); } else { save.disabled = false; save.textContent = 'Save'; } });
  });
  return f;
}

function render() {
  fillScopes();
  document.querySelectorAll('#filters button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.tag === tagFilter)); });
  if (!loaded) return;
  var cutoff = addDays(today(), -KEEP_DONE_DAYS);
  var shown = items.filter(function (it) { return pending.has(it.row) || !it.done || (it.doneAt && it.doneAt >= cutoff); })
    .map(function (it) { return pending.has(it.row) ? Object.assign({}, it, { done: pending.get(it.row) }) : it; });
  if (scope !== 'All') shown = shown.filter(function (it) { return it.scope.indexOf(scope) >= 0; });
  if (tagFilter) shown = shown.filter(function (it) { return it.routine === tagFilter; });
  if (!shown.length) {
    listEl.innerHTML = '';
    var em = document.createElement('div'); em.className = 'empty';
    em.textContent = 'Nothing here for ' + (scope === 'All' ? 'any scope' : scope) + (tagFilter ? ' from the ' + tagFilter + ' routine' : '') + '.';
    listEl.appendChild(em);
    setFill(document.getElementById('overall-fill'), 0, 0);
    document.getElementById('overall-count').textContent = '0/0';
    return;
  }
  // Keep focus and typing in an open edit form across a background refresh.
  if (editing && listEl.querySelector('form.edit')) return;
  listEl.replaceChildren();
  var total = 0, done = 0;
  var extra = Array.from(new Set(shown.map(function (i) { return i.source || 'Other'; }).filter(function (s) { return SOURCES.indexOf(s) < 0; })));
  SOURCES.concat(extra).forEach(function (name) {
    var g = shown.filter(function (i) { return (i.source || 'Other') === name; });
    if (!g.length) return;
    g.sort(function (a, b) {
      return (a.done - b.done) || (isUrgent(b) - isUrgent(a)) || (b.client - a.client)
        || String(a.priority || 'P9').localeCompare(String(b.priority || 'P9'))
        || String(a.topic).localeCompare(String(b.topic)) || (a.order - b.order);
    });
    var d = g.filter(function (i) { return i.done; }).length, n = g.length;
    total += n; done += d;
    var sec = document.createElement('section');
    sec.className = 'group' + (collapsed.has(name) ? ' collapsed' : '');
    var gh = document.createElement('div'); gh.className = 'gh'; gh.tabIndex = 0;
    gh.setAttribute('role', 'button'); gh.setAttribute('aria-expanded', String(!collapsed.has(name)));
    var nm = document.createElement('span'); nm.className = 'gname'; nm.textContent = name;
    var tr = document.createElement('div'); tr.className = 'track';
    var fl = document.createElement('div'); setFill(fl, d, n); tr.appendChild(fl);
    var ct = document.createElement('span'); ct.className = 'count'; ct.textContent = d + '/' + n;
    gh.append(nm, tr, ct);
    var toggle = function () { collapsed.has(name) ? collapsed.delete(name) : collapsed.add(name); safeSet('collapsed', JSON.stringify(Array.from(collapsed))); render(); };
    gh.addEventListener('click', toggle);
    gh.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    var ul = document.createElement('ul');
    var showing = showDone.has(name);
    g.forEach(function (it) {
      if (it.done && !showing) return;
      var li = document.createElement('li'); li.dataset.row = it.row;
      li.className = [it.done ? 'done' : '', it.client ? 'client' : '', isUrgent(it) ? 'due' : '',
        expanded.has(it.row) ? 'open' : '', saving.has(it.row) ? 'saving' : ''].filter(Boolean).join(' ');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = it.done;
      cb.disabled = saving.has(it.row);
      cb.setAttribute('aria-label', 'Done: ' + it.text.slice(0, 80));
      cb.addEventListener('change', function () { setDone(it, cb.checked); });
      var body = document.createElement('div'); body.className = 'body';
      // A div, not a <label>: a label tied to the checkbox ticked the task on any click of its text.
      var lb = document.createElement('div'); lb.className = 'txt';
      if (isUrgent(it)) lb.append(chip('Due ' + fmtDate(it.due), 'due'));
      if (it.client) lb.append(chip('Client', 'client'));
      if (it.priority === 'P1' && !it.done) lb.append(chip('P1', 'p1'));
      if (it.topic) lb.append(chip(it.topic));
      if (it.who === 'Claude') { var c = chip('🤖', 'claude'); c.title = 'Claude does this without asking'; c.setAttribute('aria-label', 'Claude task'); lb.append(c); }
      var tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = it.text; lb.append(tx);
      var sm = document.createElement('button'); sm.type = 'button'; sm.className = 'seemore';
      var isOpen = expanded.has(it.row);
      sm.textContent = isOpen ? 'See less' : 'See more'; sm.setAttribute('aria-expanded', String(isOpen));
      var toggleOpen = function () {
        var open = !li.classList.contains('open');
        li.classList.toggle('open', open); open ? expanded.add(it.row) : expanded.delete(it.row);
        sm.textContent = open ? 'See less' : 'See more'; sm.setAttribute('aria-expanded', String(open));
      };
      sm.addEventListener('click', toggleOpen);
      // Clicking the text expands or contracts a long task; it never ticks. Selecting text does nothing.
      lb.addEventListener('click', function () {
        if (!li.classList.contains('clamp')) return;
        var sel = getSelection(); if (sel && String(sel).length) return;
        toggleOpen();
      });
      body.append(lb, sm);
      li.append(cb, rt(it.routine), body);
      if (editable.length) li.append(iconButton(EDIT_SVG, 'Edit this task', function () { editing = editing === it.row ? null : it.row; render(); }));
      li.append(copyButton(it));
      if (editing === it.row) li.append(editForm(it));
      ul.appendChild(li);
    });
    if (d) {
      var more = document.createElement('li'); more.className = 'more';
      var btn = document.createElement('button'); btn.type = 'button';
      btn.textContent = showing ? 'Hide completed tasks' : 'Unhide ' + d + ' completed task' + (d === 1 ? '' : 's');
      btn.addEventListener('click', function () { showing ? showDone.delete(name) : showDone.add(name); safeSet('showDone', JSON.stringify(Array.from(showDone))); render(); });
      more.appendChild(btn); ul.appendChild(more);
    }
    sec.append(gh, ul); listEl.appendChild(sec);
  });
  setFill(document.getElementById('overall-fill'), done, total);
  document.getElementById('overall-count').textContent = done + '/' + total;
  measureClamps();
  var f = listEl.querySelector('form.edit textarea'); if (f && document.activeElement === document.body) f.focus();
}

function api(path, init) {
  return fetch(API + path, init).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      return j;
    });
  });
}

var loading = false;
function load() {
  if (loading) return; loading = true;
  return api('rows').then(function (data) {
    items = data.rows; options = data.options || {}; editable = data.editable || [];
    pending.forEach(function (v, row) { var it = items.find(function (i) { return i.row === row; }); if (it && it.done === v) pending.delete(row); });
    loaded = true;
    if (/^Could not load/.test(statusEl.textContent)) say('');
    render();
  }).catch(function (e) {
    say('Could not load the list from SiYuan: ' + e.message + '. Retrying every minute.', true);
  }).finally(function () { loading = false; });
}

// One row's changes; the server writes, reads the row back from SiYuan, and only then answers.
function write(it, changes) {
  saving.add(it.row); render();
  return api('update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tasks-Client': '1' },
    body: JSON.stringify({ row: it.row, changes: changes, today: today() })
  }).then(function (res) {
    var i = items.findIndex(function (x) { return x.row === it.row; });
    if (i >= 0) items[i] = res.row;
    say('');
    return true;
  }).catch(function (e) {
    say('Not saved: ' + e.message, true);
    return false;
  }).finally(function () { saving.delete(it.row); pending.delete(it.row); render(); });
}

function setDone(it, value) {
  pending.set(it.row, value);
  write(it, { done: value });
}

load();
setInterval(function () { if (!document.hidden && !saving.size) load(); }, REFRESH_MS);
document.addEventListener('visibilitychange', function () { if (!document.hidden && !saving.size) load(); });
</script>
</body>
</html>
`;
