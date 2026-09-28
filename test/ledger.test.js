import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLedger, addExpense, updateExpense, removeExpense, computeShares, balances, validateExpense,
  filterExpenses, categoryTotals, addMember, renameMember, removeMember,
} from '../src/ledger.js';

const mk = () => {
  const l = createLedger('測試', ['甲', '乙', '丙']);
  return { l, ids: l.members.map((m) => m.id) };
};
const base = (ids, over = {}) => ({
  title: '晚餐', amount: 100, category: '餐飲', date: '2026-05-01',
  paidBy: [{ member: ids[0], amount: 100 }],
  split: { mode: 'equal', entries: ids.map((member) => ({ member, value: 1 })) }, ...over,
});
const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('createLedger: 驗證名稱與成員', () => {
  assert.throws(() => createLedger('', ['a', 'b']));
  assert.throws(() => createLedger('x', ['a']));
  assert.throws(() => createLedger('x', ['a', 'a']));
  assert.equal(createLedger(' x ', [' a ', 'b', '']).members.length, 2);
});
test('均分: 100 元三人 → 34/33/33，加總 100', () => {
  const { l, ids } = mk();
  const e = addExpense(l, base(ids));
  const s = computeShares(e, ids);
  assert.deepEqual([s[ids[0]], s[ids[1]], s[ids[2]]], [34, 33, 33]);
  assert.equal(total(s), 100);
});
test('均分: 零頭起點每筆支出輪替', () => {
  const { l, ids } = mk();
  const e1 = addExpense(l, base(ids));
  const e2 = addExpense(l, base(ids));
  const e3 = addExpense(l, base(ids));
  assert.equal(computeShares(e1, ids)[ids[0]], 34);
  assert.equal(computeShares(e2, ids)[ids[1]], 34);
  assert.equal(computeShares(e3, ids)[ids[2]], 34);
  const b = balances(l);
  assert.deepEqual(b.map((x) => x.owed), [100, 100, 100]); // 三筆下來完全公平
});
test('按份數: 1:2:3 分 600', () => {
  const { l, ids } = mk();
  const e = addExpense(l, base(ids, { amount: 600, paidBy: [{ member: ids[0], amount: 600 }], split: { mode: 'shares', entries: ids.map((member, i) => ({ member, value: i + 1 })) } }));
  assert.deepEqual(Object.values(computeShares(e, ids)), [100, 200, 300]);
});
test('指定金額: 加總不符會被拒絕', () => {
  const { l, ids } = mk();
  const bad = base(ids, { split: { mode: 'exact', entries: [{ member: ids[0], value: 50 }, { member: ids[1], value: 49 }] } });
  assert.match(validateExpense(bad, ids)[0], /指定金額/);
  assert.throws(() => addExpense(l, bad));
  const good = base(ids, { split: { mode: 'exact', entries: [{ member: ids[0], value: 50 }, { member: ids[1], value: 50 }] } });
  assert.deepEqual(computeShares(good, ids), { [ids[0]]: 50, [ids[1]]: 50 });
});
test('百分比: 33.33/33.33/33.34 分 100 元，加總守恆', () => {
  const { ids } = mk();
  const e = { ...base(ids), seq: 0, split: { mode: 'percent', entries: [{ member: ids[0], value: 3333 }, { member: ids[1], value: 3333 }, { member: ids[2], value: 3334 }] } };
  const s = computeShares(e, ids);
  assert.equal(total(s), 100);
});
test('百分比: 不足 100% 被拒絕', () => {
  const { ids } = mk();
  const e = base(ids, { split: { mode: 'percent', entries: [{ member: ids[0], value: 5000 }, { member: ids[1], value: 4000 }] } });
  assert.match(validateExpense(e, ids)[0], /百分比/);
});
test('只分給部分成員：沒勾的人不出錢', () => {
  const { l, ids } = mk();
  addExpense(l, base(ids, { split: { mode: 'equal', entries: [{ member: ids[1], value: 1 }, { member: ids[2], value: 1 }] } }));
  const b = balances(l);
  assert.equal(b[0].owed, 0);
  assert.equal(b[1].owed, 50);
});
test('多人付款: 各付一部分，淨額正確', () => {
  const { l, ids } = mk();
  addExpense(l, base(ids, { amount: 300, paidBy: [{ member: ids[0], amount: 200 }, { member: ids[1], amount: 100 }] }));
  const b = balances(l);
  assert.deepEqual(b.map((x) => x.paid), [200, 100, 0]);
  assert.deepEqual(b.map((x) => x.net), [100, 0, -100]);
});
test('多人付款加總不符總額被拒絕', () => {
  const { ids } = mk();
  const e = base(ids, { amount: 300, paidBy: [{ member: ids[0], amount: 200 }, { member: ids[1], amount: 50 }] });
  assert.match(validateExpense(e, ids)[0], /付款加總/);
});
test('balances: 淨額加總為 0', () => {
  const { l, ids } = mk();
  addExpense(l, base(ids, { amount: 1001 , paidBy: [{ member: ids[2], amount: 1001 }] }));
  addExpense(l, base(ids, { amount: 77, paidBy: [{ member: ids[0], amount: 77 }] }));
  assert.equal(balances(l).reduce((a, b) => a + b.net, 0), 0);
});
test('validateExpense: 各種壞資料', () => {
  const { ids } = mk();
  assert.ok(validateExpense(base(ids, { title: '  ' }), ids).length);
  assert.ok(validateExpense(base(ids, { amount: 0 }), ids).length);
  assert.ok(validateExpense(base(ids, { amount: 1.5 }), ids).length);
  assert.ok(validateExpense(base(ids, { category: '亂寫' }), ids).length);
  assert.ok(validateExpense(base(ids, { date: '2026-13-45' }), ids).length);
  assert.ok(validateExpense(base(ids, { paidBy: [{ member: 'ghost', amount: 100 }] }), ids).length);
  assert.ok(validateExpense(base(ids, { split: { mode: 'weird', entries: [{ member: ids[0], value: 1 }] } }), ids).length);
  assert.ok(validateExpense(base(ids, { split: { mode: 'equal', entries: [] } }), ids).length);
  assert.ok(validateExpense(null, ids).length);
});
test('updateExpense / removeExpense', () => {
  const { l, ids } = mk();
  const e = addExpense(l, base(ids));
  updateExpense(l, e.id, base(ids, { amount: 200, paidBy: [{ member: ids[0], amount: 200 }] }));
  assert.equal(l.expenses[0].amount, 200);
  assert.equal(l.expenses[0].seq, e.seq);
  assert.throws(() => updateExpense(l, 'nope', base(ids)));
  removeExpense(l, e.id);
  assert.equal(l.expenses.length, 0);
});
test('篩選與分類小計', () => {
  const { l, ids } = mk();
  addExpense(l, base(ids, { amount: 100, category: '餐飲' }));
  addExpense(l, base(ids, { amount: 400, category: '交通', paidBy: [{ member: ids[1], amount: 400 }], split: { mode: 'equal', entries: [{ member: ids[1], value: 1 }] } }));
  assert.equal(filterExpenses(l, { category: '交通' }).length, 1);
  assert.equal(filterExpenses(l, { member: ids[0] }).length, 1);
  assert.equal(filterExpenses(l, { member: ids[1] }).length, 2);
  assert.equal(filterExpenses(l, {}).length, 2);
  const t = categoryTotals(l.expenses);
  assert.equal(t['餐飲'], 100);
  assert.equal(t['交通'], 400);
  assert.equal(t['住宿'], 0);
});
test('成員管理: 新增/改名/移除規則', () => {
  const { l, ids } = mk();
  const m = addMember(l, '丁');
  assert.throws(() => addMember(l, '丁'));
  assert.throws(() => renameMember(l, ids[0], '乙'));
  renameMember(l, ids[0], '甲甲');
  assert.equal(l.members[0].name, '甲甲');
  addExpense(l, base(ids));
  assert.throws(() => removeMember(l, ids[0]), /支出紀錄/);
  removeMember(l, m.id);
  assert.equal(l.members.length, 3);
});
