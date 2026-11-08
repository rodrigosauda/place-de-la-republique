// shared/looks.js
// The customization catalog: everything a player can wear.
// Used by the client (editor + drawing) AND the server (validation), so
// nobody can wear something that doesn't exist or isn't theirs.
//
// Inspired by photos of recent French protests: hoodies, caps, beanies,
// big sunglasses, checked scarves, masks, backpacks; police in navy with
// "POLICE" on the back, unit numbers, helmets with visors, gas masks.
//
// premium: true  -> will be sold later. While PREMIUM_ENFORCED is false
//                   everybody can use them (so you see what people like).
// faction: 'g' or 'c' -> only that side can pick it (undefined = both).

export const PREMIUM_ENFORCED = false;

export const BODIES = [
  { id: 'man', label: 'Man' },
  { id: 'woman', label: 'Woman' },
  { id: 'oldman', label: 'Old man' },
  { id: 'oldwoman', label: 'Old woman' },
];

export const SKINS = ['#f1d0b5', '#e0b394', '#c68e6a', '#a26a45', '#7a4b2e', '#4e3020'];

export const HAIRS = [
  { id: 'short', label: 'Short' },
  { id: 'long', label: 'Long' },
  { id: 'bun', label: 'Bun' },
  { id: 'curly', label: 'Curly' },
  { id: 'bald', label: 'Bald' },
];

export const HAIR_COLORS = ['#1c1714', '#4a2f1d', '#8a5a2b', '#d9b26a', '#b5401f', '#a9a9a9', '#eeeeee', '#3f7fd6', '#d63f8c'];

export const TOPS = [
  { id: 'navy', label: 'Navy', color: '#22304f' },
  { id: 'black', label: 'Black', color: '#1d1d1f' },
  { id: 'white', label: 'White', color: '#ecebe6' },
  { id: 'grey', label: 'Grey', color: '#7c8088' },
  { id: 'red', label: 'Red', color: '#b3262e' },
  { id: 'green', label: 'Green', color: '#3c6e47' },
  { id: 'denim', label: 'Denim', color: '#4b6e9c' },
  { id: 'mariniere', label: 'Breton stripes', color: '#ecebe6', stripes: '#22304f', premium: true },
];

export const PANTS = [
  { id: 'jeans', label: 'Denim', color: '#3d5a80' },
  { id: 'black', label: 'Black', color: '#1f1f22' },
  { id: 'beige', label: 'Beige', color: '#b9a57f' },
  { id: 'grey', label: 'Grey', color: '#5f636b' },
  { id: 'olive', label: 'Khaki', color: '#5b5e3a' },
];

export const HATS = [
  { id: 'none', label: 'None' },
  { id: 'beanie', label: 'Beanie', faction: 'g' },
  { id: 'cap', label: 'Cap', faction: 'g' },
  { id: 'beret', label: 'Beret', faction: 'g' },
  { id: 'hood', label: 'Hood', faction: 'g' },
  { id: 'phrygian', label: 'Liberty cap (red)', faction: 'g', premium: true },
  { id: 'tricolor', label: 'Tricolour beanie', faction: 'g', premium: true },
  { id: 'helmet', label: 'Helmet', faction: 'c' },
  { id: 'helmetUp', label: 'Helmet, visor up', faction: 'c' },
  { id: 'goldHelmet', label: 'Gold helmet', faction: 'c', premium: true },
];

export const FACES = [
  { id: 'none', label: 'None' },
  { id: 'sunglasses', label: 'Sunglasses' },
  { id: 'mask', label: 'Face mask' },
  { id: 'scarf', label: 'Checked scarf', faction: 'g' },
  { id: 'gasmask', label: 'Gas mask', faction: 'c' },
  { id: 'goggles', label: 'Ski goggles', premium: true },
  { id: 'clown', label: 'Clown nose', premium: true },
];

export const BACKS = [
  { id: 'none', label: 'None' },
  { id: 'backpack', label: 'Backpack' },
  { id: 'umbrella', label: 'Umbrella (back)', faction: 'g', premium: true },
  { id: 'cape', label: 'Tricolour cape', premium: true },
];

export const PLACARDS = [
  { id: 'cardboard', label: 'Cardboard', board: '#c9a46b', ink: '#1a1a1a', frame: '#9c7a45' },
  { id: 'white', label: 'White', board: '#f4f1ea', ink: '#c8102e', frame: '#c8102e' },
  { id: 'gold', label: 'Gold', board: '#e8c25a', ink: '#3a2a00', frame: '#a37b12', premium: true },
];

// Order of the look array sent over the network.
export const LOOK_SLOTS = ['body', 'skin', 'hair', 'hairColor', 'top', 'pants', 'hat', 'face', 'back', 'placard', 'number'];
const CATALOG = { body: BODIES, skin: SKINS, hair: HAIRS, hairColor: HAIR_COLORS, top: TOPS, pants: PANTS, hat: HATS, face: FACES, back: BACKS, placard: PLACARDS };

// How well your face item protects you from tear gas: 0 = not at all, 1 = fully.
export function gasProtection(look) {
  const id = FACES[look?.face]?.id;
  if (id === 'gasmask' || id === 'goggles') return 1;
  if (id === 'mask' || id === 'scarf') return 0.5;
  return 0;
}

export function defaultLook(faction) {
  return faction === 'c'
    ? { body: 0, skin: 1, hair: 0, hairColor: 0, top: 1, pants: 1, hat: 7, face: 0, back: 0, placard: 0, number: 212 }
    : { body: 0, skin: 1, hair: 0, hairColor: 1, top: 4, pants: 0, hat: 0, face: 0, back: 0, placard: 0, number: 0 };
}

// A varied, free (non-premium) outfit for background extras. `seed` makes it repeatable.
export function randomLook(faction, seed = 0) {
  let s = seed * 9301 + 49297;
  const rnd = (n) => { s = (s * 9301 + 49297) % 233280; return Math.floor((s / 233280) * n); };
  const pick = (slot, list) => {
    const ok = list.map((_, i) => i).filter((i) => itemAllowed(slot, i, faction) && !(typeof list[i] === 'object' && list[i].premium));
    return ok[rnd(ok.length)];
  };
  const look = defaultLook(faction);
  look.body = rnd(BODIES.length);
  look.skin = rnd(SKINS.length);
  look.hair = pick('hair', HAIRS);
  look.hairColor = look.body >= 2 ? 5 + rnd(2) : rnd(5); // older people: grey/white hair
  look.pants = pick('pants', PANTS);
  if (faction === 'g') {
    look.top = pick('top', TOPS);
    look.hat = rnd(3) === 0 ? 0 : pick('hat', HATS);
    look.face = rnd(3) === 0 ? pick('face', FACES) : 0;
    look.back = rnd(4) === 0 ? 1 : 0;
  } else {
    look.hat = rnd(4) === 0 ? 8 : 7;
    look.face = rnd(3) === 0 ? 4 : 0;
    look.number = 100 + rnd(900);
  }
  return look;
}

export const lookToArray = (look) => LOOK_SLOTS.map((k) => look[k] ?? 0);
export const arrayToLook = (arr) => Object.fromEntries(LOOK_SLOTS.map((k, i) => [k, arr?.[i] ?? 0]));

// Is item `index` of `slot` allowed for this faction (and owned, if premium)?
export function itemAllowed(slot, index, faction, owned = new Set()) {
  const list = CATALOG[slot];
  if (!list || !Number.isInteger(index) || index < 0 || index >= list.length) return false;
  const item = list[index];
  if (typeof item === 'object') {
    if (item.faction && item.faction !== faction) return false;
    if (item.premium && PREMIUM_ENFORCED && !owned.has(`${slot}:${item.id}`)) return false;
  }
  return true;
}

// Cleans a look sent by a client: anything invalid goes back to the default.
export function sanitizeLook(arr, faction, owned) {
  const def = defaultLook(faction);
  const look = arrayToLook(Array.isArray(arr) ? arr.slice(0, LOOK_SLOTS.length) : []);
  for (const slot of LOOK_SLOTS) {
    if (slot === 'number') {
      const n = Number(look.number);
      look.number = Number.isInteger(n) && n >= 0 && n <= 999 ? n : def.number;
    } else if (!itemAllowed(slot, look[slot], faction, owned)) {
      look[slot] = def[slot];
    }
  }
  // CRS always wear a helmet (it's part of the uniform).
  if (faction === 'c' && !HATS[look.hat].faction) look.hat = def.hat;
  return look;
}

export function isPremium(slot, index) {
  const item = CATALOG[slot]?.[index];
  return !!(item && typeof item === 'object' && item.premium);
}

export const CATALOG_FOR_EDITOR = CATALOG;
