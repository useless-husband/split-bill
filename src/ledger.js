// 帳本資料模型：支出驗證、分攤計算、每人餘額、篩選與小計。
import { allocate, CATEGORIES } from './money.js';

export const SPLIT_MODES = ['equal', 'shares', 'exact', 'percent'];
export const MAX_MEMBERS = 30;

let counter = 0;
export function uid() {
  counter = (counter + 1) % 1e6;
  return Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 7);
}

export function createLedger(name, memberNames) {
  const names = memberNames.map((s) => String(s).trim()).filter(Boolean);
  if (!String(name).trim()) throw new Error('請輸入帳本名稱');
  if (names.length < 2) throw new Error('至少需要兩位成員');
  if (new Set(names).size !== names.length) throw new Error('成員名稱不能重複');
  return {
    id: uid(),
    name: String(name).trim(),
    members: names.map((n) => ({ id: uid(), name: n })),
    expenses: [],
    settled: [],
    nextSeq: 0,
  };
}

const isInt = Number.isSafeInteger;

/** 回傳錯誤訊息陣列；空陣列代表合法。memberIds 為帳本成員 id（順序即零頭輪替順序）。 */
export function validateExpense(exp, memberIds) {
  const errs = [];
  const known = new Set(memberIds);
  if (!exp || typeof exp !== 'object') return ['支出資料不正確'];
  if (typeof exp.title !== 'string' || !exp.title.trim()) errs.push('請輸入項目名稱');
  if (!isInt(exp.amount) || exp.amount <= 0) errs.push('金額必須是大於 0 的整數');
  if (!CATEGORIES.includes(exp.category)) errs.push('分類不正確');
  if (typeof exp.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(exp.date) || Number.isNaN(Date.parse(exp.date))) errs.push('日期格式不正確');
  if (errs.length) return errs;

  if (!Array.isArray(exp.paidBy) || exp.paidBy.length === 0) errs.push('請選擇誰付的');
  else {
    const seen = new Set();
    let sum = 0;
    for (const p of exp.paidBy) {
      if (!p || !known.has(p.member) || seen.has(p.member)) { errs.push('付款人不正確'); break; }
      seen.add(p.member);
      if (!isInt(p.amount) || p.amount <= 0) { errs.push('付款金額必須是正整數'); break; }
      sum += p.amount;
    }
    if (!errs.length && sum !== exp.amount) errs.push(`付款加總 ${sum} 與總額 ${exp.amount} 不符`);
  }
  const sp = exp.split;
  if (!sp || !SPLIT_MODES.includes(sp.mode) || !Array.isArray(sp.entries) || sp.entries.length === 0) {
    errs.push('請選擇分給誰');
    return errs;
  }
  const seen = new Set();
  for (const e of sp.entries) {
    if (!e || !known.has(e.member) || seen.has(e.member)) { errs.push('分攤對象不正確'); return errs; }
    seen.add(e.member);
    if (!isInt(e.value) || e.value < 0) { errs.push('分攤數值必須是非負整數'); return errs; }
  }
  const vals = sp.entries.map((e) => e.value);
  const total = vals.reduce((a, b) => a + b, 0);
  if (sp.mode === 'equal') { /* 值忽略 */ }
  else if (total <= 0) errs.push('分攤數值加總必須大於 0');
  else if (sp.mode === 'exact' && total !== exp.amount) errs.push(`指定金額加總 ${total} 與總額 ${exp.amount} 不符`);
  else if (sp.mode === 'percent' && total !== 10000) errs.push(`百分比加總必須是 100%(目前 ${total / 100}%)`);
  return errs;
}

/** 計算每位成員該分攤多少元；回傳 { [memberId]: 元 }，加總必等於 exp.amount。 */
export function computeShares(exp, memberIds) {
  const errs = validateExpense(exp, memberIds);
  if (errs.length) throw new Error(errs[0]);
  const byId = new Map(exp.split.entries.map((e) => [e.member, e.value]));
  const order = memberIds.filter((id) => byId.has(id));
  const mode = exp.split.mode;
  const offset = Number.isSafeInteger(exp.seq) ? exp.seq : 0;
  let amounts;
  if (mode === 'exact') amounts = order.map((id) => byId.get(id));
  else if (mode === 'equal') amounts = allocate(exp.amount, order.map(() => 1), offset);
  else amounts = allocate(exp.amount, order.map((id) => byId.get(id)), offset);
  const out = {};
  order.forEach((id, i) => { if (amounts[i] > 0) out[id] = amounts[i]; });
  return out;
}

/** 每人已付、應付、淨額（淨額 = 已付 - 應付；正數代表別人欠他）。 */
export function balances(ledger) {
  const ids = ledger.members.map((m) => m.id);
  const rows = new Map(ledger.members.map((m) => [m.id, { id: m.id, name: m.name, paid: 0, owed: 0, net: 0 }]));
  for (const exp of ledger.expenses) {
    for (const p of exp.paidBy) rows.get(p.member).paid += p.amount;
    const sh = computeShares(exp, ids);
    for (const [id, v] of Object.entries(sh)) rows.get(id).owed += v;
  }
  for (const r of rows.values()) r.net = r.paid - r.owed;
  return [...rows.values()];
}

export function filterExpenses(ledger, { category = '', member = '' } = {}) {
  return ledger.expenses.filter((e) => {
    if (category && e.category !== category) return false;
    if (member) {
      const involved = e.paidBy.some((p) => p.member === member) || e.split.entries.some((x) => x.member === member && (e.split.mode === 'equal' || x.value > 0));
      if (!involved) return false;
    }
    return true;
  });
}

export function categoryTotals(expenses) {
  const t = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const e of expenses) t[e.category] += e.amount;
  return t;
}

export function isMemberUsed(ledger, memberId) {
  return ledger.expenses.some((e) => e.paidBy.some((p) => p.member === memberId) || e.split.entries.some((x) => x.member === memberId));
}

export function addExpense(ledger, exp) {
  const ids = ledger.members.map((m) => m.id);
  const full = { ...exp, id: exp.id || uid(), seq: ledger.nextSeq };
  const errs = validateExpense(full, ids);
  if (errs.length) throw new Error(errs[0]);
  ledger.expenses.push(full);
  ledger.nextSeq += 1;
  return full;
}

export function updateExpense(ledger, id, exp) {
  const i = ledger.expenses.findIndex((e) => e.id === id);
  if (i < 0) throw new Error('找不到這筆支出');
  const full = { ...exp, id, seq: ledger.expenses[i].seq };
  const errs = validateExpense(full, ledger.members.map((m) => m.id));
  if (errs.length) throw new Error(errs[0]);
  ledger.expenses[i] = full;
  return full;
}

export function removeExpense(ledger, id) {
  ledger.expenses = ledger.expenses.filter((e) => e.id !== id);
}

export function addMember(ledger, name) {
  const n = String(name).trim();
  if (!n) throw new Error('請輸入成員名稱');
  if (ledger.members.some((m) => m.name === n)) throw new Error('成員名稱不能重複');
  if (ledger.members.length >= MAX_MEMBERS) throw new Error(`成員最多 ${MAX_MEMBERS} 人`);
  const m = { id: uid(), name: n };
  ledger.members.push(m);
  return m;
}

export function renameMember(ledger, id, name) {
  const n = String(name).trim();
  if (!n) throw new Error('請輸入成員名稱');
  if (ledger.members.some((m) => m.id !== id && m.name === n)) throw new Error('成員名稱不能重複');
  const m = ledger.members.find((x) => x.id === id);
  if (!m) throw new Error('找不到成員');
  m.name = n;
}

export function removeMember(ledger, id) {
  if (isMemberUsed(ledger, id)) throw new Error('這位成員已有支出紀錄，無法移除');
  if (ledger.members.length <= 2) throw new Error('至少要保留兩位成員');
  ledger.members = ledger.members.filter((m) => m.id !== id);
}
