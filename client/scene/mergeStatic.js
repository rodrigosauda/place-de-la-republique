// client/scene/mergeStatic.js
// Performance: the city is made of hundreds of small meshes (benches, steps,
// lamp posts...). Drawing each one separately is slow. Since they never move,
// we glue ("merge") all meshes that share a material into ONE mesh.
// 400+ draw calls become ~30. Call it once, after the static world is built
// and BEFORE adding things that move (players, truck, props).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mergeStaticMeshes(scene) {
  scene.updateMatrixWorld(true);
  const buckets = new Map(); // key: material uuid + shadow flag -> { material, castShadow, geometries, meshes }

  scene.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || Array.isArray(obj.material)) return;
    if (obj.userData.noMerge) return;
    const key = obj.material.uuid + (obj.castShadow ? '|s' : '|n');
    let b = buckets.get(key);
    if (!b) {
      b = { material: obj.material, castShadow: obj.castShadow, geometries: [], meshes: [] };
      buckets.set(key, b);
    }
    // Bake the object's position/rotation/scale into a copy of its geometry.
    let g = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    g.applyMatrix4(obj.matrixWorld);
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    b.geometries.push(g);
    b.meshes.push(obj);
  });

  let before = 0, after = 0;
  for (const b of buckets.values()) {
    before += b.meshes.length;
    if (b.meshes.length < 2) continue; // nothing to gain
    const merged = mergeGeometries(b.geometries, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.castShadow;
    mesh.receiveShadow = true;
    for (const m of b.meshes) m.parent.remove(m);
    scene.add(mesh);
    after++;
  }
  return { before, after };
}
