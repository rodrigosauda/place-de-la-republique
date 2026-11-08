// client/scene/dayNight.js
// Day / night cycle driven by the shared game clock (shared/constants.js).
// Everybody computes the same time from the real clock, so no network needed.
// At night: darker sky, weaker sun, street lamps glow. Curfew = 23:00 to 06:00.

import * as THREE from 'three';
import { gameMinutes } from '../../shared/constants.js';

const DAY_SKY = new THREE.Color(0xaecbe6);
const DUSK_SKY = new THREE.Color(0xe39a6b);
const NIGHT_SKY = new THREE.Color(0x1a2648);

export function setupDayNight(scene, lighting, physics, nightMaterials = [], atmosphere = null, lampSpots = []) {
  // Street lamps around the plaza (a pole + a glowing ball).
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1f3a2a, flatShading: true }); // Paris green
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1c1, emissive: 0xffd27a, emissiveIntensity: 0 });
  // Real street-lamp positions from the map (OpenStreetMap).
  for (const [x, z] of lampSpots) {
    {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 6), poleMat);
      pole.position.set(x, 2.5, z);
      pole.castShadow = true;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), lampMat);
      lamp.position.set(x, 5.2, z);
      scene.add(pole, lamp);
      physics.addCylinder(x, 2.5, z, 2.5, 0.1);
    }
  }
  // One warm light on the monument at night (cheap: just one).
  const monumentLight = new THREE.PointLight(0xffc27a, 0, 45, 1.2);
  monumentLight.position.set(0, 8, 0);
  scene.add(monumentLight);

  const sky = new THREE.Color();

  return {
    daylight: 1, // 0 at night .. 1 in the day (other modules read it)
    // Returns the current game minutes (so the HUD can show the clock).
    update() {
      const minutes = gameMinutes();
      // daylight: 1 at noon, 0 at night, smooth around 06:00-08:00 and 19:00-21:00
      const h = minutes / 60;
      const daylight = smooth(5.5, 8, h) * (1 - smooth(19, 21.5, h));
      const dusk = Math.max(0, 1 - Math.abs(h - 20) / 1.5) + Math.max(0, 1 - Math.abs(h - 6.8) / 1.2);

      sky.copy(NIGHT_SKY).lerp(DAY_SKY, daylight).lerp(DUSK_SKY, Math.min(dusk, 1) * 0.45);
      if (scene.background) scene.background.copy(sky);
      scene.fog.color.copy(sky);
      // The sun travels across the sky: rises in the east at 06:00, highest at 13:00, sets at 20:00.
      const elevation = Math.sin(((h - 6) / 14) * Math.PI) * 0.95;
      const azimuth = Math.PI * 0.5 + ((h - 6) / 14) * Math.PI;
      atmosphere?.setSun(elevation, azimuth, daylight);
      if (atmosphere) lighting.setSunDirection(atmosphere.sunDirection, elevation);

      lighting.sun.intensity = atmosphere ? 0.1 + 2.6 * daylight : 0.15 + 2.05 * daylight;
      lighting.sun.color.setHSL(0.1, 0.6, 0.6 + 0.3 * daylight);
      // Less flat ambient light when the HDR environment lights the scene.
      lighting.ambient.intensity = atmosphere ? 0.35 + 0.25 * daylight : 0.8 + 0.4 * daylight; // nights stay playable
      lighting.ambient.color.setHSL(0.6, 0.5 - 0.1 * daylight, 0.55 + 0.35 * daylight);

      this.daylight = daylight;
      const night = 1 - daylight;
      lampMat.emissiveIntensity = 2.5 * night;
      // Lit apartment windows and shop fronts glow after sunset.
      for (const m of nightMaterials) m.emissiveIntensity = 1.2 * Math.max(0, night - 0.2);
      monumentLight.intensity = 40 * night;
      return minutes;
    },
  };
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
