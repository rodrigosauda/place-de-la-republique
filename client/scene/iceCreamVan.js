// client/scene/iceCreamVan.js
// The ice-cream van on the north side of the square (shared/constants.js -> ICE_CREAM).
// Pastel van with a serving hatch, a striped awning, a giant cone on the roof and a menu board.
// The ring around it is a safe zone: no fighting (the server checks it too).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ICE_CREAM } from '../../shared/constants.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildIceCreamVan(scene, physics) {
  const g = new THREE.Group();
  const box = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const pink = std(0xf39bb6), mint = std(0x9fe3c9), cream = std(0xfff6e4), dark = std(0x23262b),
    chrome = std(0xd9dde3, { metalness: 0.8, roughness: 0.25 }), glass = std(0x30475e, { roughness: 0.15, metalness: 0.3 });
  const round = (w, h, d, r, m, x, y, z) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  // The van: long side faces the square (+z), cab at the front (+x). Rounded, retro, pastel.
  round(5.0, 2.3, 2.3, 0.35, cream, -0.3, 1.75, 0);       // box body (cream)
  round(5.02, 0.9, 2.32, 0.3, mint, -0.3, 0.95, 0);       // mint lower half
  box(5.04, 0.08, 2.34, pink, -0.3, 1.42, 0);             // pink trim line
  round(1.7, 1.75, 2.25, 0.45, mint, 2.85, 1.2, 0);       // cab (rounded nose)
  round(1.1, 0.7, 2.27, 0.3, cream, 2.6, 2.0, 0);         // cab roof
  box(0.06, 0.6, 1.8, glass, 3.71, 1.6, 0);              // windscreen
  for (const zs of [-1, 1]) box(0.9, 0.55, 0.05, glass, 2.75, 1.7, zs * 1.14); // cab side windows
  box(0.2, 0.45, 2.1, chrome, 3.72, 0.55, 0);             // chrome bumper
  box(0.08, 0.35, 1.0, chrome, 3.7, 0.95, 0);             // grille
  for (const zs of [-0.8, 0.8]) {                          // round headlights
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 14), std(0xfffbe6, { emissive: 0x554f30 }));
    l.rotation.z = Math.PI / 2;
    l.position.set(3.7, 1.0, zs);
    g.add(l);
  }
  box(0.2, 0.3, 2.0, chrome, -2.85, 0.55, 0);             // rear bumper
  // Side panel on the square side: painted ice creams around the hatch + the name.
  const panel = canvasTexture(1024, 460, (c, w, h) => {
    c.fillStyle = '#fff6e4'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e0457b'; c.font = 'italic 900 64px Georgia, serif'; c.textAlign = 'center';
    c.fillText('Glaces Marianne', w / 2, 62);
    const cone = (x, y, s, cols) => {
      c.fillStyle = '#d9a45b'; c.beginPath(); c.moveTo(x - 26 * s, y); c.lineTo(x + 26 * s, y); c.lineTo(x, y + 90 * s); c.closePath(); c.fill();
      c.strokeStyle = '#b07f3a'; c.lineWidth = 3; for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(x + i * 14 * s, y); c.lineTo(x, y + 90 * s); c.stroke(); }
      cols.forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(x, y - 18 * s - i * 34 * s, 30 * s, 0, 7); c.fill(); });
    };
    cone(110, 300, 1.2, ['#f39bb6', '#9fe3c9']);
    cone(914, 300, 1.2, ['#fff1a8', '#f39bb6', '#c9a0ff']);
    c.fillStyle = '#9fe3c9'; for (let x = 0; x < w; x += 64) { c.beginPath(); c.arc(x + 32, h, 30, Math.PI, 0); c.fill(); } // scalloped bottom
  });
  const side = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 2.1), new THREE.MeshStandardMaterial({ map: panel }));
  side.position.set(-0.3, 1.86, 1.161);
  g.add(side);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 2.1), new THREE.MeshStandardMaterial({ map: panel }));
  back.position.set(-0.3, 1.86, -1.161);
  back.rotation.y = Math.PI;
  g.add(back);
  // The serving hatch: dark inside, chrome frame, a counter with cones on display.
  box(2.2, 0.95, 0.06, dark, -0.3, 1.75, 1.17);
  box(2.32, 0.07, 0.1, chrome, -0.3, 2.26, 1.2);
  box(2.32, 0.07, 0.1, chrome, -0.3, 1.25, 1.2);
  box(2.5, 0.1, 0.55, cream, -0.3, 1.25, 1.45);            // counter
  for (let i = 0; i < 4; i++) {
    const x = -1.1 + i * 0.5;
    const cn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 10), std(0xd9a45b));
    cn.rotation.x = Math.PI;
    cn.position.set(x, 1.42, 1.5);
    g.add(cn);
    const sc = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), std([0xf39bb6, 0x9fe3c9, 0xfff1a8, 0xc9a0ff][i]));
    sc.position.set(x, 1.55, 1.5);
    g.add(sc);
  }
  // Wheels with chrome hubcaps, under rounded arches.
  for (const [x, z] of [[-1.6, 1.08], [1.6, 1.08], [-1.6, -1.08], [1.6, -1.08], [2.9, 1.08], [2.9, -1.08]]) {
    if (x === 1.6) continue;
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.32, 16), dark);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.45, z);
    g.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 12), chrome);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, 0.45, z);
    g.add(hub);
  }
  // Striped awning over the hatch, with a scalloped edge.
  const stripes = canvasTexture(256, 96, (c) => {
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffffff' : '#f39bb6'; c.fillRect(i * 32, 0, 32, 70); }
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffffff' : '#f39bb6'; c.beginPath(); c.arc(i * 32 + 16, 70, 16, 0, Math.PI); c.fill(); }
  });
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.95), new THREE.MeshStandardMaterial({ map: stripes, side: THREE.DoubleSide, transparent: true }));
  awning.position.set(-0.3, 2.3, 1.5);
  awning.rotation.x = -Math.PI / 2 + 0.55;
  g.add(awning);
  // Bunting along the roof edge.
  const flagColors = [0xf39bb6, 0x9fe3c9, 0xfff1a8, 0xc9a0ff];
  for (let i = 0; i < 12; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 3), std(flagColors[i % 4]));
    f.rotation.x = Math.PI;
    f.position.set(-2.6 + i * 0.42, 2.82, 1.17);
    g.add(f);
  }
  // A giant cone on the roof (it slowly turns, see update).
  const big = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 16), std(0xd9a45b));
  cone.rotation.x = Math.PI;
  cone.position.y = 0;
  big.add(cone);
  for (const [c, y] of [[0xf39bb6, 0.75], [0x9fe3c9, 1.15], [0xfff1a8, 1.52]]) {
    const sc = new THREE.Mesh(new THREE.SphereGeometry(0.44, 16, 12), std(c));
    sc.position.y = y;
    big.add(sc);
  }
  const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), std(0xd6202d));
  cherry.position.y = 1.98;
  big.add(cherry);
  big.position.set(-0.6, 3.5, 0);
  g.add(big);
  // A striped parasol and a little table in front, and the menu board.
  const parasol = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8), chrome);
  pole.position.y = 1.15;
  parasol.add(pole);
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.5, 12, 1, true), new THREE.MeshStandardMaterial({ map: stripes, side: THREE.DoubleSide }));
  top.position.y = 2.35;
  parasol.add(top);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 16), cream);
  table.position.y = 0.75;
  parasol.add(table);
  parasol.position.set(-2.8, 0, 3.2);
  g.add(parasol);
  // Menu board on a stand in front.
  const menu = canvasTexture(256, 320, (c, w, h) => {
    c.fillStyle = '#2b2f36'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff'; c.font = '800 34px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('ICE CREAM', w / 2, 52);
    c.font = '600 26px system-ui, sans-serif';
    c.fillText('15 coins', w / 2, 100);
    c.fillStyle = '#ffb3c8'; c.fillText('+1 ♥', w / 2, 160);
    c.fillStyle = '#ddd'; c.font = '600 20px system-ui, sans-serif';
    c.fillText('No fighting', w / 2, 220);
    c.fillText('while you eat!', w / 2, 248);
    c.fillText('Press E', w / 2, 290);
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshStandardMaterial({ map: menu, side: THREE.DoubleSide }));
  board.position.set(2.0, 1.1, 2.4);
  board.rotation.y = -0.3;
  g.add(board);
  for (const x of [1.75, 2.25]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.04), dark);
    leg.position.set(x - 0.02, 0.6, 2.35 + (x - 2) * 0.3);
    g.add(leg);
  }

  g.position.set(ICE_CREAM.x, 0, ICE_CREAM.z);
  g.rotation.y = ICE_CREAM.rot;
  scene.add(g);
  physics.addBox(ICE_CREAM.x + 0.4, 1.3, ICE_CREAM.z, 3.3, 1.3, 1.2, ICE_CREAM.rot);

  // The no-fighting ring painted on the ground (mint).
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ICE_CREAM.r - 0.25, ICE_CREAM.r, 64),
    new THREE.MeshBasicMaterial({ color: 0x6fd8b0, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(ICE_CREAM.x, 0.045, ICE_CREAM.z);
  ring.userData.noMerge = true;
  scene.add(ring);

  return {
    update(t) {
      ring.material.opacity = 0.5 + Math.sin(t * 2) * 0.15;
      big.rotation.y = t * 0.6; // the giant cone on the roof turns slowly
    },
  };
}
