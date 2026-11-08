// client/scene/haussmann.js
// Builds Paris "Haussmann" buildings on the REAL building outlines from
// OpenStreetMap (see scripts/build-map.py -> mapData.json).
// What makes them look Parisian (from photos of Place de la République):
//   - cream limestone façades, 6-7 storeys, all roughly the same height
//   - ground floor: shops with big dark windows and coloured awnings, a big carriage door
//   - entresol (low floor) above the shops
//   - CONTINUOUS wrought-iron balconies on the 2nd and 5th floors,
//     small "balconnets" on the other floors
//   - stone cornices (horizontal ledges) separating the levels
//   - grey zinc mansard roof with dormer windows and chimney stacks
//
// Only the walls that face a street get windows/shops (flag from the map data);
// back walls and courtyards stay plain stone.
//
// Performance trick: every repeated detail (thousands of windows, balconies...)
// goes into ONE InstancedMesh per detail type, so the GPU draws each type in a
// single call. All walls share one physics collider (a triangle mesh).

import * as THREE from 'three';
import { LOW_QUALITY } from '../quality.js';
import { stoneFacade, zincRoof, frenchWindow, shopFront, SHOP_SIGNS } from './textures.js';

// Storey heights (metres)
const GROUND = 4.6;
const ENTRESOL = 2.8;
const FLOOR = 3.2;
const ROOF = 3.4;           // mansard height
const ROOF_INSET = 1.7;     // how far the mansard leans back
const COLUMN_SPACING = 2.7; // distance between window columns
const DETAIL_RADIUS = LOW_QUALITY ? 130 : 240; // façade details only this close to the square

const STONE_COLORS = [0xe9dcc0, 0xe2d3b4, 0xefe4cc, 0xdccaa8, 0xe6d8bb];
const AWNING_COLORS = [0x8e1b1b, 0x1f4d36, 0x1c2f5a, 0x7a1f3d, 0x2d2d2d, 0xb3541e];

export function createHaussmannBuilder(scene, physics, rand) {
  // --- one list of matrices per kind of detail ---
  const parts = {
    window: [], windowLit: [], sill: [], cornice: [], slab: [], railing: [],
    shops: SHOP_SIGNS.map(() => []), door: [], awning: [], dormer: [], dormerGlass: [], chimney: [], pot: [],
  };
  const awningColors = [];
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  function push(list, x, y, z, sx, sy, sz, rotY = 0, tiltX = 0) {
    euler.set(tiltX, rotY, 0);
    quat.setFromEuler(euler);
    m4.compose(pos.set(x, y, z), quat, scl.set(sx, sy, sz));
    list.push(m4.clone());
  }

  // Materials: cut limestone (a few shades) and zinc for the roofs.
  // Texture coordinates are in metres / 4 (one tile = 4 m).
  const zinc = zincRoof();
  const roofMat = new THREE.MeshStandardMaterial({ ...zinc, roughness: 0.55, metalness: 0.35 });
  const flatRoofMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9 });
  const stoneMats = STONE_COLORS.map((c, i) => {
    const t = stoneFacade('#' + c.toString(16).padStart(6, '0'), i + 1);
    return new THREE.MeshStandardMaterial({ ...t, roughness: 0.92, normalScale: new THREE.Vector2(0.8, 0.8) });
  });

  // Geometry is collected per material and turned into a few big meshes in finish().
  const geo = new Map(); // material -> { pos: [], uv: [], idx: [] }
  const bucket = (mat) => geo.get(mat) || geo.set(mat, { pos: [], uv: [], idx: [] }).get(mat);
  const colliderPos = [];
  const colliderIdx = [];

  // A quad a-b-c-d (counter-clockwise seen from the front), with UVs.
  function quad(mat, a, b, c, d, uvs, collide = false) {
    const B = bucket(mat);
    const base = B.pos.length / 3;
    for (const p of [a, b, c, d]) B.pos.push(p[0], p[1], p[2]);
    for (const t of uvs) B.uv.push(t[0], t[1]);
    B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    if (collide) {
      const cb = colliderPos.length / 3;
      for (const p of [a, b, c, d]) colliderPos.push(p[0], p[1], p[2]);
      colliderIdx.push(cb, cb + 1, cb + 2, cb, cb + 2, cb + 3);
    }
  }
  // A flat horizontal polygon at height y (roof caps). ring = [[x, z], ...] counter-clockwise.
  function cap(mat, ring, y) {
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { return; }
    const B = bucket(mat);
    const base = B.pos.length / 3;
    for (const [x, z] of ring) { B.pos.push(x, y, z); B.uv.push(x / 4, z / 4); }
    // ShapeUtils returns triangles in the contour's orientation; flip them so they face up.
    for (const [a, b, c] of tris) B.idx.push(base + a, base + c, base + b);
  }

  // Signed area in (x, z): > 0 means counter-clockwise in math axes.
  const area = (ring) => ring.reduce((s, [x1, z1], i) => { const [x2, z2] = ring[(i + 1) % ring.length]; return s + x1 * z2 - x2 * z1; }, 0) / 2;

  // Move every corner `d` metres inwards (for the mansard roof).
  function inset(ring, d) {
    const n = ring.length;
    const normals = ring.map(([x1, z1], i) => {
      const [x2, z2] = ring[(i + 1) % n];
      const L = Math.hypot(x2 - x1, z2 - z1) || 1;
      return [(z2 - z1) / L, -(x2 - x1) / L]; // outward for a CCW ring
    });
    return ring.map(([x, z], i) => {
      const a = normals[(i - 1 + n) % n], b = normals[i];
      let mx = a[0] + b[0], mz = a[1] + b[1];
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const k = Math.min(3, 1 / Math.max(0.2, mx * b[0] + mz * b[1])) * d;
      return [x - mx * k, z - mz * k];
    });
  }

  // Inside a polygon? (for chimney positions)
  function insidePoly(ring, x, z) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  // Shops, windows, balconies, cornices and dormers along one street-facing wall.
  function decorate(s, wallTop, floors, awningColor, haussmann) {
    const rot = Math.atan2(-s.az, s.ax); // rotates a box's local x along the façade
    const P = (u, o) => [s.cx + s.ax * u + s.nx * o, s.cz + s.az * u + s.nz * o];
    const cols = Math.max(1, Math.floor((s.len - 1) / COLUMN_SPACING));
    const spacing = s.len / cols;
    const doorCol = cols > 2 ? Math.floor(rand() * cols) : -1;

    for (let i = 0; i < cols; i++) {
      const u = -s.len / 2 + spacing * (i + 0.5);
      // --- ground floor: shop windows + awnings, one carriage door ---
      if (i === doorCol) {
        const [dx, dz] = P(u, 0.04);
        push(parts.door, dx, 2.0, dz, Math.min(2.0, spacing * 0.8), 4.0, 0.12, rot);
      } else {
        const [gx, gz] = P(u, 0.03);
        push(parts.shops[Math.floor(rand() * SHOP_SIGNS.length)], gx, 2.0, gz, spacing * 0.78, 3.3, 0.1, rot);
        if (rand() < 0.7) {
          const [ax, az] = P(u, 0.65);
          push(parts.awning, ax, 3.9, az, spacing * 0.8, 0.08, 1.3, rot, 0.45);
          awningColors.push(awningColor);
        }
      }
      if (!haussmann) continue;
      // --- entresol: short windows ---
      const [ex, ez] = P(u, 0.04);
      push(parts.window, ex, GROUND + ENTRESOL / 2, ez, 1.0, 1.3, 0.1, rot);
      // --- regular floors: tall French windows, sills, small balconies ---
      for (let f = 0; f < floors; f++) {
        const base = GROUND + ENTRESOL + f * FLOOR;
        const lit = rand() < 0.22; // some apartments have their lights on at night
        const [wx, wz] = P(u, 0.04);
        push(lit ? parts.windowLit : parts.window, wx, base + 1.3, wz, 1.15, 2.15, 0.1, rot);
        const [sx, sz] = P(u, 0.12);
        push(parts.sill, sx, base + 0.18, sz, 1.5, 0.12, 0.24, rot);
        const continuous = f === 0 || f === floors - 1; // 2nd and 5th floor
        if (!continuous) {
          const [bx, bz] = P(u, 0.14);
          push(parts.railing, bx, base + 0.55, bz, 1.3, 0.7, 1, rot);
        }
      }
      // --- dormer windows on the mansard ---
      if (Math.abs(u) < s.len / 2 - 1.5) {
        const [dx, dz] = P(u, -ROOF_INSET * 0.55);
        push(parts.dormer, dx, wallTop + 1.4, dz, 1.1, 1.6, 1.0, rot);
        const [gx, gz] = P(u, -ROOF_INSET * 0.55 + 0.52);
        push(parts.dormerGlass, gx, wallTop + 1.3, gz, 0.7, 0.95, 0.06, rot);
      }
    }
    if (!haussmann) {
      const [c1x, c1z] = P(0, 0.2);
      push(parts.cornice, c1x, GROUND + 0.1, c1z, s.len, 0.3, 0.4, rot);
      return;
    }
    // --- continuous balconies on the 2nd and last regular floor ---
    for (const f of [0, floors - 1]) {
      const base = GROUND + ENTRESOL + f * FLOOR;
      const [sx, sz] = P(0, 0.3);
      push(parts.slab, sx, base + 0.05, sz, s.len - 0.4, 0.16, 0.62, rot);
      const modules = Math.floor((s.len - 0.6) / 1.25);
      for (let k = 0; k < modules; k++) {
        const u = -((modules - 1) * 1.25) / 2 + k * 1.25;
        const [rx, rz] = P(u, 0.6);
        push(parts.railing, rx, base + 0.65, rz, 1.25, 1.0, 1, rot);
      }
    }
    // --- cornices: above the shops and at the top of the wall ---
    const [c1x, c1z] = P(0, 0.2);
    push(parts.cornice, c1x, GROUND + 0.1, c1z, s.len, 0.3, 0.4, rot);
    const [c2x, c2z] = P(0, 0.35);
    push(parts.cornice, c2x, wallTop - 0.2, c2z, s.len + 0.2, 0.45, 0.7, rot);
  }

  return {
    // ring = [[x, z], ...] (counter-clockwise), top = wall height (m), facing = '0101...' per edge.
    addFootprint(ring, top, facing) {
      if (ring.length < 3) return;
      if (area(ring) < 0) { ring = ring.slice().reverse(); facing = facing.split('').reverse().join(''); facing = facing.slice(1) + facing[0]; }
      const haussmann = top >= 14;
      const wallTop = haussmann ? top - ROOF : top;
      const floors = Math.max(1, Math.round((wallTop - GROUND - ENTRESOL) / FLOOR));
      const stone = stoneMats[Math.floor(rand() * stoneMats.length)];
      const awningColor = AWNING_COLORS[Math.floor(rand() * AWNING_COLORS.length)];
      const n = ring.length;
      let cx = 0, cz = 0;
      for (const [x, z] of ring) { cx += x; cz += z; }
      cx /= n; cz /= n;
      const near = Math.hypot(cx, cz) < DETAIL_RADIUS;

      // Walls (stone), u = metres along the building / 4.
      let u0 = 0;
      for (let i = 0; i < n; i++) {
        const [x1, z1] = ring[i];
        const [x2, z2] = ring[(i + 1) % n];
        const len = Math.hypot(x2 - x1, z2 - z1);
        const u1 = u0 + len / 4;
        // Seen from outside, a CCW (math) ring needs the vertex order 2-1 for the bottom edge.
        quad(stone, [x2, 0, z2], [x1, 0, z1], [x1, wallTop, z1], [x2, wallTop, z2],
          [[u1, 0], [u0, 0], [u0, wallTop / 4], [u1, wallTop / 4]], true);
        if (near && facing[i] === '1' && len > 2.5) {
          const ax = (x2 - x1) / len, az = (z2 - z1) / len;
          decorate({ cx: (x1 + x2) / 2, cz: (z1 + z2) / 2, ax, az, nx: az, nz: -ax, len }, wallTop, floors, awningColor, haussmann);
        }
        u0 = u1;
      }

      // Roof: zinc mansard on Haussmann blocks, flat grey roof on low buildings.
      if (haussmann) {
        const inner = inset(ring, ROOF_INSET);
        let v0 = 0;
        for (let i = 0; i < n; i++) {
          const a = ring[i], b = ring[(i + 1) % n], ai = inner[i], bi = inner[(i + 1) % n];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const v1 = v0 + len / 4;
          quad(roofMat, [b[0], wallTop, b[1]], [a[0], wallTop, a[1]], [ai[0], wallTop + ROOF, ai[1]], [bi[0], wallTop + ROOF, bi[1]],
            [[v1, 0], [v0, 0], [v0, 1], [v1, 1]]);
          v0 = v1;
        }
        cap(roofMat, inner, wallTop + ROOF);
        // Chimney stacks on top.
        if (near && !LOW_QUALITY) {
          const xs = inner.map((p) => p[0]), zs = inner.map((p) => p[1]);
          const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
          const stacks = Math.min(4, Math.max(1, Math.round(Math.abs(area(ring)) / 150)));
          for (let c = 0, tries = 0; c < stacks && tries < 20; tries++) {
            const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
            if (!insidePoly(inner, x, z)) continue;
            c++;
            push(parts.chimney, x, wallTop + ROOF + 0.7, z, 2.2, 1.6, 0.8, rand() * Math.PI);
            for (let k = -1; k <= 1; k++) push(parts.pot, x + k * 0.6, wallTop + ROOF + 1.75, z, 1, 1, 1, 0);
          }
        }
      } else {
        cap(flatRoofMat, ring, wallTop);
      }
    },

    // Create the meshes (call once, after all addFootprint() calls).
    // Returns materials that should glow at night (lit windows, shop windows).
    finish() {
      // Walls and roofs: one mesh per material.
      for (const [mat, B] of geo) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
        g.setIndex(B.idx);
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.noMerge = true; // already one big mesh (but still a wall you can tag)
        mesh.userData.wall = true;
        scene.add(mesh);
      }
      // One physics collider for every wall in the city.
      const R = physics.RAPIER;
      physics.world.createCollider(R.ColliderDesc.trimesh(new Float32Array(colliderPos), new Uint32Array(colliderIdx)));

      const box = new THREE.BoxGeometry(1, 1, 1);
      const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra });
      // Windows: painted French windows that reflect the sky (environment map).
      const winTex = frenchWindow();
      const glass = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.25, metalness: 0.35 });
      const litGlass = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.25, metalness: 0.35, emissive: 0xffc977, emissiveMap: winTex, emissiveIntensity: 0 });
      const shopMats = SHOP_SIGNS.map((sign, i) => {
        const t = shopFront(sign, i);
        return new THREE.MeshStandardMaterial({ map: t, roughness: 0.3, metalness: 0.2, emissive: 0xffd9a0, emissiveMap: t, emissiveIntensity: 0 });
      });
      const lightStone = std(0xf2e9d6);
      const iron = railingMaterial();

      const make = (list, g, mat, { shadow = false, colors = null } = {}) => {
        if (!list.length) return;
        const mesh = new THREE.InstancedMesh(g, mat, list.length);
        list.forEach((m, i) => mesh.setMatrixAt(i, m));
        if (colors) {
          const c = new THREE.Color();
          colors.forEach((hex, i) => mesh.setColorAt(i, c.setHex(hex)));
        }
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        scene.add(mesh);
      };

      make(parts.window, box, glass);
      make(parts.windowLit, box, litGlass);
      if (LOW_QUALITY) { parts.sill = []; parts.railing = parts.railing.filter((_, i) => i % 3 === 0); parts.dormerGlass = []; parts.pot = []; }
      make(parts.sill, box, lightStone);
      make(parts.cornice, box, lightStone, { shadow: true });
      make(parts.slab, box, lightStone, { shadow: true });
      make(parts.railing, new THREE.PlaneGeometry(1, 1), iron);
      parts.shops.forEach((list, i) => make(list, box, shopMats[i]));
      make(parts.door, box, std(0x1f3a2a));
      make(parts.awning, box, std(0xffffff), { shadow: true, colors: awningColors });
      make(parts.dormer, box, std(0x6b7785), { shadow: true });
      make(parts.dormerGlass, box, glass);
      make(parts.chimney, box, std(0xcdb79a), { shadow: true });
      make(parts.pot, new THREE.CylinderGeometry(0.14, 0.16, 0.5, 6), std(0xb5653c));

      return [litGlass, ...shopMats];
    },
  };
}

// Wrought-iron balcony railing drawn on a transparent canvas (bars + curly scrolls).
function railingMaterial() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d');
  g.strokeStyle = '#15181c';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(0, 6); g.lineTo(128, 6);     // hand rail
  g.moveTo(0, 90); g.lineTo(128, 90);   // bottom rail
  g.stroke();
  g.lineWidth = 3;
  for (let x = 8; x < 128; x += 16) {   // bars
    g.beginPath(); g.moveTo(x, 6); g.lineTo(x, 90); g.stroke();
  }
  g.lineWidth = 2.5;
  for (let x = 16; x < 128; x += 32) {  // scrolls
    g.beginPath(); g.arc(x, 48, 10, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(x, 26, 6, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(x, 70, 6, 0, Math.PI * 2); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
}
