// 範例帳本：讓第一次打開的人馬上看到成果。
import { createLedger, addExpense } from './ledger.js';

export function demoLedger() {
  const l = createLedger('花蓮三天兩夜', ['小明', '小華', '阿傑', '小美']);
  const [a, b, c, d] = l.members.map((m) => m.id);
  const all = (mode = 'equal') => ({ mode, entries: [a, b, c, d].map((member) => ({ member, value: 1 })) });
  addExpense(l, { title: '租車三天', amount: 7800, category: '交通', date: '2026-05-01', paidBy: [{ member: a, amount: 7800 }], split: all() });
  addExpense(l, { title: '民宿兩晚', amount: 9601, category: '住宿', date: '2026-05-01', paidBy: [{ member: b, amount: 5000 }, { member: c, amount: 4601 }], split: all() });
  addExpense(l, { title: '太魯閣門票', amount: 1000, category: '門票', date: '2026-05-02', paidBy: [{ member: c, amount: 1000 }], split: { mode: 'shares', entries: [{ member: a, value: 1 }, { member: b, value: 1 }, { member: c, value: 1 }, { member: d, value: 0 }] } });
  addExpense(l, { title: '炸彈蔥油餅宵夜', amount: 335, category: '餐飲', date: '2026-05-02', paidBy: [{ member: d, amount: 335 }], split: all() });
  addExpense(l, { title: '晚餐燒肉', amount: 4280, category: '餐飲', date: '2026-05-02', paidBy: [{ member: a, amount: 4280 }], split: { mode: 'shares', entries: [{ member: a, value: 1 }, { member: b, value: 1 }, { member: c, value: 2 }, { member: d, value: 1 }] } });
  addExpense(l, { title: '代購日本零食(日圓標價)', amount: 1560, foreign: { currency: 'JPY', amount: '10000', rate: '0.156' }, category: '其他', date: '2026-05-03', paidBy: [{ member: d, amount: 1560 }], split: { mode: 'exact', entries: [{ member: a, value: 300 }, { member: b, value: 300 }, { member: c, value: 300 }, { member: d, value: 660 }] } });
  return l;
}
