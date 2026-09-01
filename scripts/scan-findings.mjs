/**
 * Scan a Findings database for follow-up work recorded inside notes.
 *
 * Why this exists: a finding marked Closed can still carry live work. A verifier who confirms the
 * main fix often records a smaller problem found along the way — a guard applied to one branch of
 * two, an inventory gone stale — inside the notes rather than opening a new row. Those are
 * invisible to the status column and easy to lose. Two were found this way on 2026-08-31.
 *
 * It reads only the last verification section of each note (the part after the final separator),
 * so a fix description that quotes an old problem does not match, and prints a window around each
 * hit rather than whole notes, which run to several thousand characters each.
 *
 * Usage, from a machine that can reach the SiYuan kernel:
 *   SIYUAN_BASE_URL=... SIYUAN_TOKEN=... node scripts/scan-findings.mjs <av_id> [notes_field_id]
 *
 * The database and field IDs are workspace-specific and deliberately not hardcoded; they are in
 * the private project hub. Field IDs come from get_database.
 */

import { SiyuanTools } from '../dist/src/index.js';

const [avID, notesFieldArg] = process.argv.slice(2);
if (!avID) {
  console.error('Usage: node scripts/scan-findings.mjs <av_id> [notes_field_id]');
  process.exit(1);
}
if (!process.env.SIYUAN_BASE_URL || !process.env.SIYUAN_TOKEN) {
  console.error('SIYUAN_BASE_URL and SIYUAN_TOKEN must be set.');
  process.exit(1);
}

const MARKERS =
  /(STILL TRUE|STILL OUTSTANDING|STILL (?:FAILS|BROKEN|OPEN|NOT)|NOT FIXED|PARTIAL|REMAINS OPEN|FOLLOW-?UP|CAVEAT|WORTH A NEW ROW)/i;

// 最近一次核验写在最后一段分隔线之后。只看那一段：修复说明里常常引用旧问题的措辞，
// 整篇一起搜会把已经解决的事又报一遍。
const SEPARATOR = '─────';
const WINDOW_BEFORE = 200;
const WINDOW_AFTER = 500;

const siyuan = new SiyuanTools({
  baseUrl: process.env.SIYUAN_BASE_URL,
  token: process.env.SIYUAN_TOKEN,
});

const av = await siyuan.av.getAttributeView(avID);
const keyValues = av.keyValues || [];

const notesKey =
  notesFieldArg ||
  keyValues.find((kv) => kv?.key?.type === 'text' && /note/i.test(kv?.key?.name || ''))?.key?.id;
if (!notesKey) {
  console.error('Could not find a notes field. Pass its field ID as the second argument.');
  process.exit(1);
}

const label = new Map();
for (const kv of keyValues) {
  if (kv?.key?.type === 'block' || /^id$/i.test(kv?.key?.name || '')) {
    for (const value of kv.values || []) {
      const text = value?.block?.content ?? value?.number?.content;
      if (text !== undefined) label.set(value.blockID, text);
    }
  }
}

const notes = keyValues.find((kv) => kv?.key?.id === notesKey);
let hits = 0;

for (const value of notes?.values || []) {
  const content = value?.text?.content;
  if (!content) continue;

  const latest = content.split(SEPARATOR).pop();
  const found = MARKERS.exec(latest);
  if (!found) continue;

  hits++;
  const from = Math.max(0, found.index - WINDOW_BEFORE);
  console.log(`\n=== ${label.get(value.blockID) ?? value.blockID} ===`);
  console.log(`…${latest.slice(from, found.index + WINDOW_AFTER).trim()}…`);
}

console.log(`\n${hits} finding(s) with follow-up markers in their latest verification section.`);
