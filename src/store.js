// 帳本儲存：包一層 localStorage，壞資料時退回空狀態而不是壞掉。
import { sanitizeLedger } from './share.js';

export const STORAGE_KEY = 'split-bill:v1';

export function loadState(storage) {
  const empty = { books: [], activeId: null };
  let raw;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return empty; }
  if (!raw) return empty;
  try {
    const data = JSON.parse(raw);
    const books = [];
    for (const b of Array.isArray(data.books) ? data.books : []) {
      try { books.push(sanitizeLedger(b)); } catch { /* 跳過壞掉的帳本 */ }
    }
    const activeId = books.some((b) => b.id === data.activeId) ? data.activeId : (books[0]?.id ?? null);
    return { books, activeId };
  } catch { return empty; }
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ books: state.books, activeId: state.activeId }));
    return true;
  } catch { return false; }
}
