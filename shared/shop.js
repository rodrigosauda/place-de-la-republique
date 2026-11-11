// shared/shop.js
// What is in the shop. The game is free: prices are in COINS, earned by doing tasks (shared/tasks.js).
// (The old real-money checkout in worker/shop.js is switched off; it would read the same numbers.)
// Everything here is cosmetic. Nothing may ever change how strong a player is or how fights go.

import { CATALOG_FOR_EDITOR, SHOP_SLOTS, priceOfItem } from './looks.js';
import { coinsForCents } from './tasks.js';

export const CURRENCY = 'COINS';

export const SLOT_TITLES = {
  hat: 'Hats and helmets', face: 'Faces', back: 'Back items', top: 'Tops', placard: 'Placards',
  trail: 'Footstep trails', flair: 'Name flair',
};

// Bundles are cheaper than buying the parts. `grants` are item keys.
export const BUNDLES = [
  { id: 'bundle:founder', label: 'Founder pack', desc: 'Gold name, gold dust trail, gold placard, tricolour cape', price: 700,
    grants: ['flair:founder', 'trail:gold', 'placard:gold', 'back:cape'] },
  { id: 'bundle:tricolor', label: 'Blue-white-red pack', desc: 'Tricolour beanie, cape, sparks trail and name', price: 600,
    grants: ['hat:tricolor', 'back:cape', 'trail:tricolor', 'flair:tricolor'] },
  { id: 'bundle:party', label: 'Party pack', desc: 'Clown nose, confetti, feathers, star name', price: 500,
    grants: ['face:clown', 'trail:confetti', 'trail:feathers', 'flair:star'] },
];

// Every premium item as a product: { id: 'hat:phrygian', slot, label, price, faction?, grants: ['hat:phrygian'] }
export function itemProducts() {
  const out = [];
  for (const slot of SHOP_SLOTS) {
    for (const item of CATALOG_FOR_EDITOR[slot] || []) {
      if (typeof item !== 'object' || !item.premium) continue;
      out.push({ id: `${slot}:${item.id}`, slot, label: item.label, price: coinsForCents(priceOfItem(item)), faction: item.faction, grants: [`${slot}:${item.id}`] });
    }
  }
  return out;
}

const PRODUCTS = new Map([...itemProducts(), ...BUNDLES].map((p) => [p.id, p]));
export const productById = (id) => PRODUCTS.get(id) || null;

// Item keys a list of product ids would grant (unknown ids are ignored).
export function grantsOf(productIds) {
  const keys = new Set();
  for (const id of productIds) for (const k of productById(id)?.grants ?? []) keys.add(k);
  return [...keys];
}

// Total price in cents; items you already own are free (so nobody pays twice).
export function totalPrice(productIds, owned = new Set()) {
  let sum = 0;
  for (const id of new Set(productIds)) {
    const p = productById(id);
    if (!p) continue;
    if (p.grants.every((k) => owned.has(k))) continue;
    sum += p.price;
  }
  return sum;
}

export const formatPrice = (coins) => `${coins} coins`;

// Wallet codes: "RPR-XXXX-XXXX-XXXX-XXXX" (80 bits of randomness, no look-alike characters).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 symbols
export function normalizeCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('RPR') ? raw.slice(3) : raw;
  if (body.length !== 16 || [...body].some((c) => !ALPHABET.includes(c))) return null;
  return `RPR-${body.match(/.{4}/g).join('-')}`;
}
export function newCode(randomBytes) {
  let body = '';
  for (let i = 0; i < 16; i++) body += ALPHABET[randomBytes[i] % ALPHABET.length];
  return `RPR-${body.match(/.{4}/g).join('-')}`;
}
