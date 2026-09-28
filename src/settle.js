// 結算：把每人淨額轉成「誰轉給誰多少」。
// 淨額 > 0 代表別人欠他（債權人），< 0 代表他欠別人（債務人）。

/** 貪婪法：每次讓「欠最多的人」付給「被欠最多的人」。速度快，但不保證筆數最少。 */
export function greedy(nets) {
  const cred = nets.filter((x) => x.net > 0).map((x) => ({ ...x }));
  const debt = nets.filter((x) => x.net < 0).map((x) => ({ id: x.id, net: -x.net }));
  const out = [];
  const byBig = (a, b) => b.net - a.net;
  while (cred.length && debt.length) {
    cred.sort(byBig); debt.sort(byBig);
    const c = cred[0]; const d = debt[0];
    const amt = Math.min(c.net, d.net);
    out.push({ from: d.id, to: c.id, amount: amt });
    c.net -= amt; d.net -= amt;
    if (c.net === 0) cred.shift();
    if (d.net === 0) debt.shift();
  }
  return out;
}

/**
 * 精確法（≤ 12 個非零淨額）：最少轉帳筆數 = 非零人數 - 「可切成的零和小組」最大數量。
 * 用子集合 DP 找最多組零和小組，組內再用貪婪法（組內最多 k-1 筆）。
 */
export function exact(nets) {
  const people = nets.filter((x) => x.net !== 0);
  const n = people.length;
  if (n === 0) return [];
  if (n > 12) throw new RangeError('人數太多，請改用貪婪法');
  const size = 1 << n;
  const sum = new Int32Array(size);
  for (let m = 1; m < size; m++) {
    const low = 31 - Math.clz32(m & -m);
    sum[m] = sum[m & (m - 1)] + people[low].net;
  }
  const best = new Int8Array(size).fill(-1);
  const pick = new Int32Array(size);
  best[0] = 0;
  for (let m = 1; m < size; m++) {
    if (sum[m] !== 0) continue;
    const lowBit = m & -m;
    const rest = m ^ lowBit;
    // 枚舉包含最低位元的子集合
    let sub = rest;
    for (;;) {
      const g = sub | lowBit;
      if (sum[g] === 0 && best[m ^ g] >= 0 && best[m ^ g] + 1 > best[m]) { best[m] = best[m ^ g] + 1; pick[m] = g; }
      if (sub === 0) break;
      sub = (sub - 1) & rest;
    }
  }
  const out = [];
  let m = size - 1;
  while (m) {
    const g = pick[m];
    const group = [];
    for (let i = 0; i < n; i++) if (g & (1 << i)) group.push(people[i]);
    out.push(...greedy(group));
    m ^= g;
  }
  return out;
}

/** 對外入口：人數（非零淨額）≤ 12 用精確法，否則貪婪法。 */
export function settle(nets, { exactLimit = 12 } = {}) {
  const nonzero = nets.filter((x) => x.net !== 0).length;
  const total = nets.reduce((a, b) => a + b.net, 0);
  if (total !== 0) throw new Error('淨額加總不為 0，資料有誤');
  if (nonzero <= exactLimit) return { method: 'exact', transfers: exact(nets) };
  return { method: 'greedy', transfers: greedy(nets) };
}

export const transferKey = (t) => `${t.from}>${t.to}>${t.amount}`;

/** 驗證方案：照著轉完後每個人都歸零。 */
export function verifyPlan(nets, transfers) {
  const left = new Map(nets.map((x) => [x.id, x.net]));
  for (const t of transfers) {
    if (t.amount <= 0 || !left.has(t.from) || !left.has(t.to)) return false;
    left.set(t.from, left.get(t.from) + t.amount);
    left.set(t.to, left.get(t.to) - t.amount);
  }
  return [...left.values()].every((v) => v === 0);
}
