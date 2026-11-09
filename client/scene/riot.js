// client/scene/riot.js
// The "living riot": a big background crowd, riot police lines, tear gas,
// red flares, smoke, a police helicopter and rubbish on the street.
//
// The crowd is NOT sent over the network: every browser computes the same
// scene from the shared game clock (shared/timeline.js), so all players see
// the march leave at 14:00 and the police line advance at 17:00.
// From the server come: tear gas thrown by police players, "an extra was hit"
// (so everyone sees them fall) and "the line hit someone" (a baton swing).
//
// The extras are real little people (legs, arms, head, hair, vest...) that
// walk with a proper stride. Cheap to draw: each body part is ONE InstancedMesh,
// so 150 people cost about 20 draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gameMinutes, GAS_RADIUS, GAS_DURATION_MS, GAS_PICKUP_MS, GAS_PICKUP_RANGE, inSafeZone, PLAZA } from '../../shared/constants.js';
import { phaseAt, policeLine, linePhase, meleeCenters, MELEE_RADIUS } from '../../shared/timeline.js';

const N_CROWD_LOW = 110, N_CROWD_FULL = 200; // the full quality draws almost twice as many extras (each part is one instanced mesh)
const LINE_COPS = 20;   // officers in the shield line
const FIGHT_COPS = 36;  // officers brawling in the middle
const FIGHTERS = 40;    // protesters brawling (paired with an officer)
const N_POLICE = LINE_COPS + FIGHT_COPS;
const ROWS = 2;
const KO_TIME = 4000;
const TOP_COLORS = [0x22304f, 0x1d1d1f, 0xecebe6, 0x7c8088, 0xb3262e, 0x3c6e47, 0x4b6e9c, 0x5a3e2b];
const PANTS_COLORS = [0x3d5a80, 0x1f1f22, 0xb9a57f, 0x5f636b, 0x2f3b52];
const SKIN = [0xf1d0b5, 0xe0b394, 0xc68e6a, 0xa26a45, 0x7a4b2e, 0x4e3020];
const HAIR = [0x1c1714, 0x4a2f1d, 0x8a5a2b, 0xd9b26a, 0xa9a9a9, 0xb5401f];
// The black bloc: black and grey clothes, hoods up (drawn as dark "hair").
const BLOC_COLORS = [0x1d1d1f, 0x1d1d1f, 0x2b2c30, 0x3a3c42, 0x55585e];
const SIGN_COLORS = [0xc9a46b, 0xf4f1ea, 0xd6202d, 0xf7d417];

// A tiny repeatable random generator (same numbers in every browser).
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const angleDiff = (to, from) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// The march route on the real map: from the east of the square, past the monument,
// out along Boulevard de Magenta (north-west) until it disappears in the distance.
const ROUTE = [[72, -8], [20, -24], [-60, -28], [-104, -33], [-128, -42], [-210, -66], [-330, -100]].map(([x, z]) => new THREE.Vector2(x, z));
const ROUTE_LEN = ROUTE.reduce((sum, p, i) => (i ? sum + p.distanceTo(ROUTE[i - 1]) : 0), 0);
function routePoint(s, out) {
  s = ((s % ROUTE_LEN) + ROUTE_LEN) % ROUTE_LEN;
  for (let i = 1; i < ROUTE.length; i++) {
    const seg = ROUTE[i].distanceTo(ROUTE[i - 1]);
    if (s <= seg) {
      const t = s / seg;
      out.x = ROUTE[i - 1].x + (ROUTE[i].x - ROUTE[i - 1].x) * t;
      out.z = ROUTE[i - 1].y + (ROUTE[i].y - ROUTE[i - 1].y) * t;
      out.dir = Math.atan2(ROUTE[i].x - ROUTE[i - 1].x, ROUTE[i].y - ROUTE[i - 1].y);
      return out;
    }
    s -= seg;
  }
  return out;
}

// Smoke bombs left on the street after 17:00 (near the clashes at Boulevard du Temple).
const SMOKE_SPOTS = [[118, 12], [104, 24], [96, -6], [126, 34], [62, -32], [-40, -20]];

// --------------------------------------------------------------------- textures
function cloudTexture() {
  // A soft, lumpy cloud puff (several blurred blobs) instead of a perfect circle.
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = seeded(42);
  for (let i = 0; i < 14; i++) {
    const x = 64 + (r() - 0.5) * 50, y = 64 + (r() - 0.5) * 50, rad = 18 + r() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  // fade the edges so no square corners ever show
  const id = g.getImageData(0, 0, 128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const d = Math.hypot(x - 64, y - 64) / 64;
    id.data[(y * 128 + x) * 4 + 3] *= Math.max(0, 1 - d * d);
  }
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --------------------------------------------------------------------- body parts
// Geometry is built so that each limb rotates around its joint (hip / shoulder).
function bodyGeometries() {
  const leg = new THREE.CapsuleGeometry(0.075, 0.62, 3, 8);
  leg.translate(0, -0.39, 0);
  const arm = new THREE.CapsuleGeometry(0.055, 0.46, 3, 8);
  arm.translate(0, -0.28, 0);
  const torso = new THREE.CapsuleGeometry(0.19, 0.36, 4, 10);
  torso.scale(1.18, 1, 0.78);
  const vest = new THREE.CapsuleGeometry(0.205, 0.26, 4, 10);
  vest.scale(1.18, 1, 0.8);
  const head = new THREE.SphereGeometry(0.125, 12, 10);
  const hair = new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const helmet = new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const visor = new THREE.BoxGeometry(0.26, 0.12, 0.02);
  const shield = new THREE.BoxGeometry(0.56, 1.0, 0.03);
  // Rubber chicken (police) and baguette (protesters), held in the right hand,
  // pointing forward. Coloured per vertex so each is ONE instanced mesh.
  const painted = (geo, hex) => {
    const g = geo.toNonIndexed();
    const c = new THREE.Color(hex);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
    g.deleteAttribute('uv');
    return g;
  };
  const part = (geo, hex, x, y, z, rx = 0) => { geo.rotateX(rx); geo.translate(x, y, z); return painted(geo, hex); };
  const baton = mergeGeometries([
    part(new THREE.CapsuleGeometry(0.06, 0.16, 3, 8), 0xf2d230, 0, 0, 0.18, Math.PI / 2),   // body
    part(new THREE.CapsuleGeometry(0.025, 0.18, 3, 6), 0xf2d230, 0, 0, 0.42, Math.PI / 2),  // neck
    part(new THREE.SphereGeometry(0.045, 8, 6), 0xf2d230, 0, 0, 0.55),                       // head
    part(new THREE.BoxGeometry(0.015, 0.045, 0.06), 0xd6202d, 0, 0.045, 0.55),               // comb
    part(new THREE.ConeGeometry(0.02, 0.06, 5), 0xf28c1e, 0, 0, 0.61, Math.PI / 2),          // beak
  ]);
  baton.translate(0, -0.5, 0);
  const baguette = painted(new THREE.CapsuleGeometry(0.045, 0.55, 3, 8), 0xc98a3c);
  baguette.rotateX(Math.PI / 2);
  baguette.translate(0, -0.52, 0.25);
  const sign = new THREE.BoxGeometry(0.72, 0.48, 0.025);
  const flag = new THREE.PlaneGeometry(0.95, 0.62);
  flag.translate(0.475, 0, 0); // hinged on the pole so it waves from one edge
  const stick = new THREE.CylinderGeometry(0.018, 0.018, 1.0, 5);
  return { leg, arm, torso, vest, head, hair, helmet, visor, shield, baton, baguette, sign, stick, flag };
}

export function createRiotScene(scene, physics, { lowQuality = false } = {}) {
  const G = bodyGeometries();
  const NC = lowQuality ? N_CROWD_LOW : N_CROWD_FULL;
  const color = new THREE.Color();
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...extra });
  const meshes = [];
  const inst = (geo, material, count) => {
    const m = new THREE.InstancedMesh(geo, material, count);
    m.castShadow = !lowQuality;
    m.receiveShadow = true;
    m.frustumCulled = false; // people move around; the bounding box would be wrong
    m.userData.noMerge = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    meshes.push(m);
    return m;
  };

  // ------------------------------------------------------------- the crowd
  const C = {
    torso: inst(G.torso, mat(0xffffff), NC),
    vest: inst(G.vest, mat(0xf7d417, { emissive: 0x2a2400 }), NC),
    head: inst(G.head, mat(0xffffff), NC),
    hair: inst(G.hair, mat(0xffffff), NC),
    legL: inst(G.leg, mat(0xffffff), NC),
    legR: inst(G.leg, mat(0xffffff), NC),
    armL: inst(G.arm, mat(0xffffff), NC),
    armR: inst(G.arm, mat(0xffffff), NC),
    sign: inst(G.sign, mat(0xffffff), NC),
    stick: inst(G.stick, mat(0x8b5a2b), NC),
    bread: inst(G.baguette, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), NC),
    flag: inst(G.flag, new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), NC), // flags on tall poles
  };
  // Big banners carried by two people (a texture each, so the words are readable).
  const BANNER_TEXTS = ['WAGES FIRST', 'OUR FUTURE', 'WE ARE HERE', 'FAIR PRICES'];
  const BANNER_BG = ['#c8102e', '#1f4fb4', '#f4f1ea', '#2f8f4e'];
  const BANNER_INK = ['#ffffff', '#ffffff', '#c8102e', '#ffffff'];
  const bannerMeshes = lowQuality ? [] : BANNER_TEXTS.map((text, k) => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = BANNER_BG[k]; g.fillRect(0, 0, 512, 160);
    g.strokeStyle = BANNER_INK[k]; g.lineWidth = 8; g.strokeRect(10, 10, 492, 140);
    g.fillStyle = BANNER_INK[k]; g.font = '900 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 84);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return inst(new THREE.PlaneGeometry(1, 0.31), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }), 2);
  });
  const bannerPoles = lowQuality ? null : inst(G.stick, mat(0x8b5a2b), 16); // two poles per banner
  // Pair k of banner carriers: two extras that are not fighting, walking side by side.
  const BANNER_PAIRS = lowQuality ? [] : Array.from({ length: 8 }, (_, k) => [FIGHTERS + 8 + k * 7, FIGHTERS + 9 + k * 7]);
  const FLAG_COLORS = [0xc8102e, 0x1f4fb4, 0x2f8f4e, 0xf4f1ea, 0xf7d417, 0xe0662a];
  const crowd = [];
  for (let i = 0; i < NC; i++) {
    const r = seeded(i * 7919 + 13);
    const a = {
      x: -30 + r() * 40, z: -20 + r() * 20, rot: r() * 6.28,
      lat: (r() - 0.5) * 10,                 // sideways place in the march column
      ring: 12 + r() * 20, ang: r() * 6.28,  // place around the monument
      phase: r() * 6.28, speed: 1.15 + r() * 0.45,
      stride: 0, moving: 0,
      height: 0.92 + r() * 0.16, wide: 0.9 + r() * 0.25,
      vest: r() < 0.12, bloc: i < FIGHTERS || r() < 0.45, sign: r() < 0.32, flare: r() < 0.05, flagger: false,
      visible: false, koUntil: 0, kx: 0, kz: 0, punchT: -1,
    };
    crowd.push(a);
    if (i >= FIGHTERS && !lowQuality && seeded(i * 104729 + 7)() < 0.1 && !BANNER_PAIRS.some((p) => p.includes(i))) { a.sign = true; a.flagger = true; } // 1 in 10 carries a flag
    if (BANNER_PAIRS.some((p) => p.includes(i))) a.sign = false;
    C.flag.setColorAt(i, color.set(FLAG_COLORS[i % FLAG_COLORS.length]));
    const top = a.bloc ? BLOC_COLORS[Math.floor(r() * BLOC_COLORS.length)] : TOP_COLORS[Math.floor(r() * TOP_COLORS.length)];
    const skin = SKIN[Math.floor(r() * SKIN.length)];
    const pants = a.bloc ? BLOC_COLORS[Math.floor(r() * 3)] : PANTS_COLORS[Math.floor(r() * PANTS_COLORS.length)];
    if (a.bloc) a.vest = false;
    C.torso.setColorAt(i, color.set(top));
    C.armL.setColorAt(i, color.set(top));
    C.armR.setColorAt(i, color.set(top));
    C.head.setColorAt(i, color.set(skin));
    C.hair.setColorAt(i, color.set(a.bloc ? top : r() < 0.25 ? TOP_COLORS[Math.floor(r() * 3)] : HAIR[Math.floor(r() * HAIR.length)])); // hood up / some wear beanies
    C.legL.setColorAt(i, color.set(pants));
    C.legR.setColorAt(i, color.set(pants));
    C.sign.setColorAt(i, color.set(SIGN_COLORS[Math.floor(r() * SIGN_COLORS.length)]));
  }

  // ------------------------------------------------------- riot police
  const navy = mat(0x15181f);
  const P = {
    torso: inst(G.torso, mat(0x0d0f14), N_POLICE),
    head: inst(G.head, mat(0xe0b394), N_POLICE),
    helmet: inst(G.helmet, mat(0x1b2333, { metalness: 0.4, roughness: 0.35 }), N_POLICE),
    visor: inst(G.visor, new THREE.MeshStandardMaterial({ color: 0x9fc6e8, transparent: true, opacity: 0.55, roughness: 0.1 }), N_POLICE),
    legL: inst(G.leg, navy, N_POLICE),
    legR: inst(G.leg, navy, N_POLICE),
    armL: inst(G.arm, navy, N_POLICE),
    armR: inst(G.arm, navy, N_POLICE),
    baton: inst(G.baton, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), N_POLICE),
    shield: inst(G.shield, new THREE.MeshStandardMaterial({ color: 0xaad4ff, transparent: true, opacity: 0.45, roughness: 0.1 }), N_POLICE),
  };
  const police = [];
  for (let i = 0; i < N_POLICE; i++) police.push({ x: 120, z: 25, rot: 0, phase: i * 0.7, stride: 0, moving: 0, swingT: -1, visible: false, koUntil: 0, inLine: false });

  // The police line blocks you: one invisible moving box (kinematic body).
  const R = physics.RAPIER;
  const lineBody = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(133, 1, 31));
  const lineCollider = physics.world.createCollider(R.ColliderDesc.cuboid(8, 1, 0.7), lineBody);
  let line = policeLine(12);
  let linePush = null;   // from the server (the line reacts to players); null = default schedule
  let lineState = 1;     // 1 advancing, 0 held, -1 falling back
  let linePushPhase = null;

  // ------------------------------------------------------------ smoke
  const puffTex = cloudTexture();
  const MAX_PUFFS = lowQuality ? 140 : 320;
  const puffs = [];
  for (let i = 0; i < MAX_PUFFS; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 }));
    sprite.visible = false;
    sprite.userData.noMerge = true;
    sprite.renderOrder = 2;
    scene.add(sprite);
    puffs.push({ sprite, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size0: 1, size1: 2, alpha: 0.5, spin: 0, tint: new THREE.Color() });
  }
  let nextPuff = 0;
  let light = 1; // 1 = daylight, ~0.3 at night (smoke isn't lit, so we darken it by hand)
  function puff(x, y, z, { vx = 0, vy = 0.6, vz = 0, life = 3, size0 = 0.6, size1 = 3, alpha = 0.5, tint = 0xdddddd } = {}) {
    const p = puffs[nextPuff];
    nextPuff = (nextPuff + 1) % puffs.length;
    p.sprite.position.set(x, y, z);
    p.tint.set(tint);
    p.sprite.material.rotation = Math.random() * 6.28;
    p.sprite.visible = true;
    Object.assign(p, { life: 0, max: life, vx, vy, vz, size0, size1, alpha, spin: (Math.random() - 0.5) * 0.4 });
  }
  const WIND = { x: 0.35, z: 0.12 }; // a light breeze pushes all smoke the same way

  // Tear-gas clouds on the ground: { x, z, start, end }, and the canisters lying there.
  const gasClouds = [];
  const canGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8);
  const canMat = mat(0x4d5a2b, { metalness: 0.5, roughness: 0.4 });
  function addGas(x, z, now = Date.now(), id = 0) {
    const can = new THREE.Mesh(canGeo, canMat);
    can.rotation.z = Math.PI / 2;
    can.rotation.y = Math.random() * 6.28;
    can.position.set(x, 0.05, z);
    can.userData.noMerge = true;
    scene.add(can);
    gasClouds.push({ id, x, z, start: now, end: now + GAS_DURATION_MS, acc: 0, can });
  }

  // Canisters flying through the air (thrown by real police players), with a smoke trail.
  const flying = [];
  function throwGas(from, to, onLand) {
    const mesh = new THREE.Mesh(canGeo, canMat);
    mesh.userData.noMerge = true;
    scene.add(mesh);
    flying.push({ mesh, from: from.clone(), to: new THREE.Vector3(to[0], 0.1, to[1]), t: 0, onLand, trail: 0 });
  }

  // One red light that follows a burning flare (a fixed number of lights = no shader rebuilds).
  const flareLight = new THREE.PointLight(0xff2a1a, 0, 14, 1.5);
  flareLight.userData.noMerge = true;
  scene.add(flareLight);
  const flares = inst(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3a22 }), NC);
  flares.castShadow = false;

  // ------------------------------------------------------- helicopter
  const heli = new THREE.Group();
  heli.userData.noMerge = true;
  const heliMat = mat(0x2a3550, { metalness: 0.3 });
  const hb = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 2.4, 4, 10), heliMat);
  hb.rotation.z = Math.PI / 2;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(4, 0.35, 0.35), heliMat);
  tail.position.set(-3.4, 0.3, 0);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 0.3), mat(0x111111));
  rotor.position.y = 1.35;
  const rotor2 = rotor.clone();
  rotor2.rotation.y = Math.PI / 2;
  const blades = new THREE.Group();
  blades.add(rotor, rotor2);
  const skid = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 1.6), mat(0x111111));
  skid.position.y = -1.3;
  heli.add(hb, tail, blades, skid);
  heli.visible = false;
  scene.add(heli);
  const search = new THREE.SpotLight(0xf2f6ff, 0, 90, 0.16, 0.5, 1);
  search.userData.noMerge = true;
  scene.add(search, search.target);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(5, 45, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  beam.userData.noMerge = true;
  beam.visible = false;
  scene.add(beam);

  // ------------------------------------------------------------ debris
  const N_DEBRIS = 160;
  const debris = inst(new THREE.BoxGeometry(0.35, 0.03, 0.25), mat(0xffffff), N_DEBRIS);
  debris.castShadow = false;
  const debrisColors = [0xeeeeea, 0xd9d2c0, 0xf7d417, 0xc9a46b, 0xb3262e, 0x6b8e5a, 0xff7f1f];
  const debrisPos = [];
  for (let i = 0; i < N_DEBRIS; i++) {
    const r = seeded(i * 104729 + 7);
    const nearAction = r() < 0.5;
    const x = nearAction ? 115 + (r() - 0.5) * 30 : PLAZA.minX + r() * (PLAZA.maxX - PLAZA.minX);
    const z = nearAction ? 22 + (r() - 0.5) * 26 : PLAZA.minZ + r() * (PLAZA.maxZ - PLAZA.minZ);
    debrisPos.push({ x, z, rot: r() * 6.28, s: 0.6 + r() * 1.2, appear: 17 + r() * 6.5 });
    debris.setColorAt(i, color.set(debrisColors[Math.floor(r() * debrisColors.length)]));
  }
  let lastDebrisMinute = -1;

  // ------------------------------------------------------------ helpers
  const tmp = { x: 0, z: 0, dir: 0 };
  const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
  const base = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  // Put part `mesh` of person i at base × (offset, rotation, scale).
  function place(mesh, i, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    e.set(rx, ry, rz);
    local.compose(v.set(x, y, z), q.setFromEuler(e), one.set(sx, sy, sz));
    m.multiplyMatrices(base, local);
    mesh.setMatrixAt(i, m);
  }
  function hideAll(group, i) { for (const k in group) group[k].setMatrixAt(i, HIDDEN); }

  // Tree trunks and other posts the extras must walk around (set by main.js from the map).
  const GRID = 4, obstacleGrid = new Map();
  const cellKey = (x, z) => `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
  function avoidObstacles(a, radius = 0.75) {
    const cx = Math.floor(a.x / GRID), cz = Math.floor(a.z / GRID);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const list = obstacleGrid.get(`${ix},${iz}`);
      if (!list) continue;
      for (const [ox, oz, or] of list) {
        const dx = a.x - ox, dz = a.z - oz, d = Math.hypot(dx, dz), min = radius + or;
        if (d < min) { const k = (d > 0.001 ? (min - d) / d : 1); a.x += (d > 0.001 ? dx : 1) * k; a.z += dz * k; }
      }
    }
  }
  let firstFrame = true; // when you join, everyone starts where they should be (no long walk in)
  let flareSpawn = 0;
  let drumT = 0;
  let lastAmbientGas = -1;
  const state = { centroid: new THREE.Vector3(), crowdCount: 0, flares: [], chantLevel: 0, heliPos: heli.position, drumHit: 0, heliOn: false };

  return {
    state,
    addGas,
    throwGas,
    gasClouds,
    get crowd() { return crowd; },
    get police() { return police; },
    get line() { return line; },

    // Things the extras walk around: [[x, z, radius], ...] (tree trunks, lamp posts, benches).
    setObstacles(list) {
      obstacleGrid.clear();
      for (const o of list) {
        const k = cellKey(o[0], o[1]);
        if (!obstacleGrid.has(k)) obstacleGrid.set(k, []);
        obstacleGrid.get(k).push(o);
      }
    },

    // Where the line is, from the server's snapshots.
    setLine(push, state) {
      linePush = push;
      lineState = state;
      linePushPhase = linePhase(gameMinutes() / 60);
    },
    get lineState() { return linePushPhase && linePushPhase === linePhase(gameMinutes() / 60) ? lineState : null; },

    // A canister the server took away (someone threw it back).
    removeGas(id) {
      const i = gasClouds.findIndex((g) => g.id === id);
      if (i >= 0) { scene.remove(gasClouds[i].can); gasClouds.splice(i, 1); }
    },
    // A fresh canister you could pick up and throw back (protesters).
    canisterNear(x, z) {
      const now = Date.now();
      let best = null, bd = GAS_PICKUP_RANGE;
      for (const g of gasClouds) {
        if (!g.id || now - g.start > GAS_PICKUP_MS) continue;
        const d = Math.hypot(g.x - x, g.z - z);
        if (d < bd) { bd = d; best = g; }
      }
      return best;
    },
    // The crowd hit a police player at (x, z): the nearest extra throws a punch.
    crowdSwing(x, z) {
      let best = null, bd = 6;
      for (const a of crowd) {
        if (!a.visible || a.koUntil > Date.now()) continue;
        const d = Math.hypot(a.x - x, a.z - z);
        if (d < bd) { bd = d; best = a; }
      }
      if (best) { best.punchT = 0; best.rot = Math.atan2(x - best.x, z - best.z); }
    },

    // An extra was hit (by anyone, relayed by the server): they fall over for a few seconds.
    knockDown(i, kx, kz) {
      const a = i >= 1000 ? police[i - 1000] : crowd[i]; // >= 1000 = a police extra
      if (!a || !a.visible) return;
      a.koUntil = Date.now() + KO_TIME;
      a.kx = kx * 4;
      a.kz = kz * 4;
    },

    // The police line hit someone at (x, z): the nearest officer swings his baton.
    lineSwing(x, z) {
      let best = null, bd = 6;
      for (const c of police) {
        if (!c.visible) continue;
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) best.swingT = 0;
    },

    // The extra closest to (x, z) in front of `facing` within `range` (for your own hits).
    // Protesters hit police extras (returned as 1000 + index), police hit protester extras.
    findExtra(x, z, facing, range, myFaction = 'c') {
      const fx = Math.sin(facing), fz = Math.cos(facing);
      let best = -1, bd = range;
      const list = myFaction === 'g' ? police : crowd;
      list.forEach((a, i) => {
        if (!a.visible || a.koUntil > Date.now()) return;
        const dx = a.x - x, dz = a.z - z, d = Math.hypot(dx, dz);
        if (d < bd && (d < 0.3 || (dx * fx + dz * fz) / d > 0.35)) { bd = d; best = myFaction === 'g' ? 1000 + i : i; }
      });
      return best;
    },

    // daylight: 0 (night) .. 1 (day). others: [{x, z}] players to step around.
    update(dt, localFaction, daylight = 1, others = []) {
      const now = Date.now();
      const minutes = gameMinutes(now);
      const h = minutes / 60;
      const phase = phaseAt(minutes);
      const tReal = now / 1000;
      light = 0.3 + 0.7 * daylight;
      // The server tells us how far the line has got (only during the clashes / curfew sweep).
      const lp = linePhase(h);
      line = policeLine(h, lp && lp === linePushPhase ? linePush : null);

      // ---- the brawl: who wants to be where right now (worked out from the clock,
      //      so every player sees the same fights)
      const CENTERS = meleeCenters(tReal); // 0 = around the statue, 1 = east, 2 = west
      const inPlazaClamp = (p) => {
        p.x = Math.max(PLAZA.minX + 2, Math.min(PLAZA.maxX - 2, p.x));
        p.z = Math.max(PLAZA.minZ + 2, Math.min(PLAZA.maxZ - 2, p.z));
        const d = Math.hypot(p.x, p.z);
        if (d < 10.5) { const k = 10.5 / (d || 1); p.x *= k; p.z *= k; } // around the monument, not through it
        return p;
      };
      // Pair j: protester j fights officer LINE_COPS + (j % FIGHT_COPS).
      const pairs = [];
      for (let j = 0; j < FIGHTERS; j++) {
        const r = seeded(j * 977 + 5);
        const phi = r() * 6.28, phi2 = r() * 6.28, spin = (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.35);
        const H = CENTERS[j % 3];
        const drift = (r() - 0.5) * (H.ring ? 0.12 : 0.06);
        const theta = r() * 6.28 + tReal * drift + 0.6 * Math.sin(tReal * 0.13 + phi);
        // Around the statue: on a ring 11-20 m from its centre. Elsewhere: anywhere in the fight.
        const R = H.ring ? 11.5 + r() * 8 + 1.5 * Math.sin(tReal * 0.2 + phi2) : 2 + r() * MELEE_RADIUS + 2 * Math.sin(tReal * 0.2 + phi2);
        let ax = H.x + Math.cos(theta) * R, az = H.z + Math.sin(theta) * R * (H.ring ? 0.95 : 0.8);
        // Every ~25 s a pair breaks into a chase: they run off ~10 m and come back.
        const period = 25, slot = Math.floor((tReal + phi * 4) / period), u = ((tReal + phi * 4) % period) / 5;
        if (u < 1) {
          const rr = seeded(j * 131 + slot);
          const dir = rr() * 6.28;
          const run = Math.sin(Math.PI * u) * 10;
          ax += Math.cos(dir) * run; az += Math.sin(dir) * run;
        }
        const psi = phi + tReal * spin;                        // they circle each other
        const gap = 1.15 + 0.4 * Math.sin(tReal * 2.3 + phi);  // lunging in and out
        const P0 = inPlazaClamp({ x: ax - Math.sin(psi) * gap / 2, z: az - Math.cos(psi) * gap / 2 });
        const P1 = inPlazaClamp({ x: ax + Math.sin(psi) * gap / 2, z: az + Math.cos(psi) * gap / 2 });
        // Knock-downs: in some 20 s slots one of the two goes down for 4 s.
        const ks = Math.floor(tReal / 20), kr = seeded(j * 7349 + ks), roll = kr(), when = kr() * 14, inSlot = tReal - ks * 20;
        const down = inSlot > when && inSlot < when + 4 ? (roll < 0.22 ? 'g' : roll < 0.4 ? 'c' : null) : null;
        pairs.push({ g: P0, c: P1, psi, phi, down });
      }

      // ---- crowd: steer towards those spots, keep apart, animate
      let cx = 0, cz = 0, count = 0;
      const turn = 1 - Math.exp(-5 * dt);
      for (let i = 0; i < NC; i++) {
        const a = crowd[i];
        a.visible = true;
        const ko = a.koUntil > now;
        let target;
        if (i < FIGHTERS) {
          const pr = pairs[i];
          target = { x: pr.g.x, z: pr.g.z, face: pr.psi, fight: true, down: pr.down === 'g', winner: pr.down === 'c', phi: pr.phi };
        } else {
          // Around the brawl: shouting, surging in and out, waving placards.
          const r = seeded(i * 7919 + 13);
          const ang = r() * 6.28 + tReal * (r() - 0.5) * 0.05;
          const H = CENTERS[i % 3];
          const rad = (H.ring ? 21 : MELEE_RADIUS + 3) + r() * 7 - 3 * Math.max(0, Math.sin(tReal * 0.6 + a.phase));
          target = inPlazaClamp({ x: H.x + Math.cos(ang) * rad, z: H.z + Math.sin(ang) * rad * (H.ring ? 0.95 : 0.8) });
          target.face = Math.atan2(H.x - target.x, H.z - target.z);
          // The second banner carrier walks 2.3 m beside the first one, so the banner stays stretched between them.
          const bp = BANNER_PAIRS.find((pair) => pair[1] === i);
          if (bp) {
            const T = crowd[bp[0]].target, f = T.face;
            target = inPlazaClamp({ x: T.x + Math.cos(f) * 2.3, z: T.z - Math.sin(f) * 2.3 });
            target.face = f;
          }
        }
        if (firstFrame) { a.x = target.x; a.z = target.z; }
        if (ko) {
          a.x += a.kx * dt; a.z += a.kz * dt;
          a.kx *= Math.exp(-5 * dt); a.kz *= Math.exp(-5 * dt);
          a.moving = 0;
        } else {
          const dx = target.x - a.x, dz = target.z - a.z;
          const dist = Math.hypot(dx, dz);
          let step = 0;
          if (dist > 0.08) {
            // Walk when close, run when far (max ~6.5 m/s), never teleport.
            const speed = Math.min(6.5, 0.6 + dist * 2.2) * (a.speed / 1.4);
            step = Math.min(dist, speed * dt);
            a.x += (dx / dist) * step; a.z += (dz / dist) * step;
          }
          const v = step / Math.max(dt, 1e-4);
          a.moving += ((v > 0.4 ? Math.min(1.6, v / 2.2) : 0) - a.moving) * Math.min(1, dt * 8);
          a.stride += step * 3.4;
          // Face where you walk when moving fast, otherwise face your opponent / the brawl.
          a.rot += angleDiff(v > 2 ? Math.atan2(dx, dz) : target.face, a.rot) * turn;
        }
        a.target = target;
        count++; cx += a.x; cz += a.z;
      }
      // Keep apart from each other and from players (step aside instead of walking through).
      for (let i = 0; i < NC; i++) {
        const a = crowd[i];
        for (let j = i + 1; j < NC; j++) {
          const b = crowd[j];
          const dx = a.x - b.x, dz = a.z - b.z;
          if (Math.abs(dx) > 0.7 || Math.abs(dz) > 0.7) continue;
          const d = Math.hypot(dx, dz);
          if (d > 0.001 && d < 0.7) {
            const push = (0.7 - d) * 0.5;
            a.x += (dx / d) * push; a.z += (dz / d) * push;
            b.x -= (dx / d) * push; b.z -= (dz / d) * push;
          }
        }
        for (const o of others) {
          const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz);
          if (d > 0.001 && d < 0.8) { a.x += (dx / d) * (0.8 - d); a.z += (dz / d) * (0.8 - d); }
        }
        avoidObstacles(a); // walk around trees and lamp posts, not through them
      }

      // A swing every ~1.3 s, worked out from the clock: 0 = arm resting, wind up, smash.
      const swingArm = (t, rest) => {
        const s = ((t % 1.3) + 1.3) % 1.3 / 1.3;
        if (s < 0.18) return rest - (s / 0.18) * 2.6;
        if (s < 0.32) return rest - 2.6 + ((s - 0.18) / 0.14) * 2.6;
        return rest;
      };

      // Draw every extra.
      for (let i = 0; i < NC; i++) {
        const a = crowd[i];
        const tg = a.target;
        const ko = a.koUntil > now || tg.down;
        const swing = Math.sin(a.stride) * 0.55 * Math.min(1, a.moving);
        const bob = Math.abs(Math.cos(a.stride)) * 0.06 * Math.min(1, a.moving);
        const jump = !ko && !tg.fight && a.moving < 0.2 && Math.sin(tReal * 3 + a.phase * 3) > 0.9 ? 0.18 : 0;
        const lean = !ko && a.moving > 1 ? 0.22 : 0; // lean forward when running
        // Lying on the ground when knocked out (rotated 90° backwards).
        base.compose(v.set(a.x, (ko ? 0.2 : bob + jump), a.z), q.setFromEuler(e.set(ko ? -Math.PI / 2 : lean, a.rot, 0, 'YXZ')), one.set(a.wide, a.height, a.wide));
        e.order = 'XYZ';
        const raise = a.sign && !tg.fight && !ko; // holding the placard up
        const pump = !tg.fight && !ko && a.moving < 0.2 ? Math.max(0, Math.sin(tReal * 2.4 + a.phase)) * 0.6 : 0;
        place(C.legL, i, 0.1, 0.86, 0, swing);
        place(C.legR, i, -0.1, 0.86, 0, -swing);
        place(C.torso, i, 0, 1.12, 0);
        if (a.vest) place(C.vest, i, 0, 1.13, 0); else C.vest.setMatrixAt(i, HIDDEN);
        place(C.head, i, 0, 1.56, 0.01);
        place(C.hair, i, 0, 1.585, -0.01);
        let armR = -swing * 0.8 - pump * 2.6;
        if (tg.fight && !ko) armR = tg.winner ? -2.9 : swingArm(tReal + tg.phi, -0.5); // fighting (or cheering a win)
        if (a.punchT >= 0) { // hitting a police player: wind up, smash down
          a.punchT += dt;
          const t = a.punchT / 0.45;
          armR = t < 0.4 ? -(t / 0.4) * 2.8 : -2.8 + ((t - 0.4) / 0.6) * 2.8;
          if (t >= 1) a.punchT = -1;
        }
        place(C.armR, i, -0.27, 1.38, 0, armR, 0, -0.08);
        if ((!a.sign || tg.fight) && (a.vest || a.bloc)) place(C.bread, i, -0.27, 1.38, 0, armR, 0, -0.08); // swinging a baguette
        else C.bread.setMatrixAt(i, HIDDEN);
        if (raise) {
          // Left arm up holding the stick and the sign above the head (or a flag on a taller pole).
          place(C.armL, i, 0.27, 1.38, 0, -Math.PI + 0.25, 0, 0.1);
          if (a.flagger) {
            place(C.stick, i, 0.3, 2.4, 0.08, 0, 0, 0, 1, 1.5, 1);
            place(C.flag, i, 0.3, 3.0, 0.08, 0, Math.sin(tReal * 3 + a.phase) * 0.35, 0);
            C.sign.setMatrixAt(i, HIDDEN);
          } else {
            place(C.stick, i, 0.3, 2.05, 0.08);
            place(C.sign, i, 0.3, 2.55, 0.08, 0, Math.sin(tReal * 1.5 + a.phase) * 0.15);
            C.flag.setMatrixAt(i, HIDDEN);
          }
        } else {
          C.flag.setMatrixAt(i, HIDDEN);
          place(C.armL, i, 0.27, 1.38, 0, tg.fight && !ko ? -0.9 : swing * 0.8, 0, 0.08); // guard up when fighting
          C.stick.setMatrixAt(i, HIDDEN);
          C.sign.setMatrixAt(i, HIDDEN);
        }
        // Red flares around the brawl, all day.
        const burning = a.flare && !ko && Math.sin(tReal * 0.05 + a.phase) > -0.3;
        if (burning) {
          place(flares, i, -0.3, 2.0 + Math.random() * 0.05, 0.2, 0, 0, 0, 1.3, 1.3, 1.3);
        } else flares.setMatrixAt(i, HIDDEN);
      }
      // Banners between pairs of carriers: only while both are walking close together and on their feet.
      if (BANNER_PAIRS.length) {
        const flagBase = new THREE.Matrix4();
        BANNER_PAIRS.forEach(([ia, ib], k) => {
          const A = crowd[ia], B = crowd[ib];
          const mesh = bannerMeshes[k % bannerMeshes.length], slot = Math.floor(k / bannerMeshes.length);
          const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz);
          const show = d < 6 && A.koUntil <= now && B.koUntil <= now && !A.target.fight && !B.target.fight && !A.target.down && !B.target.down;
          if (!show) {
            mesh.setMatrixAt(slot, HIDDEN);
            bannerPoles.setMatrixAt(k * 2, HIDDEN); bannerPoles.setMatrixAt(k * 2 + 1, HIDDEN);
            return;
          }
          const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, yaw = Math.atan2(dx, dz) - Math.PI / 2; // plane faces along the walking direction
          const width = Math.max(1.4, d + 0.4);
          flagBase.compose(v.set(mx, 2.55 + Math.sin(tReal * 2 + k) * 0.03, mz), q.setFromEuler(e.set(0, yaw, 0)), one.set(width, 1, 1));
          mesh.setMatrixAt(slot, flagBase);
          for (const [n, P] of [[0, A], [1, B]]) {
            flagBase.compose(v.set(P.x, 1.75, P.z), q.identity(), one.set(1, 1.5, 1));
            bannerPoles.setMatrixAt(k * 2 + n, flagBase);
          }
        });
        for (const mesh of bannerMeshes) mesh.instanceMatrix.needsUpdate = true;
        bannerPoles.instanceMatrix.needsUpdate = true;
      }
      for (const k in C) C[k].instanceMatrix.needsUpdate = true;
      if (C.flag.instanceColor) C.flag.instanceColor.needsUpdate = true;
      flares.instanceMatrix.needsUpdate = true;
      state.crowdCount = count;
      if (count) state.centroid.set(cx / count, 0, cz / count);

      // ---- police: a shield line (when the timeline has one) + officers brawling in the middle
      const ca = Math.cos(line.a), sa = Math.sin(line.a);
      const nLine = Math.round(line.active * LINE_COPS);
      const perRow = Math.ceil(nLine / ROWS);
      const spacing = line.len / Math.max(1, perRow);
      const faceRot = Math.atan2(line.fx, line.fz);
      for (let i = 0; i < N_POLICE; i++) {
        const c = police[i];
        c.visible = true;
        let tx, tz, face, fight = null;
        if (i < LINE_COPS) {
          if (i < nLine) {
            const row = i % ROWS, k = Math.floor(i / ROWS);
            const off = -line.len / 2 + spacing * (k + 0.5) + (row ? spacing / 2 : 0);
            const back = row * 1.4;
            tx = line.x + ca * off - line.fx * back;
            tz = line.z + sa * off - line.fz * back;
            face = faceRot;
            c.inLine = row === 0;
          } else {
            // Off duty from the line: reinforcements standing on the edge of the brawl.
            const ang = (i / LINE_COPS) * 6.28 + tReal * 0.02;
            const H = CENTERS[i % 3], rad = H.ring ? 22 : MELEE_RADIUS + 2;
            const p = inPlazaClamp({ x: H.x + Math.cos(ang) * rad, z: H.z + Math.sin(ang) * rad * 0.8 });
            tx = p.x; tz = p.z; face = Math.atan2(H.x - tx, H.z - tz);
            c.inLine = false;
          }
        } else {
          // Brawling: opposite the protester of pair (i - LINE_COPS).
          const pr = pairs[i - LINE_COPS];
          tx = pr.c.x; tz = pr.c.z; face = pr.psi + Math.PI;
          fight = pr;
          c.inLine = false;
        }
        if (firstFrame) { c.x = tx; c.z = tz; }
        const ko = c.koUntil > now || fight?.down === 'c';
        const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
        let step = 0;
        if (!ko && dist > 0.08) {
          const speed = Math.min(6, 0.6 + dist * 2.2);
          step = Math.min(dist, speed * dt);
          c.x += (dx / dist) * step; c.z += (dz / dist) * step;
        }
        avoidObstacles(c, 0.8);
        const vel = step / Math.max(dt, 1e-4);
        c.moving += ((vel > 0.4 ? Math.min(1.6, vel / 2.2) : 0) - c.moving) * Math.min(1, dt * 8);
        c.stride += step * 3.3;
        c.rot += angleDiff(vel > 2 ? Math.atan2(dx, dz) : face, c.rot) * turn;
        // Swings: the brawlers all the time, the front row of the line during the clashes, plus real hits from the server.
        if (c.swingT < 0 && c.inLine && phase.id === 'clashes' && Math.random() < dt * 0.15) c.swingT = 0;
        let batonArm = -0.35;
        if (fight && !ko) batonArm = fight.down === 'g' ? -2.9 : swingArm(tReal + fight.phi + 0.65, -0.35);
        if (c.swingT >= 0) {
          c.swingT += dt;
          const t = c.swingT / 0.45;
          batonArm = t < 0.4 ? -0.35 - (t / 0.4) * 2.4 : -2.75 + ((t - 0.4) / 0.6) * 2.4;
          if (t >= 1) c.swingT = -1;
        }
        const swing = Math.sin(c.stride) * 0.5 * Math.min(1, c.moving);
        const stomp = c.inLine && phase.id === 'clashes' && c.moving < 0.2 ? Math.max(0, Math.sin(tReal * 2 + c.phase)) * 0.04 : 0;
        base.compose(v.set(c.x, ko ? 0.22 : stomp, c.z), q.setFromEuler(e.set(ko ? -Math.PI / 2 : c.moving > 1 ? 0.2 : 0, c.rot, 0, 'YXZ')), one.set(1.08, 1.02, 1.08));
        e.order = 'XYZ';
        place(P.legL, i, 0.1, 0.86, 0, swing);
        place(P.legR, i, -0.1, 0.86, 0, -swing);
        place(P.torso, i, 0, 1.12, 0, 0, 0, 0, 1.1, 1.05, 1.15);
        place(P.head, i, 0, 1.56, 0.01);
        place(P.helmet, i, 0, 1.6, 0);
        // Not every officer looks the same: some have the visor up, some brawlers carry no shield.
        if (i % 3 === 1) place(P.visor, i, 0, 1.72, 0.1, -1.1); else place(P.visor, i, 0, 1.55, 0.135, -0.15);
        if (!c.inLine && i % 4 === 2) {
          place(P.armL, i, 0.27, 1.38, 0, swing * 0.8, 0, 0.08);
          P.shield.setMatrixAt(i, HIDDEN);
        } else {
          place(P.armL, i, 0.27, 1.38, 0, -1.1, 0, 0.25);               // holding the shield forward
          place(P.shield, i, 0.12, 1.05, 0.42, 0, -0.15);
        }
        place(P.armR, i, -0.27, 1.38, 0, batonArm, 0, -0.1);
        place(P.baton, i, -0.27, 1.38, 0, batonArm, 0, -0.1);
      }
      for (const k in P) P[k].instanceMatrix.needsUpdate = true;
      firstFrame = false;

      // Smoke bombs going off in the brawl (visual only).
      if (Math.random() < dt * 0.5) {
        const H = CENTERS[Math.floor(Math.random() * 3)];
        const ang = Math.random() * 6.28, rr = (H.ring ? 12 : 0) + Math.random() * MELEE_RADIUS;
        state.smoke = { x: H.x + Math.cos(ang) * rr, z: H.z + Math.sin(ang) * rr * 0.8, until: now + 6000 };
      }
      if (state.smoke && now < state.smoke.until && Math.random() < dt * 8) {
        puff(state.smoke.x, 0.3, state.smoke.z, { vy: 1.2, vx: WIND.x * 2, vz: WIND.z * 2, life: 5, size0: 0.8, size1: 4.5, alpha: 0.28, tint: 0x9a9a9a });
      }

      // The invisible wall follows the front row. Police players walk through their own line.
      lineCollider.setHalfExtents({ x: line.len / 2, y: 1, z: 0.7 });
      lineBody.setNextKinematicTranslation({ x: line.x, y: 1, z: line.z });
      lineBody.setNextKinematicRotation({ x: 0, y: Math.sin(-line.a / 2), z: 0, w: Math.cos(-line.a / 2) });
      lineCollider.setEnabled(localFaction !== 'c' && line.active > 0.5);

      // (Tear gas fired by the line comes from the server, so protesters can throw it back.)

      // ---- gas clouds -> lots of soft, low, slowly spreading puffs
      for (let k = gasClouds.length - 1; k >= 0; k--) {
        const g = gasClouds[k];
        if (now > g.end) { scene.remove(g.can); gasClouds.splice(k, 1); continue; }
        const age = (now - g.start) / GAS_DURATION_MS;
        // The canister hisses a jet of smoke at first, then the cloud just lingers.
        g.acc += dt * (age < 0.6 ? (lowQuality ? 7 : 16) : 4);
        while (g.acc > 1) {
          g.acc -= 1;
          const spread = GAS_RADIUS * (0.15 + Math.min(1, age * 1.8) * 0.85);
          const r = spread * Math.sqrt(Math.random());
          const ang = Math.random() * 6.28;
          const fresh = age < 0.15;
          puff(g.x + Math.cos(ang) * r, 0.3 + Math.random() * 0.6, g.z + Math.sin(ang) * r, {
            vx: Math.cos(ang) * 0.35 + WIND.x, vy: fresh ? 0.6 : 0.18, vz: Math.sin(ang) * 0.35 + WIND.z,
            life: 5 + Math.random() * 2, size0: 1.0, size1: 4.2 + Math.random() * 1.6, alpha: 0.32, tint: 0xeef0e6,
          });
        }
      }

      // ---- flares and smoke bombs
      state.flares.length = 0;
      flareSpawn += dt;
      if (flareSpawn > (lowQuality ? 0.2 : 0.09)) {
        flareSpawn = 0;
        for (const a of crowd) {
          if (!a.visible || !a.flare || a.koUntil > now || !(phase.id === 'march' || phase.id === 'clashes') || Math.sin(tReal * 0.05 + a.phase) <= -0.3) continue;
          const fx = a.x + Math.sin(a.rot - 1.5) * 0.3, fz = a.z + Math.cos(a.rot - 1.5) * 0.3;
          puff(fx, 2.0, fz, { vy: 1.0, vx: WIND.x, vz: WIND.z, life: 2.6, size0: 0.35, size1: 2.2, alpha: 0.45, tint: 0xff7060 });
          state.flares.push(new THREE.Vector3(fx, 2, fz));
        }
        if (h >= 17 && h < 23.5) {
          for (const [x, z] of SMOKE_SPOTS) if (Math.random() < 0.45) puff(x, 0.3, z, { vy: 1.4, vx: WIND.x * 2, vz: WIND.z * 2, life: 6, size0: 0.8, size1: 5.5, alpha: 0.3, tint: 0x9a9a9a });
        }
      }
      if (state.flares.length) {
        flareLight.position.copy(state.flares[0]);
        flareLight.intensity = 6 + Math.random() * 4;
      } else flareLight.intensity = 0;

      for (const p of puffs) {
        if (!p.sprite.visible) continue;
        p.life += dt;
        if (p.life >= p.max) { p.sprite.visible = false; continue; }
        const t = p.life / p.max;
        p.sprite.position.x += p.vx * dt;
        p.sprite.position.y += p.vy * dt;
        p.sprite.position.z += p.vz * dt;
        p.vx *= 1 - dt * 0.3; p.vz *= 1 - dt * 0.3;
        p.sprite.material.rotation += p.spin * dt;
        p.sprite.scale.setScalar(p.size0 + (p.size1 - p.size0) * Math.sqrt(t));
        p.sprite.material.opacity = p.alpha * Math.min(1, t * 5) * (1 - t) * (1 - t * 0.3);
        p.sprite.material.color.copy(p.tint).multiplyScalar(light);
      }

      // ---- flying canisters (with a thin smoke trail)
      for (let k = flying.length - 1; k >= 0; k--) {
        const f = flying[k];
        f.t += dt / 0.9;
        const t = Math.min(1, f.t);
        f.mesh.position.lerpVectors(f.from, f.to, t);
        f.mesh.position.y += Math.sin(t * Math.PI) * 5;
        f.mesh.rotation.x += dt * 12;
        f.trail += dt;
        if (f.trail > 0.03) { f.trail = 0; puff(f.mesh.position.x, f.mesh.position.y, f.mesh.position.z, { vy: 0.1, life: 1.4, size0: 0.25, size1: 1.1, alpha: 0.4, tint: 0xf2f2ec }); }
        if (f.t >= 1) { scene.remove(f.mesh); flying.splice(k, 1); f.onLand?.(); }
      }

      // ---- helicopter: from the march until the end of the curfew
      const heliOn = h >= 14 || h < 6;
      heli.visible = heliOn;
      if (heliOn) {
        const ang = tReal * 0.07;
        const focus = phase.id === 'clashes' ? { x: line.x, z: line.z } : phase.id === 'march' ? { x: -60, z: -28 } : { x: 0, z: -10 };
        heli.position.set(focus.x + Math.cos(ang) * 45, 48, focus.z + Math.sin(ang) * 35);
        heli.rotation.y = -ang;
        blades.rotation.y += dt * 30;
        const night = h >= 20.5 || h < 6.5;
        search.intensity = night ? 900 : 0;
        beam.visible = night;
        if (night) {
          search.position.copy(heli.position);
          const tx = focus.x + Math.sin(tReal * 0.3) * 14, tz = focus.z + Math.cos(tReal * 0.23) * 10;
          search.target.position.set(tx, 0, tz);
          search.target.updateMatrixWorld();
          beam.position.set((heli.position.x + tx) / 2, 24, (heli.position.z + tz) / 2);
          beam.lookAt(tx, 0, tz);
          beam.rotateX(-Math.PI / 2);
        }
      } else { search.intensity = 0; beam.visible = false; }
      state.heliOn = heliOn;

      // ---- debris (updated once per game minute)
      const minuteKey = Math.floor(minutes);
      if (minuteKey !== lastDebrisMinute) {
        lastDebrisMinute = minuteKey;
        const hh = h < 6 ? h + 24 : h;
        for (let i = 0; i < N_DEBRIS; i++) {
          const d = debrisPos[i];
          if (hh < d.appear || hh < 17) { debris.setMatrixAt(i, HIDDEN); continue; }
          base.identity();
          place(debris, i, d.x, 0.06, d.z, 0, d.rot, 0, d.s, 1, d.s);
        }
        debris.instanceMatrix.needsUpdate = true;
      }

      // ---- drums while the crowd gathers / marches
      state.chantLevel = 0.9; // the brawl never stops
      state.drumHit = 0;
      {
        drumT += dt;
        if (drumT > 0.45) { drumT -= 0.45; state.drumBeat = ((state.drumBeat || 0) + 1) % 8; state.drumHit = [1, 0, 2, 0, 1, 1, 2, 0][state.drumBeat]; }
      }
    },

    // Push the local player out of the police line if it walked into them (e.g. while the line advances).
    keepOut(position, faction) {
      if (faction === 'c' || line.active <= 0.5) return null;
      const ca = Math.cos(line.a), sa = Math.sin(line.a);
      const dx = position.x - line.x, dz = position.z - line.z;
      const u = dx * ca + dz * sa;              // along the line
      const w = dx * line.fx + dz * line.fz;    // in front (+) / behind (-)
      if (Math.abs(u) > line.len / 2 + 0.3 || w > 1.2 || w < -2.4) return null;
      const push = 1.25 - w;
      return { x: line.fx * push, z: line.fz * push };
    },

    // How much tear gas is around this point right now (0..1).
    gasAt(x, z) {
      if (inSafeZone(x, z)) return 0; // the bases are safe
      const now = Date.now();
      let worst = 0;
      for (const g of gasClouds) {
        const age = (now - g.start) / GAS_DURATION_MS;
        const radius = GAS_RADIUS * (0.4 + Math.min(1, age * 2) * 0.8);
        const gx = g.x + WIND.x * age * 4, gz = g.z + WIND.z * age * 4; // drifts with the wind
        const d = Math.hypot(x - gx, z - gz);
        if (d < radius) worst = Math.max(worst, (1 - d / radius) * (1 - Math.max(0, age - 0.7) / 0.3));
      }
      return Math.min(1, worst * 1.6);
    },
  };
}
