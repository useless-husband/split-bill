import { h } from './dom.js';
import { CATEGORIES, formatTWD } from './money.js';
import {
  createLedger, addExpense, updateExpense, removeExpense, balances, filterExpenses, categoryTotals,
  addMember, renameMember, removeMember, isMemberUsed,
} from './ledger.js';
import { greedy, settle, transferKey } from './settle.js';
import { summaryText, exportJSON, importJSON, encodeHash, decodeHash } from './share.js';
import { loadState, saveState } from './store.js';
import { buildForm } from './form.js';
import { demoLedger } from './demo.js';

const root = document.getElementById('app');
let storage;
try { storage = window.localStorage; storage.getItem('x'); } catch { storage = { getItem: () => null, setItem: () => { throw new Error('no storage'); } }; }

const state = loadState(storage);
const ui = {
  tab: 'expenses', filter: { category: '', member: '' }, editing: null, msg: null,
  confirmDelBook: false, creating: false, incoming: null, shareUrl: '', importText: '', storageOk: true,
};

const book = () => state.books.find((b) => b.id === state.activeId) || null;
const say = (text, kind = 'ok') => { ui.msg = { text, kind }; };
function commit() {
  ui.storageOk = saveState(storage, state);
  render();
}
const guard = (fn) => (...a) => {
  try { fn(...a); } catch (e) { say(e.message, 'error'); render(); }
};

// ---------- 共用 ----------
function header() {
  return h('header', { class: 'top' },
    h('h1', {}, '分帳小幫手'),
    state.books.length > 0 && h('select', {
      'aria-label': '切換帳本',
      onchange: (ev) => { state.activeId = ev.target.value; ui.editing = null; ui.confirmDelBook = false; ui.msg = null; ui.filter = { category: '', member: '' }; commit(); },
    }, state.books.map((b) => h('option', { value: b.id, selected: b.id === state.activeId }, b.name))),
  );
}
function tabs() {
  const items = [['expenses', '支出'], ['settle', '結算'], ['share', '分享'], ['book', '帳本']];
  return h('nav', { class: 'tabs', 'aria-label': '功能' }, items.map(([k, t]) => h('button', {
    type: 'button', 'aria-current': ui.tab === k ? 'page' : null,
    onclick: () => { ui.tab = k; ui.editing = null; ui.msg = null; render(); },
  }, t)));
}
function messages() {
  const out = [h('div', { role: 'status', 'aria-live': 'polite' }, ui.msg && h('div', { class: `panel ${ui.msg.kind === 'error' ? 'error' : 'notice'}` }, ui.msg.text))];
  if (!ui.storageOk) out.push(h('div', { class: 'panel error', role: 'alert' }, '無法寫入瀏覽器儲存空間(可能是無痕模式或空間已滿)。請先到「分享」匯出 JSON 備份。'));
  if (ui.incoming) {
    out.push(h('div', { class: 'panel notice' },
      h('p', {}, `這個連結內含帳本「${ui.incoming.name}」(${ui.incoming.members.length} 位成員、${ui.incoming.expenses.length} 筆支出)。要匯入成新的帳本嗎？`),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', type: 'button', id: 'accept-incoming', onclick: () => { state.books.push(ui.incoming); state.activeId = ui.incoming.id; ui.incoming = null; ui.tab = 'expenses'; say('已匯入帳本'); commit(); } }, '匯入'),
        h('button', { type: 'button', onclick: () => { ui.incoming = null; render(); } }, '略過'))));
  }
  return out;
}

// ---------- 支出 ----------
function expensesView(b) {
  if (ui.editing) {
    const exp = ui.editing === 'new' ? null : b.expenses.find((e) => e.id === ui.editing);
    return buildForm(b, {
      expense: exp,
      onCancel: () => { ui.editing = null; render(); },
      onSave: guard((data) => {
        if (exp) updateExpense(b, exp.id, data); else addExpense(b, data);
        ui.editing = null; say(exp ? '已儲存修改' : '已新增支出'); commit();
      }),
      onDelete: guard(() => { removeExpense(b, exp.id); ui.editing = null; say('已刪除'); commit(); }),
    });
  }
  const name = new Map(b.members.map((m) => [m.id, m.name]));
  const list = filterExpenses(b, ui.filter).slice().sort((x, y) => (y.date.localeCompare(x.date)) || (y.seq - x.seq));
  const totals = categoryTotals(list);
  const sum = list.reduce((a, e) => a + e.amount, 0);
  const setF = (k) => (ev) => { ui.filter[k] = ev.target.value; render(); };
  return h('section', {},
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', id: 'add-expense', onclick: () => { ui.editing = 'new'; ui.msg = null; render(); window.scrollTo(0, 0); } }, '新增支出')),
    b.expenses.length > 0 && h('div', { class: 'filters' },
      h('label', {}, h('span', { class: 'sr' }, '依分類篩選'), h('select', { onchange: setF('category') }, h('option', { value: '' }, '全部分類'), CATEGORIES.map((c) => h('option', { value: c, selected: c === ui.filter.category }, c)))),
      h('label', {}, h('span', { class: 'sr' }, '依成員篩選'), h('select', { onchange: setF('member') }, h('option', { value: '' }, '所有人'), b.members.map((m) => h('option', { value: m.id, selected: m.id === ui.filter.member }, m.name)))),
    ),
    list.length > 0 && h('div', { class: 'subtotals', 'aria-label': '分類小計' },
      h('span', {}, '合計 ', h('b', {}, `NT$ ${formatTWD(sum)}`)),
      CATEGORIES.filter((c) => totals[c] > 0).map((c) => h('span', {}, `${c} `, h('b', {}, formatTWD(totals[c]))))),
    list.length === 0
      ? h('p', { class: 'empty' }, b.expenses.length ? '沒有符合篩選條件的支出。' : '還沒有任何支出。按上面的「新增支出」開始記帳。')
      : h('ul', { class: 'list' }, list.map((e) => h('li', {},
        h('button', { type: 'button', class: 'item', onclick: () => { ui.editing = e.id; ui.msg = null; render(); window.scrollTo(0, 0); }, 'aria-label': `編輯 ${e.title}，${formatTWD(e.amount)} 元` },
          h('span', { class: 'main' },
            h('span', { class: 'title' }, e.title), h('br'),
            h('span', { class: 'meta' }, `${e.date.slice(5).replace('-', '/')} · ${e.category} · ${e.paidBy.map((p) => name.get(p.member)).join('、')} 付`,
              e.foreign ? ` · ${e.foreign.amount} ${e.foreign.currency}` : '')),
          h('span', { class: 'amt' }, formatTWD(e.amount)))))),
  );
}

// ---------- 結算 ----------
function settleView(b) {
  const rows = balances(b);
  const name = new Map(rows.map((r) => [r.id, r.name]));
  const nets = rows.map((r) => ({ id: r.id, net: r.net }));
  const plan = settle(nets);
  const g = greedy(nets);
  const done = new Set(b.settled);
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '-' : '') + formatTWD(Math.abs(n));
  return h('section', {},
    b.expenses.length === 0 && h('p', { class: 'empty' }, '還沒有支出，先到「支出」新增幾筆。'),
    h('h2', {}, '每人明細'),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '成員'), h('th', { class: 'num' }, '已付'), h('th', { class: 'num' }, '應付'), h('th', { class: 'num' }, '淨額'))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.name), h('td', { class: 'num' }, formatTWD(r.paid)), h('td', { class: 'num' }, formatTWD(r.owed)),
        h('td', { class: `num ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}` }, signed(r.net)))))),
    h('p', { class: 'muted' }, '淨額 = 已付 - 應付。正數代表別人要給他，負數代表他要給別人；全部加起來一定是 0。'),
    h('h3', {}, '怎麼還'),
    plan.transfers.length === 0
      ? h('p', {}, '目前沒有需要轉帳的款項。')
      : h('ul', { class: 'list' }, plan.transfers.map((t) => {
        const k = transferKey(t); const isDone = done.has(k);
        return h('li', {}, h('div', { class: `transfer ${isDone ? 'done' : ''}` },
          h('label', {}, h('input', { type: 'checkbox', checked: isDone, 'aria-label': `已還：${name.get(t.from)} 給 ${name.get(t.to)} ${t.amount} 元`, onchange: (ev) => {
            b.settled = b.settled.filter((x) => x !== k); if (ev.target.checked) b.settled.push(k); commit();
          } }), h('span', { class: 'txt' }, `${name.get(t.from)} → ${name.get(t.to)}`)),
          h('span', { class: 'num' }, `NT$ ${formatTWD(t.amount)}`)));
      })),
    h('p', { class: 'muted' },
      plan.transfers.length === 0 ? '' :
        (plan.method === 'exact'
          ? `這份方案共 ${plan.transfers.length} 筆，已用精確演算法確認是最少筆數。`
          : `成員超過 12 人，改用貪婪法(共 ${plan.transfers.length} 筆)，不保證是理論最少。`),
      plan.method === 'exact' && g.length > plan.transfers.length ? ` 簡單的貪婪法會需要 ${g.length} 筆。` : ''),
    h('p', { class: 'muted' }, '勾選「已還」只是記錄；如果之後又改了支出，新的方案裡金額不同的項目會重新出現。'),
  );
}

// ---------- 分享 ----------
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback */ }
  const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
  document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove(); return ok;
}
function shareView(b) {
  const text = b.expenses.length ? summaryText(b) : '';
  return h('section', {},
    h('h2', {}, '貼到 LINE 的結算摘要'),
    text ? h('pre', { class: 'summary', id: 'summary' }, text) : h('p', { class: 'empty' }, '還沒有支出可以結算。'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'primary', disabled: !text, onclick: async () => { say(await copy(text) ? '已複製，貼到 LINE 就好' : '複製失敗，請手動選取文字', 'ok'); render(); } }, '複製摘要')),

    h('h2', { style: 'margin-top:28px' }, '分享連結'),
    h('p', { class: 'muted' }, '把整本帳本壓縮進網址，對方打開就能匯入。資料只在網址裡，不會上傳到任何伺服器。'),
    h('div', { class: 'actions' }, h('button', { type: 'button', id: 'make-link', onclick: async () => {
      try { ui.shareUrl = `${location.origin}${location.pathname}#${await encodeHash(b)}`; say(`連結長度 ${ui.shareUrl.length} 字元`); }
      catch (e) { say(e.message, 'error'); }
      render();
    } }, '產生分享連結')),
    ui.shareUrl && h('div', {},
      h('label', { class: 'field' }, h('span', {}, '分享連結'), h('input', { type: 'text', readonly: true, value: ui.shareUrl, onfocus: (ev) => ev.target.select() })),
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: async () => { say(await copy(ui.shareUrl) ? '連結已複製' : '複製失敗，請手動選取', 'ok'); render(); } }, '複製連結'))),

    h('h2', { style: 'margin-top:28px' }, '備份與匯入(JSON)'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', onclick: () => {
        const url = URL.createObjectURL(new Blob([exportJSON(b)], { type: 'application/json' }));
        const a = h('a', { href: url, download: `${b.name}.json` }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } }, '下載這本帳本(JSON)')),
    h('label', { class: 'field' }, h('span', {}, '選擇 JSON 檔匯入'), h('input', { type: 'file', accept: '.json,application/json', onchange: async (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      if (file.size > 2_000_000) { say('檔案太大', 'error'); render(); return; }
      doImport(await file.text());
    } })),
    h('label', { class: 'field' }, h('span', {}, '或貼上 JSON 內容'), h('textarea', { id: 'import-text', value: ui.importText, oninput: (ev) => { ui.importText = ev.target.value; } })),
    h('div', { class: 'actions' }, h('button', { type: 'button', id: 'import-btn', onclick: () => doImport(ui.importText) }, '匯入貼上的內容')),
  );
}
function doImport(text) {
  try {
    const l = importJSON(text);
    state.books.push(l); state.activeId = l.id; ui.tab = 'expenses'; ui.importText = '';
    say(`已匯入「${l.name}」(${l.expenses.length} 筆支出)`);
    commit();
  } catch (e) { say(`匯入失敗：${e.message}`, 'error'); render(); }
}

// ---------- 帳本 ----------
function createForm(first) {
  let name = ''; let members = '';
  return h('form', { novalidate: true, onsubmit: (ev) => {
    ev.preventDefault();
    try {
      const l = createLedger(name, members.split(/[\n,，、]+/));
      state.books.push(l); state.activeId = l.id; ui.creating = false; ui.tab = 'expenses'; say('帳本建好了，來新增第一筆支出吧');
      commit();
    } catch (e) { say(e.message, 'error'); render(); }
  } },
  h('h2', {}, first ? '開始使用：建立第一本帳本' : '新增帳本'),
  h('label', { class: 'field' }, h('span', {}, '帳本名稱'), h('input', { type: 'text', id: 'new-name', maxlength: 60, placeholder: '例如：花蓮三天兩夜', oninput: (ev) => { name = ev.target.value; } })),
  h('label', { class: 'field' }, h('span', {}, '成員(用逗號或換行分開，至少兩位)'), h('textarea', { id: 'new-members', placeholder: '小明, 小華, 阿傑', oninput: (ev) => { members = ev.target.value; } })),
  h('p', { class: 'muted' }, '成員的順序也是零頭輪流多 1 元的順序。'),
  h('div', { class: 'actions' },
    h('button', { type: 'submit', class: 'primary', id: 'create-book' }, '建立帳本'),
    first && h('button', { type: 'button', id: 'load-demo', onclick: () => { const d = demoLedger(); state.books.push(d); state.activeId = d.id; say('已載入範例帳本，隨你改、隨時可以刪除'); commit(); } }, '先看範例帳本'),
    !first && h('button', { type: 'button', onclick: () => { ui.creating = false; render(); } }, '取消')));
}
function bookView(b) {
  if (ui.creating) return createForm(false);
  const used = (id) => isMemberUsed(b, id);
  let newName = '';
  return h('section', {},
    h('h2', {}, '帳本名稱'),
    (() => { let v = b.name; return h('form', { onsubmit: guard((ev) => { ev.preventDefault(); if (!v.trim()) throw new Error('請輸入帳本名稱'); b.name = v.trim().slice(0, 60); say('已改名'); commit(); }) },
      h('div', { class: 'row' }, h('input', { type: 'text', 'aria-label': '帳本名稱', value: b.name, maxlength: 60, style: 'flex:1;min-width:0;width:auto;text-align:left', oninput: (ev) => { v = ev.target.value; } }), h('button', { type: 'submit' }, '改名'))); })(),

    h('h2', { style: 'margin-top:24px' }, '成員'),
    h('p', { class: 'muted' }, '順序就是除不盡時輪流多付 1 元的順序。有支出紀錄的成員不能移除，但可以改名。'),
    b.members.map((m) => {
      let v = m.name;
      return h('form', { class: 'row', onsubmit: guard((ev) => { ev.preventDefault(); renameMember(b, m.id, v); say('已改名'); commit(); }) },
        h('input', { type: 'text', 'aria-label': `成員 ${m.name} 的名稱`, value: m.name, maxlength: 60, style: 'flex:1;min-width:0;width:auto;text-align:left', oninput: (ev) => { v = ev.target.value; } }),
        h('button', { type: 'submit' }, '改名'),
        h('button', { type: 'button', class: 'danger', disabled: used(m.id) || b.members.length <= 2, onclick: guard(() => { removeMember(b, m.id); say('已移除'); commit(); }), 'aria-label': `移除 ${m.name}` }, '移除'));
    }),
    h('form', { class: 'row', onsubmit: guard((ev) => { ev.preventDefault(); addMember(b, newName); say('已新增成員'); commit(); }) },
      h('input', { type: 'text', 'aria-label': '新成員名稱', placeholder: '新成員名稱', maxlength: 60, style: 'flex:1;min-width:0;width:auto;text-align:left', oninput: (ev) => { newName = ev.target.value; } }),
      h('button', { type: 'submit' }, '新增')),

    h('h2', { style: 'margin-top:24px' }, '帳本管理'),
    h('div', { class: 'actions' }, h('button', { type: 'button', id: 'new-book', onclick: () => { ui.creating = true; ui.msg = null; render(); } }, '新增另一本帳本')),
    !ui.confirmDelBook
      ? h('div', { class: 'actions' }, h('button', { type: 'button', class: 'danger', id: 'del-book', onclick: () => { ui.confirmDelBook = true; render(); } }, '刪除這本帳本'))
      : h('div', { class: 'panel confirm', role: 'alertdialog', 'aria-label': '確認刪除帳本' },
        h('p', {}, `確定刪除「${b.name}」和裡面 ${b.expenses.length} 筆支出？無法復原，建議先到「分享」下載備份。`),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'danger', id: 'del-book-yes', onclick: () => {
            state.books = state.books.filter((x) => x.id !== b.id); state.activeId = state.books[0]?.id ?? null;
            ui.confirmDelBook = false; ui.tab = 'expenses'; say('帳本已刪除'); commit();
          } }, '確定刪除'),
          h('button', { type: 'button', onclick: () => { ui.confirmDelBook = false; render(); } }, '先不要'))),
    h('p', { class: 'muted' }, '所有資料只存在這個瀏覽器的 localStorage，不會傳到任何地方。換手機或清除網站資料前，記得先匯出備份。'),
  );
}

// ---------- 主畫面 ----------
function render() {
  const b = book();
  const keepScroll = window.scrollY;
  const parts = [header()];
  if (!b) {
    parts.push(...messages(), createForm(true));
  } else {
    parts.push(tabs(), ...messages());
    try {
      parts.push(ui.tab === 'expenses' ? expensesView(b) : ui.tab === 'settle' ? settleView(b) : ui.tab === 'share' ? shareView(b) : bookView(b));
    } catch (e) {
      parts.push(h('div', { class: 'panel error' }, `這本帳本的資料有問題：${e.message}。請到「帳本」刪除，或匯入備份。`));
    }
  }
  const focusId = document.activeElement?.id;
  root.replaceChildren(...parts);
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  if (!ui.editing) window.scrollTo(0, keepScroll);
  document.title = b ? `${b.name}｜分帳小幫手` : '分帳小幫手';
}

render();

async function checkHash() {
  if (!/^#b=/.test(location.hash)) return;
  try { ui.incoming = await decodeHash(location.hash); }
  catch (e) { say(`分享連結無法讀取：${e.message}`, 'error'); }
  history.replaceState(null, '', location.pathname + location.search);
  render();
}
checkHash();
window.addEventListener('hashchange', checkHash);
