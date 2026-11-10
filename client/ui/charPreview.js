// client/ui/charPreview.js
// A small live 3D picture of a character (used by the shop's try-on).
// Turns gently left and right; drag to rotate. setLook() swaps the outfit.

import * as THREE from 'three';
import { DEFAULT_WEAPON } from '../../shared/constants.js';
import { createPlayerMesh } from '../player/playerMesh.js';
import { CharacterFx } from '../combat/effects.js';

export function createCharPreview({ faction, look, slogan = '', width = 240, height = 300 }) {
  const box = document.createElement('div');
  box.className = 'char-preview';
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7d6a, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 50);
  camera.position.set(0, 0.9, 7.2);
  camera.lookAt(0, 0.55, 0);

  let mesh = null, fx = null, spin = -0.35, dragging = false, lastX = 0, alive = true;
  let cur = { faction, look, slogan };
  function rebuild() {
    if (mesh) { scene.remove(mesh); mesh.userData.dispose?.(); }
    mesh = createPlayerMesh('', cur.faction, false, cur.faction === 'g' ? cur.slogan || 'Lower prices!' : '', false, cur.look);
    for (const o of [mesh.userData.parts.label, mesh.userData.parts.bubble]) { if (o) { mesh.remove(o); o.element?.remove(); } }
    fx = new CharacterFx(mesh);
    fx.setWeapon(DEFAULT_WEAPON[cur.faction] ?? 1);
    scene.add(mesh);
  }
  rebuild();

  renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; });
  const up = () => { dragging = false; };
  window.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    spin += (e.clientX - lastX) * 0.01;
    lastX = e.clientX;
  });
  let last = performance.now();
  const loop = (now) => {
    if (!alive) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!dragging) spin = Math.sin(now / 2500) * 0.9;
    mesh.rotation.y = spin;
    fx.update(dt, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    element: box,
    setLook(look, faction = cur.faction) { cur = { ...cur, look, faction }; rebuild(); },
    emote(i) { fx.playEmote(i); },
    destroy() {
      alive = false;
      window.removeEventListener('pointerup', up);
      mesh?.userData.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss();
      box.remove();
    },
  };
}
