// client/vehicle/Truck.js
// The water-cannon truck ("canon à eau"), made only of boxes and cylinders.
//
// Two modes:
//  - driven by YOU: arcade driving with a kinematic character controller,
//    so it slides along buildings instead of driving through them.
//  - driven by someone else / parked: its pose comes from server snapshots
//    and is interpolated, exactly like remote players.
// In both cases it has a collider, so walking players bump into it.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { TRUCK_SPAWN } from '../../shared/constants.js';
import { quatFromYaw } from '../physics/physics.js';
import { InterpolationBuffer } from '../network/interpolation.js';

// Collider half sizes (metres): 2.4 wide, 2.4 high, 6 long.
const HALF = { x: 1.2, y: 1.2, z: 3 };

const MAX_SPEED = 14;       // m/s forwards (~50 km/h)
const MAX_REVERSE = 5;      // m/s backwards
const ACCELERATION = 10;    // m/s^2
const BRAKE = 20;           // m/s^2 when pressing the opposite direction
const FRICTION = 4;         // m/s^2 when no key is pressed
const TURN_RATE = 1.6;      // rad/s at full speed

const mat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true });

export class Truck {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.ownerId = 0;   // who drives it (0 = nobody), decided by the server
    this.ignoreHandles = new Set(); // colliders the truck drives through (other players: the server knocks them over)
    this.spraying = false; // water cannon on? (from the server, or our own mouse when driving)
    this.water = 100;      // tank level, from the server
    this.speed = 0;
    this.yaw = TRUCK_SPAWN.r; // 0 = facing +z
    this.position = new THREE.Vector3(TRUCK_SPAWN.x, TRUCK_SPAWN.y, TRUCK_SPAWN.z);
    this.buffer = new InterpolationBuffer();
    this.buffer.reset(performance.now(), TRUCK_SPAWN.x, TRUCK_SPAWN.y, TRUCK_SPAWN.z, TRUCK_SPAWN.r);
    this._pose = {};

    this.mesh = this.buildMesh();
    scene.add(this.mesh);

    // Physics: kinematic box + its own character controller.
    const { RAPIER } = physics;
    const desc = RAPIER.ColliderDesc.cuboid(HALF.x, HALF.y, HALF.z);
    const k = physics.createKinematic(desc, this.position.x, this.position.y, this.position.z);
    this.body = k.body;
    this.collider = k.collider;
    this.controller = k.controller;
    this.controller.setSlideEnabled(true);
    this.body.setRotation(quatFromYaw(this.yaw), true);
    this.syncMesh();
  }

  buildMesh() {
    const g = new THREE.Group(); // origin = collider centre, +z = front
    const add = (geo, material, x, y, z) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const white = mat(0xf2f2f2);
    const blue = mat(0x1d3d8f);
    const dark = mat(0x222428);
    const glass = mat(0x7fa6c9);

    add(new THREE.BoxGeometry(2.4, 0.5, 6), dark, 0, -0.55, 0);      // chassis
    add(new THREE.BoxGeometry(2.4, 1.6, 1.8), white, 0, 0.5, 2.1);   // cab
    add(new THREE.BoxGeometry(2.2, 0.7, 0.05), glass, 0, 0.75, 3.01); // windscreen
    add(new THREE.BoxGeometry(2.4, 1.9, 4), white, 0, 0.65, -0.9);   // water tank
    add(new THREE.BoxGeometry(2.42, 0.3, 4.02), blue, 0, 0.2, -0.9); // blue stripe
    add(new THREE.BoxGeometry(1.2, 0.15, 0.3), mat(0x3a6dff), 0, 1.38, 2.3); // light bar

    // Water cannon turret on the roof: a cylinder base + a cylinder barrel.
    add(new THREE.CylinderGeometry(0.45, 0.5, 0.4, 8), dark, 0, 1.8, 0.6);
    const barrel = add(new THREE.CylinderGeometry(0.12, 0.15, 1.6, 8), dark, 0, 1.95, 1.3);
    barrel.rotation.x = Math.PI / 2 - 0.15;

    // Wheels: 6 short cylinders lying on their side.
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 10);
    for (const z of [2.1, -0.9, -2.2]) {
      for (const x of [-1.15, 1.15]) {
        const w = add(wheelGeo, dark, x, -0.7, z);
        w.rotation.z = Math.PI / 2;
      }
    }

    // Label showing who drives.
    const div = document.createElement('div');
    div.className = 'name-label vehicle';
    div.textContent = 'Water cannon';
    this.label = new CSS2DObject(div);
    this.label.position.set(0, 2.6, 0);
    g.add(this.label);
    return g;
  }

  setDriverName(name) {
    this.label.element.textContent = name ? `Water cannon · ${name}` : 'Water cannon (press E)';
  }

  // --- local driving (called every frame before physics.step) -------------
  // `props` (optional) = StreetProps, so the truck can shove bins and barriers.
  drive(dt, input, props) {
    const throttle = input.forward; // W/S
    const steer = input.right;      // A/D

    // Speed: accelerate, brake when pressing the opposite way, coast otherwise.
    if (throttle !== 0) {
      const braking = Math.sign(throttle) !== Math.sign(this.speed) && this.speed !== 0;
      this.speed += throttle * (braking ? BRAKE : ACCELERATION) * dt;
    } else {
      const drop = FRICTION * dt;
      this.speed = Math.abs(this.speed) <= drop ? 0 : this.speed - Math.sign(this.speed) * drop;
    }
    this.speed = THREE.MathUtils.clamp(this.speed, -MAX_REVERSE, MAX_SPEED);

    // Steering only works while moving (and is reversed when backing up, like a car).
    this.yaw -= steer * TURN_RATE * dt * (this.speed / MAX_SPEED) * (this.speed < 0 ? 2.5 : 1);

    // Desired movement along the truck's forward direction.
    const desired = {
      x: Math.sin(this.yaw) * this.speed * dt,
      y: 0, // the square is flat, the truck stays at the same height
      z: Math.cos(this.yaw) * this.speed * dt,
    };
    this.controller.computeColliderMovement(
      this.collider, desired, undefined, undefined,
      (c) => !this.ignoreHandles.has(c.handle),
    );
    const move = this.controller.computedMovement();

    // Hit a wall? Lose most of the speed (feels like a bump).
    const wanted = Math.hypot(desired.x, desired.z);
    const got = Math.hypot(move.x, move.z);
    if (wanted > 0.001 && got < wanted * 0.5) this.speed *= 0.5;

    const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + move.x, y: p.y, z: p.z + move.z });
    this.body.setNextKinematicRotation(quatFromYaw(this.yaw));

    props?.pushFrom(this.controller, this.collider, Math.abs(this.speed), dt);
  }

  // --- remote / parked (called every frame before physics.step) ------------
  onSnapshot(time, x, y, z, r) {
    this.buffer.push(time, x, y, z, r);
  }

  followNetwork(now) {
    const pose = this.buffer.sample(now, this._pose);
    if (!pose) return;
    this.yaw = pose.r;
    this.speed = 0;
    this.body.setNextKinematicTranslation({ x: pose.x, y: pose.y, z: pose.z });
    this.body.setNextKinematicRotation(quatFromYaw(pose.r));
  }

  // Put the truck somewhere at once (new day: back to its parking spot).
  place(x, y, z, r) {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(quatFromYaw(r), true);
    this.yaw = r;
    this.speed = 0;
    this.position.set(x, y, z);
    this.resetBuffer();
  }

  // When control changes hands, restart the interpolation from the current pose
  // so the truck doesn't "rewind" through old snapshots.
  resetBuffer() {
    const p = this.position;
    this.buffer.reset(performance.now(), p.x, p.y, p.z, this.yaw);
  }

  // After physics.step(): copy physics -> mesh.
  syncMesh() {
    const p = this.body.translation();
    this.position.set(p.x, p.y, p.z);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
  }

  // A spot right next to the truck where the player appears when getting out.
  exitPoint() {
    const rightX = -Math.cos(this.yaw);
    const rightZ = Math.sin(this.yaw);
    return { x: this.position.x + rightX * 2.6, z: this.position.z + rightZ * 2.6 };
  }
}
