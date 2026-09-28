import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryText, exportJSON, importJSON, sanitizeLedger, encodeHash, decodeHash } from '../src/share.js';
import { demoLedger } from '../src/demo.js';
import { loadState, saveState, STORAGE_KEY } from '../src/store.js';
import { balances } from '../src/ledger.js';
import { settle, transferKey } from '../src/settle.js';
import { rng, randomLedger } from './helpers.js';

test('summaryText: 包含帳本名、每人明細與轉帳', () => {
  const l = demoLedger();
  const t = summaryText(l);
  assert.match(t, /^【花蓮三天兩夜】分帳結算/);
  assert.match(t, /小明：/);
  assert.match(t, /怎麼還/);
  assert.match(t, /→/);
  assert.doesNotMatch(t, /undefined|NaN/);
});
test('summaryText: 已還標記會出現在對應那一行', () => {
  const l = demoLedger();
  const before = summaryText(l).split('\n').filter((s) => /→/.test(s));
  assert.ok(before.length >= 1);
  assert.ok(before.every((s) => !s.includes('(已還)')));
  const rows = balances(l);
  const plan = settle(rows).transfers;
  l.settled = [transferKey(plan[0])];
  const after = summaryText(l).split('\n').filter((s) => /→/.test(s));
  assert.ok(after[0].endsWith('(已還)'));
  assert.ok(after.slice(1).every((s) => !s.includes('(已還)')));
});
test('summaryText: 已結清時的說法', () => {
  const l = demoLedger(); l.expenses = [];
  assert.match(summaryText(l), /大家都結清了/);
});
test('demo 帳本: 淨額加總為 0，金額為整數', () => {
  const b = balances(demoLedger());
  assert.equal(b.reduce((a, x) => a + x.net, 0), 0);
  assert.ok(b.every((x) => Number.isInteger(x.paid) && Number.isInteger(x.owed)));
});
test('JSON 匯出再匯入：內容相同（id 除外）', () => {
  const l = demoLedger();
  const back = importJSON(exportJSON(l));
  assert.notEqual(back.id, l.id);
  assert.deepEqual({ ...back, id: 0 }, { ...l, id: 0 });
});
test('匯入: 接受不包 wrapper 的裸帳本', () => {
  const l = demoLedger();
  assert.equal(importJSON(JSON.stringify(l)).name, l.name);
});
test('匯入壞資料: 各種情況都丟出中文錯誤而不是當機', () => {
  const l = demoLedger();
  const clone = () => JSON.parse(JSON.stringify(l));
  const cases = [
    '', '   ', 'not json', '123', 'null', '[]', '"str"', '{}', '{"ledger":null}',
    JSON.stringify({ ...clone(), name: '' }),
    JSON.stringify({ ...clone(), members: [{ id: 'a', name: 'x' }] }),
    JSON.stringify({ ...clone(), members: 'oops' }),
    JSON.stringify({ ...clone(), expenses: {} }),
    JSON.stringify({ ...clone(), expenses: [null] }),
  ];
  const bad1 = clone(); bad1.expenses[0].amount = -5;
  const bad2 = clone(); bad2.expenses[0].paidBy[0].member = 'ghost';
  const bad3 = clone(); bad3.expenses[0].split.mode = 'hack';
  const bad4 = clone(); bad4.expenses[0].amount = 1e20;
  const bad5 = clone(); bad5.members[1].id = bad5.members[0].id;
  const bad6 = clone(); bad6.expenses[5].foreign.rate = 'abc';
  const bad7 = clone(); bad7.expenses[1].id = bad7.expenses[0].id;
  const bad8 = clone(); bad8.expenses[0].paidBy[0].amount = '7800';
  for (const b of [bad1, bad2, bad3, bad4, bad5, bad6, bad7, bad8]) cases.push(JSON.stringify(b));
  for (const c of cases) assert.throws(() => importJSON(c), (e) => e instanceof Error && /[一-鿿]/.test(e.message), c.slice(0, 60));
});
test('匯入: 原型污染欄位不會被帶進帳本', () => {
  const l = demoLedger();
  const s = JSON.stringify(l).replace('{"id"', '{"__proto__":{"x":1},"id"');
  const back = importJSON(s);
  assert.equal(({}).x, undefined);
  assert.equal(back.x, undefined);
});
test('匯入: 多餘欄位被丟掉、字串被截斷檢查', () => {
  const l = JSON.parse(JSON.stringify(demoLedger()));
  l.evil = '<script>'; l.expenses[0].note = 'x';
  const back = importJSON(JSON.stringify(l));
  assert.equal(back.evil, undefined);
  assert.equal(back.expenses[0].note, undefined);
  l.name = 'a'.repeat(200);
  assert.throws(() => importJSON(JSON.stringify(l)), /太長/);
});
test('sanitizeLedger: 缺 seq 時會補上，nextSeq 正確', () => {
  const l = JSON.parse(JSON.stringify(demoLedger()));
  l.expenses.forEach((e) => delete e.seq);
  const s = sanitizeLedger(l);
  assert.equal(s.nextSeq, l.expenses.length);
});
test('網址 hash: 編碼後解碼相同，且比 JSON 短', async () => {
  const l = demoLedger();
  const h = await encodeHash(l);
  assert.match(h, /^b=[A-Za-z0-9_-]+$/);
  assert.ok(h.length < JSON.stringify(l).length);
  const back = await decodeHash('#' + h);
  assert.deepEqual({ ...back, id: 0 }, { ...l, id: 0 });
});
test('網址 hash: 隨機帳本往返', async () => {
  const r = rng(77);
  for (let i = 0; i < 30; i++) {
    const l = randomLedger(r);
    const back = await decodeHash(await encodeHash(l));
    assert.deepEqual(balances(back).map((x) => x.net), balances(l).map((x) => x.net));
  }
});
test('網址 hash: 壞連結防呆', async () => {
  for (const h of ['', '#', '#x=1', '#b=', '#b=!!!', '#b=AAAA', '#b=' + 'A'.repeat(50)]) {
    await assert.rejects(() => decodeHash(h), (e) => e instanceof Error && /[一-鿿]/.test(e.message), h);
  }
});
test('store: 存取往返', () => {
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const l = demoLedger();
  assert.ok(saveState(st, { books: [l], activeId: l.id }));
  const s = loadState(st);
  assert.equal(s.books.length, 1);
  assert.equal(s.activeId, l.id);
});
test('store: 壞資料 / 例外 不會當機', () => {
  const st = (v) => ({ getItem: () => v, setItem() { throw new Error('quota'); } });
  assert.deepEqual(loadState(st('{oops')), { books: [], activeId: null });
  assert.deepEqual(loadState(st(null)), { books: [], activeId: null });
  assert.equal(loadState(st(JSON.stringify({ books: [{ bad: 1 }, 5, null], activeId: 'x' }))).books.length, 0);
  assert.deepEqual(loadState({ getItem() { throw new Error('denied'); } }), { books: [], activeId: null });
  assert.equal(saveState(st(null), { books: [], activeId: null }), false);
  assert.ok(STORAGE_KEY);
});
test('store: activeId 不存在時退回第一本', () => {
  const l = demoLedger();
  const st = { getItem: () => JSON.stringify({ books: [l], activeId: 'gone' }) };
  assert.equal(loadState(st).activeId, l.id);
});
