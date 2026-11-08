// client/ui/outfitEditor.js
// The outfit editor: a live 3D preview of your character + rows of options.
// Used in the start menu and in game (bottom bar → "Outfit").
// Premium items show a "€" badge. While PREMIUM_ENFORCED is false (shared/looks.js)
// they are free for everyone — that's how we learn what people like before selling.

import { DEFAULT_WEAPON } from '../../shared/constants.js';
import * as THREE from 'three';
import { createPlayerMesh } from '../player/playerMesh.js';
import { CharacterFx } from '../combat/effects.js';
import {
  BODIES, SKINS, HAIRS, HAIR_COLORS, TOPS, PANTS, HATS, FACES, BACKS, PLACARDS,
  PREMIUM_ENFORCED, defaultLook, itemAllowed,
} from '../../shared/looks.js';

// Remember the last outfit per faction in this browser (nice to have; works without).
export function loadSavedLook(faction) {
  try {
    const saved = JSON.parse(localStorage.getItem('look_' + faction));
    if (saved) return { ...defaultLook(faction), ...saved };
  } catch { /* ignore */ }
  return defaultLook(faction);
}
export function saveLook(faction, look) {
  try { localStorage.setItem('look_' + faction, JSON.stringify(look)); } catch { /* ignore */ }
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
  root.append(previewBox, options);

  // ---------------------------------------------------------------- 3D preview
  const W = 220, H = 260;
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
    if (nextEmote <= 0) { fx.playEmote([0, 4, 1][Math.floor(Math.random() * 3)]); nextEmote = 5; }
    fx.update(dt, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // ---------------------------------------------------------------- options
  const changed = () => { rebuild(); onChange?.({ ...look }); };

  function row(title, slot, list, render) {
    const r = document.createElement('div');
    r.className = 'outfit-row';
    const h = document.createElement('div');
    h.className = 'outfit-title';
    h.textContent = title;
    const items = document.createElement('div');
    items.className = 'outfit-items';
    list.forEach((item, i) => {
      if (!itemAllowed(slot, i, faction)) return; // other faction's items
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'outfit-item' + (look[slot] === i ? ' selected' : '');
      render(b, item, i);
      if (typeof item === 'object' && item.premium) {
        const badge = document.createElement('span');
        badge.className = 'premium';
        badge.textContent = '€';
        badge.title = PREMIUM_ENFORCED ? 'Premium' : 'Premium — free for now';
        b.appendChild(badge);
      }
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
    dot.style.background = item.stripes ? `repeating-linear-gradient(0deg, ${item.color} 0 3px, ${item.stripes} 3px 6px)` : item.color;
    b.append(dot, document.createTextNode(item.label));
  };

  row('Character', 'body', BODIES, text);
  row('Skin', 'skin', SKINS, swatch);
  row('Hairstyle', 'hair', HAIRS, text);
  row('Hair colour', 'hairColor', HAIR_COLORS, swatch);
  if (faction === 'g') row('Top', 'top', TOPS, colorLabel);
  row('Trousers', 'pants', PANTS, colorLabel);
  row(faction === 'c' ? 'Helmet' : 'Hat', 'hat', HATS, text);
  row('Face', 'face', FACES, text);
  row('Back', 'back', BACKS, text);
  if (faction === 'g') row('Placard', 'placard', PLACARDS, text);
  if (faction === 'c') {
    const r = document.createElement('div');
    r.className = 'outfit-row';
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

  return {
    element: root,
    getLook: () => ({ ...look }),
    destroy() {
      alive = false;
      if (mesh) mesh.userData.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
    },
  };
}
