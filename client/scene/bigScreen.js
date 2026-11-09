// client/scene/bigScreen.js
// A giant screen on a building facing the square.
// Shows the clock, the score of each side and TODAY'S TOP 3 KNOCK-OUTS for the
// Protesters and for the Police (from the server; empty again at 06:00 when the day restarts).
// Drawn on a <canvas> and used as a texture; redrawn only when something changes.

import * as THREE from 'three';
import { formatClock, isCurfew } from '../../shared/constants.js';

// On the long south façade (Café République block), facing the square, to the RIGHT of the
// advertising banner (see adBanner.js) so the two never overlap.
const WALL = { x: 34, z: 57.25 };                       // a point on the wall
const NORMAL = { x: -0.0475, z: -1 };                    // the way the wall faces (the square)

export function createBigScreen(scene) {
  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const frame = new THREE.Mesh(new THREE.BoxGeometry(15, 7.8, 0.4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  frame.position.set(0, 0, -0.22);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 7),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), // unlit: glows at night
  );
  const group = new THREE.Group();
  group.add(frame, screen);
  group.position.set(WALL.x + NORMAL.x * 0.6, 12.5, WALL.z + NORMAL.z * 0.6);
  group.rotation.y = Math.atan2(NORMAL.x, NORMAL.z);
  scene.add(group);

  let last = '';
  let topKos = { g: [], c: [] };

  const fit = (text, maxW) => {
    let t = text;
    while (g.measureText(t).width > maxW && t.length > 2) t = t.slice(0, -2) + '…';
    return t;
  };

  function column(cx, color, label, points, list) {
    g.textAlign = 'center';
    g.fillStyle = color;
    g.font = '900 120px system-ui, sans-serif';
    g.fillText(String(points), cx, 205);
    g.font = '800 34px system-ui, sans-serif';
    g.fillText(label, cx, 248);
    // Top 3 knock-outs today
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = '700 22px system-ui, sans-serif';
    g.fillText('TOP K.O. TODAY', cx, 290);
    g.font = '700 30px system-ui, sans-serif';
    if (!list.length) {
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillText('—', cx, 335);
      return;
    }
    list.forEach(([name, kos], i) => {
      const y = 334 + i * 42;
      g.textAlign = 'left';
      g.fillStyle = color;
      g.fillText(`${i + 1}.`, cx - 210, y);
      g.fillStyle = '#ffffff';
      g.fillText(fit(name, 300), cx - 168, y);
      g.textAlign = 'right';
      g.fillStyle = color;
      g.fillText(`${kos}`, cx + 210, y);
    });
  }

  return {
    // [[name, knock-outs], ...] for each side, from the server.
    setTopKos(k) {
      if (k) topKos = { g: k.g || [], c: k.c || [] };
    },

    update(score, minutes, players) {
      const curfew = isCurfew(minutes);
      const key = `${score.g}|${score.c}|${formatClock(minutes)}|${curfew}|${players}|${JSON.stringify(topKos)}`;
      if (key === last) return;
      last = key;

      g.fillStyle = curfew ? '#2a0610' : '#071526';
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(W / 2 - 1, 100, 2, 340); // divider

      g.textAlign = 'center';
      g.fillStyle = '#ffffff';
      g.font = '800 46px system-ui, sans-serif';
      g.fillText(`PLACE DE LA RÉPUBLIQUE · ${formatClock(minutes)}`, W / 2, 62);

      column(W / 4, '#ff4a55', 'PROTESTERS', score.g, topKos.g);
      column((W * 3) / 4, '#7fa6ff', 'POLICE', score.c, topKos.c);

      g.textAlign = 'center';
      g.font = '700 30px system-ui, sans-serif';
      g.fillStyle = curfew ? '#ff5a6e' : '#9fd4ff';
      g.fillText(curfew ? 'CURFEW: HOLD THE SQUARE!' : `${players} player${players === 1 ? '' : 's'} online`, W / 2, 492);
      texture.needsUpdate = true;
    },
  };
}
