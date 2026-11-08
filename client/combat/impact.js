// client/combat/impact.js
// Little bursts of cartoon debris for hits, blocks and knock-outs (crumbs, feathers, sparks, stars)
// plus a ground ring on knock-outs. One InstancedMesh for all particles, a few pooled rings.
import * as THREE from 'three';

const MAX = 120;
const RINGS = 4;

export function createImpacts(scene) {
  const mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.08, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.userData.noMerge = true;
  mesh.castShadow = false;
  scene.add(mesh);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX; i++) { mesh.setMatrixAt(i, hidden); mesh.setColorAt(i, new THREE.Color(1, 1, 1)); }

  const parts = [];                       // live particles
  const free = Array.from({ length: MAX }, (_, i) => i);
  const col = new THREE.Color();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();

  const rings = Array.from({ length: RINGS }, () => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    r.rotation.x = -Math.PI / 2;
    r.visible = false;
    r.userData.noMerge = true;
    r.userData.t = 1;
    scene.add(r);
    return r;
  });
  let nextRing = 0;

  // kind: 'hit' (colour = what was swung), 'block' (sparks), 'ko' (stars + ring)
  function burst(pos, kind = 'hit', hex = 0xd9a45b) {
    const n = kind === 'ko' ? 22 : kind === 'block' ? 9 : 10;
    for (let k = 0; k < n && free.length; k++) {
      const i = free.pop();
      const a = Math.random() * Math.PI * 2;
      const sp = (kind === 'ko' ? 2.4 : 1.8) * (0.5 + Math.random());
      let c = hex, size = 0.7 + Math.random() * 0.8;
      if (kind === 'block') { c = k % 2 ? 0xffffff : 0xaad4ff; size = 0.5 + Math.random() * 0.5; }
      if (kind === 'ko') { c = k % 3 === 0 ? 0xffffff : k % 3 === 1 ? 0xffe14d : 0xffb347; size = 0.9 + Math.random() * 1.1; }
      if (kind === 'hit' && k % 3 === 0) c = 0xffffff;
      mesh.setColorAt(i, col.set(c));
      parts.push({ i, x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 2.2, vz: Math.sin(a) * sp, life: 0, max: 0.45 + Math.random() * 0.3, size, spin: Math.random() * 6 });
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (kind === 'ko') {
      const r = rings[nextRing++ % RINGS];
      r.position.set(pos.x, 0.06, pos.z);
      r.userData.t = 0;
      r.visible = true;
    }
  }

  function update(dt) {
    for (let k = parts.length - 1; k >= 0; k--) {
      const a = parts[k];
      a.life += dt;
      if (a.life >= a.max) { mesh.setMatrixAt(a.i, hidden); free.push(a.i); parts.splice(k, 1); continue; }
      a.vy -= 9 * dt;
      a.x += a.vx * dt; a.y = Math.max(0.05, a.y + a.vy * dt); a.z += a.vz * dt;
      const f = 1 - a.life / a.max;
      e.set(a.spin * a.life, a.spin * a.life * 1.3, 0);
      m.compose(p.set(a.x, a.y, a.z), q.setFromEuler(e), s.setScalar(a.size * (0.4 + 0.6 * f)));
      mesh.setMatrixAt(a.i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    for (const r of rings) {
      if (!r.visible) continue;
      r.userData.t += dt / 0.5;
      const t = r.userData.t;
      if (t >= 1) { r.visible = false; continue; }
      r.scale.setScalar(0.5 + t * 3.2);
      r.material.opacity = 0.7 * (1 - t);
    }
  }
  return { burst, update };
}
