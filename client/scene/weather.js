// client/scene/weather.js
// Rain: thin streaks falling in a box that follows the camera (cheap: one LineSegments object).
// How hard it rains comes from today's scenario (shared/timeline.js).

import * as THREE from 'three';
import { LOW_QUALITY } from '../quality.js';

const COUNT = LOW_QUALITY ? 900 : 3600;
const SIZE = 44;      // metres: width/depth of the rain box around the camera
const HEIGHT = 28;    // metres: how high the streaks start
const FALL = 24;      // m/s
const WIND = 3;       // m/s sideways

export function createWeather(scene) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(COUNT * 6);
  const base = new Float32Array(COUNT * 3); // x, y, z of each streak's head (box coordinates)
  for (let i = 0; i < COUNT; i++) {
    base[i * 3] = (Math.random() - 0.5) * SIZE;
    base[i * 3 + 1] = Math.random() * HEIGHT;
    base[i * 3 + 2] = (Math.random() - 0.5) * SIZE;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: 0x9fb0c4, transparent: true, opacity: 0.4, depthWrite: false, fog: false });
  const rain = new THREE.LineSegments(geo, mat);
  rain.frustumCulled = false;
  rain.visible = false;
  rain.userData.noMerge = true;
  scene.add(rain);

  return {
    // intensity 0..1, daylight 0..1 (streaks look dark at night), camera = what the rain follows.
    update(dt, intensity, daylight, camera) {
      rain.visible = intensity > 0.02;
      if (!rain.visible) return;
      rain.position.set(camera.position.x, 0, camera.position.z);
      const shown = Math.floor(COUNT * intensity);
      const k = 0.25 + 0.75 * daylight;
      mat.color.setRGB(0.62 * k, 0.69 * k, 0.77 * k);
      mat.opacity = 0.25 + 0.4 * intensity;
      for (let i = 0; i < COUNT; i++) {
        const o = i * 6;
        if (i >= shown) { pos[o] = pos[o + 3] = pos[o + 1] = pos[o + 4] = pos[o + 2] = pos[o + 5] = 0; continue; }
        let y = base[i * 3 + 1] - FALL * dt;
        if (y < 0) y += HEIGHT;
        base[i * 3 + 1] = y;
        const x = base[i * 3], z = base[i * 3 + 2];
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;                                   // head
        pos[o + 3] = x - WIND * 0.055; pos[o + 4] = y + FALL * 0.055; pos[o + 5] = z; // tail (up and upwind)
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
