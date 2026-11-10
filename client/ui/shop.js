// client/ui/shop.js
// The shop window: a live preview of YOUR character on the left (click any item to try it on),
// tabs on the right (Featured · Protesters · Police · Effects · Bundles · Owned) with a picture of every product.
// In test mode (see worker/shop.js) a purchase is fake: nothing is charged, the items are granted at once.
// Opens from the start menu, the in-game bottom bar and the outfit editor ("Buy" on a locked item).

import { BUNDLES, itemProducts, formatPrice, totalPrice } from '../../shared/shop.js';
import { CATALOG_FOR_EDITOR, defaultLook } from '../../shared/looks.js';
import { wallet } from '../shop/wallet.js';
import { productPicture } from '../shop/thumbs.js';
import { createCharPreview } from './charPreview.js';

const FACTION_TAG = { g: 'Protesters only', c: 'Police only' };
const TABS = [['featured', 'Featured'], ['g', 'Protesters'], ['c', 'Police'], ['fx', 'Trails & names'], ['bundles', 'Bundles'], ['owned', 'Owned']];
const WEAR_SLOTS = new Set(['hat', 'face', 'back', 'top', 'placard']);

// Saved outfit of a side (same storage as the outfit editor; kept here to avoid a circular import).
function savedLook(faction) {
  try {
    const s = JSON.parse(localStorage.getItem('look_' + faction));
    if (s && s.v === 2) return { ...defaultLook(faction), ...s };
  } catch { /* ignore */ }
  return defaultLook(faction);
}

const indexOf = (key) => {
  const [slot, id] = key.split(':');
  return [slot, (CATALOG_FOR_EDITOR[slot] || []).findIndex((it) => typeof it === 'object' && it.id === id)];
};
const worth = (b) => b.grants.reduce((sum, k) => sum + (itemProducts().find((p) => p.id === k)?.price ?? 0), 0);

export function openShop({ highlight = [], faction = 'g', look = null, slogan = '', onOpen, onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'shop-overlay';
  const card = document.createElement('div');
  card.className = 'shop-card';
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  onOpen?.();

  const base = { g: faction === 'g' && look ? look : savedLook('g'), c: faction === 'c' && look ? look : savedLook('c') };
  let side = faction === 'c' ? 'c' : 'g';      // whose character is in the preview
  let tab = 'featured';
  let trying = null;                            // product being tried on
  let status = '';
  let confirming = null;                        // product id waiting for a second click
  let confirmTimer = 0;

  // ---------------------------------------------------------------- frame (built once)
  card.innerHTML = `
    <div class="shop-head"><h2>Shop</h2><button type="button" class="shop-close" title="Close (Esc)">✕</button></div>
    <p class="shop-info"><b>Cosmetic only</b>: nothing here makes you stronger. <span class="shop-test">Test mode: nothing is charged.</span></p>
    <div class="shop-body">
      <div class="shop-side">
        <div class="shop-preview"></div>
        <div class="shop-trying"></div>
        <details class="shop-wallet"><summary>Your wallet</summary><div class="shop-wallet-in"></div></details>
      </div>
      <div class="shop-main">
        <div class="shop-tabs"></div>
        <p class="shop-status" hidden></p>
        <div class="shop-scroll"></div>
      </div>
    </div>`;
  const $ = (s) => card.querySelector(s);
  const preview = createCharPreview({ faction: side, look: base[side], slogan, width: 240, height: 300 });
  $('.shop-preview').appendChild(preview.element);

  const close = () => {
    clearTimeout(confirmTimer);
    off();
    window.removeEventListener('keydown', onKey, true);
    preview.destroy();
    overlay.remove();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  $('.shop-close').addEventListener('click', close);
  const off = wallet.onChange(() => render());

  for (const [id, label] of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shop-tab';
    b.dataset.tab = id;
    b.textContent = label;
    b.addEventListener('click', () => {
      tab = id;
      if (id === 'g' || id === 'c') { side = id; trying = null; preview.setLook(base[side], side); }
      render();
      $('.shop-scroll').scrollTop = 0;
    });
    $('.shop-tabs').appendChild(b);
  }

  // ---------------------------------------------------------------- try-on
  function tryOn(p) {
    trying = p;
    if (p.faction) side = p.faction;
    const l = { ...base[side] };
    let wearable = false;
    for (const k of p.grants) {
      const [slot, i] = indexOf(k);
      if (i >= 0 && WEAR_SLOTS.has(slot)) { l[slot] = i; wearable = true; }
      if (i >= 0 && slot === 'trail') l.trail = i;
    }
    preview.setLook(l, side);
    render();
  }
  function resetTry() { trying = null; preview.setLook(base[side], side); render(); }

  // ---------------------------------------------------------------- buying
  async function buy(id) {
    status = 'Processing…';
    render();
    try {
      const res = await wallet.buy([id]);
      status = res.test ? 'Added to your wallet. (Test mode: nothing was charged.)' : 'Thank you!';
    } catch (e) {
      status = `Could not buy: ${e.message}`;
    }
    confirming = null;
    render();
  }
  function priceButton(p) {
    const own = p.grants.every((k) => wallet.owned.has(k));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shop-buy';
    if (own) { b.classList.add('owned'); b.textContent = 'Owned ✓'; b.disabled = true; return b; }
    const price = totalPrice([p.id], wallet.owned);
    const partial = p.grants.some((k) => wallet.owned.has(k));
    b.textContent = confirming === p.id ? `Confirm ${formatPrice(price)}` : `${partial ? 'Complete for ' : ''}${formatPrice(price)}`;
    if (confirming === p.id) b.classList.add('confirm');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirming === p.id) { clearTimeout(confirmTimer); buy(p.id); return; }
      confirming = p.id;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { confirming = null; render(); }, 3500);
      render();
    });
    return b;
  }

  // ---------------------------------------------------------------- cards
  function cardFor(p) {
    const el = document.createElement('div');
    el.className = 'shop-item' + (highlight.includes(p.id) ? ' hl' : '') + (trying?.id === p.id ? ' on' : '');
    el.title = 'Click to try it on';
    const name = document.createElement('div');
    name.className = 'shop-name';
    name.textContent = p.slot === 'placard' ? `${p.label} placard` : p.slot === 'trail' ? `${p.label} (trail)` : p.label;
    const note = document.createElement('div');
    note.className = 'shop-sub';
    if (p.desc) {
      const w = worth(p);
      note.textContent = `${p.desc} · worth ${formatPrice(w)}, save ${Math.round((1 - p.price / w) * 100)}%`;
    } else note.textContent = p.slot === 'placard' ? 'Protesters only' : FACTION_TAG[p.faction] || 'Both sides';
    el.append(productPicture(p), name, note, priceButton(p));
    el.addEventListener('click', () => tryOn(p));
    return el;
  }
  function productsFor(t) {
    const items = itemProducts();
    const owned = (p) => p.grants.every((k) => wallet.owned.has(k));
    switch (t) {
      case 'featured': {
        const hl = [...items, ...BUNDLES].filter((p) => highlight.includes(p.id));
        const pick = ['hat:phrygian', 'face:goggles', 'back:cape', 'trail:confetti', 'hat:goldHelmet', 'placard:neon'];
        return [...hl, ...BUNDLES, ...items.filter((p) => pick.includes(p.id) && !highlight.includes(p.id))];
      }
      case 'g': return items.filter((p) => WEAR_SLOTS.has(p.slot) && p.faction !== 'c');
      case 'c': return items.filter((p) => WEAR_SLOTS.has(p.slot) && p.slot !== 'placard' && p.slot !== 'top' && p.faction !== 'g');
      case 'fx': return items.filter((p) => p.slot === 'trail' || p.slot === 'flair');
      case 'bundles': return BUNDLES;
      case 'owned': return [...BUNDLES, ...items].filter(owned);
      default: return [];
    }
  }

  // ---------------------------------------------------------------- render (cards, status, wallet)
  function render() {
    card.querySelectorAll('.shop-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const st = $('.shop-status');
    st.hidden = !status;
    st.textContent = status;

    // What you are trying on, with buy / back buttons.
    const tr = $('.shop-trying');
    tr.innerHTML = '';
    if (trying) {
      const t = document.createElement('div');
      t.className = 'shop-trying-name';
      const fxOnly = trying.grants.every((k) => !WEAR_SLOTS.has(k.split(':')[0]));
      t.textContent = `Trying on: ${trying.label}${fxOnly ? ' (see the picture: trails and names show in the game)' : ''}`;
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'shop-reset';
      back.textContent = 'Take it off';
      back.addEventListener('click', resetTry);
      tr.append(t, priceButton(trying), back);
    } else {
      tr.innerHTML = `<div class="shop-trying-name">Your ${side === 'c' ? 'police officer' : 'protester'}. Click any item to try it on.</div>`;
    }

    const scroll = $('.shop-scroll');
    const keep = scroll.scrollTop;
    scroll.innerHTML = '';
    const list = productsFor(tab);
    if (!list.length) {
      scroll.innerHTML = `<p class="shop-empty">${tab === 'owned' ? 'Nothing yet. Items you buy show up here.' : 'Nothing here yet.'}</p>`;
    } else {
      const grid = document.createElement('div');
      grid.className = 'shop-grid';
      grid.append(...list.map(cardFor));
      scroll.appendChild(grid);
    }
    scroll.scrollTop = keep;

    // Wallet: the recovery code and a way to restore items on another device.
    const w = $('.shop-wallet-in');
    w.innerHTML = '';
    if (wallet.code) {
      const line = document.createElement('div');
      line.innerHTML = '<b>Wallet code</b> (your only key to your items): ';
      const c = document.createElement('code');
      c.textContent = wallet.code;
      const copy = document.createElement('button');
      copy.type = 'button'; copy.textContent = 'Copy';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(wallet.code); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy it'; } });
      line.append(c, copy);
      w.appendChild(line);
    } else {
      const p = document.createElement('div');
      p.textContent = 'No purchases yet. After your first one you get a wallet code to use your items on other devices.';
      w.appendChild(p);
    }
    const restore = document.createElement('form');
    restore.className = 'shop-restore';
    restore.innerHTML = '<input placeholder="RPR-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" /><button type="submit">Restore</button>';
    restore.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await wallet.restore(restore.querySelector('input').value); status = 'Items restored.'; } catch (err) { status = err.message; }
      render();
    });
    w.appendChild(restore);
  }

  render();
  wallet.refresh();
  if (highlight.length) { const p = [...itemProducts(), ...BUNDLES].find((x) => x.id === highlight[0]); if (p) tryOn(p); }
  return { close };
}
