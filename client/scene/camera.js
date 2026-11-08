// client/scene/camera.js
// Third-person orbit camera.
//  - Computer: like most 3D games, the mouse is "captured" (Pointer Lock).
//    Just MOVE the mouse to look around — no button needed. Clicks are free
//    for punching. Press Esc to get your mouse pointer back; click to capture again.
//  - Phone / tablet: drag on the view to look around, quick tap = punch.
//  - Mouse wheel to zoom in/out.
//  - The camera smoothly follows a target position (player or truck).
//
// Convention: `yaw` is the horizontal angle. The camera sits "behind" the
// target, so the direction the camera LOOKS at (on the ground) is:
//   forward = (-sin(yaw), 0, -cos(yaw))
// Player movement uses this, so W always means "away from the camera".

import * as THREE from 'three';

const MOUSE_SENSITIVITY = 0.0025; // radians per pixel of mouse movement (raise to turn faster)
const TOUCH_SENSITIVITY = 0.005;

export class ThirdPersonCamera {
  constructor(domElement) {
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
    this.yaw = Math.PI / 2;  // start looking towards -x
    this.pitch = 0.35;       // radians above the horizon
    this.distance = 9;       // metres from the target
    this.minDistance = 3;
    this.maxDistance = 30;
    this.target = new THREE.Vector3(); // smoothed look-at point
    this.shakeAmount = 0;              // metres of random jitter, fades out by itself (see shake())
    this.dom = domElement;

    // Keeping the view clear: tree trunks / lamp posts [[x, z, radius], ...] and walls (physics ray) pull the camera in.
    this.obstacles = [];
    this.physics = null;
    this.shownDistance = this.distance; // the distance actually used this frame (smoothed)
    this.occlusion = true;              // false in the start menu (the camera circles the square from far away)

    this.onTap = null;           // called on a punch click / tap
    this.lockEnabled = false;    // main.js turns this on after you press Play
    this.onLockChange = null;    // main.js shows/hides the "click to play" hint

    // --- computer: pointer lock --------------------------------------------
    document.addEventListener('pointerlockchange', () => this.onLockChange?.(this.locked));
    domElement.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.rotate(e.movementX * MOUSE_SENSITIVITY, e.movementY * MOUSE_SENSITIVITY);
    });
    domElement.addEventListener('mousedown', (e) => {
      if (!this.lockEnabled) return;
      if (!this.locked) {
        this.lock(); // the first click only captures the mouse (no punch)
        return;
      }
      if (e.button === 0) this.onTap?.(); // punch right away, no waiting for mouse-up
    });

    // --- phone / tablet: drag to look, tap to punch --------------------------
    let dragging = false;
    let moved = 0;
    let lastX = 0, lastY = 0;
    domElement.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      domElement.setPointerCapture(e.pointerId);
    });
    domElement.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') return;
      dragging = false;
      domElement.releasePointerCapture(e.pointerId);
      if (moved < 8) this.onTap?.();
    });
    domElement.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerType !== 'touch') return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      this.rotate(dx * TOUCH_SENSITIVITY, dy * TOUCH_SENSITIVITY);
    });
    domElement.addEventListener('wheel', (e) => {
      this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.01, this.minDistance, this.maxDistance);
    }, { passive: true });
    domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  // Give the camera the posts it must not sit inside (see world.obstacles) and the physics world for walls.
  setOcclusion(obstacles, physics) {
    this.obstacles = obstacles;
    this.physics = physics;
  }

  // How far behind the target the camera may go along the direction (dx,dy,dz) before something blocks the view.
  clearDistance(dx, dy, dz, wanted) {
    let d = wanted;
    const T = this.target;
    // 1) round posts (tree trunks are about 5 m tall; above that the view is free)
    const hx = dx, hz = dz, len = Math.hypot(hx, hz);
    if (len > 1e-4) {
      const ux = hx / len, uz = hz / len;
      for (const [ox, oz, r] of this.obstacles) {
        const px = ox - T.x, pz = oz - T.z;
        if (px * px + pz * pz > (wanted + 2) * (wanted + 2)) continue;
        const along = px * ux + pz * uz;                 // metres (horizontal) to the closest point
        if (along < 0.3) continue;
        const off = Math.abs(px * uz - pz * ux);         // sideways miss distance
        const rr = r + 0.45;
        if (off > rr) continue;
        const enter = (along - Math.sqrt(rr * rr - off * off)) / len; // back to 3D distance along the ray
        const height = T.y + dy * enter;
        if (height < 6 && enter < d) d = Math.max(0.5, enter - 0.1);
      }
    }
    // 2) walls and buildings (static colliders only: not players, not the truck)
    if (this.physics) {
      const { RAPIER, world } = this.physics;
      const ray = new RAPIER.Ray({ x: T.x, y: T.y, z: T.z }, { x: dx, y: dy, z: dz });
      const flags = RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
      const hit = world.castRay(ray, d, true, flags);
      if (hit && hit.timeOfImpact < d) d = Math.max(0.5, hit.timeOfImpact - 0.25);
    }
    return d;
  }

  get locked() {
    return document.pointerLockElement === this.dom;
  }

  // Capture the mouse (must be called from a click or key press).
  lock() {
    try {
      const p = this.dom.requestPointerLock();
      p?.catch?.(() => {}); // some browsers return a promise that can reject
    } catch { /* not supported: the game still works with the keyboard */ }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  rotate(dYaw, dPitch) {
    this.yaw -= dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, 0.05, 1.3);
  }

  // The direction the camera looks at, as a player "facing" angle.
  get aimYaw() {
    return this.yaw + Math.PI;
  }

  // Hits and bumps: 0.1 = a tap, 0.4 = a big hit. Several shakes don't add up, the biggest wins.
  shake(amount) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  // Jump straight to a position (no smoothing), e.g. right after spawning.
  snapTo(position) {
    this.target.copy(position);
  }

  // Call once per frame. `position` = what to follow, `height` = look-at height above it.
  update(dt, position, height = 1.5) {
    // Exponential smoothing: frame-rate independent "lerp towards".
    const k = 1 - Math.exp(-12 * dt);
    this.target.x += (position.x - this.target.x) * k;
    this.target.y += (position.y + height - this.target.y) * k;
    this.target.z += (position.z - this.target.z) * k;

    // Direction from the target to the camera, and how far we can really go along it.
    const dirX = Math.sin(this.yaw) * Math.cos(this.pitch);
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * Math.cos(this.pitch);
    const free = this.occlusion ? this.clearDistance(dirX, dirY, dirZ, this.distance) : this.distance;
    // Pull in fast when something blocks the view, drift back out slowly.
    this.shownDistance += (free - this.shownDistance) * (1 - Math.exp(-(free < this.shownDistance ? 25 : 3) * dt));
    const dist = Math.min(this.distance, Math.max(0.5, this.shownDistance));
    this.camera.position.set(
      this.target.x + dirX * dist,
      this.target.y + dirY * dist,
      this.target.z + dirZ * dist,
    );
    if (this.shakeAmount > 0.002) {
      const a = this.shakeAmount;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.camera.position.z += (Math.random() - 0.5) * a;
      this.shakeAmount *= Math.exp(-9 * dt);
    } else this.shakeAmount = 0;
    this.camera.lookAt(this.target);
  }
}
