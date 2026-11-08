// client/player/playerMesh.js
// Builds a low-poly person from simple shapes, dressed according to their
// "look" (see shared/looks.js): body type, skin, hair, top, trousers, hat,
// face accessory, back item, placard style, CRS unit number.
// Used for the local player, remote players, NPCs and the menu preview.
//
// Structure (so effects.js can animate parts):
//   group                 <- position + facing (rotation.y). Label, bubble, stars live here.
//   └─ pose               <- tilted when knocked out, lowered when sitting
//      ├─ torso, head, hair, hat, face, back item, gilet / police vest
//      ├─ legs[0..1]      <- hip pivots (rotate x to walk)
//      ├─ arms[0..1]      <- shoulder pivots (0 = right arm, 1 = left arm)
//      │   └─ (right hand) weaponPivot -> weapons     (left hand) placard
//      └─ shield (CRS)
// The physics capsule is the same for everyone: 1.8 m tall, centre = group origin.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FACTIONS } from '../../shared/constants.js';
import {
  BODIES, SKINS, HAIRS, HAIR_COLORS, TOPS, PANTS, HATS, FACES, BACKS, PLACARDS, defaultLook,
} from '../../shared/looks.js';

export const PLAYER_RADIUS = 0.4;
export const PLAYER_HALF_LENGTH = 0.5;
export const PLAYER_HALF_HEIGHT = PLAYER_RADIUS + PLAYER_HALF_LENGTH; // 0.9

// Arm angles (rotation.x of the shoulder pivot): 0 = hanging down, -PI/2 = pointing forward, -PI = straight up.
export const ARM_REST = -0.15;

// Smooth shading + soft roughness: rounder, less 'blocky' characters.
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
const rbox = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function add(parent, geo, material, x, y, z, { rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

export function createPlayerMesh(name, faction, isLocal = false, slogan = '', isNpc = false, lookIn = null, badge = '') {
  const look = { ...defaultLook(faction), ...(lookIn || {}) };
  const body = BODIES[look.body]?.id ?? 'man';
  const female = body === 'woman' || body === 'oldwoman';
  const old = body === 'oldman' || body === 'oldwoman';
  const skin = mat(SKINS[look.skin] ?? SKINS[1]);
  const hairMat = mat(HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0]);
  const top = TOPS[look.top] ?? TOPS[0];
  const topMat = top.stripes ? stripedMaterial(top.color, top.stripes) : mat(top.color);
  const pantsMat = mat((PANTS[look.pants] ?? PANTS[0]).color);
  const shoeMat = mat(0x222222);
  const crs = faction === 'c';

  const group = new THREE.Group();
  const pose = new THREE.Group();
  group.add(pose);

  // Proportions
  const shoulder = female ? 0.23 : 0.27;
  const torsoW = female ? 0.36 : 0.44;
  const hunch = old ? 0.12 : 0;

  // --- legs (hip pivots) ---------------------------------------------------
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, -0.08, 0);
    add(hip, new THREE.CapsuleGeometry(0.085, 0.58, 4, 12), crs ? mat(0x141b2b) : pantsMat, 0, -0.37, 0);
    add(hip, rbox(0.13, 0.1, 0.27, 0.04), shoeMat, 0, -0.78, 0.05);
    if (crs) add(hip, new THREE.BoxGeometry(0.16, 0.2, 0.08), mat(0x0c0f16), 0, -0.45, 0.08); // knee pads
    pose.add(hip);
    return hip;
  });

  // --- torso ---------------------------------------------------------------
  const torso = new THREE.Group();
  torso.position.y = -0.08;
  torso.rotation.x = hunch;
  pose.add(torso);
  const torsoMesh = add(torso, rbox(torsoW, 0.62, 0.24, 0.08), crs ? mat(0x182238) : topMat, 0, 0.33, 0);
  if (female && !crs) add(torso, new THREE.BoxGeometry(torsoW + 0.06, 0.12, 0.27), pantsMat, 0, 0.04, 0); // skirt-ish waist

  if (crs) {
    // Tactical vest with POLICE on the back and the unit number.
    add(torso, rbox(torsoW + 0.04, 0.5, 0.29, 0.06), mat(0x0f1522), 0, 0.36, 0);
    const back = canvasTexture(256, 160, (g) => {
      g.fillStyle = '#0f1522'; g.fillRect(0, 0, 256, 160);
      g.fillStyle = '#f2f2f2'; g.font = '900 64px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText('POLICE', 128, 70);
      g.font = '800 44px system-ui, sans-serif';
      g.fillText(String(look.number ?? 212).padStart(3, '0'), 128, 135);
    });
    add(torso, new THREE.PlaneGeometry(torsoW, 0.3), new THREE.MeshStandardMaterial({ map: back }), 0, 0.42, -0.151, { ry: Math.PI, shadow: false });
    const front = canvasTexture(128, 48, (g) => {
      g.fillStyle = '#0f1522'; g.fillRect(0, 0, 128, 48);
      g.fillStyle = '#f2f2f2'; g.font = '900 34px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('POLICE', 64, 36);
    });
    add(torso, new THREE.PlaneGeometry(0.26, 0.1), new THREE.MeshStandardMaterial({ map: front }), 0.07, 0.5, 0.151, { shadow: false });
  } else {
    // The gilet jaune: hi-vis vest with grey reflective stripes (+ your slogan written on the back).
    const vest = mat(FACTIONS.g.color, { emissive: 0x2a2400 });
    add(torso, rbox(torsoW + 0.03, 0.46, 0.27, 0.06), vest, 0, 0.36, 0);
    for (const y of [0.22, 0.4]) add(torso, new THREE.BoxGeometry(torsoW + 0.05, 0.035, 0.29), mat(0xd9d9d9, { emissive: 0x333333 }), 0, y, 0, { shadow: false });
    if (slogan) {
      const back = canvasTexture(256, 128, (g) => {
        g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 256, 128);
        g.fillStyle = '#1a1a1a'; g.textAlign = 'center';
        writeFitted(g, slogan.toUpperCase(), 128, 64, 240, 'italic 800', 34);
      });
      add(torso, new THREE.PlaneGeometry(torsoW, 0.22), new THREE.MeshStandardMaterial({ map: back, transparent: true }), 0, 0.3, -0.141, { ry: Math.PI, shadow: false });
    }
  }

  // --- head ----------------------------------------------------------------
  const head = new THREE.Group();
  head.position.set(0, 0.79, hunch * 0.6);
  pose.add(head);
  add(head, new THREE.CylinderGeometry(0.06, 0.07, 0.12, 6), skin, 0, -0.14, 0); // neck
  const skull = add(head, new THREE.SphereGeometry(0.16, 20, 16), skin, 0, 0, 0);
  skull.scale.set(0.92, 1.08, 1); // a slightly oval head
  add(head, new THREE.ConeGeometry(0.028, 0.07, 8), skin, 0, -0.01, 0.165, { rx: Math.PI / 2 }); // nose
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.035, 8, 6), skin, s * 0.15, 0, 0, { shadow: false }); // ears
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.022, 6, 4), mat(0x111111), s * 0.055, 0.02, 0.145, { shadow: false }); // eyes
  addHair(head, HAIRS[look.hair]?.id ?? 'short', hairMat, female);
  addHat(head, HATS[look.hat]?.id ?? 'none', top);
  addFace(head, FACES[look.face]?.id ?? 'none');

  // --- back item -----------------------------------------------------------
  const backId = BACKS[look.back]?.id ?? 'none';
  if (backId === 'backpack') add(torso, new THREE.BoxGeometry(0.32, 0.38, 0.16), mat(0x3a3f2b), 0, 0.36, -0.21);
  if (backId === 'umbrella') {
    add(torso, new THREE.CylinderGeometry(0.06, 0.02, 0.9, 8), mat(0x2b59c3), 0.05, 0.4, -0.2, { rz: 0.5 });
    add(torso, new THREE.CylinderGeometry(0.015, 0.015, 0.25, 5), mat(0x222222), -0.18, 0.84, -0.2, { rz: 0.5 });
  }
  if (backId === 'cape') {
    const flag = canvasTexture(96, 64, (g) => {
      ['#2b4ea2', '#f4f4f4', '#d6202d'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 32, 0, 32, 64); });
    });
    add(torso, new THREE.PlaneGeometry(0.55, 0.75), new THREE.MeshStandardMaterial({ map: flag, side: THREE.DoubleSide }), 0, 0.22, -0.17, { rx: 0.12, ry: Math.PI });
  }

  // --- arms (shoulder pivots). 0 = right arm (-x), 1 = left arm (+x) -------
  const sleeveMat = crs ? mat(0x182238) : topMat;
  const arms = [-1, 1].map((side) => {
    const sh = new THREE.Group();
    sh.position.set(side * shoulder, 0.5, hunch * 0.3);
    sh.rotation.x = ARM_REST;
    add(sh, new THREE.CapsuleGeometry(0.062, 0.44, 4, 12), sleeveMat, 0, -0.28, 0);
    add(sh, new THREE.SphereGeometry(0.065, 12, 8), crs ? mat(0x111111) : skin, 0, -0.6, 0); // hand (CRS: gloves)
    pose.add(sh);
    return sh;
  });

  // Weapons in the right hand: 0 = baguette (Yellow Vests), 1 = rubber chicken (Riot Police).
  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0, -0.6, 0);
  weaponPivot.rotation.x = 1.25; // points forward/up when the arm hangs down
  arms[0].add(weaponPivot);
  const weapons = [];
  // A long French baguette: golden crust with diagonal cuts.
  const baguette = new THREE.Group();
  const crust = mat(0xc98a3c, { roughness: 0.8 });
  const loaf = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.95, 4, 10), crust);
  loaf.position.y = 0.42;
  baguette.add(loaf);
  for (let i = 0; i < 4; i++) {
    const cut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.04), mat(0xf0d9a8));
    cut.position.set(0, 0.12 + i * 0.2, 0.068);
    cut.rotation.z = 0.6;
    baguette.add(cut);
  }
  // A yellow rubber chicken held by its feet: body, long neck, head, red comb, orange beak.
  const chicken = new THREE.Group();
  const rubber = mat(0xf2d230, { roughness: 0.45 });
  const chickenBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.3, 4, 10), rubber);
  chickenBody.position.y = 0.32;
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.32, 4, 8), rubber);
  neck.position.y = 0.68;
  const chickenHead = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), rubber);
  chickenHead.position.y = 0.9;
  const comb = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.07, 0.11), mat(0xd6202d));
  comb.position.set(0, 0.98, 0);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 6), mat(0xf28c1e));
  beak.position.set(0, 0.9, 0.09);
  beak.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5), mat(0xf28c1e));
    leg.position.set(s * 0.04, 0.08, 0);
    chicken.add(leg);
  }
  chicken.add(chickenBody, neck, chickenHead, comb, beak);
  for (const w of [baguette, chicken]) {
    w.traverse((o) => { o.castShadow = true; });
    w.visible = false;
    weaponPivot.add(w);
    weapons.push(w);
  }

  // Placard held up in the left hand (Gilets with a slogan).
  let placard = null;
  if (!crs && slogan) {
    placard = createPlacard(slogan, PLACARDS[look.placard] ?? PLACARDS[0]);
    placard.position.set(0, -0.6, 0);
    placard.rotation.x = Math.PI; // the arm points up, so flip the sign upright
    arms[1].add(placard);
  }

  // CRS shield (in pose space; effects.js slides it in front when blocking).
  let shield = null;
  if (crs) {
    const shieldTex = canvasTexture(128, 192, (g) => {
      g.fillStyle = 'rgba(170,212,255,0.55)'; g.fillRect(0, 0, 128, 192);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = '900 26px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('POLICE', 64, 40);
      g.strokeStyle = 'rgba(30,40,60,0.8)'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 186);
    });
    shield = add(pose, new THREE.BoxGeometry(0.62, 1.05, 0.04), new THREE.MeshStandardMaterial({ map: shieldTex, transparent: true }), 0.42, 0.05, 0.3, { shadow: false });
  }

  // --- KO stars ------------------------------------------------------------
  const stars = new THREE.Group();
  const starMat = mat(0xffe14d, { emissive: 0x7a6200 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    add(stars, new THREE.OctahedronGeometry(0.1, 0), starMat, Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45, { shadow: false });
  }
  stars.visible = false;
  group.add(stars);

  // --- name label + chat bubble (HTML) ---------------------------------------
  const color = FACTIONS[faction]?.color ?? 0xffffff;
  const div = document.createElement('div');
  div.className = 'name-label' + (isLocal ? ' local' : '') + (isNpc ? ' npc' : '');
  div.textContent = isNpc ? `${name} · NPC` : badge ? `${badge} ${name}` : name; // badge = role icon + loyalty stars
  div.style.borderColor = '#' + color.toString(16).padStart(6, '0');
  const label = new CSS2DObject(div);
  label.position.set(0, PLAYER_HALF_HEIGHT + 0.5, 0);
  if (name) group.add(label);

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'chat-bubble';
  const bubble = new CSS2DObject(bubbleDiv);
  bubble.position.set(0, PLAYER_HALF_HEIGHT + 1.05, 0);
  bubble.visible = false; // the label renderer hides it (CSS display would be overwritten)
  group.add(bubble);

  // The material that flashes red when hit.
  const bodyMaterial = torsoMesh.material;
  if (!bodyMaterial.emissive) bodyMaterial.emissive = new THREE.Color(0);

  group.userData.parts = { pose, torso, head, legs, arms, weaponPivot, weapons, shield, placard, stars, label, bubble, bodyMaterial, old };
  group.userData.dispose = () => {
    label.element.remove();
    bubble.element.remove();
    group.traverse((o) => o.geometry?.dispose());
  };
  return group;
}

// ---------------------------------------------------------------------------
// Hair, hats and face accessories (all on the head group; head radius 0.16)
// ---------------------------------------------------------------------------
function addHair(head, id, hairMat, female) {
  const cap = (r = 0.168) => new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  if (id === 'bald') return;
  if (id === 'curly') {
    add(head, new THREE.IcosahedronGeometry(0.2, 1), hairMat, 0, 0.05, -0.02);
    return;
  }
  add(head, cap(), hairMat, 0, 0.01, -0.005, { rx: -0.15 });
  if (id === 'long') add(head, new THREE.BoxGeometry(0.3, 0.32, 0.1), hairMat, 0, -0.12, -0.11);
  if (id === 'bun') add(head, new THREE.SphereGeometry(0.08, 8, 6), hairMat, 0, 0.12, -0.15);
  if (id === 'short' && female) add(head, new THREE.BoxGeometry(0.3, 0.16, 0.08), hairMat, 0, -0.04, -0.12);
}

function addHat(head, id, top) {
  const half = (r) => new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  switch (id) {
    case 'beanie':
      add(head, half(0.175), mat(0x8e1b1b), 0, 0.03, 0);
      add(head, new THREE.CylinderGeometry(0.178, 0.178, 0.06, 12), mat(0x6e1414), 0, 0.03, 0);
      break;
    case 'cap':
      add(head, half(0.172), mat(0x1d1d1f), 0, 0.03, 0);
      add(head, new THREE.BoxGeometry(0.22, 0.02, 0.14), mat(0x1d1d1f), 0, 0.04, 0.2);
      break;
    case 'beret':
      add(head, new THREE.CylinderGeometry(0.2, 0.17, 0.06, 12), mat(0x1a1a1a), 0.03, 0.13, 0, { rz: -0.25 });
      add(head, new THREE.CylinderGeometry(0.012, 0.012, 0.04, 5), mat(0x1a1a1a), 0.06, 0.18, 0, { rz: -0.25 });
      break;
    case 'hood':
      add(head, new THREE.SphereGeometry(0.2, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(top.color), 0, 0.0, -0.03, { rx: -0.35 });
      break;
    case 'phrygian': // the red bonnet of Marianne
      add(head, half(0.175), mat(0xc8102e), 0, 0.03, 0);
      add(head, new THREE.ConeGeometry(0.13, 0.26, 10), mat(0xc8102e), 0, 0.25, 0.04, { rx: 0.55 });
      add(head, new THREE.SphereGeometry(0.05, 8, 6), mat(0xc8102e), 0, 0.33, 0.14);
      add(head, new THREE.CylinderGeometry(0.012, 0.012, 0.01, 5), mat(0xffffff), 0.12, 0.08, 0.1); // cockade dot
      break;
    case 'tricolor': {
      const band = (c, y) => add(head, new THREE.CylinderGeometry(0.17 - y * 0.25, 0.178 - y * 0.25, 0.06, 12), mat(c), 0, 0.03 + y, 0);
      band(0x2b4ea2, 0); band(0xf4f4f4, 0.06); band(0xd6202d, 0.12);
      add(head, new THREE.SphereGeometry(0.05, 8, 6), mat(0xd6202d), 0, 0.2, 0);
      break;
    }
    case 'helmet':
    case 'helmetUp':
    case 'goldHelmet': {
      const shell = id === 'goldHelmet' ? mat(0xd4af37, { metalness: 0.8, roughness: 0.25 }) : mat(0x0e1320);
      add(head, new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), shell, 0, -0.01, -0.01);
      const visor = new THREE.Mesh(
        new THREE.SphereGeometry(0.205, 12, 6, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.35),
        new THREE.MeshStandardMaterial({ color: 0x9fc3e6, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
      );
      if (id === 'helmetUp') { visor.rotation.x = -0.9; visor.position.y = 0.04; }
      head.add(visor);
      break;
    }
    default:
  }
}

function addFace(head, id) {
  switch (id) {
    case 'sunglasses':
      add(head, new THREE.BoxGeometry(0.24, 0.06, 0.04), mat(0x0d0d0d, { metalness: 0.5, roughness: 0.2 }), 0, 0.02, 0.15, { shadow: false });
      break;
    case 'mask':
      add(head, new THREE.BoxGeometry(0.2, 0.11, 0.06), mat(0xe9f1f5), 0, -0.07, 0.13, { shadow: false });
      break;
    case 'scarf': {
      const check = canvasTexture(64, 64, (g) => {
        g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#1a1a1a';
        for (let i = 0; i < 64; i += 16) { g.fillRect(i, 0, 6, 64); g.fillRect(0, i, 64, 6); }
      });
      add(head, new THREE.CylinderGeometry(0.17, 0.19, 0.16, 10), new THREE.MeshStandardMaterial({ map: check }), 0, -0.1, 0.01, { shadow: false });
      break;
    }
    case 'gasmask':
      add(head, new THREE.BoxGeometry(0.2, 0.16, 0.08), mat(0x111111), 0, -0.04, 0.13);
      for (const s of [-1, 1]) add(head, new THREE.CylinderGeometry(0.045, 0.045, 0.07, 8), mat(0x2a2a2a), s * 0.08, -0.09, 0.19, { rx: Math.PI / 2 });
      add(head, new THREE.BoxGeometry(0.2, 0.06, 0.03), new THREE.MeshStandardMaterial({ color: 0x8fb3c9, transparent: true, opacity: 0.6 }), 0, 0.03, 0.16, { shadow: false });
      break;
    case 'goggles':
      add(head, new THREE.BoxGeometry(0.28, 0.08, 0.05), mat(0xff8a1f, { metalness: 0.6, roughness: 0.2, emissive: 0x3a1a00 }), 0, 0.03, 0.15, { shadow: false });
      add(head, new THREE.CylinderGeometry(0.168, 0.168, 0.03, 12), mat(0x111111), 0, 0.03, 0, { shadow: false });
      break;
    case 'clown':
      add(head, new THREE.SphereGeometry(0.045, 8, 6), mat(0xe0141e), 0, -0.02, 0.17, { shadow: false });
      break;
    default:
  }
}

// A sign on a wooden stick, in the chosen style. The slogan is drawn on a canvas.
function createPlacard(text, style) {
  const tex = canvasTexture(256, 128, (g) => {
    g.fillStyle = style.board; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = style.frame; g.lineWidth = 8; g.strokeRect(4, 4, 248, 120);
    g.fillStyle = style.ink; g.textAlign = 'center';
    writeFitted(g, text.toUpperCase(), 128, 64, 232, '900', 44);
  });
  const group = new THREE.Group();
  add(group, new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), mat(0x8b5a2b), 0, 0.35, 0);
  const side = mat(style.board);
  const face = new THREE.MeshStandardMaterial({ map: tex });
  add(group, new THREE.BoxGeometry(0.9, 0.45, 0.025), [side, side, side, side, face, face], 0, 0.95, 0);
  return group;
}

// Writes text on max 2 lines, shrinking the font until it fits.
function writeFitted(g, text, cx, cy, maxW, weight, startSize) {
  const words = text.split(' ');
  let size = startSize;
  let lines;
  do {
    g.font = `${weight} ${size}px system-ui, sans-serif`;
    lines = [''];
    for (const w of words) {
      const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + w : w;
      if (g.measureText(t).width > maxW && lines[lines.length - 1]) lines.push(w);
      else lines[lines.length - 1] = t;
    }
    size -= 2;
  } while ((lines.length > 2 || lines.some((l) => g.measureText(l).width > maxW)) && size > 12);
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, cx, cy + (i - (lines.length - 1) / 2) * (size + 6)));
}

// Breton striped shirt ("marinière").
function stripedMaterial(base, stripe) {
  const tex = canvasTexture(16, 64, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 16, 64);
    g.fillStyle = stripe;
    for (let y = 0; y < 64; y += 10) g.fillRect(0, y, 16, 4);
  });
  return new THREE.MeshStandardMaterial({ map: tex, flatShading: true });
}
