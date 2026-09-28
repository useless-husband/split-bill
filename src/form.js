// 新增/編輯支出的表單。表單狀態放在 f，輸入時只更新預覽，切換選項時才整個重畫。
import { h } from './dom.js';
import { CATEGORIES, parseScaled, toTWD, formatTWD } from './money.js';
import { computeShares, validateExpense } from './ledger.js';

const CURRENCIES = ['TWD', 'JPY', 'USD', 'KRW', 'EUR', 'CNY', 'HKD', 'THB', 'GBP', 'SGD', 'MYR', 'VND'];
const MODES = [
  ['equal', '均分', ''],
  ['shares', '按份數', '份'],
  ['exact', '指定金額', '元'],
  ['percent', '百分比', '%'],
];

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function initialState(ledger, exp) {
  const ids = ledger.members.map((m) => m.id);
  const f = {
    title: '', currency: 'TWD', amount: '', rate: '', date: todayStr(), category: CATEGORIES[0],
    payMode: 'single', payer: ids[0], payAmts: {}, mode: 'equal',
    part: Object.fromEntries(ids.map((id) => [id, true])), vals: {}, confirmDel: false,
  };
  if (!exp) return f;
  f.title = exp.title; f.date = exp.date; f.category = exp.category;
  if (exp.foreign) { f.currency = exp.foreign.currency; f.amount = exp.foreign.amount; f.rate = exp.foreign.rate; }
  else f.amount = String(exp.amount);
  if (exp.paidBy.length === 1) f.payer = exp.paidBy[0].member;
  else { f.payMode = 'multi'; exp.paidBy.forEach((p) => { f.payAmts[p.member] = String(p.amount); }); }
  f.mode = exp.split.mode;
  f.part = Object.fromEntries(ids.map((id) => [id, false]));
  for (const e of exp.split.entries) {
    if (exp.split.mode !== 'equal' && e.value === 0) continue;
    f.part[e.member] = true;
    f.vals[e.member] = exp.split.mode === 'percent' ? String(e.value / 100) : String(e.value);
  }
  return f;
}

/** 從表單狀態組出支出；回傳 { exp, error, total }。 */
export function collect(ledger, f) {
  const ids = ledger.members.map((m) => m.id);
  let total = null;
  try {
    if (f.currency === 'TWD') {
      if (!/^\d{1,12}$/.test(f.amount.trim())) return { error: '請輸入金額(新台幣整數元)', total };
      total = Number(f.amount.trim());
    } else {
      total = toTWD(f.amount, f.rate);
    }
  } catch (e) {
    return { error: f.currency === 'TWD' ? '請輸入金額(新台幣整數元)' : (f.amount.trim() ? e.message : '請輸入外幣金額'), total };
  }
  if (total <= 0) return { error: '金額必須大於 0', total: null };

  let paidBy;
  if (f.payMode === 'single') paidBy = [{ member: f.payer, amount: total }];
  else {
    paidBy = [];
    for (const id of ids) {
      const s = (f.payAmts[id] || '').trim();
      if (!s) continue;
      if (!/^\d{1,12}$/.test(s)) return { error: '付款金額請輸入整數元', total };
      if (Number(s) > 0) paidBy.push({ member: id, amount: Number(s) });
    }
    const sum = paidBy.reduce((a, b) => a + b.amount, 0);
    if (sum !== total) return { error: `付款金額加總 ${formatTWD(sum)} 元，要等於總額 ${formatTWD(total)} 元(${sum < total ? '還差' : '多了'} ${formatTWD(Math.abs(total - sum))} 元)`, total };
  }

  const entries = [];
  for (const id of ids) {
    if (!f.part[id]) continue;
    if (f.mode === 'equal') { entries.push({ member: id, value: 1 }); continue; }
    const s = (f.vals[id] || '').trim();
    let v;
    if (f.mode === 'percent') {
      const p = s ? parseScaled(s, 2) : 0n;
      if (p === null) return { error: '百分比最多兩位小數', total };
      v = Number(p);
    } else {
      if (s && !/^\d{1,12}$/.test(s)) return { error: f.mode === 'shares' ? '份數請輸入整數' : '指定金額請輸入整數元', total };
      v = s ? Number(s) : 0;
    }
    entries.push({ member: id, value: v });
  }
  if (!entries.length) return { error: '請至少勾選一位分攤的人', total };

  const exp = {
    title: f.title.trim(), amount: total, category: f.category, date: f.date, paidBy,
    split: { mode: f.mode, entries },
  };
  if (f.currency !== 'TWD') exp.foreign = { currency: f.currency, amount: f.amount.trim(), rate: f.rate.trim() };
  const errs = validateExpense(exp, ids);
  if (errs.length) return { error: errs[0], total };
  return { exp, total };
}

export function buildForm(ledger, { expense, onSave, onCancel, onDelete }) {
  const f = initialState(ledger, expense);
  const ids = ledger.members.map((m) => m.id);
  const root = h('form', { novalidate: true, 'aria-label': expense ? '編輯支出' : '新增支出' });
  let previewEl; let errEl; let payHintEl;

  const refresh = () => {
    const { exp, error, total } = collect(ledger, { ...f, title: f.title || '_' });
    if (payHintEl) {
      const sum = ids.reduce((a, id) => a + (/^\d+$/.test((f.payAmts[id] || '').trim()) ? Number(f.payAmts[id]) : 0), 0);
      payHintEl.textContent = total ? `已填 ${formatTWD(sum)} / ${formatTWD(total)} 元` : `已填 ${formatTWD(sum)} 元`;
    }
    previewEl.replaceChildren();
    if (!exp) { previewEl.append(h('span', { class: 'muted' }, error || '')); return; }
    const sh = computeShares(exp, ids);
    previewEl.append(
      h('div', { class: 'muted' }, `每人分攤(共 ${formatTWD(exp.amount)} 元)`),
      h('ul', {}, ledger.members.filter((m) => sh[m.id]).map((m) => h('li', {}, h('span', {}, m.name), h('span', { class: 'num' }, `${formatTWD(sh[m.id])} 元`)))),
      h('div', { class: 'muted' }, '除不盡的零頭，依成員順序輪流多 1 元；起點每筆支出會往後輪一位，長期下來是公平的。'),
    );
  };
  const bind = (key, obj = f) => (ev) => { obj[key] = ev.target.value; refresh(); };

  const draw = () => {
    const focusKey = document.activeElement?.dataset?.k;
    root.replaceChildren();
    errEl = h('p', { class: 'error', role: 'alert' });
    previewEl = h('div', { class: 'panel preview', 'aria-live': 'polite' });
    payHintEl = null;
    const foreign = f.currency !== 'TWD';

    const parts = [
      h('h2', {}, expense ? '編輯支出' : '新增支出'),
      h('label', { class: 'field' }, h('span', {}, '項目名稱'), h('input', { type: 'text', maxlength: 40, value: f.title, oninput: bind('title'), autocomplete: 'off', placeholder: '例如：晚餐燒肉', id: 'f-title' })),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, '幣別'), h('select', { 'data-k': 'cur', onchange: (ev) => { f.currency = ev.target.value; draw(); refresh(); } }, CURRENCIES.map((c) => h('option', { value: c, selected: c === f.currency }, c === 'TWD' ? 'TWD 新台幣' : c)))),
        h('label', { class: 'field' }, h('span', {}, foreign ? `金額(${f.currency})` : '金額(元)'), h('input', { type: 'text', inputmode: foreign ? 'decimal' : 'numeric', value: f.amount, oninput: bind('amount'), id: 'f-amount', placeholder: foreign ? '例如 1200.5' : '例如 1280' })),
      ),
      foreign && h('label', { class: 'field' }, h('span', {}, `匯率(1 ${f.currency} = 幾元新台幣)`), h('input', { type: 'text', inputmode: 'decimal', value: f.rate, oninput: bind('rate'), placeholder: '例如 0.2145', id: 'f-rate' })),
      foreign && h('p', { class: 'muted' }, '換算後四捨五入成整數元；以下付款與分攤金額都用換算後的新台幣。'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, '日期'), h('input', { type: 'date', value: f.date, oninput: bind('date') })),
        h('label', { class: 'field' }, h('span', {}, '分類'), h('select', { onchange: bind('category') }, CATEGORIES.map((c) => h('option', { value: c, selected: c === f.category }, c)))),
      ),

      h('fieldset', {},
        h('legend', { class: 'legend' }, '誰付的'),
        h('div', { class: 'seg' },
          [['single', '一個人付'], ['multi', '多人各付一部分']].map(([v, t]) => h('label', {}, h('input', { type: 'radio', name: 'paymode', 'data-k': 'pm-' + v, checked: f.payMode === v, onchange: () => { f.payMode = v; draw(); refresh(); } }), t)),
        ),
        f.payMode === 'single'
          ? h('label', { class: 'field' }, h('span', { class: 'sr' }, '付款人'), h('select', { onchange: bind('payer') }, ledger.members.map((m) => h('option', { value: m.id, selected: m.id === f.payer }, m.name))))
          : h('div', {},
            ledger.members.map((m) => h('div', { class: 'row' },
              h('span', { class: 'name', style: 'flex:1' }, m.name),
              h('input', { type: 'text', inputmode: 'numeric', 'aria-label': `${m.name} 付了多少元`, placeholder: '0', value: f.payAmts[m.id] || '', oninput: bind(m.id, f.payAmts) }))),
            (payHintEl = h('p', { class: 'muted' })),
          ),
      ),

      h('fieldset', {},
        h('legend', { class: 'legend' }, '分法'),
        h('div', { class: 'seg' }, MODES.map(([v, t]) => h('label', {}, h('input', { type: 'radio', name: 'mode', 'data-k': 'mode-' + v, checked: f.mode === v, onchange: () => { f.mode = v; draw(); refresh(); } }), t))),
        h('p', { class: 'legend', style: 'margin-top:12px' }, '分給誰'),
        ledger.members.map((m) => {
          const unit = MODES.find((x) => x[0] === f.mode)[2];
          return h('div', { class: 'row' },
            h('label', {}, h('input', { type: 'checkbox', 'data-k': 'part-' + m.id, checked: !!f.part[m.id], onchange: (ev) => { f.part[m.id] = ev.target.checked; draw(); refresh(); } }), h('span', { class: 'name' }, m.name)),
            f.mode !== 'equal' && f.part[m.id] && h('input', { type: 'text', inputmode: 'decimal', 'aria-label': `${m.name} 的${unit}`, placeholder: unit, value: f.vals[m.id] || '', oninput: bind(m.id, f.vals) }),
          );
        }),
        f.mode === 'percent' && h('p', { class: 'muted' }, '百分比加總要剛好 100。'),
        f.mode === 'exact' && h('p', { class: 'muted' }, '指定金額加總要剛好等於總額。'),
      ),

      previewEl,
      errEl,
      h('div', { class: 'actions' },
        h('button', { type: 'submit', class: 'primary' }, expense ? '儲存修改' : '新增支出'),
        h('button', { type: 'button', onclick: onCancel }, '取消'),
        expense && !f.confirmDel && h('button', { type: 'button', class: 'danger', onclick: () => { f.confirmDel = true; draw(); refresh(); } }, '刪除這筆'),
      ),
      expense && f.confirmDel && h('div', { class: 'panel confirm', role: 'alertdialog', 'aria-label': '確認刪除' },
        h('p', {}, `確定刪除「${expense.title}」？刪除後無法復原。`),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'danger', onclick: onDelete }, '確定刪除'),
          h('button', { type: 'button', onclick: () => { f.confirmDel = false; draw(); refresh(); } }, '先不要')),
      ),
    ];
    root.append(...parts.filter((x) => x));
    if (focusKey) root.querySelector(`[data-k="${focusKey}"]`)?.focus();
  };

  root.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const { exp, error } = collect(ledger, f);
    if (!exp) { errEl.textContent = error; return; }
    errEl.textContent = '';
    onSave(exp);
  });
  draw(); refresh();
  return root;
}
