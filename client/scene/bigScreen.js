// client/scene/bigScreen.js
// A giant screen on a building facing the square.
// Shows the faction scores, the game clock and the curfew status.
// Drawn on a <canvas> and used as a texture; redrawn only when something changes.

import * as THREE from 'three';
import { formatClock, isCurfew } from '../../shared/constants.js';

export function createBigScreen(scene, { x = 23.4, y = 12.5, z = 57.45, rotY = Math.PI } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // Screen + dark frame, on the front of the north building at x=0 (facing the plaza).
  const frame = new THREE.Mesh(new THREE.BoxGeometry(15, 7.8, 0.4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  frame.position.set(0, 0, -0.22);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 7),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), // unlit: glows at night
  );
  // On a real façade facing the square (default: south side, facing north = -z).
  const group = new THREE.Group();
  group.add(frame, screen);
  group.position.set(x, y, z);
  group.rotation.y = rotY;
  scene.add(group);

  let last = '';
  return {
    update(score, minutes, players) {
      const curfew = isCurfew(minutes);
      const key = `${score.g}|${score.c}|${formatClock(minutes)}|${curfew}|${players}`;
      if (key === last) return;
      last = key;


      g.fillStyle = curfew ? '#2a0610' : '#071526';
      g.fillRect(0, 0, 512, 256);
      g.textAlign = 'center';
      g.fillStyle = '#ffffff';
      g.font = '700 30px system-ui, sans-serif';
      g.fillText(`PLACE DE LA RÉPUBLIQUE · ${formatClock(minutes)}`, 256, 42);

      g.font = '900 64px system-ui, sans-serif';
      g.fillStyle = '#f7d417';
      g.fillText(String(score.g), 128, 140);
      g.fillStyle = '#7fa6ff';
      g.fillText(String(score.c), 384, 140);
      g.font = '700 24px system-ui, sans-serif';
      g.fillStyle = '#f7d417';
      g.fillText('YELLOW VESTS', 128, 175);
      g.fillStyle = '#7fa6ff';
      g.fillText('POLICE', 384, 175);
      g.fillStyle = '#ffffff';
      g.font = '900 40px system-ui, sans-serif';
      g.fillText('–', 256, 135);

      g.font = '700 24px system-ui, sans-serif';
      g.fillStyle = curfew ? '#ff5a6e' : '#9fd4ff';
      g.fillText(curfew ? 'CURFEW: HOLD THE SQUARE!' : `${players} player${players === 1 ? '' : 's'} online`, 256, 228);
      texture.needsUpdate = true;
    },
  };
}
