// client/ui/shop.js
// The shop window: premium outfit items, trails, name flair and bundles.
// In test mode (see worker/shop.js) a purchase is fake: nothing is charged, the items are granted at once.
// Opens from the start menu, the in-game bottom bar and the outfit editor ("Buy" on a locked item).

import { BUNDLES, SLOT_TITLES, itemProducts, formatPrice, totalPrice } from '../../shared/shop.js';
import { wallet } from '../shop/wallet.js';

const FACTION_TAG = { g: 'Protesters only', c: 'Police only' };

export function openShop({ highlight = [], onOpen, onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'shop-overlay';
  const card = document.createElement('div');
  card.className = 'shop-card';
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  onOpen?.();

  let status = '';
  let confirming = null; // product id waiting for a second click
  let confirmTimer = 0;

  const close = () => {
    clearTimeout(confirmTimer);
    off();
    window.removeEventListener('keydown', onKey, true);
    overlay.remove();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  const off = wallet.onChange(() => render());

  async function buy(id) {
    status = 'Processing…';
    render();
    try {
      const res = await wallet.buy([id]);
      status = res.test ? `Added to your wallet. (Test mode: nothing was charged.)` : 'Thank you!';
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
    if (own) { b.className = 'owned'; b.textContent = 'Owned ✓'; b.disabled = true; return b; }
    const price = totalPrice([p.id], wallet.owned);
    const partial = p.grants.some((k) => wallet.owned.has(k));
    b.textContent = confirming === p.id ? `Confirm ${formatPrice(price)}` : `${partial ? 'Complete for ' : ''}${formatPrice(price)}`;
    if (confirming === p.id) b.classList.add('confirm');
    b.addEventListener('click', () => {
      if (confirming === p.id) { clearTimeout(confirmTimer); buy(p.id); return; }
      confirming = p.id;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { confirming = null; render(); }, 3500);
      render();
    });
    return b;
  }

  function cardFor(p, sub) {
    const el = document.createElement('div');
    el.className = 'shop-item' + (highlight.includes(p.id) ? ' hl' : '');
    el.dataset.id = p.id;
    const name = document.createElement('div');
    name.className = 'shop-name';
    name.textContent = p.label;
    const note = document.createElement('div');
    note.className = 'shop-sub';
    note.textContent = sub || FACTION_TAG[p.faction] || '';
    el.append(name, note, priceButton(p));
    return el;
  }

  function render() {
    const scroll = card.querySelector('.shop-scroll')?.scrollTop ?? 0;
    card.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'shop-head';
    head.innerHTML = '<h2>Shop</h2>';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'shop-close'; x.textContent = '✕'; x.title = 'Close (Esc)';
    x.addEventListener('click', close);
    head.appendChild(x);
    card.appendChild(head);

    const test = document.createElement('p');
    test.className = 'shop-test';
    test.textContent = 'Test mode: checkout is a rehearsal. Nothing is charged and everything is granted for free.';
    const fair = document.createElement('p');
    fair.className = 'shop-fair';
    fair.textContent = 'Everything here is cosmetic. It never makes you stronger or changes how a fight goes.';
    card.append(test, fair);
    if (status) { const s = document.createElement('p'); s.className = 'shop-status'; s.textContent = status; card.appendChild(s); }

    const scrollBox = document.createElement('div');
    scrollBox.className = 'shop-scroll';

    // Bundles say what the parts would cost on their own.
    const worth = (b) => b.grants.reduce((sum, k) => sum + (itemProducts().find((p) => p.id === k)?.price ?? 0), 0);
    const sections = [['Bundles', BUNDLES.map((b) => cardFor(b, `${b.desc} · worth ${formatPrice(worth(b))}`))]];
    const bySlot = {};
    for (const p of itemProducts()) (bySlot[p.slot] ??= []).push(p);
    for (const slot of Object.keys(SLOT_TITLES)) if (bySlot[slot]) sections.push([SLOT_TITLES[slot], bySlot[slot].map((p) => cardFor(p))]);
    for (const [title, cards] of sections) {
      const h = document.createElement('h3');
      h.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'shop-grid';
      grid.append(...cards);
      scrollBox.append(h, grid);
    }
    card.appendChild(scrollBox);
    scrollBox.scrollTop = scroll;

    // Wallet: the recovery code and a way to restore items on another device.
    const w = document.createElement('div');
    w.className = 'shop-wallet';
    if (wallet.code) {
      const line = document.createElement('div');
      line.innerHTML = '<b>Your wallet code</b> (keep it safe: it is the only key to your items): ';
      const c = document.createElement('code');
      c.textContent = wallet.code;
      const copy = document.createElement('button');
      copy.type = 'button'; copy.textContent = 'Copy';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(wallet.code); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy it'; } });
      line.append(c, copy);
      w.appendChild(line);
    }
    const restore = document.createElement('form');
    restore.className = 'shop-restore';
    restore.innerHTML = '<input placeholder="Restore items: RPR-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" /><button type="submit">Restore</button>';
    restore.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await wallet.restore(restore.querySelector('input').value); status = 'Items restored.'; } catch (err) { status = err.message; }
      render();
    });
    w.appendChild(restore);
    card.appendChild(w);

    if (highlight.length && !card.dataset.scrolled) {
      card.dataset.scrolled = '1';
      requestAnimationFrame(() => card.querySelector('.shop-item.hl')?.scrollIntoView({ block: 'center' }));
    }
  }
  render();
  wallet.refresh();
  return { close };
}

