// client/scene/tags.js
// Graffiti tags: your name sprayed on a wall, in your faction's colours.
// The server stores them (max MAX_TAGS, oldest disappear) so everyone sees them.

import * as THREE from 'three';
import { MAX_TAGS } from '../../shared/constants.js';

const FONTS = ['900 italic 64px "Arial Black", Impact, sans-serif', '900 64px Impact, "Arial Black", sans-serif'];

export function createTagLayer(scene) {
  const meshes = [];

  function makeTexture(text, faction) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 160;
    const g = c.getContext('2d');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = FONTS[text.length % FONTS.length];
    // shrink to fit
    let size = 64;
    while (g.measureText(text).width > 470 && size > 24) { size -= 4; g.font = g.font.replace(/\d+px/, `${size}px`); }
    const fill = faction === 'c' ? '#3b6dff' : '#f7d417';
    g.lineJoin = 'round';
    g.lineWidth = 14;
    g.strokeStyle = '#111';
    g.save();
    g.translate(256, 80);
    g.rotate(-0.06);
    g.strokeText(text, 0, 0);
    g.fillStyle = fill;
    g.fillText(text, 0, 0);
    // a few spray drips
    g.fillStyle = fill;
    for (let i = 0; i < 6; i++) g.fillRect(-200 + i * 75 + (text.length * 13) % 30, 18, 4, 18 + ((i * 37) % 30));
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function add(tag) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.8),
      new THREE.MeshStandardMaterial({ map: makeTexture(tag.n, tag.f), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const n = new THREE.Vector3(tag.nx, tag.ny, tag.nz);
    mesh.position.set(tag.x, tag.y, tag.z).addScaledVector(n, 0.04);
    mesh.lookAt(mesh.position.clone().add(n));
    scene.add(mesh);
    meshes.push(mesh);
    while (meshes.length > MAX_TAGS) {
      const old = meshes.shift();
      scene.remove(old);
      old.material.map.dispose();
      old.geometry.dispose();
    }
  }

  return {
    add,
    setAll(list) {
      for (const m of meshes) scene.remove(m);
      meshes.length = 0;
      list.forEach(add);
    },
  };
}
