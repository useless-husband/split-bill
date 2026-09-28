import { createLedger, addExpense } from '../src/ledger.js';

// 可重現的偽亂數
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
export const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));

export function randomLedger(r, { maxMembers = 8, maxExpenses = 10 } = {}) {
  const n = ri(r, 2, maxMembers);
  const l = createLedger('隨機', Array.from({ length: n }, (_, i) => `人${i}`));
  const ids = l.members.map((m) => m.id);
  const cats = ['餐飲', '交通', '住宿', '門票', '其他'];
  const k = ri(r, 1, maxExpenses);
  for (let i = 0; i < k; i++) {
    const amount = ri(r, 1, 50000);
    // 付款：1~3 人
    const payers = ids.filter(() => r() < 0.4);
    if (!payers.length) payers.push(ids[ri(r, 0, n - 1)]);
    const p = payers.slice(0, 3);
    const paidBy = [];
    let left = amount;
    p.forEach((member, j) => {
      const a = j === p.length - 1 ? left : ri(r, 0, left);
      left -= a;
      if (a > 0) paidBy.push({ member, amount: a });
    });
    if (!paidBy.length) paidBy.push({ member: p[0], amount });
    const parts = ids.filter(() => r() < 0.6);
    if (!parts.length) parts.push(ids[0]);
    const mode = ['equal', 'shares', 'exact', 'percent'][ri(r, 0, 3)];
    let entries;
    if (mode === 'equal') entries = parts.map((member) => ({ member, value: 1 }));
    else if (mode === 'shares') entries = parts.map((member) => ({ member, value: ri(r, 1, 5) }));
    else if (mode === 'exact') entries = cut(r, amount, parts);
    else entries = cut(r, 10000, parts);
    addExpense(l, { title: `支出${i}`, amount, category: cats[ri(r, 0, 4)], date: '2026-06-01', paidBy, split: { mode, entries } });
  }
  return l;
}
function cut(r, total, parts) {
  let left = total;
  return parts.map((member, j) => {
    const v = j === parts.length - 1 ? left : ri(r, 0, left);
    left -= v;
    return { member, value: v };
  });
}
