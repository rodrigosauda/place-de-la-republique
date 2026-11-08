// client/scene/textures.js
// Realistic-looking surface textures, PAINTED IN CODE (no image files needed,
// no licence issues): cut limestone, zinc roofs, paving slabs, asphalt,
// French windows and shop fronts.
// Each texture also gets a "normal map" made from its height, so light
// catches the joints between stones and the seams of the roof.

import * as THREE from 'three';

// Repeatable pseudo-random numbers (same textures for everybody).
function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Sprinkle fine grain over a canvas (stone/asphalt texture).
function grain(g, w, h, amount, rand, dark = true) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * (dark ? 1 : 0.8);
  }
  g.putImageData(img, 0, 0);
}

// Turn a grey height canvas (white = high) into a normal map texture.
function normalFromHeight(heightCanvas, strength = 2) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return tex(c, false);
}

function tex(c, color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Cut limestone ("pierre de taille"): courses of blocks with thin joints.
// One texture tile = 4 m wide x 4 m high (see uvScaleBox).
// ---------------------------------------------------------------------------
export function stoneFacade(baseColor = '#e6d9bc', seed = 1) {
  const rand = rng(seed);
  const S = 256;
  const [c, g] = canvas(S, S);
  const [hc, hg] = canvas(S, S);
  g.fillStyle = baseColor;
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#fff';
  hg.fillRect(0, 0, S, S);
  const rowH = 32; // 0.5 m courses
  for (let row = 0; row < S / rowH; row++) {
    const y = row * rowH;
    let x = row % 2 ? -40 : 0;
    while (x < S) {
      const bw = 70 + rand() * 40;
      const tint = (rand() - 0.5) * 18;
      g.fillStyle = `rgba(${128 + tint},${118 + tint},${100 + tint},0.10)`;
      g.fillRect(x + 1, y + 1, bw - 2, rowH - 2);
      // joints (darker, recessed)
      g.fillStyle = 'rgba(120,105,85,0.55)';
      g.fillRect(x, y, 1.5, rowH);
      hg.fillStyle = '#444';
      hg.fillRect(x, y, 2, rowH);
      x += bw;
    }
    g.fillStyle = 'rgba(120,105,85,0.6)';
    g.fillRect(0, y, S, 1.5);
    hg.fillStyle = '#444';
    hg.fillRect(0, y, S, 2);
  }
  grain(g, S, S, 16, rand);
  // light weathering streaks
  for (let i = 0; i < 25; i++) {
    g.fillStyle = `rgba(90,80,70,${0.03 + rand() * 0.04})`;
    g.fillRect(rand() * S, rand() * S, 2 + rand() * 4, 20 + rand() * 60);
  }
  return { map: tex(c), normalMap: normalFromHeight(hc, 2.5) };
}

// Grey-blue zinc roof with vertical standing seams. Tile = 4 m.
export function zincRoof() {
  const rand = rng(7);
  const S = 128;
  const [c, g] = canvas(S, S);
  const [hc, hg] = canvas(S, S);
  g.fillStyle = '#6f7d8b';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 16) {
    g.fillStyle = 'rgba(220,230,240,0.25)';
    g.fillRect(x, 0, 2, S);
    g.fillStyle = 'rgba(30,35,45,0.25)';
    g.fillRect(x + 2, 0, 1, S);
    hg.fillStyle = '#fff';
    hg.fillRect(x, 0, 2, S);
  }
  grain(g, S, S, 10, rand);
  return { map: tex(c), normalMap: normalFromHeight(hc, 3) };
}

// Light stone paving slabs of the plaza. Tile = 4 m.
export function paving() {
  const rand = rng(3);
  const S = 256;
  const [c, g] = canvas(S, S);
  const [hc, hg] = canvas(S, S);
  g.fillStyle = '#cfc8b8';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#fff';
  hg.fillRect(0, 0, S, S);
  const rowH = 32;
  for (let row = 0; row < S / rowH; row++) {
    let x = row % 2 ? -32 : 0;
    while (x < S) {
      const w = 64;
      const t = (rand() - 0.5) * 22;
      g.fillStyle = `rgb(${205 + t},${198 + t},${184 + t})`;
      g.fillRect(x + 1, row * rowH + 1, w - 2, rowH - 2);
      hg.fillStyle = '#555';
      hg.fillRect(x, row * rowH, 2, rowH);
      x += w;
    }
    hg.fillStyle = '#555';
    hg.fillRect(0, row * rowH, S, 2);
    g.fillStyle = 'rgba(80,75,65,0.45)';
    g.fillRect(0, row * rowH, S, 1);
  }
  grain(g, S, S, 14, rand);
  for (let i = 0; i < 40; i++) { // stains
    g.fillStyle = `rgba(70,65,60,${rand() * 0.06})`;
    g.beginPath();
    g.arc(rand() * S, rand() * S, 4 + rand() * 14, 0, Math.PI * 2);
    g.fill();
  }
  return { map: tex(c), normalMap: normalFromHeight(hc, 2) };
}

// Asphalt: dark, fine grain, a few patches. Tile = 8 m.
export function asphalt() {
  const rand = rng(11);
  const S = 256;
  const [c, g] = canvas(S, S);
  const [hc, hg] = canvas(S, S);
  g.fillStyle = '#4a4d52';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, S, S);
  grain(g, S, S, 30, rand);
  grain(hg, S, S, 90, rand);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(30,32,36,${0.15 + rand() * 0.15})`;
    g.fillRect(rand() * S, rand() * S, 30 + rand() * 60, 20 + rand() * 40);
  }
  return { map: tex(c), normalMap: normalFromHeight(hc, 1) };
}

// A tall French window: cream frame, glass panes, light curtains.
export function frenchWindow() {
  const [c, g] = canvas(64, 128);
  g.fillStyle = '#efe8d8'; // frame
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#2d3a48'; // glass
  for (const [x, y, w, h] of [[6, 6, 24, 36], [34, 6, 24, 36], [6, 46, 24, 36], [34, 46, 24, 36], [6, 86, 24, 36], [34, 86, 24, 36]]) {
    const grad = g.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#5a6e82');
    grad.addColorStop(0.5, '#2b3846');
    grad.addColorStop(1, '#1d2731');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
  }
  g.fillStyle = 'rgba(240,235,220,0.35)'; // curtains
  g.fillRect(6, 6, 8, 116);
  g.fillRect(50, 6, 8, 116);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Shop fronts with English signs (one texture per sign, a few variants).
export const SHOP_SIGNS = ['BAKERY', 'PHARMACY', 'CAFÉ', 'BOOKS', 'FLOWERS', 'BISTRO', 'WINE BAR', 'FASHION'];
export function shopFront(sign, i) {
  const [c, g] = canvas(256, 160);
  const colors = ['#1f3a2a', '#7a1f2b', '#1c2f5a', '#2a2a2a', '#5a3d1e', '#3d2a52'];
  g.fillStyle = colors[i % colors.length];
  g.fillRect(0, 0, 256, 160);
  // sign band
  g.fillStyle = '#f2e6c9';
  g.font = '700 26px Georgia, serif';
  g.textAlign = 'center';
  g.fillText(sign, 128, 30);
  // window with warm interior
  const grad = g.createLinearGradient(0, 44, 0, 160);
  grad.addColorStop(0, '#3b4a57');
  grad.addColorStop(1, '#141a20');
  g.fillStyle = grad;
  g.fillRect(14, 44, 228, 112);
  g.fillStyle = 'rgba(255,214,150,0.18)';
  g.fillRect(14, 110, 228, 46);
  g.fillStyle = colors[i % colors.length];
  g.fillRect(124, 44, 8, 112); // mullion
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Give a BoxGeometry real-world UVs, so a texture tile covers `tile` metres
// instead of being stretched over the whole face.
export function uvScaleBox(geo, w, h, d, tile = 4) {
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * (dims[f][0] / tile), uv.getY(i) * (dims[f][1] / tile));
    }
  }
  uv.needsUpdate = true;
  return geo;
}
