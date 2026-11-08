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
    this.dom = domElement;

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

    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.target);
  }
}
