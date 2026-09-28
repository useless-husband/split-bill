import test from 'node:test';
import assert from 'node:assert/strict';
import { greedy, exact, settle, verifyPlan, transferKey } from '../src/settle.js';
import { balances } from '../src/ledger.js';
import { rng, ri, randomLedger } from './helpers.js';

const nets = (arr) => arr.map((net, i) => ({ id: 'p' + i, net }));

test('greedy: 簡單兩人', () => {
  assert.deepEqual(greedy(nets([100, -100])), [{ from: 'p1', to: 'p0', amount: 100 }]);
});
test('greedy: 全部 0 不需轉帳', () => {
  assert.deepEqual(greedy(nets([0, 0, 0])), []);
});
test('greedy: 一人先付全部，其餘各還', () => {
  const t = greedy(nets([300, -100, -100, -100]));
  assert.equal(t.length, 3);
  assert.ok(verifyPlan(nets([300, -100, -100, -100]), t));
});
test('exact: 找到比貪婪法更少的方案', () => {
  // 兩個獨立小組 (+5,-5) 與 (+3,-3)... 貪婪法會把它們混起來
  const n = nets([5, 3, -4, -4]);
  // 沒有零和子群，貪婪也是 3 筆
  assert.equal(exact(n).length, 3);
  const n2 = nets([7, 5, -6, -6]); // 沒有零和子群
  assert.equal(exact(n2).length, 3);
  // 有子群 (+10,-10) 與 (+6,-3,-3)：貪婪先配對最大者
  const n3 = nets([10, 6, -10, -3, -3]);
  const g = greedy(n3); const e = exact(n3);
  assert.ok(verifyPlan(n3, e));
  assert.equal(e.length, 3);
  assert.ok(e.length <= g.length);
});
test('exact: 貪婪法確實不一定最少（構造反例）', () => {
  // 用固定亂數種子搜尋：貪婪法筆數 > 精確法筆數的例子
  let found = false;
  const r = rng(99);
  for (let i = 0; i < 3000 && !found; i++) {
    const k = ri(r, 4, 8);
    const a = Array.from({ length: k - 1 }, () => ri(r, -20, 20));
    a.push(-a.reduce((x, y) => x + y, 0));
    const nn = nets(a);
    if (greedy(nn).length > exact(nn).length) found = true;
  }
  assert.ok(found, '應該能找到貪婪法比精確法多的例子');
});
test('exact: 超過 12 人丟錯，settle 自動改用貪婪', () => {
  const a = Array.from({ length: 13 }, (_, i) => (i % 2 ? -1 : 1));
  a[12] = 1; a[0] = 1; // 保證總和：重算
  const s = a.reduce((x, y) => x + y, 0);
  a[1] -= s;
  const n = nets(a);
  assert.throws(() => exact(n), RangeError);
  const r = settle(n);
  assert.equal(r.method, 'greedy');
  assert.ok(verifyPlan(n, r.transfers));
});
test('settle: 淨額不為 0 → 丟錯', () => {
  assert.throws(() => settle(nets([1, 2])));
});
test('settle: 12 人以內用精確法', () => {
  assert.equal(settle(nets([5, -5])).method, 'exact');
});
test('verifyPlan: 抓出錯誤方案', () => {
  const n = nets([100, -100]);
  assert.equal(verifyPlan(n, [{ from: 'p1', to: 'p0', amount: 90 }]), false);
  assert.equal(verifyPlan(n, [{ from: 'p0', to: 'p1', amount: 100 }]), false);
  assert.equal(verifyPlan(n, [{ from: 'x', to: 'p0', amount: 100 }]), false);
  assert.equal(verifyPlan(n, []), false);
});
test('transferKey', () => {
  assert.equal(transferKey({ from: 'a', to: 'b', amount: 5 }), 'a>b>5');
});

// 暴力法：任意集合分成最多零和小組
function bruteMin(values) {
  const v = values.filter((x) => x !== 0);
  let best = 0;
  const n = v.length;
  function go(mask, groups) {
    if (mask === 0) { best = Math.max(best, groups); return; }
    const low = mask & -mask; const rest = mask ^ low;
    for (let sub = rest; ; sub = (sub - 1) & rest) {
      const g = sub | low; let s = 0;
      for (let i = 0; i < n; i++) if (g & (1 << i)) s += v[i];
      if (s === 0) go(mask ^ g, groups + 1);
      if (sub === 0) break;
    }
  }
  go((1 << n) - 1, 0);
  return n - best;
}

test('property: 精確法筆數 = 暴力法最小值（500 組，<=7 人）', () => {
  const r = rng(2024);
  for (let i = 0; i < 500; i++) {
    const k = ri(r, 2, 7);
    const a = Array.from({ length: k - 1 }, () => ri(r, -15, 15));
    a.push(-a.reduce((x, y) => x + y, 0));
    const n = nets(a);
    const e = exact(n);
    assert.ok(verifyPlan(n, e));
    assert.equal(e.length, bruteMin(a), JSON.stringify(a));
  }
});

test('property: 1000 組隨機帳本 —— 淨額和為 0、方案結清、精確 <= 貪婪', () => {
  const r = rng(12345);
  for (let i = 0; i < 1000; i++) {
    const l = randomLedger(r, { maxMembers: 9, maxExpenses: 8 });
    const b = balances(l);
    assert.equal(b.reduce((x, y) => x + y.net, 0), 0);
    assert.equal(b.reduce((x, y) => x + y.paid, 0), b.reduce((x, y) => x + y.owed, 0));
    assert.equal(b.reduce((x, y) => x + y.paid, 0), l.expenses.reduce((x, e) => x + e.amount, 0));
    const n = b.map((x) => ({ id: x.id, net: x.net }));
    const g = greedy(n);
    const s = settle(n);
    assert.ok(verifyPlan(n, g), 'greedy');
    assert.ok(verifyPlan(n, s.transfers), 'settle');
    assert.ok(s.transfers.length <= g.length);
    assert.ok(s.transfers.length <= n.filter((x) => x.net !== 0).length - 1 || s.transfers.length === 0);
    assert.ok(s.transfers.every((t) => Number.isSafeInteger(t.amount) && t.amount > 0 && t.from !== t.to));
  }
});
test('property: 大團體（20 人）貪婪結清', () => {
  const r = rng(5);
  for (let i = 0; i < 100; i++) {
    const l = randomLedger(r, { maxMembers: 8, maxExpenses: 3 });
    const a = Array.from({ length: 19 }, () => ri(r, -500, 500));
    a.push(-a.reduce((x, y) => x + y, 0));
    const n = nets(a);
    const s = settle(n);
    assert.ok(verifyPlan(n, s.transfers));
    assert.ok(l);
  }
});
