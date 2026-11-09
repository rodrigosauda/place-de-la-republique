// client/shop/thumbs.js
// Pictures for the shop: every product is drawn on the game's own 3D character
// (one small offscreen renderer, one picture per frame so the window never freezes).
// Pictures are cached for the whole session.

import * as THREE from 'three';
import { createPlayerMesh } from '../player/playerMesh.js';
import { CATALOG_FOR_EDITOR, defaultLook } from '../../shared/looks.js';

const SIZE = 220;
const cache = new Map();   // product id -> data URL
const queue = [];          // [product, img] waiting to be drawn
let renderer = null, scene = null, camera = null, running = false;

const TRAIL_COLORS = {
  confetti: [0xff4d6d, 0xffd23f, 0x3bceac, 0x4d9de0, 0xe15554],
  feathers: [0xffffff, 0xfff2a8, 0xfffbe0],
  tricolor: [0x1f5fd1, 0xffffff, 0xef4135],
  gold: [0xffd700, 0xffec8b, 0xffc300],
};

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(-3, 3, -4);
  scene.add(rim);
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
}

// slot:id -> index in that slot's list
function indexOf(key) {
  const [slot, id] = key.split(':');
  const i = (CATALOG_FOR_EDITOR[slot] || []).findIndex((it) => typeof it === 'object' && it.id === id);
  return [slot, i];
}

// The name label above the head, drawn flat (flair is HTML in the game).
function flairPicture(id) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  const styles = {
    star: { bg: 'rgba(20,24,32,0.85)', fg: '#fff', border: '#f7d417', text: '★ You' },
    tricolor: { bg: ['#1f3f9a', '#f4f4f4', '#c8202f'], fg: '#101828', text: 'You' },
    founder: { bg: ['#4a3a10', '#251c05'], fg: '#ffd84a', border: '#ffd84a', text: '★ You', glow: true },
  };
  const st = styles[id] || styles.star;
  g.font = '800 30px system-ui, sans-serif';
  const w = g.measureText(st.text).width + 44, x = SIZE / 2 - w / 2, y = SIZE / 2 - 26;
  if (Array.isArray(st.bg)) {
    const grad = st.bg.length === 3 ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y, 0, y + 52);
    st.bg.forEach((col, i) => grad.addColorStop(i / (st.bg.length - 1), col));
    g.fillStyle = grad;
  } else g.fillStyle = st.bg;
  g.beginPath(); g.roundRect(x, y, w, 52, 12); g.fill();
  if (st.border) { g.strokeStyle = st.border; g.lineWidth = 3; g.stroke(); }
  if (st.glow) { g.shadowColor = 'rgba(255,216,74,0.8)'; g.shadowBlur = 12; }
  g.fillStyle = st.fg; g.textAlign = 'center'; g.fillText(st.text, SIZE / 2, y + 37);
  return c.toDataURL('image/png');
}

function draw(p) {
  const keys = p.grants;
  // A bundle with a name flair but a body too: draw the body; flair alone: draw the label.
  if (keys.length === 1 && keys[0].startsWith('flair:')) return flairPicture(keys[0].split(':')[1]);
  if (!renderer) setup();
  const faction = p.faction === 'c' ? 'c' : 'g';
  const look = { ...defaultLook(faction) };
  let slogan = '', close = false, back = false, trail = null;
  for (const k of keys) {
    const [slot, i] = indexOf(k);
    if (i < 0) continue;
    if (slot === 'trail') { trail = TRAIL_COLORS[k.split(':')[1]]; continue; }
    if (slot === 'flair') continue;
    look[slot] = i;
    if (slot === 'placard') slogan = 'LOWER PRICES!';
    if (keys.length === 1 && (slot === 'hat' || slot === 'face')) close = true;
    if (keys.length === 1 && slot === 'back') back = true;
  }
  const mesh = createPlayerMesh('', faction, false, slogan, true, look);
  for (const o of [mesh.userData.parts.label, mesh.userData.parts.bubble]) { if (o) { mesh.remove(o); o.element?.remove(); } }
  mesh.position.y = 0.9;
  if (slogan && mesh.userData.parts.arms) mesh.userData.parts.arms[1].rotation.x = -2.9;
  scene.add(mesh);
  const bits = [];
  if (trail) {
    for (let i = 0; i < 36; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.014), new THREE.MeshBasicMaterial({ color: trail[i % trail.length], side: THREE.DoubleSide }));
      b.position.set((Math.random() - 0.5) * 0.9, 0.05 + Math.random() * 0.7, -0.15 - Math.random() * 0.9);
      b.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      scene.add(b);
      bits.push(b);
    }
  }
  const a = back ? Math.PI + 0.6 : 0.5;
  const d = close ? 1.7 : slogan ? 6.4 : 4.4;
  camera.position.set(Math.sin(a) * d, close ? 1.85 : 1.6, Math.cos(a) * d);
  camera.lookAt(0, close ? 1.7 : slogan ? 1.7 : 1.0, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(mesh, ...bits);
  mesh.userData.dispose?.();
  for (const b of bits) { b.geometry.dispose(); b.material.dispose(); }
  return url;
}

function pump() {
  const job = queue.shift();
  if (!job) { running = false; return; }
  const [p, img] = job;
  try {
    if (!cache.has(p.id)) cache.set(p.id, draw(p));
    img.src = cache.get(p.id);
    img.classList.add('ready');
  } catch (e) {
    console.warn('shop picture failed', p.id, e);
  }
  requestAnimationFrame(pump);
}

// An <img> for the product; the picture fills in a moment later (instantly when cached).
export function productPicture(p) {
  const img = document.createElement('img');
  img.className = 'shop-pic';
  img.alt = p.label;
  img.width = img.height = SIZE;
  if (cache.has(p.id)) { img.src = cache.get(p.id); img.classList.add('ready'); return img; }
  queue.push([p, img]);
  if (!running) { running = true; requestAnimationFrame(pump); }
  return img;
}

