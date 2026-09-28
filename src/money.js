// 金額工具：全部使用整數（新台幣「元」），匯率換算用 BigInt，避免浮點誤差。

export const CATEGORIES = ['餐飲', '交通', '住宿', '門票', '其他'];

/**
 * 把 total 元依權重分配給每個人，保證加總「完全等於」total。
 * 規則：每人先拿 floor(total * w / sumW)；剩下的零頭（一定少於參與人數）
 * 從「輪替起點」開始，依成員順序每人多 1 元。
 * @param {number} total 非負整數
 * @param {number[]} weights 非負整數，權重為 0 的人不參與
 * @param {number} offset 輪替起點（第幾位參與者先多 1 元），會對參與人數取餘
 */
export function allocate(total, weights, offset = 0) {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('金額必須是非負整數');
  if (!weights.every((w) => Number.isSafeInteger(w) && w >= 0)) throw new RangeError('權重必須是非負整數');
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) throw new RangeError('至少要有一位參與者');
  const T = BigInt(total);
  const S = BigInt(sumW);
  const out = weights.map((w) => Number((T * BigInt(w)) / S));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const eligible = [];
  weights.forEach((w, i) => { if (w > 0) eligible.push(i); });
  const start = ((Math.trunc(offset) % eligible.length) + eligible.length) % eligible.length;
  for (let k = 0; rest > 0; k++, rest--) out[eligible[(start + k) % eligible.length]] += 1;
  return out;
}

/** 嚴格解析十進位字串為放大 10^scale 的 BigInt；不合法回傳 null。 */
export function parseScaled(str, scale) {
  const m = new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${scale}}))?$`).exec(String(str).trim());
  if (!m) return null;
  return BigInt(m[1] + (m[2] || '').padEnd(scale, '0'));
}

/** 外幣金額（最多 2 位小數）× 匯率（最多 6 位小數）→ 新台幣整數元，四捨五入。 */
export function toTWD(amountStr, rateStr) {
  const cents = parseScaled(amountStr, 2);
  const rate = parseScaled(rateStr, 6);
  if (cents === null) throw new RangeError('外幣金額格式不正確');
  if (rate === null || rate === 0n) throw new RangeError('匯率格式不正確');
  const den = 100n * 1000000n;
  const twd = (cents * rate * 2n + den) / (2n * den);
  if (twd > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('金額太大');
  return Number(twd);
}

export function formatTWD(n) {
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + s;
}
