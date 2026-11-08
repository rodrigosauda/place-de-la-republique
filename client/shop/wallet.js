// client/shop/wallet.js
// Which premium items this browser owns. No accounts: a secret wallet code (RPR-XXXX-XXXX-XXXX-XXXX)
// is shown after the first purchase and kept in localStorage. Typing it on another device restores the items.
// The server checks ownership again on every join / outfit change (worker/shop.js), so this is only for the UI.

import { normalizeCode } from '../../shared/shop.js';
import { sanitizeLook, lookToArray } from '../../shared/looks.js';

const KEY = 'rpr_wallet';
let code = '';
let owned = new Set();
const listeners = new Set();
try { code = normalizeCode(localStorage.getItem(KEY)) || ''; } catch { /* storage blocked */ }

const notify = () => listeners.forEach((fn) => fn());
const save = () => { try { localStorage.setItem(KEY, code); } catch { /* ignore */ } };

async function call(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Shop error (${res.status})`);
  return data;
}

export const wallet = {
  get code() { return code; },
  get owned() { return owned; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async refresh() {
    if (!code) return;
    try { owned = new Set((await call(`/shop/wallet?code=${encodeURIComponent(code)}`)).owned); notify(); } catch { /* offline: keep what we know */ }
  },

  // productIds: ['hat:phrygian', 'bundle:founder', ...]. In test mode nothing is charged.
  async buy(productIds) {
    const data = await call('/shop/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: productIds, code: code || undefined }),
    });
    code = data.code; save();
    owned = new Set(data.owned);
    notify();
    return data;
  },

  async restore(input) {
    const c = normalizeCode(input);
    if (!c) throw new Error('That code does not look right. It has 16 letters and digits.');
    const data = await call(`/shop/wallet?code=${encodeURIComponent(c)}`);
    if (!data.owned.length) throw new Error('No items found for that code.');
    code = c; save();
    owned = new Set(data.owned);
    notify();
  },

  // A look with everything you do not own swapped back to the default (what the server would do).
  cleanLook(faction, look) {
    return sanitizeLook(lookToArray(look), faction, owned);
  },
};

wallet.ready = wallet.refresh(); // resolves when we know what this browser owns
