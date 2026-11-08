// client/scene/streetFurniture.js
// The small things that make a street look like Paris, all from basic shapes:
//   Morris columns (green poster columns), Wallace fountains, a newspaper kiosk,
//   métro entrances, the café pavilion with its terrace, the "miroir d'eau"
//   (thin water mirror), benches, brown bollards and road markings.

import * as THREE from 'three';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra });
const GREEN = std(0x1f4d36);          // the classic Paris street-furniture green
const DARK = std(0x22262b);
const BRONZE_BROWN = std(0x4a3426);

function mesh(geo, mat, x, y, z, { shadow = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// A canvas texture helper.
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Colourful theatre / concert posters wrapped around Morris columns.
const posterTexture = canvasTexture(512, 128, (g) => {
  const colors = ['#c8102e', '#f2c14e', '#2b59c3', '#f4ecd8', '#3a7d44', '#e86a33', '#7b2d8b', '#111'];
  const words = ['THEATRE', 'CONCERT', 'CINEMA', 'OPERA', 'EXPO', 'CIRCUS', 'DANCE', 'JAZZ'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = colors[i];
    g.fillRect(i * 64, 0, 64, 128);
    g.fillStyle = i === 1 || i === 3 ? '#111' : '#fff';
    g.font = '900 15px system-ui, sans-serif';
    g.save();
    g.translate(i * 64 + 32, 64);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.fillText(words[i], 0, 5);
    g.restore();
  }
});

export function addMorrisColumn(scene, physics, x, z) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.3, 14), GREEN, 0, 0.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.6, 14, 1, true), new THREE.MeshStandardMaterial({ map: posterTexture }), 0, 1.6, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.25, 14), GREEN, 0, 3.0, 0));
  g.add(mesh(new THREE.SphereGeometry(0.66, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), GREEN, 0, 3.1, 0));
  g.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), GREEN, 0, 3.85, 0));
  g.position.set(x, 0, z);
  scene.add(g);
  physics.addCylinder(x, 1.6, z, 1.6, 0.75);
}

export function addWallaceFountain(scene, physics, x, z) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.6, 8), GREEN, 0, 0.3, 0));
  for (let i = 0; i < 4; i++) { // the four caryatids, as thin columns
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 6), GREEN, Math.cos(a) * 0.28, 1.25, Math.sin(a) * 0.28));
  }
  g.add(mesh(new THREE.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), GREEN, 0, 1.9, 0));
  g.add(mesh(new THREE.ConeGeometry(0.1, 0.35, 6), GREEN, 0, 2.5, 0));
  g.position.set(x, 0, z);
  scene.add(g);
  physics.addCylinder(x, 1.2, z, 1.2, 0.6);
}

export function addNewsKiosk(scene, physics, x, z) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.6, 6), GREEN, 0, 1.3, 0));
  const sign = canvasTexture(256, 32, (c) => {
    c.fillStyle = '#1f4d36'; c.fillRect(0, 0, 256, 32);
    c.fillStyle = '#f2c14e'; c.font = '700 20px system-ui'; c.textAlign = 'center'; c.fillText('NEWSPAPERS', 128, 23);
  });
  g.add(mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.45, 6, 1, true), new THREE.MeshStandardMaterial({ map: sign, side: THREE.DoubleSide }), 0, 2.85, 0));
  g.add(mesh(new THREE.ConeGeometry(1.9, 1.0, 6), GREEN, 0, 3.55, 0));
  g.add(mesh(new THREE.SphereGeometry(0.15, 8, 6), std(0xd4af37), 0, 4.1, 0));
  g.position.set(x, 0, z);
  scene.add(g);
  physics.addCylinder(x, 1.5, z, 1.5, 1.5);
}

// Métro entrance: stairs going down behind a railing, and the "M" totem sign.
export function addMetroEntrance(scene, physics, x, z, rotY = 0) {
  const g = new THREE.Group();
  const hole = mesh(new THREE.BoxGeometry(2.4, 0.04, 5), std(0x0d0f12), 0, 0.02, 0, { shadow: false });
  g.add(hole);
  for (let i = 0; i < 6; i++) { // a few visible steps
    g.add(mesh(new THREE.BoxGeometry(2.3, 0.05, 0.4), std(0x6d6d6d), 0, 0.05, -2.2 + i * 0.45, { shadow: false }));
  }
  // Open railings on 3 sides: a top rail + thin posts (you can see the stairs through them).
  const rail = std(0x1f4d36);
  for (const [px, pz, len, along] of [[-1.25, 0, 5, 'z'], [1.25, 0, 5, 'z'], [0, 2.5, 2.5, 'x']]) {
    g.add(mesh(along === 'z' ? new THREE.BoxGeometry(0.07, 0.07, len) : new THREE.BoxGeometry(len, 0.07, 0.07), rail, px, 1.0, pz));
    g.add(mesh(along === 'z' ? new THREE.BoxGeometry(0.04, 0.04, len) : new THREE.BoxGeometry(len, 0.04, 0.04), rail, px, 0.25, pz));
    const posts = Math.round(len / 0.25);
    for (let i = 0; i <= posts; i++) {
      const o = -len / 2 + (i / posts) * len;
      g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 4), rail, along === 'z' ? px : o, 0.62, along === 'z' ? o : pz, { shadow: false }));
    }
  }
  // the stairs going down (dark, stepping into the ground)
  for (let i = 0; i < 8; i++) g.add(mesh(new THREE.BoxGeometry(2.3, 0.04, 0.55), std(0x55585c), 0, 0.03 - i * 0.002, 2.1 - i * 0.6, { shadow: false }));
  // the totem with the yellow M
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8), DARK, 1.7, 1.6, -2.3));
  const mTex = canvasTexture(128, 128, (c) => {
    c.fillStyle = '#f2c14e'; c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111'; c.font = '900 84px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('M', 64, 94);
  });
  const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 20), [
    std(0x111111), new THREE.MeshStandardMaterial({ map: mTex }), new THREE.MeshStandardMaterial({ map: mTex }),
  ]);
  sign.rotation.x = Math.PI / 2;
  sign.position.set(1.7, 3.4, -2.3);
  g.add(sign);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  // Colliders: the whole entrance is a solid block (you can't fall in).
  physics.addBox(x, 0.5, z, rotY ? 2.5 : 1.3, 0.5, rotY ? 1.3 : 2.5);
}

// The glass café pavilion on the square with its terrace and red parasols.
export function addCafe(scene, physics, x, z) {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfd8e6, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2 });
  g.add(mesh(new THREE.BoxGeometry(10, 3.6, 6), glass, 0, 1.8, 0, { shadow: false }));
  g.add(mesh(new THREE.BoxGeometry(10.6, 0.3, 6.6), std(0xe9e4da), 0, 3.75, 0));
  for (const [px, pz] of [[-5, -3], [5, -3], [-5, 3], [5, 3]]) g.add(mesh(new THREE.BoxGeometry(0.2, 3.6, 0.2), DARK, px, 1.8, pz));
  // bar counter inside
  g.add(mesh(new THREE.BoxGeometry(5, 1.1, 0.8), std(0x6b4a2f), 0, 0.55, 1.6));
  const signTex = canvasTexture(512, 64, (c) => {
    c.fillStyle = '#111'; c.fillRect(0, 0, 512, 64);
    c.fillStyle = '#f4ecd8'; c.font = 'italic 700 38px Georgia, serif'; c.textAlign = 'center'; c.fillText('Café République', 256, 45);
  });
  const sign = mesh(new THREE.PlaneGeometry(7, 0.9), new THREE.MeshStandardMaterial({ map: signTex }), 0, 4.4, -3.31, { shadow: false });
  sign.rotation.y = Math.PI;
  g.add(sign);
  // terrace: round tables, chairs, parasols (on the -z side)
  const wood = std(0x8b5a2b);
  const red = std(0xa3161f);
  for (let i = 0; i < 4; i++) {
    const tx = -3.6 + i * 2.4;
    const tz = -5.2;
    g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 12), DARK, tx, 0.75, tz));
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 6), DARK, tx, 0.37, tz));
    for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), wood, tx + s * 0.75, 0.23, tz));
    if (i % 2 === 0) {
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), DARK, tx + 1.2, 1.2, tz));
      g.add(mesh(new THREE.ConeGeometry(1.6, 0.6, 8), red, tx + 1.2, 2.45, tz));
    }
  }
  g.position.set(x, 0, z);
  scene.add(g);
  physics.addBox(x, 1.8, z, 5, 1.8, 3);
  for (let i = 0; i < 4; i++) physics.addCylinder(x - 3.6 + i * 2.4, 0.4, z - 5.2, 0.4, 0.5);
}

// The thin sheet of water on the square, nice reflections, you can walk on it.
export function addWaterMirror(scene, x, z, w, d) {
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.03, d),
    new THREE.MeshStandardMaterial({ color: 0x9cc3d8, metalness: 0.25, roughness: 0.05, emissive: 0x0b1a26 }),
  );
  water.position.set(x, 0.03, z);
  water.receiveShadow = true;
  scene.add(water);
}

export function addBench(scene, physics, x, z, rotY = 0) {
  const g = new THREE.Group();
  const wood = std(0x7a5232);
  g.add(mesh(new THREE.BoxGeometry(2.2, 0.08, 0.5), wood, 0, 0.45, 0));
  g.add(mesh(new THREE.BoxGeometry(2.2, 0.45, 0.07), wood, 0, 0.75, -0.22));
  for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.45, 0.5), DARK, s * 0.95, 0.22, 0));
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  physics.addBox(x, 0.4, z, rotY ? 0.3 : 1.1, 0.4, rotY ? 1.1 : 0.3);
}

// Brown cast-iron bollards ("potelets") in a line, with colliders. Instanced: cheap.
export function addBollards(scene, physics, points) {
  const geo = new THREE.CylinderGeometry(0.08, 0.1, 1.0, 8);
  const inst = new THREE.InstancedMesh(geo, BRONZE_BROWN, points.length);
  const m = new THREE.Matrix4();
  points.forEach(([x, z], i) => {
    inst.setMatrixAt(i, m.makeTranslation(x, 0.5, z));
    physics.addCylinder(x, 0.5, z, 0.5, 0.12);
  });
  inst.castShadow = true;
  scene.add(inst);
}

// White road markings: dashed centre lines + pedestrian crossings. Instanced.
export function addRoadMarkings(scene, dashes, zebras) {
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f1f1, roughness: 0.8 });
  const geo = new THREE.BoxGeometry(1, 0.02, 1);
  const all = [...dashes, ...zebras];
  const inst = new THREE.InstancedMesh(geo, white, all.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  all.forEach(([x, z, sx, sz, r = 0], i) => {
    m.compose(new THREE.Vector3(x, 0.015, z), q.setFromAxisAngle(up, r), new THREE.Vector3(sx, 1, sz));
    inst.setMatrixAt(i, m);
  });
  inst.receiveShadow = true;
  scene.add(inst);
}

// A café terrace on the pavement in front of a real café (from the map):
// a long awning with the café's name, small round tables and wicker chairs.
// (x, z) = the café's wall, rot = direction the terrace faces (out of the wall).
export function addTerrace(scene, physics, x, z, rot, name = '', width = 8) {
  const g = new THREE.Group();
  const w = Math.max(4, Math.min(12, width));
  const red = std(0x8e1b1b);
  // Awning sloping out from the wall, with a printed front valance.
  const awning = mesh(new THREE.BoxGeometry(w, 0.06, 3.2), red, 0, 3.15, 1.6);
  awning.rotation.x = 0.18;
  g.add(awning);
  if (name) {
    const t = canvasTexture(512, 64, (c) => {
      c.fillStyle = '#8e1b1b'; c.fillRect(0, 0, 512, 64);
      c.fillStyle = '#f4ecd8'; c.font = 'italic 700 38px Georgia, serif'; c.textAlign = 'center';
      c.fillText(name, 256, 45);
    });
    const valance = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.45), new THREE.MeshStandardMaterial({ map: t }));
    valance.position.set(0, 2.62, 3.2);
    g.add(valance);
  }
  // Tables + chairs in two rows.
  const wicker = std(0xb08850);
  const cols = Math.max(2, Math.floor(w / 2.2));
  const tables = [];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < cols; i++) {
      const tx = -w / 2 + (i + 0.5) * (w / cols);
      const tz = 1.1 + row * 1.6;
      g.add(mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 12), DARK, tx, 0.74, tz));
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.74, 6), DARK, tx, 0.37, tz));
      for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.42, 0.45, 0.42), wicker, tx + s * 0.6, 0.23, tz));
      tables.push([tx, tz]);
    }
  }
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  scene.add(g);
  // Colliders for the tables (in world space).
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const [tx, tz] of tables) physics.addCylinder(x + tx * c + tz * s, 0.4, z - tx * s + tz * c, 0.4, 0.45);
}
