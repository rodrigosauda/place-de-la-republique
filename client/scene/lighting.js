// client/scene/lighting.js
// Ambient light (soft fill) + one directional "sun" that casts shadows.
// Shadows only cover a box around the player, and that box follows the
// player around: much sharper (and cheaper) than covering the whole map.

import * as THREE from 'three';

const SUN_OFFSET = new THREE.Vector3(40, 60, 25); // where the sun sits relative to the player
const SHADOW_HALF_SIZE = 45;                      // shadows are drawn in a 90 x 90 m box

export function setupLighting(scene) {
  // Hemisphere light = ambient light with a sky colour and a ground colour.
  const ambient = new THREE.HemisphereLight(0xdfeeff, 0x8a7d6a, 1.2);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -SHADOW_HALF_SIZE;
  cam.right = SHADOW_HALF_SIZE;
  cam.top = SHADOW_HALF_SIZE;
  cam.bottom = -SHADOW_HALF_SIZE;
  cam.near = 1;
  cam.far = 200;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  return {
    sun,
    ambient,
    // Point the sun light where the sky's sun is (above the horizon only).
    setSunDirection(dir, elevation) {
      const e = Math.max(elevation, 0.25); // keep shadows readable at dawn/dusk
      SUN_OFFSET.set(dir.x, 0, dir.z).normalize().multiplyScalar(Math.cos(e) * 75);
      SUN_OFFSET.y = Math.sin(e) * 75;
    },
    // Call every frame with the position the camera is looking at.
    follow(target) {
      sun.target.position.copy(target);
      sun.position.copy(target).add(SUN_OFFSET);
    },
  };
}
