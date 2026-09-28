// 分享：LINE 文字摘要、JSON 匯出/匯入（含防呆）、網址 hash 壓縮。
import { balances, computeShares, validateExpense, uid } from './ledger.js';
import { settle, transferKey } from './settle.js';
import { formatTWD, parseScaled, CATEGORIES } from './money.js';

const APP_TAG = 'split-bill';
const LIMITS = { members: 30, expenses: 2000, text: 60, json: 2_000_000 };

/** 貼到 LINE 的純文字結算摘要。 */
export function summaryText(ledger) {
  const rows = balances(ledger);
  const name = new Map(rows.map((r) => [r.id, r.name]));
  const { transfers } = settle(rows);
  const done = new Set(ledger.settled || []);
  const total = ledger.expenses.reduce((a, e) => a + e.amount, 0);
  const L = [];
  L.push(`【${ledger.name}】分帳結算`);
  L.push(`共 ${ledger.expenses.length} 筆支出，合計 NT$ ${formatTWD(total)}`);
  L.push('');
  L.push('每人明細(已付 / 應付 / 淨額)');
  for (const r of rows) {
    const sign = r.net > 0 ? '+' : r.net < 0 ? '-' : '';
    L.push(`${r.name}：${formatTWD(r.paid)} / ${formatTWD(r.owed)} / ${sign}${formatTWD(Math.abs(r.net))}`);
  }
  L.push('');
  if (transfers.length === 0) L.push('大家都結清了，不用轉帳。');
  else {
    L.push('怎麼還');
    transfers.forEach((t, i) => {
      const mark = done.has(transferKey(t)) ? '(已還)' : '';
      L.push(`${i + 1}. ${name.get(t.from)} → ${name.get(t.to)}　NT$ ${formatTWD(t.amount)}${mark}`);
    });
  }
  return L.join('\n');
}

export function exportJSON(ledger) {
  return JSON.stringify({ app: APP_TAG, version: 1, ledger }, null, 2);
}

const str = (v, max, what) => {
  if (typeof v !== 'string') throw new Error(`${what}不是文字`);
  const s = v.trim();
  if (!s) throw new Error(`${what}不可空白`);
  if (s.length > max) throw new Error(`${what}太長`);
  return s;
};

/** 把不受信任的物件整理成合法帳本；不合法就丟出帶中文訊息的 Error。 */
export function sanitizeLedger(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('帳本格式不正確');
  const name = str(raw.name, LIMITS.text, '帳本名稱');
  if (!Array.isArray(raw.members) || raw.members.length < 2) throw new Error('成員至少要兩位');
  if (raw.members.length > LIMITS.members) throw new Error('成員太多');
  const ids = new Set(); const names = new Set();
  const members = raw.members.map((m) => {
    if (!m || typeof m !== 'object') throw new Error('成員資料不正確');
    const id = str(m.id, 40, '成員 id'); const nm = str(m.name, LIMITS.text, '成員名稱');
    if (ids.has(id) || names.has(nm)) throw new Error('成員 id 或名稱重複');
    ids.add(id); names.add(nm);
    return { id, name: nm };
  });
  const memberIds = members.map((m) => m.id);
  if (!Array.isArray(raw.expenses)) throw new Error('支出清單不正確');
  if (raw.expenses.length > LIMITS.expenses) throw new Error('支出筆數太多');
  const expIds = new Set();
  let maxSeq = -1;
  const expenses = raw.expenses.map((e, i) => {
    if (!e || typeof e !== 'object') throw new Error(`第 ${i + 1} 筆支出不正確`);
    const exp = {
      id: str(e.id, 40, '支出 id'),
      seq: Number.isSafeInteger(e.seq) && e.seq >= 0 ? e.seq : i,
      title: typeof e.title === 'string' ? e.title.trim().slice(0, LIMITS.text) : '',
      amount: e.amount, category: e.category, date: e.date,
      paidBy: Array.isArray(e.paidBy) ? e.paidBy.map((p) => ({ member: p?.member, amount: p?.amount })) : null,
      split: e.split && typeof e.split === 'object' && Array.isArray(e.split.entries)
        ? { mode: e.split.mode, entries: e.split.entries.map((x) => ({ member: x?.member, value: x?.value })) } : null,
    };
    if (e.foreign && typeof e.foreign === 'object') {
      const f = e.foreign;
      if (typeof f.currency !== 'string' || !/^[A-Z]{3}$/.test(f.currency) || parseScaled(f.amount, 2) === null || parseScaled(f.rate, 6) === null) {
        throw new Error(`第 ${i + 1} 筆外幣資料不正確`);
      }
      exp.foreign = { currency: f.currency, amount: String(f.amount), rate: String(f.rate) };
    }
    if (expIds.has(exp.id)) throw new Error('支出 id 重複');
    expIds.add(exp.id);
    const errs = validateExpense(exp, memberIds);
    if (errs.length) throw new Error(`第 ${i + 1} 筆支出：${errs[0]}`);
    maxSeq = Math.max(maxSeq, exp.seq);
    return exp;
  });
  const settled = Array.isArray(raw.settled) ? raw.settled.filter((s) => typeof s === 'string' && s.length < 200).slice(0, 500) : [];
  return { id: typeof raw.id === 'string' && raw.id.length <= 40 ? raw.id : uid(), name, members, expenses, settled, nextSeq: maxSeq + 1 };
}

/** 匯入 JSON 文字；回傳帳本（換新 id，避免覆蓋現有帳本）。壞資料丟出 Error。 */
export function importJSON(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('內容是空的');
  if (text.length > LIMITS.json) throw new Error('檔案太大');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('不是有效的 JSON'); }
  const raw = data && typeof data === 'object' && 'ledger' in data ? data.ledger : data;
  const ledger = sanitizeLedger(raw);
  balances(ledger); // 再驗一次能算
  ledger.id = uid();
  return ledger;
}

// ---- 網址 hash：deflate-raw + base64url ----
const toB64u = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (t) => {
  if (!/^[A-Za-z0-9_-]+$/.test(t)) throw new Error('分享連結格式不正確');
  const b = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
async function pipe(bytes, stream, cap = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > cap) { await reader.cancel(); throw new Error('分享連結解壓後太大'); }
    chunks.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function encodeHash(ledger) {
  const { id, ...rest } = ledger; // eslint-disable-line no-unused-vars
  const bytes = new TextEncoder().encode(JSON.stringify(rest));
  return 'b=' + toB64u(await pipe(bytes, new CompressionStream('deflate-raw')));
}

export async function decodeHash(hash) {
  const m = /^#?b=(.+)$/.exec(hash || '');
  if (!m) throw new Error('這不是分享連結');
  let bytes;
  try { bytes = await pipe(fromB64u(m[1]), new DecompressionStream('deflate-raw'), LIMITS.json); }
  catch (e) { throw new Error(e.message.includes('太大') || e.message.includes('格式') ? e.message : '分享連結已損毀'); }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('分享連結已損毀'); }
  const ledger = sanitizeLedger(data);
  balances(ledger);
  ledger.id = uid();
  return ledger;
}

export { CATEGORIES, computeShares };
