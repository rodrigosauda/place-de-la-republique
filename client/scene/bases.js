// client/scene/bases.js
// The two bases where each side starts (shared/constants.js -> BASES):
//   - Police: between two parked riot-police buses in front of the Caserne Vérines (north side)
//   - Protesters: the pavement in front of the real Café République (south side)
// A painted ring + a sign show the safe zone (no fighting inside).

import * as THREE from 'three';
import { BASES, FACTIONS } from '../../shared/constants.js';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

function box(parent, w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// A French riot-police bus (white with a blue stripe, "POLICE" on the side, blue lights).
// Long side along z. side = +1 / -1: which side has the open door.
function addPoliceBus(scene, physics, x, z, doorSide, rotY = 0) {
  const g = new THREE.Group();
  const L = 11, W = 2.5, H = 2.9;
  const white = std(0xf1f2f4);
  box(g, W, H - 0.5, L, white, 0, 0.5 + (H - 0.5) / 2, 0);
  box(g, W + 0.02, 0.35, L + 0.02, std(0x1e3c8c), 0, 1.25, 0); // blue stripe
  // Dark windows on both sides and the front.
  const glass = std(0x1b2430, { roughness: 0.15, metalness: 0.4 });
  box(g, W + 0.04, 0.75, L - 2.2, glass, 0, 2.35, -0.3);
  box(g, W - 0.3, 0.9, 0.06, glass, 0, 2.2, L / 2 + 0.01);
  // Grilles over the windscreen (riot buses have them).
  for (let i = -3; i <= 3; i++) box(g, 0.04, 0.95, 0.08, std(0x333333), i * 0.32, 2.2, L / 2 + 0.06);
  // "POLICE" lettering on both sides.
  const tex = canvasTexture(512, 96, (c) => {
    c.fillStyle = '#f1f2f4'; c.fillRect(0, 0, 512, 96);
    c.fillStyle = '#1e3c8c'; c.font = '900 76px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('POLICE', 256, 78);
  });
  for (const s of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.75), new THREE.MeshStandardMaterial({ map: tex }));
    plate.position.set(s * (W / 2 + 0.02), 1.75, -0.5);
    plate.rotation.y = s * Math.PI / 2;
    g.add(plate);
  }
  // Open door on the yard side (a dark opening).
  box(g, 0.05, 2, 1.1, std(0x0d0f14), doorSide * (W / 2 + 0.01), 1.4, L / 2 - 1.6);
  // Wheels.
  const wheelMat = std(0x161616, { roughness: 0.9 });
  for (const s of [-1, 1]) for (const wz of [-3.6, 3.4]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14), wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(s * (W / 2 - 0.1), 0.5, wz);
    g.add(w);
  }
  // Blue lights on the roof.
  const blue = new THREE.MeshStandardMaterial({ color: 0x2a6bff, emissive: 0x2a6bff, emissiveIntensity: 1.2 });
  for (const s of [-1, 1]) box(g, 0.35, 0.2, 0.35, blue, s * 0.7, H + 0.1, L / 2 - 0.6);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  physics.addBox(x, H / 2, z, W / 2, H / 2, L / 2, rotY);
  return blue;
}

// Crowd barrier (static decoration closing the yard a bit).
function addBarrier(scene, physics, x, z, rotY) {
  const g = new THREE.Group();
  const metal = std(0xb9c0c8, { metalness: 0.6, roughness: 0.4 });
  box(g, 2.2, 0.06, 0.06, metal, 0, 1.05, 0);
  box(g, 2.2, 0.06, 0.06, metal, 0, 0.25, 0);
  for (let i = -5; i <= 5; i++) box(g, 0.03, 0.8, 0.03, metal, i * 0.2, 0.65, 0);
  for (const s of [-1, 1]) box(g, 0.06, 1.1, 0.5, metal, s * 1.08, 0.55, 0);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  physics.addBox(x, 0.55, z, rotY ? 0.15 : 1.1, 0.55, rotY ? 1.1 : 0.15);
}

// Ring painted on the ground + a sign: "SAFE ZONE".
function addSafeZoneMarking(scene, base, color, signAt) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(base.r - 0.25, base.r, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(base.x, 0.04, base.z);
  ring.userData.noMerge = true;
  scene.add(ring);

  const css = `#${color.toString(16).padStart(6, '0')}`;
  const tex = canvasTexture(512, 192, (c) => {
    c.fillStyle = '#10141c'; c.fillRect(0, 0, 512, 192);
    c.fillStyle = css; c.fillRect(0, 0, 512, 14); c.fillRect(0, 178, 512, 14);
    c.textAlign = 'center'; c.fillStyle = '#ffffff';
    c.font = '900 54px system-ui, sans-serif'; c.fillText(base.label, 256, 84);
    c.font = '700 34px system-ui, sans-serif'; c.fillStyle = css; c.fillText('SAFE ZONE · NO FIGHTING', 256, 140);
  });
  // Two faces back to back, so the text reads the right way round from the square AND from
  // inside the base (one double-sided face shows mirrored writing to whoever spawns behind it).
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), new THREE.MeshStandardMaterial({ map: tex }));
  sign.position.set(signAt[0], 3.1, signAt[1]);
  sign.lookAt(signAt[0], 3.1, 0); // face the square
  const back = sign.clone();
  back.rotateY(Math.PI);          // face the base
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), std(0x333333));
  pole.position.set(sign.position.x, 1.3, sign.position.z);
  scene.add(sign, back, pole);
  return ring;
}

export function buildBases(scene, physics) {
  const c = BASES.c;
  // Two buses parked end to end along the barracks, the yard (spawn) between them.
  const lights = [
    addPoliceBus(scene, physics, c.x - 12, c.z, -1, Math.PI / 2),
    addPoliceBus(scene, physics, c.x + 12, c.z, -1, Math.PI / 2),
  ];
  const g = BASES.g;
  const rings = [
    addSafeZoneMarking(scene, c, 0x5f86ff, [c.x + 4.5, c.z + 5.2]),
    addSafeZoneMarking(scene, g, FACTIONS.g.color, [g.x - 6, g.z - 2.5]),
  ];
  return {
    // Blink the blue lights and pulse the rings a little.
    update(t) {
      const on = Math.floor(t * 3) % 2 === 0;
      lights[0].emissiveIntensity = on ? 2 : 0.2;
      lights[1].emissiveIntensity = on ? 0.2 : 2;
      for (const r of rings) r.material.opacity = 0.55 + Math.sin(t * 2) * 0.15;
    },
  };
}
