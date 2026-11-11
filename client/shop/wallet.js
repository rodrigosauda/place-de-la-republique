// client/shop/wallet.js
// The game is free: you earn COINS by doing tasks (client/ui/progress.js) and spend them in the shop
// (cosmetic items) and at the ice-cream van. Coins and the items you unlocked are kept in this browser
// (localStorage). Everything is cosmetic, so there is nothing to protect on the server.

import { sanitizeLook, lookToArray, defaultLook, itemKey, SHOP_SLOTS } from '../../shared/looks.js';
import { productById, totalPrice } from '../../shared/shop.js';
import { COINS } from '../../shared/tasks.js';

const KEY = 'rpr_coins';
let coins = COINS.start;  // a small welcome gift so the shop isn't empty-handed on day one
let owned = new Set();
const listeners = new Set();
try {
  const s = JSON.parse(localStorage.getItem(KEY));
  if (s) { coins = Math.max(0, Math.floor(Number(s.coins) || 0)); owned = new Set(Array.isArray(s.owned) ? s.owned : []); }
} catch { /* storage blocked: you start fresh each time */ }

const notify = () => listeners.forEach((fn) => fn());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ coins, owned: [...owned] })); } catch { /* ignore */ } };
save();

export const wallet = {
  get coins() { return coins; },
  get owned() { return owned; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  refresh() {},

  addCoins(n) {
    if (!(n > 0)) return;
    coins += Math.floor(n);
    save();
    notify();
  },
  // Spend coins on something that is not an item (an ice cream). Returns false if you can't afford it.
  spend(n) {
    if (coins < n) return false;
    coins -= n;
    save();
    notify();
    return true;
  },

  // productIds: ['hat:phrygian', 'bundle:founder', ...]. Items you already own are free.
  async buy(productIds) {
    const price = totalPrice(productIds, owned);
    if (price > coins) throw new Error(`You need ${price - coins} more coins. Do tasks (P) to earn them.`);
    coins -= price;
    for (const id of productIds) for (const k of productById(id)?.grants ?? []) owned.add(k);
    save();
    notify();
    return { ok: true, price };
  },

  // A look with everything you have not unlocked swapped back to the default.
  cleanLook(faction, look) {
    const clean = sanitizeLook(lookToArray(look), faction, owned);
    const def = defaultLook(faction);
    for (const slot of SHOP_SLOTS) {
      const key = itemKey(slot, clean[slot]);
      if (key && !owned.has(key)) clean[slot] = def[slot];
    }
    return clean;
  },
};

wallet.ready = Promise.resolve();
