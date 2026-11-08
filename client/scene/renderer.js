// client/scene/renderer.js
// Creates the WebGL renderer (3D) and a CSS2D renderer (HTML name labels
// floating above players). Both fill the window and resize with it.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { LOW_QUALITY } from '../quality.js';

export function createRenderers(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(LOW_QUALITY ? 0.6 : Math.min(window.devicePixelRatio, 1.5)); // cap for performance (the game adapts it further, see main.js)
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !LOW_QUALITY;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  // Labels are normal HTML elements positioned over the canvas.
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, labelRenderer };
}
