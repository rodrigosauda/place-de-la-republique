// client/physics/physics.js
// Thin wrapper around Rapier. Rapier runs only in the browser (client-side).
// The world is static (ground, buildings, monument) + kinematic bodies
// for the local player and the truck, moved by character controllers.

import RAPIER from '@dimforge/rapier3d-compat';

export class Physics {
  // Rapier is WebAssembly, so it must be loaded before use: `await Physics.create()`.
  static async create() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.RAPIER = RAPIER;
    // We don't use gravity from Rapier (no dynamic bodies yet); the character
    // controllers apply their own gravity. Kept for future dynamic objects.
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  // --- Static colliders (never move) -------------------------------------

  // Axis-aligned box. (x,y,z) = centre, (hx,hy,hz) = half sizes.
  addBox(x, y, z, hx, hy, hz, rotY = 0) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z);
    if (rotY) desc.setRotation(quatFromYaw(rotY));
    return this.world.createCollider(desc);
  }

  // Upright cylinder. (x,y,z) = centre.
  addCylinder(x, y, z, halfHeight, radius) {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(x, y, z);
    return this.world.createCollider(desc);
  }

  // --- Kinematic bodies (moved by code, they push nothing but block movement) --

  // Creates a kinematic body + collider + character controller in one go.
  createKinematic(colliderDesc, x, y, z) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
    );
    const collider = this.world.createCollider(colliderDesc, body);
    // 0.02 = small gap the controller keeps from obstacles (avoids jitter).
    const controller = this.world.createCharacterController(0.02);
    return { body, collider, controller };
  }

  step(dt) {
    this.world.timestep = dt;
    this.world.step();
  }
}

// Rotation around the vertical axis as a quaternion {x,y,z,w}.
export function quatFromYaw(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
