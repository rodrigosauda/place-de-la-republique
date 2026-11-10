// client/ui/outfitEditor.js
// The outfit editor: a live 3D preview of your character + rows of options.
// Used in the start menu and in game (bottom bar → "Outfit").
// Premium items show their price (or a tick once owned). You can try a locked item on in the preview;
// a strip under the preview then offers to buy it. Locked items are dropped when you save or play
// (and the server checks again), see wallet.cleanLook.

import { DEFAULT_WEAPON } from '../../shared/constants.js';
import * as THREE from 'three';
import { createPlayerMesh } from '../player/playerMesh.js';
import { CharacterFx } from '../combat/effects.js';
import {
  BODIES, SKINS, HAIRS, HAIR_COLORS, TOPS, PANTS, HATS, FACES, BACKS, PLACARDS, TRAILS, FLAIRS,
  SHOP_SLOTS, CATALOG_FOR_EDITOR, defaultLook, itemAllowed, itemKey, priceOfItem,
} from '../../shared/looks.js';
import { formatPrice, totalPrice } from '../../shared/shop.js';
import { wallet } from '../shop/wallet.js';
import { openShop } from './shop.js';

const EVERYTHING = { has: () => true }; // "owned" set used only to decide which items this side may SEE

// Remember the last outfit per faction in this browser (nice to have; works without).
// LOOK_VERSION 2 = the black bloc look (Nov 2026): outfits saved before that start again from the new default,
// so nobody is still walking around in the old colours by accident (shop items stay owned).
const LOOK_VERSION = 2;
export function loadSavedLook(faction) {
  try {
    const saved = JSON.parse(localStorage.getItem('look_' + faction));
    if (saved && saved.v === LOOK_VERSION) return { ...defaultLook(faction), ...saved };
  } catch { /* ignore */ }
  return defaultLook(faction);
}
export function saveLook(faction, look) {
  try { localStorage.setItem('look_' + faction, JSON.stringify({ ...look, v: LOOK_VERSION })); } catch { /* ignore */ }
}

// Returns { element, getLook(), destroy() }. `onChange(look)` fires on every change.
export function createOutfitEditor({ faction, look: initial, slogan = '', onChange }) {
  const look = { ...initial };
  const root = document.createElement('div');
  root.className = 'outfit-editor';
  const previewBox = document.createElement('div');
  previewBox.className = 'outfit-preview';
  const options = document.createElement('div');
  options.className = 'outfit-options';
  const strip = document.createElement('div');
  strip.className = 'outfit-locked';
  strip.style.display = 'none';
  // Left: the character + quick looks. Right: tabs with the options of one group at a time.
  const side = document.createElement('div');
  side.className = 'outfit-side';
  const presetsBox = document.createElement('div');
  presetsBox.className = 'outfit-presets';
  side.append(previewBox, presetsBox);
  const panel = document.createElement('div');
  panel.className = 'outfit-panel';
  const tabsBar = document.createElement('div');
  tabsBar.className = 'outfit-tabs';
  panel.append(tabsBar, options);
  root.append(side, panel, strip);
  const badges = [];

  // ---------------------------------------------------------------- 3D preview
  const W = 240, H = 300;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  previewBox.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7d6a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
  camera.position.set(0, 0.9, 7.2);
  camera.lookAt(0, 0.55, 0);
  let mesh = null, fx = null, spin = -0.35, dragging = false, lastX = 0;
  const rebuild = () => {
    if (mesh) { scene.remove(mesh); mesh.userData.dispose(); }
    mesh = createPlayerMesh('', faction, false, faction === 'g' ? slogan || 'Lower prices!' : '', false, look);
    mesh.remove(mesh.userData.parts.label);
    fx = new CharacterFx(mesh);
    fx.setWeapon(DEFAULT_WEAPON[faction] ?? 1);
    scene.add(mesh);
  };
  rebuild();
  // Drag to rotate the preview.
  renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; });
  window.addEventListener('pointerup', () => { dragging = false; });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    spin += (e.clientX - lastX) * 0.01;
    lastX = e.clientX;
  });
  // Every few seconds the preview waves or dances.
  let alive = true, last = performance.now(), nextEmote = 2;
  const loop = (now) => {
    if (!alive) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!dragging) spin = Math.sin(now / 2500) * 0.9; // gently turns left and right
    mesh.rotation.y = spin;
    nextEmote -= dt;
    if (nextEmote <= 0) { fx.playEmote([0, 3, 1][Math.floor(Math.random() * 3)]); nextEmote = 5; }
    fx.update(dt, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // ---------------------------------------------------------------- options
  // Price tags on premium items, and the "try-on only" strip under the preview.
  function refreshLocks() {
    for (const badge of badges) {
      const own = wallet.owned.has(badge.dataset.key);
      badge.textContent = own ? '✓' : formatPrice(Number(badge.dataset.price));
      badge.classList.toggle('own', own);
      badge.title = own ? 'You own this' : 'Premium: try it on, buy it to wear it in the game';
    }
    const locked = [];
    for (const slot of SHOP_SLOTS) {
      const key = itemKey(slot, look[slot]);
      if (key && !wallet.owned.has(key) && itemAllowed(slot, look[slot], faction, EVERYTHING)) locked.push([key, CATALOG_FOR_EDITOR[slot][look[slot]].label]);
    }
    strip.style.display = locked.length ? '' : 'none';
    if (!locked.length) return;
    strip.innerHTML = '';
    const msg = document.createElement('span');
    msg.textContent = `Try-on only: ${locked.map((l) => l[1]).join(', ')}. You will not wear ${locked.length > 1 ? 'them' : 'it'} in the game until you buy ${locked.length > 1 ? 'them' : 'it'}.`;
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.textContent = `Shop · ${formatPrice(totalPrice(locked.map((l) => l[0]), wallet.owned))}`;
    buy.addEventListener('click', () => openShop({ highlight: locked.map((l) => l[0]), faction, look: { ...look } }));
    strip.append(msg, buy);
  }
  const offWallet = wallet.onChange(refreshLocks);
  const changed = () => { rebuild(); refreshLocks(); onChange?.({ ...look }); };

  // Tabs: each row belongs to one group; only the open group is shown (no long scrolling list).
  const GROUPS = [['clothes', 'Clothes'], ['head', 'Head'], ['body', 'Body'], ['extras', 'Extras']];
  let group = 'clothes';
  const tabButtons = GROUPS.map(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'outfit-tab' + (id === group ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => { group = id; showGroup(); });
    tabsBar.appendChild(b);
    return [id, b];
  });
  function showGroup() {
    for (const [id, b] of tabButtons) b.classList.toggle('on', id === group);
    options.querySelectorAll('.outfit-row').forEach((r) => { r.style.display = r.dataset.group === group ? '' : 'none'; });
  }
  let rowGroup = 'clothes';
  const rowButtons = {}; // slot -> (index -> button), to update the selection when a quick look is picked

  function row(title, slot, list, render) {
    const r = document.createElement('div');
    r.className = 'outfit-row';
    r.dataset.group = rowGroup;
    rowButtons[slot] = {};
    const h = document.createElement('div');
    h.className = 'outfit-title';
    h.textContent = title;
    const items = document.createElement('div');
    items.className = 'outfit-items';
    list.forEach((item, i) => {
      if (!itemAllowed(slot, i, faction, EVERYTHING)) return; // other faction's items
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'outfit-item' + (look[slot] === i ? ' selected' : '');
      render(b, item, i);
      if (typeof item === 'object' && item.premium) {
        const badge = document.createElement('span');
        badge.className = 'premium';
        badge.dataset.key = `${slot}:${item.id}`;
        badge.dataset.price = priceOfItem(item);
        b.appendChild(badge);
        badges.push(badge);
      }
      rowButtons[slot][i] = b;
      b.addEventListener('click', () => {
        look[slot] = i;
        items.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
        b.classList.add('selected');
        changed();
      });
      items.appendChild(b);
    });
    r.append(h, items);
    options.appendChild(r);
  }
  const text = (b, item) => { b.textContent = item.label; };
  const swatch = (b, color) => { b.classList.add('swatch-btn'); b.style.background = color; };
  const colorLabel = (b, item) => {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = item.vest ? '#f7d417' : item.stripes ? `repeating-linear-gradient(0deg, ${item.color} 0 3px, ${item.stripes} 3px 6px)` : item.color;
    b.append(dot, document.createTextNode(item.label));
  };

  rowGroup = 'clothes';
  if (faction === 'g') row('Top', 'top', TOPS, colorLabel);
  row('Trousers', 'pants', PANTS, colorLabel);
  row('Back', 'back', BACKS, text);
  rowGroup = 'head';
  row(faction === 'c' ? 'Helmet' : 'Hat', 'hat', HATS, text);
  row('Face', 'face', FACES, text);
  row('Hairstyle', 'hair', HAIRS, text);
  row('Hair colour', 'hairColor', HAIR_COLORS, swatch);
  rowGroup = 'body';
  row('Character', 'body', BODIES, text);
  row('Skin', 'skin', SKINS, swatch);
  rowGroup = 'extras';
  if (faction === 'g') row('Placard', 'placard', PLACARDS, text);
  row('Footstep trail', 'trail', TRAILS, text);
  row('Name flair', 'flair', FLAIRS, text);
  if (faction === 'c') {
    const r = document.createElement('div');
    r.className = 'outfit-row';
    r.dataset.group = 'extras';
    r.innerHTML = '<div class="outfit-title">Unit number</div>';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.max = 999;
    input.value = look.number;
    input.className = 'outfit-number';
    input.addEventListener('change', () => {
      look.number = Math.max(0, Math.min(999, Math.floor(Number(input.value) || 0)));
      input.value = look.number;
      changed();
    });
    r.appendChild(input);
    options.appendChild(r);
  }

  // Quick looks: one click for a complete outfit in the agreed style (you can still change every part).
  const PRESETS = faction === 'g'
    ? [['Black bloc', { top: 1, pants: 1, hat: 4, face: 7 }], ['Grey hoodie', { top: 3, pants: 3, hat: 4, face: 2 }],
      ['Marcher', { top: 0, pants: 0, hat: 0, face: 0 }], ['Yellow vest', { top: 8, pants: 0, hat: 1, face: 0 }]]
    : [['Riot gear', { hat: 7, face: 0 }], ['Gas mask', { hat: 7, face: 4 }], ['Visor up', { hat: 8, face: 0 }], ['Sunglasses', { hat: 8, face: 1 }]];
  const presetTitle = document.createElement('div');
  presetTitle.className = 'outfit-title';
  presetTitle.textContent = 'Quick looks';
  presetsBox.appendChild(presetTitle);
  for (const [label, parts] of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'outfit-item preset';
    b.textContent = label;
    b.addEventListener('click', () => {
      for (const [slot, i] of Object.entries(parts)) {
        if (!itemAllowed(slot, i, faction, EVERYTHING)) continue;
        look[slot] = i;
        const btns = rowButtons[slot] || {};
        for (const [k, btn] of Object.entries(btns)) btn.classList.toggle('selected', Number(k) === i);
      }
      changed();
    });
    presetsBox.appendChild(b);
  }

  showGroup();
  refreshLocks();

  return {
    element: root,
    getLook: () => ({ ...look }),
    destroy() {
      alive = false;
      offWallet();
      if (mesh) mesh.userData.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
    },
  };
}
