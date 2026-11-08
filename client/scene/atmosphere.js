// client/scene/atmosphere.js
// Makes the city look less "raw":
//   - a physically based sky (Sky shader) with a sun that follows the game clock
//   - image-based lighting: a real HDR photo of an outdoor place lights every
//     material (soft light, reflections in windows and metal)
//   - filmic tone mapping (like a camera) instead of flat colours
//   - post-processing (high quality only): ambient occlusion = soft shadows in
//     corners, and a gentle bloom so lamps and lit windows glow at night
// The HDR file is in public/hdr (CC0, from Poly Haven via the three.js examples).

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LOW_QUALITY } from '../quality.js';

export function setupAtmosphere(renderer, scene, camera) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;

  // --- sky ---
  const sky = new Sky();
  sky.scale.setScalar(450); // inside the camera's far plane
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.8;
  if (u.showSunDisc) u.showSunDisc.value = false; // the disc is far too bright for bloom
  sky.userData.noMerge = true;
  scene.add(sky);
  scene.background = null;

  // --- image-based lighting from an HDR photo ---
  const pmrem = new THREE.PMREMGenerator(renderer);
  new HDRLoader().load('/hdr/pedestrian_overpass_1k.hdr', (hdr) => {
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    pmrem.dispose();
  });
  scene.environmentIntensity = 0.6;

  // --- post-processing (skipped on ?quality=low) ---
  let composer = null;
  let bloom = null;
  if (!LOW_QUALITY) {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
    ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1 });
    ao.blendIntensity = 0.8;
    composer.addPass(ao);
    bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0, 0.4, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    window.addEventListener('resize', () => composer.setSize(window.innerWidth, window.innerHeight));
  }

  const sunDir = new THREE.Vector3();
  return {
    sunDirection: sunDir,
    // elevation/azimuth in radians. daylight 0..1, night 0..1 (for bloom).
    setSun(elevation, azimuth, daylight) {
      sunDir.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
      u.sunPosition.value.copy(sunDir).multiplyScalar(450000);
      scene.environmentIntensity = 0.12 + 0.6 * daylight;
      renderer.toneMappingExposure = 0.55 + 0.25 * daylight;
      if (bloom) bloom.strength = 0.55 * (1 - daylight); // glow only after sunset (lamps, windows)
    },
    render(cam) {
      if (composer) composer.render();
      else renderer.render(scene, cam);
    },
  };
}
