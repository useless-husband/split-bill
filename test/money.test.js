import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, toTWD, parseScaled, formatTWD } from '../src/money.js';
import { rng, ri } from './helpers.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);

test('allocate: 整除時平均分', () => {
  assert.deepEqual(allocate(300, [1, 1, 1]), [100, 100, 100]);
});
test('allocate: 100 元三人均分，零頭 1 元給第一位', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
});
test('allocate: 零頭依輪替起點往後給', () => {
  assert.deepEqual(allocate(100, [1, 1, 1], 1), [33, 34, 33]);
  assert.deepEqual(allocate(101, [1, 1, 1], 2), [34, 33, 34]);
  assert.deepEqual(allocate(100, [1, 1, 1], 4), [33, 34, 33]);
});
test('allocate: 權重 0 的人不會拿到零頭', () => {
  assert.deepEqual(allocate(10, [0, 1, 1, 1], 0), [0, 4, 3, 3]);
  assert.deepEqual(allocate(11, [1, 0, 1], 1), [5, 0, 6]);
});
test('allocate: 按份數比例', () => {
  assert.deepEqual(allocate(1000, [1, 2, 2]), [200, 400, 400]);
  assert.equal(sum(allocate(1001, [1, 2, 2])), 1001);
});
test('allocate: 拒絕不合法輸入', () => {
  assert.throws(() => allocate(-1, [1]), RangeError);
  assert.throws(() => allocate(1.5, [1]), RangeError);
  assert.throws(() => allocate(10, [0, 0]), RangeError);
  assert.throws(() => allocate(10, [1, -1]), RangeError);
});
test('allocate: 隨機 2000 組加總守恆且每人差距不超過 1(均分)', () => {
  const r = rng(7);
  for (let i = 0; i < 2000; i++) {
    const n = ri(r, 1, 15); const total = ri(r, 0, 1e7);
    const out = allocate(total, Array(n).fill(1), ri(r, 0, 100));
    assert.equal(sum(out), total);
    assert.ok(Math.max(...out) - Math.min(...out) <= 1);
  }
});
test('allocate: 隨機權重加總守恆', () => {
  const r = rng(11);
  for (let i = 0; i < 2000; i++) {
    const w = Array.from({ length: ri(r, 1, 10) }, () => ri(r, 0, 9));
    if (sum(w) === 0) continue;
    const total = ri(r, 0, 1e9);
    const out = allocate(total, w, ri(r, 0, 50));
    assert.equal(sum(out), total);
    out.forEach((v, j) => { if (w[j] === 0) assert.equal(v, 0); });
  }
});
test('allocate: 大金額也不會因浮點誤差失準', () => {
  const out = allocate(9007199254740991, [3, 3, 3]);
  assert.equal(sum(out), 9007199254740991);
});
test('parseScaled: 嚴格格式', () => {
  assert.equal(parseScaled('12.5', 2), 1250n);
  assert.equal(parseScaled('12', 2), 1200n);
  for (const bad of ['', '-1', '1e3', '1.234', 'abc', '1,000', ' ', '1.']) assert.equal(parseScaled(bad, 2), null, bad);
});
test('toTWD: 外幣換算四捨五入', () => {
  assert.equal(toTWD('100', '32.15'), 3215);
  assert.equal(toTWD('10000', '0.2145'), 2145);
  assert.equal(toTWD('0.01', '32'), 0);
  assert.equal(toTWD('1', '0.5'), 1); // 0.5 進位
  assert.equal(toTWD('1', '0.499999'), 0);
  assert.equal(toTWD('12.34', '31.5'), 389); // 388.71
});
test('toTWD: 壞輸入丟錯', () => {
  assert.throws(() => toTWD('abc', '30'), RangeError);
  assert.throws(() => toTWD('10', '0'), RangeError);
  assert.throws(() => toTWD('10', '-3'), RangeError);
});
test('formatTWD: 千分位', () => {
  assert.equal(formatTWD(0), '0');
  assert.equal(formatTWD(1234567), '1,234,567');
  assert.equal(formatTWD(-9800), '-9,800');
});
