// client/player/LocalPlayer.js
// The player YOU control. Movement uses Rapier's kinematic character
// controller: we tell it "I want to move by this much" and it answers
// "here is how much you can actually move without going through walls".

import * as THREE from 'three';
import { createPlayerMesh, PLAYER_RADIUS, PLAYER_HALF_LENGTH, PLAYER_HALF_HEIGHT } from './playerMesh.js';
import { CharacterFx } from '../combat/effects.js';
import { MAX_HP, KO_MS, WEAPONS, DEFAULT_WEAPON, FIGHT_WEAPONS } from '../../shared/constants.js';

const RUN_FACTOR = 1.75; // Shift: run this much faster than walking

const WALK_SPEED = 6;     // m/s
const JUMP_SPEED = 7;     // m/s upwards when jumping
const GRAVITY = 22;       // m/s^2 (a bit stronger than real life feels snappier)
const TURN_SPEED = 12;    // how fast the body rotates towards the move direction
const DASH_SPEED = 15;    // m/s during a dodge roll (about 3.3 m in total)
const DASH_MS = 220;
export const DASH_COOLDOWN_MS = 1500;

export class LocalPlayer {
  constructor({ scene, physics, name, faction, slogan, look, spawn }) {
    this.slogan = slogan;
    this.look = look;
    this.name = name;
    this.faction = faction;
    this.physics = physics;
    this.scene = scene;

    this.mesh = createPlayerMesh(name, faction, true, slogan, false, look);
    scene.add(this.mesh);
    this.fx = new CharacterFx(this.mesh);
    this.speed = 0;          // ground speed this frame (for the walk animation)

    // --- combat state ---
    this.hp = MAX_HP;
    this.koUntil = 0;        // performance.now() time when the KO ends (0 = not KO)
    this.lastAttack = 0;
    this.knock = { x: 0, z: 0 }; // knockback velocity (m/s), fades out quickly
    this.blocking = false;   // right mouse button (CRS: shield, others: weapon across the face)
    this.weapon = DEFAULT_WEAPON[faction];
    this.fx.setWeapon(this.weapon);
    this.carrying = -1;      // index of the street prop we hold above our head (-1 = none)
    this.speedFactor = 1;    // < 1 while in tear gas (set by main.js)
    this.soakedUntil = 0;    // inside the water jet until this time
    this.wantDash = false;   // set by main.js when C is pressed
    this.dash = null;        // { x, z, until } while dashing
    this.dashReadyAt = 0;    // performance.now() time when the next dash is possible

    // --- physics: kinematic capsule + character controller ---
    const { RAPIER } = physics;
    const desc = RAPIER.ColliderDesc.capsule(PLAYER_HALF_LENGTH, PLAYER_RADIUS);
    const k = physics.createKinematic(desc, spawn.x, PLAYER_HALF_HEIGHT + 0.5, spawn.z);
    this.body = k.body;
    this.collider = k.collider;
    this.controller = k.controller;
    this.controller.enableAutostep(0.4, 0.2, true);   // walk up small steps (monument)
    this.controller.enableSnapToGround(0.3);          // stick to the ground on small drops
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.controller.setSlideEnabled(true);            // slide along walls instead of stopping

    this.spawn = spawn;
    this.verticalSpeed = 0;
    this.grounded = false;
    this.facing = 0;        // rotation around Y (radians), 0 = looking towards +z
    this.inVehicle = false;
    this.position = new THREE.Vector3(spawn.x, PLAYER_HALF_HEIGHT, spawn.z);
  }

  // Called every frame BEFORE physics.step(). cameraYaw makes W = "away from camera".
  // `props` (optional) = StreetProps, so we can push bins and barriers.
  update(dt, input, cameraYaw, props) {
    this._dt = dt;
    if (this.inVehicle) return;
    this.fx.setBlock(this.blocking);

    // 1) Horizontal wish direction, relative to the camera (no control while KO).
    //    Inside the water jet you can barely move.
    const control = this.isKO ? 0 : performance.now() < this.soakedUntil ? 0.15 : 1;
    const f = input.forward * control;
    const r = input.right * control;
    const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw); // camera forward on the ground
    const rx = Math.cos(cameraYaw), rz = -Math.sin(cameraYaw);  // camera right
    let mx = fx * f + rx * r;
    let mz = fz * f + rz * r;
    let len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    // Dodge roll (C): a short burst in the direction you walk (or the way you face).
    const nowMs = performance.now();
    if (this.wantDash) {
      this.wantDash = false;
      if (this.canDash(nowMs)) {
        const dx = len > 0 ? mx : Math.sin(this.facing);
        const dz = len > 0 ? mz : Math.cos(this.facing);
        this.dash = { x: dx, z: dz, until: nowMs + DASH_MS };
        this.dashReadyAt = nowMs + DASH_COOLDOWN_MS;
        this.justDashed = true;
      }
    }
    const dashing = !!this.dash && nowMs < this.dash.until && !this.isKO;
    if (dashing) { mx = this.dash.x; mz = this.dash.z; len = 1; } else this.dash = null;

    // 2) Vertical: gravity + jump.
    if (this.grounded && input.jump && !this.isKO) this.verticalSpeed = JUMP_SPEED;
    this.verticalSpeed -= GRAVITY * dt;

    // Knockback from hits fades out quickly (like friction).
    const fade = Math.exp(-6 * dt);
    this.knock.x *= fade;
    this.knock.z *= fade;

    // Holding the shield up: walk at half speed.
    // Shift = run (not while blocking or carrying something heavy).
    this.running = input.run && !this.blocking && this.carrying < 0 && len > 0;
    const speed = dashing ? DASH_SPEED
      : (this.blocking ? WALK_SPEED * 0.5 : this.running ? WALK_SPEED * RUN_FACTOR : WALK_SPEED) * this.speedFactor;
    const desired = {
      x: (mx * speed + this.knock.x) * dt,
      y: this.verticalSpeed * dt,
      z: (mz * speed + this.knock.z) * dt,
    };

    // 3) Ask Rapier what movement is actually possible.
    this.controller.computeColliderMovement(this.collider, desired);
    const move = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalSpeed < 0) this.verticalSpeed = 0;

    const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + move.x, y: p.y + move.y, z: p.z + move.z });

    // Bumped into a bin or barrier? Push it.
    props?.pushFrom(this.controller, this.collider, len > 0 ? speed : 0, dt);

    // 4) Turn the body: towards where the camera looks when blocking
    //    (so the shield faces the danger), otherwise towards where we walk.
    if (this.blocking) {
      this.facing = lerpAngle(this.facing, cameraYaw + Math.PI, 1 - Math.exp(-TURN_SPEED * dt));
    } else if (len > 0) {
      const target = Math.atan2(mx, mz);
      this.facing = lerpAngle(this.facing, target, 1 - Math.exp(-TURN_SPEED * dt));
    }
  }

  canDash(now) {
    return !this.inVehicle && !this.isKO && !this.blocking && this.carrying < 0 && now >= this.dashReadyAt;
  }

  get isDashing() {
    return !!this.dash && performance.now() < this.dash.until;
  }

  // Called every frame AFTER physics.step(): copy physics -> mesh.
  syncMesh() {
    if (this.inVehicle) return;
    const p = this.body.translation();
    if (this._dt) {
      const raw = Math.min(14, Math.hypot(p.x - this.position.x, p.z - this.position.z) / this._dt);
      this.speed += (raw - this.speed) * (1 - Math.exp(-12 * this._dt)); // smoothed for the walk animation
    }
    // Fell through the world somehow? Respawn.
    if (p.y < -20) this.teleport(this.spawn.x, PLAYER_HALF_HEIGHT + 1, this.spawn.z);
    this.position.set(p.x, p.y, p.z);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facing;
  }

  // --- combat ---------------------------------------------------------------
  get isKO() {
    return this.hp <= 0;
  }

  // Try to swing. Returns true if the swing happens (main.js then tells the server).
  tryAttack(now, aimYaw) {
    const cooldown = WEAPONS[this.weapon].cooldown;
    if (this.inVehicle || this.isKO || this.blocking || this.carrying >= 0 || now - this.lastAttack < cooldown) return false;
    this.lastAttack = now;
    this.facing = aimYaw; // turn towards where the camera looks
    this.fx.swing();
    return true;
  }

  // New outfit from the editor: rebuild the mesh, keep the animation state.
  setLook(look) {
    this.look = look;
    const old = this.mesh;
    this.mesh = createPlayerMesh(this.name, this.faction, true, this.slogan, false, look);
    this.mesh.position.copy(old.position);
    this.mesh.rotation.y = old.rotation.y;
    this.mesh.visible = old.visible;
    this.scene.add(this.mesh);
    this.scene.remove(old);
    old.userData.dispose();
    const fx = new CharacterFx(this.mesh);
    fx.setWeapon(this.weapon);
    fx.setCarrying(this.carrying >= 0);
    fx.setKO(this.isKO);
    this.fx = fx;
  }


  setCarrying(i) {
    this.carrying = i;
    this.fx.setCarrying(i >= 0);
  }

  // The water jet pushes us (sent by the server ~10 times per second).
  onPush(kx, kz) {
    this.knock.x = kx;
    this.knock.z = kz;
    this.soakedUntil = performance.now() + 250;
  }

  // The server says we got hit.
  onHit(hp, kx, kz, now, byTruck = false) {
    this.hp = hp;
    this.knock.x = kx;
    this.knock.z = kz;
    this.verticalSpeed = byTruck ? 7 : 3; // the truck sends you flying
    this.fx.flash();
    if (hp <= 0) {
      this.koUntil = now + KO_MS;
      this.fx.setKO(true);
    }
  }

  // Called when the KO timer is over: stand up at the spawn point.
  respawn() {
    this.hp = MAX_HP;
    this.koUntil = 0;
    this.knock.x = this.knock.z = 0;
    this.fx.setKO(false);
    const a = Math.random() * Math.PI * 2;
    const s = this.spawn;
    this.teleport(s.x + Math.cos(a) * 2, PLAYER_HALF_HEIGHT + 0.3, s.z + Math.sin(a) * 2);
  }

  teleport(x, y, z) {
    this.body.setTranslation({ x, y, z }, true);
    this.verticalSpeed = 0;
    this.position.set(x, y, z);
  }

  // --- vehicle -----------------------------------------------------------
  enterVehicle() {
    this.inVehicle = true;
    this.mesh.visible = false;
    this.collider.setEnabled(false); // don't collide with the truck we're inside
  }

  exitVehicle(x, z, facing) {
    this.inVehicle = false;
    this.mesh.visible = true;
    this.collider.setEnabled(true);
    this.facing = facing;
    this.teleport(x, PLAYER_HALF_HEIGHT + 0.3, z);
  }
}

// Rotate from angle a towards b by fraction t, the short way around.
export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
