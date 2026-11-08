// client/vehicle/WaterSpray.js
// The water jet: lots of small blue spheres shot from the cannon barrel.
// Visual only — the push itself is decided by the server (GameRoom.js).
// Uses ONE InstancedMesh, so 200 droplets cost about the same as one mesh.

import * as THREE from 'three';

const MAX_DROPS = 200;
const DROPS_PER_SECOND = 160;
const LIFETIME = 0.9;   // seconds
const SPEED = 19;       // m/s out of the barrel

export class WaterSpray {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(0.12, 6, 4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.75, roughness: 0.2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_DROPS);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    this.drops = []; // { x,y,z, vx,vy,vz, age }
    this.toEmit = 0;
    this.matrix = new THREE.Matrix4();
    this.tmpScale = new THREE.Vector3();
    this.tmpPos = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();
  }

  // Call every frame. `truck` gives the barrel position/direction, `on` = spraying.
  update(dt, truck, on) {
    // 1) Emit new drops from the barrel tip.
    if (on) {
      this.toEmit += DROPS_PER_SECOND * dt;
      const fx = Math.sin(truck.yaw);
      const fz = Math.cos(truck.yaw);
      const p = truck.position;
      while (this.toEmit >= 1 && this.drops.length < MAX_DROPS) {
        this.toEmit -= 1;
        const spread = 0.12;
        this.drops.push({
          x: p.x + fx * 2.2, y: p.y + 2.0, z: p.z + fz * 2.2,
          vx: (fx + (Math.random() - 0.5) * spread) * SPEED,
          vy: 1.5 + Math.random() * 1.5,
          vz: (fz + (Math.random() - 0.5) * spread) * SPEED,
          age: Math.random() * 0.05,
        });
      }
    } else {
      this.toEmit = 0;
    }

    // 2) Move drops (simple gravity), remove old ones and ones under the ground.
    let n = 0;
    for (const d of this.drops) {
      d.age += dt;
      d.vy -= 9.8 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.age > LIFETIME || d.y < 0.05) continue;
      this.drops[n++] = d;
    }
    this.drops.length = n;

    // 3) Write them into the instanced mesh (bigger as they spread out).
    for (let i = 0; i < n; i++) {
      const d = this.drops[i];
      const s = 0.6 + d.age * 1.8;
      this.tmpPos.set(d.x, d.y, d.z);
      this.tmpScale.set(s, s, s);
      this.matrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
