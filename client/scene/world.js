// client/scene/world.js
// Builds the REAL Place de la République and the streets around it, from
// OpenStreetMap data (scripts/build-map.py -> mapData.json, © OpenStreetMap contributors):
//   - ground: pavements everywhere, asphalt roads with kerbs, the paved square
//   - every building with its real outline, as a Haussmann block (haussmann.js)
//   - the real trees, street lamps, benches, Wallace fountains, métro entrances
//     and café terraces (at the real cafés, e.g. Café République)
//   - the Monument à la République (Marianne, the three seated statues, the lion)
// Every solid thing gets BOTH a mesh (what you see) and a Rapier collider.
//
// Returns { nightMaterials, lamps }.

import * as THREE from 'three';
import { WORLD, BASES } from '../../shared/constants.js';
import { LOW_QUALITY } from '../quality.js';
import { createHaussmannBuilder } from './haussmann.js';
import { paving, asphalt } from './textures.js';
import { addWallaceFountain, addMetroEntrance, addBench, addTerrace } from './streetFurniture.js';
import MAP from './mapData.json';

// Seeded random numbers: every player must get the SAME world.
function seededRandom(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });
const M = {
  stone: mat(0xd2cbbb),
  bronze: mat(0x4f5b44, { roughness: 0.6, metalness: 0.4 }),
  trunk: mat(0x8c7d63),
  leaves: [mat(0x5c8a3a), mat(0x4f7d33), mat(0x6a9443)],
  kerb: mat(0xb9b3a6),
};

// "decimetre" flat arrays from the map -> [[x, z], ...] in metres
const ringOf = (flat) => { const r = []; for (let i = 0; i < flat.length; i += 2) r.push([flat[i] / 10, flat[i + 1] / 10]); return r; };
const nearBase = (x, z, extra) => Object.values(BASES).some((b) => Math.hypot(x - b.x, z - b.z) < b.r + extra);

// A flat polygon with holes as a mesh lying on the ground at height y.
// UVs are world metres / tile, so textures keep their real size.
function groundPolygon(polys, material, y, tile) {
  const geos = [];
  for (const { o, h } of polys) {
    // Shape coordinates (x, -z) + rotateX(-90°) = lying flat, facing up.
    const shape = new THREE.Shape(ringOf(o).map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const hole of h) shape.holes.push(new THREE.Path(ringOf(hole).map(([x, z]) => new THREE.Vector2(x, -z))));
    const g = new THREE.ShapeGeometry(shape);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    geos.push(g);
  }
  const meshes = geos.map((g) => {
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  });
  return meshes;
}

export function buildWorld(scene, physics) {
  const rand = seededRandom(1789); // a very French seed

  // Helpers: box / cylinder mesh + matching collider. (x,z) = centre on the ground.
  function box(x, z, w, h, d, material, { y = h / 2, collide = true, shadow = true } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (collide) physics.addBox(x, y, z, w / 2, h / 2, d / 2);
    return mesh;
  }
  function cylinder(x, z, radius, h, material, { y = h / 2, segments = 10, collide = true, top = radius } = {}) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, radius, h, segments), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (collide) physics.addCylinder(x, y, z, h / 2, radius);
    return mesh;
  }

  // ---------------------------------------------------------------- ground
  // Pavement (light stone slabs) everywhere; roads and the square drawn on top.
  const GX = WORLD.halfX + 120, GZ = WORLD.halfZ + 120;
  const pave = paving();
  const texMat = (t, tile, extra) => {
    const p = { map: t.map.clone(), normalMap: t.normalMap.clone() };
    for (const x of Object.values(p)) { x.repeat.set(1, 1); x.needsUpdate = true; }
    return new THREE.MeshStandardMaterial({ ...p, roughness: 0.92, ...extra });
  };
  const pavementTex = { map: pave.map.clone(), normalMap: pave.normalMap.clone() };
  for (const t of Object.values(pavementTex)) { t.repeat.set(GX / 2, GZ / 2); t.needsUpdate = true; }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GX * 2, GZ * 2), new THREE.MeshStandardMaterial({ ...pavementTex, color: 0xd6d1c6, roughness: 0.92 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  physics.addBox(0, -1, 0, GX, 1, GZ); // top surface at y = 0

  // Roads (asphalt, 1 tile = 8 m) + a low kerb along their edges.
  const roadMat = texMat(asphalt(), 8, { roughness: 0.95 });
  for (const m of groundPolygon(MAP.roads, roadMat, 0.02, 8)) scene.add(m);
  addKerbs(scene, MAP.roads);

  // The square and the other pedestrian areas (nicer paving, 1 tile = 4 m).
  const squareMat = texMat(pave, 4, { color: 0xe6e0d2 });
  for (const m of groundPolygon(MAP.pedestrian, squareMat, 0.04, 4)) scene.add(m);

  // ------------------------------------------------------------- buildings
  const builder = createHaussmannBuilder(scene, physics, rand);
  for (const b of MAP.buildings) builder.addFootprint(ringOf(b.p), b.t / 10, b.f);
  const nightMaterials = builder.finish();

  // ------------------------------------------------------------ the trees
  // Plane trees: pale trunk + 3 leaf blobs. Instanced = 3 draw calls for 500 trees.
  const trees = [];
  for (let i = 0; i < MAP.trees.length; i += 3) {
    const x = MAP.trees[i] / 10, z = MAP.trees[i + 1] / 10;
    if (Math.hypot(x, z) < 11 || nearBase(x, z, 1.5)) continue;
    if (LOW_QUALITY && Math.hypot(x, z) > 170) continue;
    trees.push([x, z, MAP.trees[i + 2] || 12 + rand() * 6]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunks = new THREE.InstancedMesh(trunkGeo, M.trunk, trees.length);
  const leaves = M.leaves.map((m) => new THREE.InstancedMesh(leafGeo, m, trees.length));
  const dummy = new THREE.Object3D();
  trees.forEach(([x, z, h], i) => {
    const trunkH = Math.max(5.2, h * 0.5); // Paris plane trees: tall bare trunks, crown high up
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, trunkH, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    const crown = Math.max(2.6, h * 0.24);
    leaves.forEach((inst, k) => {
      dummy.position.set(x + (rand() - 0.5) * crown * 1.2, trunkH + crown * (0.75 + k * 0.4), z + (rand() - 0.5) * crown * 1.2);
      dummy.scale.setScalar(crown * (0.85 + rand() * 0.35));
      dummy.rotation.set(rand() * 3, rand() * 3, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    physics.addCylinder(x, 1.5, z, 1.5, 0.3);
  });
  for (const m of [trunks, ...leaves]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
  }

  // ------------------------------------------------------- street furniture
  const each = (arr, step, fn) => { for (let i = 0; i < arr.length; i += step) fn(arr[i] / 10, arr[i + 1] / 10, i); };
  each(MAP.benches, 2, (x, z) => { if (!nearBase(x, z, 1)) addBench(scene, physics, x, z, 0); });
  each(MAP.fountains, 2, (x, z) => addWallaceFountain(scene, physics, x, z));
  each(MAP.metro, 2, (x, z) => addMetroEntrance(scene, physics, x, z, Math.abs(z) < 30 && Math.abs(x) < 120 ? Math.PI / 2 : 0));
  for (const [x, z, rot, name, width] of MAP.cafes) {
    if (Math.hypot(x / 10, z / 10) < (LOW_QUALITY ? 120 : 220)) addTerrace(scene, physics, x / 10, z / 10, rot, name, width);
  }
  const lamps = [];
  each(MAP.lamps, 2, (x, z) => { if (!nearBase(x, z, 0.5)) lamps.push([x, z]); });

  // --------------------------------------------------------------- monument
  buildMonument(scene, physics, box, cylinder);

  // ---------------------------------------------------------- invisible walls
  // Stop players from walking off the edge of the map (down the long streets).
  const X = WORLD.halfX, Z = WORLD.halfZ;
  physics.addBox(0, 10, Z + 1, X + 2, 10, 1);
  physics.addBox(0, 10, -Z - 1, X + 2, 10, 1);
  physics.addBox(X + 1, 10, 0, 1, 10, Z + 2);
  physics.addBox(-X - 1, 10, 0, 1, 10, Z + 2);

  // Sky colour + fog for depth (dayNight.js changes them over the day).
  scene.background = new THREE.Color(0xaecbe6);
  scene.fog = new THREE.Fog(0xaecbe6, 110, 340);

  // Posts the background crowd walks around: tree trunks, lamp posts, benches.
  const obstacles = [...trees.map(([x, z]) => [x, z, 0.4]), ...lamps.map(([x, z]) => [x, z, 0.15])];
  each(MAP.benches, 2, (x, z) => obstacles.push([x, z, 1.1]));
  // Rain: the ground gets darker and shinier (and back again).
  const wetList = [ground.material, roadMat, squareMat].map((m) => ({ m, rough: m.roughness, color: m.color.clone() }));
  let wetNow = -1;
  const setWet = (w) => {
    w = Math.round(w * 50) / 50;
    if (w === wetNow) return;
    wetNow = w;
    for (const { m, rough, color } of wetList) {
      m.roughness = rough * (1 - 0.6 * w);
      m.color.copy(color).multiplyScalar(1 - 0.28 * w);
    }
  };
  return { nightMaterials, lamps, obstacles, setWet };
}

// Low stone kerbs along the edges of the roads (visual only; you can step over them).
function addKerbs(scene, polys) {
  const segs = [];
  for (const { o, h } of polys) {
    for (const flat of [o, ...h]) {
      const r = ringOf(flat);
      for (let i = 0; i < r.length; i++) {
        const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % r.length];
        const len = Math.hypot(x2 - x1, z2 - z1);
        if (len > 0.3 && Math.abs((x1 + x2) / 2) < WORLD.halfX + 20 && Math.abs((z1 + z2) / 2) < WORLD.halfZ + 20) segs.push([x1, z1, x2, z2, len]);
      }
    }
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 0.28), M.kerb, segs.length);
  const dummy = new THREE.Object3D();
  segs.forEach(([x1, z1, x2, z2, len], i) => {
    dummy.position.set((x1 + x2) / 2, 0.07, (z1 + z2) / 2);
    dummy.rotation.set(0, -Math.atan2(z2 - z1, x2 - x1), 0);
    dummy.scale.set(len + 0.1, 1, 1);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  });
  inst.receiveShadow = true;
  inst.computeBoundingSphere();
  scene.add(inst);
}

// The Monument à la République (1883): stepped base, pedestal with a bronze
// frieze, tall stone column, Marianne on top with the olive branch raised and
// the tablet of the Rights of Man; three seated allegories and the lion + urn.
function buildMonument(scene, physics, box, cylinder) {
  const stone = M.stone;
  const bronze = M.bronze;
  // Stepped base: 3 low steps you can walk up (each step is < autostep height).
  [9, 7.8, 6.6].forEach((r, i) => cylinder(0, 0, r, 0.35, stone, { y: 0.175 + i * 0.35, segments: 24 }));
  const top = 1.05;
  // Pedestal + bronze frieze (the bas-reliefs) + column + cornices.
  cylinder(0, 0, 3.8, 3.4, stone, { y: top + 1.7, segments: 16 });
  cylinder(0, 0, 3.85, 1.0, bronze, { y: top + 1.9, segments: 16, collide: false });
  box(0, 0, 4.0, 0.5, 4.0, stone, { y: top + 3.65 });
  box(0, 0, 2.6, 10, 2.6, stone, { y: top + 3.9 + 5 });
  box(0, 0, 3.3, 0.5, 3.3, stone, { y: top + 14.15, collide: false });

  // Marianne (about 9.5 m tall in real life).
  const g = new THREE.Group();
  const add = (geo, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, bronze);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.5, 1.0, 3.6, 10), 0, 1.8, 0);          // long dress
  add(new THREE.CylinderGeometry(0.38, 0.5, 1.1, 10), 0, 4.0, 0);         // chest
  add(new THREE.SphereGeometry(0.42, 10, 8), 0, 4.95, 0);                  // head
  add(new THREE.CylinderGeometry(0.46, 0.46, 0.16, 10), 0, 5.28, 0);       // crown
  add(new THREE.CylinderGeometry(0.11, 0.13, 2.0, 6), -0.6, 5.1, 0, 0, 0.35); // right arm raised
  for (let i = 0; i < 6; i++) {                                            // olive branch
    add(new THREE.SphereGeometry(0.18, 6, 4), -1.0 - (i % 3) * 0.12, 6.1 + i * 0.13, ((i % 2) - 0.5) * 0.35);
  }
  add(new THREE.CylinderGeometry(0.11, 0.13, 1.5, 6), 0.6, 3.8, 0, 0, -0.25); // left arm down
  add(new THREE.BoxGeometry(0.9, 1.3, 0.16), 1.0, 2.9, 0.2);               // tablet (Rights of Man)
  g.position.set(0, top + 14.4, 0);
  g.rotation.y = -Math.PI / 2; // facing west, along the square (towards Boulevard Saint-Martin)
  scene.add(g);

  // Three seated allegories: Liberté, Égalité, Fraternité (block seat + body + head).
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 4.9;
    const z = Math.sin(a) * 4.9;
    box(x, z, 1.7, 1.0, 1.7, stone, { y: top + 0.5 });
    const fig = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.7, 1.6, 8), bronze);
    fig.position.set(x, top + 1.8, z);
    fig.castShadow = true;
    scene.add(fig);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), bronze);
    head.position.set(x, top + 2.85, z);
    scene.add(head);
  }

  // The lion guarding the ballot urn, on the west side.
  const lion = new THREE.Group();
  const part = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, bronze);
    m.position.set(x, y, z);
    m.castShadow = true;
    lion.add(m);
  };
  part(new THREE.BoxGeometry(1.0, 0.8, 2.2), 0, 0.6, 0);         // body
  part(new THREE.SphereGeometry(0.62, 10, 8), 0, 1.2, -1.1);     // mane
  part(new THREE.SphereGeometry(0.4, 8, 6), 0, 1.15, -1.55);     // face
  for (const [lx, lz] of [[-0.35, -0.8], [0.35, -0.8], [-0.35, 0.8], [0.35, 0.8]]) part(new THREE.BoxGeometry(0.25, 0.4, 0.25), lx, 0.2, lz);
  part(new THREE.CylinderGeometry(0.4, 0.32, 0.8, 10), 0, 0.4, -2.1); // urn
  part(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 10), 0, 0.85, -2.1);
  lion.position.set(-6.2, top, 0);
  lion.rotation.y = Math.PI / 2; // looking west
  scene.add(lion);
  physics.addBox(-6.2, top + 0.6, 0, 1.6, 0.6, 0.6);
}
