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
import { TRUCK_SPAWN, TRUCK_STALL_SPEED } from '../../shared/constants.js';
import { quatFromYaw } from '../physics/physics.js';
import { InterpolationBuffer } from '../network/interpolation.js';

// Collider half sizes (metres): 2.4 wide, 2.4 high, 6 long.
const HALF = { x: 1.2, y: 1.2, z: 3 };

const MAX_SPEED = 11;       // m/s forwards (~40 km/h); it's a heavy truck
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
    this.gunnerId = 0;  // who works the cannon (0 = nobody: then the driver does)
    this.aim = TRUCK_SPAWN.r; // where the cannon points (world yaw)
    this.stalled = false;     // stopped by protesters / a barricade (from the server)
    this.painted = false;     // paint on the windscreen (from the server)
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

  // A French police water cannon ("lanceur d'eau"): white with a blue band, a dark cab with a grille
  // over the windscreen, a big water tank, a turret with the cannon on the roof (it turns to aim),
  // blue lights, six wheels. Built from boxes and cylinders, origin = collider centre, +z = front.
  buildMesh() {
    const g = new THREE.Group();
    const add = (geo, material, x, y, z, parent = g) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const white = mat(0xeef0f3);
    const blue = mat(0x1d3d8f);
    const dark = mat(0x1c1e22);
    const grey = mat(0x5b6068);
    const glass = new THREE.MeshStandardMaterial({ color: 0x2a3a4c, roughness: 0.15, metalness: 0.4 });

    // Chassis, bumpers, steps.
    add(box(2.4, 0.45, 6.1), dark, 0, -0.6, 0);
    add(box(2.5, 0.35, 0.25), dark, 0, -0.45, 3.05);                 // front bumper (push bar)
    for (const x of [-0.9, 0.9]) add(box(0.12, 0.7, 0.12), grey, x, -0.25, 3.15);
    add(box(2.0, 0.08, 0.12), grey, 0, 0.05, 3.15);

    // Cab: white, rounded-ish front, dark windscreen with a protective grille.
    add(box(2.4, 1.7, 1.9), white, 0, 0.45, 2.0);
    add(box(2.42, 0.32, 1.92), blue, 0, -0.05, 2.0);                 // blue band
    const screen = add(box(2.2, 0.75, 0.05), glass, 0, 0.75, 2.97);
    for (let i = -5; i <= 5; i++) add(box(0.035, 0.8, 0.04), grey, i * 0.2, 0.75, 3.01); // grille bars
    add(box(2.2, 0.04, 0.04), grey, 0, 1.13, 3.01);
    add(box(2.2, 0.04, 0.04), grey, 0, 0.37, 3.01);
    for (const x of [-1.21, 1.21]) add(box(0.04, 0.5, 0.9), glass, x, 0.8, 2.2); // side windows
    for (const x of [-0.85, 0.85]) add(box(0.35, 0.18, 0.04), mat(0xfff6d8), x, -0.25, 3.0); // headlights

    // Paint splat on the windscreen (protesters can throw paint): hidden until it happens.
    const splat = new THREE.Group();
    const paintMat = new THREE.MeshStandardMaterial({ color: 0xe0303c, roughness: 0.6 });
    const blob = new THREE.CircleGeometry(1, 10);
    for (const [x, y, r] of [[-0.4, 0.8, 0.38], [0.2, 0.7, 0.3], [0.55, 0.9, 0.22], [-0.1, 0.55, 0.2], [0.75, 0.6, 0.15], [-0.8, 0.65, 0.18]]) {
      const m = new THREE.Mesh(blob, paintMat);
      m.position.set(x, y, 3.05);
      m.scale.set(r, r * 0.8, 1);
      splat.add(m);
    }
    splat.visible = false;
    g.add(splat);
    this.splat = splat;

    // Water tank body with the blue band and "POLICE" lettering.
    add(box(2.4, 2.0, 4.1), white, 0, 0.7, -0.95);
    add(box(2.42, 0.32, 4.12), blue, 0, 0.2, -0.95);
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const x2 = c.getContext('2d');
    x2.fillStyle = '#eef0f3'; x2.fillRect(0, 0, 512, 96);
    x2.fillStyle = '#1d3d8f'; x2.font = '900 78px system-ui, sans-serif'; x2.textAlign = 'center'; x2.fillText('POLICE', 256, 80);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (const sx of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.5), new THREE.MeshStandardMaterial({ map: tex }));
      plate.position.set(sx * 1.215, 1.15, -0.95);
      plate.rotation.y = sx * Math.PI / 2;
      g.add(plate);
    }
    // Rear: ladder and a door.
    add(box(1.0, 1.6, 0.05), grey, 0, 0.6, -3.03);
    for (let i = 0; i < 5; i++) add(box(0.5, 0.05, 0.08), dark, 0.85, -0.2 + i * 0.35, -3.05);

    // Blue lights on the cab roof (they blink, see updateVisuals).
    const lightMat = new THREE.MeshStandardMaterial({ color: 0x2a6bff, emissive: 0x2a6bff, emissiveIntensity: 1.5 });
    this.lights = [-0.7, 0.7].map((x) => add(box(0.45, 0.18, 0.3), lightMat.clone(), x, 1.4, 2.4));

    // Turret: a base on the roof that turns (yaw) and a barrel that tilts a little.
    this.turret = new THREE.Group();
    this.turret.position.set(0, 1.75, 0.6);
    g.add(this.turret);
    add(new THREE.CylinderGeometry(0.5, 0.6, 0.35, 12), grey, 0, 0, 0, this.turret);
    add(box(0.5, 0.45, 0.6), dark, 0, 0.35, 0.05, this.turret);
    const barrel = add(new THREE.CylinderGeometry(0.11, 0.15, 1.5, 10), dark, 0, 0.42, 0.85, this.turret);
    barrel.rotation.x = Math.PI / 2 - 0.12;
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10), grey, 0, 0.5, 1.6, this.turret).rotation.x = Math.PI / 2;

    // Wheels: 6, with grey hubs; they turn with the speed.
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.38, 14);
    const hubGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.4, 8);
    for (const z of [2.1, -0.9, -2.2]) {
      for (const x of [-1.15, 1.15]) {
        const w = new THREE.Group();
        w.position.set(x, -0.7, z);
        add(wheelGeo, dark, 0, 0, 0, w).rotation.z = Math.PI / 2;
        add(hubGeo, grey, 0, 0, 0, w).rotation.z = Math.PI / 2;
        g.add(w);
        this.wheels.push(w);
      }
    }

    // Label showing who is in it.
    const div = document.createElement('div');
    div.className = 'name-label vehicle';
    div.textContent = 'Water cannon';
    this.label = new CSS2DObject(div);
    this.label.position.set(0, 3.2, 0);
    g.add(this.label);
    return g;
  }

  setDriverName(name, gunner = null) {
    const who = [name && `driver ${name}`, gunner && `cannon ${gunner}`].filter(Boolean).join(' · ');
    this.label.element.textContent = who ? `Water cannon · ${who}` : 'Water cannon (police: press E)';
  }

  // Where the water comes out (world position) and which way the barrel points.
  barrelTip(out) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const ax = Math.sin(this.aim), az = Math.cos(this.aim);
    return out.set(this.position.x + fx * 0.6 + ax * 1.6, this.position.y + 2.25, this.position.z + fz * 0.6 + az * 1.6);
  }

  // Lights, wheels, turret, paint: every frame after syncMesh().
  updateVisuals(dt, now) {
    const on = Math.floor(now / 300) % 2 === 0;
    this.lights[0].material.emissiveIntensity = on ? 2.2 : 0.15;
    this.lights[1].material.emissiveIntensity = on ? 0.15 : 2.2;
    const moved = this._last ? Math.hypot(this.position.x - this._last.x, this.position.z - this._last.z) : 0;
    const fwd = this._last ? Math.sign((this.position.x - this._last.x) * Math.sin(this.yaw) + (this.position.z - this._last.z) * Math.cos(this.yaw)) : 0;
    this._last = { x: this.position.x, z: this.position.z };
    for (const w of this.wheels) w.rotation.x += (moved / 0.52) * fwd;
    let rel = this.aim - this.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.turret.rotation.y += (rel - this.turret.rotation.y) * (1 - Math.exp(-10 * dt));
    this.splat.visible = this.painted;
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
    // Stopped by a crowd or a barricade: it can only creep.
    const top = this.stalled ? TRUCK_STALL_SPEED : MAX_SPEED;
    this.speed = THREE.MathUtils.clamp(this.speed, -Math.min(MAX_REVERSE, top), top);

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
