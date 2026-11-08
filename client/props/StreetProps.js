// client/props/StreetProps.js
// Green Paris bins and metal crowd barriers that players (and the truck) can push.
//
// How pushing works:
//  1. Props are kinematic bodies, so the character controller bumps into them.
//  2. After moving, we ask the controller "what did you bump into?". If it was a
//     prop, we move that prop a little in the push direction (it slides along
//     walls thanks to its own character controller).
//  3. We tell the server the new position (at most TICK_RATE times per second).
//     The server checks we were close enough and shares it with everybody.
//
// Grab & throw: press G near a prop to lift it above your head, click (or G
// again) to throw it. While carried or flying, a prop has no collider.
// The server flies it too and decides who gets hit; we just draw the arc.

import * as THREE from 'three';
import { PROPS } from '../../shared/constants.js';
import { quatFromYaw } from '../physics/physics.js';

const BIN = { radius: 0.4, halfHeight: 0.5 };
const BARRIER = { hx: 1.0, hy: 0.55, hz: 0.08 };
const IGNORE_SERVER_MS = 700; // after pushing a prop ourselves, trust our own position for a bit

const binMat = new THREE.MeshStandardMaterial({ color: 0x2f7d4a, flatShading: true });
const lidMat = new THREE.MeshStandardMaterial({ color: 0x245f38, flatShading: true });
const metalMat = new THREE.MeshStandardMaterial({ color: 0xb8bec6, flatShading: true, metalness: 0.6, roughness: 0.4 });

export class StreetProps {
  constructor(scene, physics) {
    this.physics = physics;
    this.items = [];               // { mesh, body, collider, x, z, tx, tz, y, r, lastLocal }
    this.byHandle = new Map();     // collider handle -> item index
    this.dirty = new Set();        // indexes we pushed and still need to send
    this.controller = physics.world.createCharacterController(0.02);
    const { RAPIER } = physics;

    PROPS.forEach((def, i) => {
      let mesh, desc, y;
      const r = def.r ?? 0;
      if (def.kind === 'bin') {
        y = BIN.halfHeight;
        mesh = new THREE.Group();
        const can = new THREE.Mesh(new THREE.CylinderGeometry(BIN.radius, BIN.radius * 0.85, BIN.halfHeight * 2, 10), binMat);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(BIN.radius + 0.04, BIN.radius + 0.04, 0.08, 10), lidMat);
        lid.position.y = BIN.halfHeight;
        mesh.add(can, lid);
        desc = RAPIER.ColliderDesc.cylinder(BIN.halfHeight, BIN.radius);
      } else {
        y = BARRIER.hy;
        mesh = new THREE.Group();
        // Two legs + top/bottom rails + vertical bars: a classic "barrière Vauban".
        for (const sx of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, BARRIER.hy * 2, 0.5), metalMat);
          leg.position.set(sx * BARRIER.hx, 0, 0);
          mesh.add(leg);
        }
        for (const sy of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(BARRIER.hx * 2, 0.05, 0.05), metalMat);
          rail.position.y = sy * (BARRIER.hy - 0.1);
          mesh.add(rail);
        }
        for (let bx = -0.8; bx <= 0.81; bx += 0.2) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, BARRIER.hy * 1.6, 0.02), metalMat);
          bar.position.x = bx;
          mesh.add(bar);
        }
        desc = RAPIER.ColliderDesc.cuboid(BARRIER.hx, BARRIER.hy, BARRIER.hz);
      }
      mesh.traverse((o) => { o.castShadow = true; });
      mesh.position.set(def.x, y, def.z);
      mesh.rotation.y = r;
      scene.add(mesh);

      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(def.x, y + 0.02, def.z).setRotation(quatFromYaw(r)),
      );
      const collider = physics.world.createCollider(desc, body);
      this.byHandle.set(collider.handle, i);
      this.items.push({
        mesh, body, collider, x: def.x, z: def.z, tx: def.x, tz: def.z, y: y + 0.02, r, lastLocal: 0,
        carrier: 0,   // id of the player/NPC holding it (0 = on the ground)
        flight: null, // { x, y, z, vx, vy, vz } while thrown
      });
    });
  }

  // After a character/truck controller moved: push every prop it bumped into.
  // `pusher` = the collider that moved, `speed` = how fast it was going (m/s).
  pushFrom(controller, pusher, speed, dt) {
    if (speed < 0.5) return;
    const now = performance.now();
    const pushed = new Set(); // the controller can report the same prop several times: push once
    for (let c = 0; c < controller.numComputedCollisions(); c++) {
      const hit = controller.computedCollision(c);
      const i = hit?.collider ? this.byHandle.get(hit.collider.handle) : undefined;
      if (i === undefined || pushed.has(i) || this.items[i].carrier || this.items[i].flight) continue;
      pushed.add(i);
      const item = this.items[i];
      // Push away from the contact point (opposite of the surface normal).
      let nx = -hit.normal1.x;
      let nz = -hit.normal1.z;
      const len = Math.hypot(nx, nz);
      if (len < 0.01) continue;
      nx /= len; nz /= len;
      const step = speed * 0.9 * dt;
      // Let the prop slide along walls instead of going through them.
      this.controller.computeColliderMovement(
        item.collider, { x: nx * step, y: 0, z: nz * step }, undefined, undefined,
        (other) => other.handle !== pusher.handle,
      );
      const m = this.controller.computedMovement();
      item.x += m.x;
      item.z += m.z;
      item.tx = item.x;
      item.tz = item.z;
      item.lastLocal = now;
      this.dirty.add(i);
    }
  }

  // Positions from the server (sent when we join): [[x, z, carrierId], ...]
  setAll(list) {
    list.forEach(([x, z, carrier], i) => {
      this.setOne(i, x, z, true);
      this.setCarrier(i, carrier || 0);
    });
  }

  setOne(i, x, z, snap = false) {
    const item = this.items[i];
    if (!item) return;
    if (item.flight) { // the server says where it landed: end the flight there
      item.flight = null;
      snap = true;
      item.lastLocal = 0;
    }
    if (performance.now() - item.lastLocal < IGNORE_SERVER_MS) return; // we're pushing it right now
    item.tx = x;
    item.tz = z;
    if (snap) { item.x = x; item.z = z; }
  }

  // Somebody picked it up (id) or dropped it (0).
  setCarrier(i, id) {
    const item = this.items[i];
    if (!item) return;
    item.carrier = id;
    if (id) item.flight = null;
  }

  // Thrown: fly from p with velocity v (same simple physics as the server).
  startFlight(i, p, v) {
    const item = this.items[i];
    if (!item) return;
    item.carrier = 0;
    item.flight = { x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2] };
  }

  // The nearest prop on the ground within `range` of pos, or -1.
  nearest(pos, range) {
    let best = -1, bestD = range;
    this.items.forEach((item, i) => {
      if (item.carrier || item.flight) return;
      const d = Math.hypot(item.x - pos.x, item.z - pos.z);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // Every frame, before physics.step().
  // `holderOf(id)` returns { position, facing } of a player/NPC (or null).
  update(dt, holderOf) {
    const k = 1 - Math.exp(-12 * dt);
    for (const item of this.items) {
      let y = item.y;
      let rot = item.r;
      const holder = item.carrier ? holderOf(item.carrier) : null;
      if (holder) {
        // Lifted above the holder's head.
        item.x = item.tx = holder.position.x;
        item.z = item.tz = holder.position.z;
        y = holder.position.y + 1.6;
        rot = holder.facing + Math.PI / 2;
      } else if (item.flight) {
        const f = item.flight;
        f.vy -= 9.8 * dt;
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        if (f.y <= item.y) { f.y = item.y; f.vx = f.vz = f.vy = 0; } // wait on the ground for the server
        item.x = item.tx = f.x;
        item.z = item.tz = f.z;
        y = f.y;
        f.spin = (f.spin || 0) + dt * 8; // spin while flying (visual only)
        rot += f.spin;
      } else {
        item.x += (item.tx - item.x) * k;
        item.z += (item.tz - item.z) * k;
      }
      const solid = !holder && !item.flight;
      item.collider.setEnabled(solid);
      item.body.setNextKinematicTranslation({ x: item.x, y, z: item.z });
      item.mesh.position.set(item.x, y - 0.02, item.z);
      item.mesh.rotation.y = rot;
    }
  }

  // The props we pushed since the last call, as [[i, x, z], ...] (for the network).
  takeChanges() {
    const out = [...this.dirty].map((i) => [i, this.items[i].x, this.items[i].z]);
    this.dirty.clear();
    return out;
  }
}
