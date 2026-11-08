// client/ui/minimap.js
// A round minimap (bottom right): the real streets and buildings around you, rotated so that
// "up" is where the camera looks. Shows the day's objective (with an arrow at the edge when it is
// out of view), both bases, the truck, other players and the police line.

import MAP from '../scene/mapData.json';
import { WORLD, BASES, PLAZA } from '../../shared/constants.js';

const SIZE = 170 * 2;          // canvas pixels (drawn at 170 CSS px, so it stays sharp on retina screens)
const VIEW_RADIUS = 75;        // metres from the centre to the edge of the minimap
const BG_SCALE = 1.5;          // pixels per metre in the pre-drawn background

// Draw the static city once into an off-screen canvas.
function paintBackground() {
  const w = Math.round(WORLD.halfX * 2 * BG_SCALE);
  const h = Math.round(WORLD.halfZ * 2 * BG_SCALE);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2e37'; // ground
  g.fillRect(0, 0, w, h);
  const X = (v) => (v / 10 + WORLD.halfX) * BG_SCALE;
  const Z = (v) => (v / 10 + WORLD.halfZ) * BG_SCALE;
  const poly = (flat, fill) => {
    g.beginPath();
    for (let i = 0; i < flat.length; i += 2) {
      if (i === 0) g.moveTo(X(flat[i]), Z(flat[i + 1])); else g.lineTo(X(flat[i]), Z(flat[i + 1]));
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  for (const r of MAP.roads) poly(r.o, '#4a4e5a');
  for (const r of MAP.pedestrian) poly(r.o, '#cfc7b4');
  for (const b of MAP.buildings) poly(b.p, '#8b8577');
  return c;
}

export function createMinimap() {
  const canvas = document.createElement('canvas');
  canvas.className = 'minimap';
  canvas.width = SIZE; canvas.height = SIZE;
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d');
  const bg = paintBackground();
  const zoom = SIZE / 2 / VIEW_RADIUS; // pixels per metre on the minimap
  const COLORS = { g: '#f7d417', c: '#7f9dff' };

  // One dot, drawn in minimap pixels (not metres) so it keeps its size.
  const dot = (x, z, r, color, ring = false) => {
    g.beginPath();
    g.arc(x, z, r / zoom, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    if (ring) { g.lineWidth = 2 / zoom; g.strokeStyle = '#000'; g.stroke(); }
  };

  return {
    show(on) { canvas.style.display = on ? 'block' : 'none'; },

    // me = { x, z, faction }; yaw = camera yaw; others = [{ x, z, faction }]; truck = { x, z }
    update({ me, yaw, others, truck, objective, line }) {
      const half = SIZE / 2;
      g.clearRect(0, 0, SIZE, SIZE);
      g.save();
      g.beginPath(); g.arc(half, half, half, 0, Math.PI * 2); g.clip();
      g.fillStyle = '#1b1d24'; g.fillRect(0, 0, SIZE, SIZE);

      // World space: 1 unit = 1 metre, centred on you, rotated so the camera looks "up".
      g.translate(half, half);
      g.rotate(yaw);
      g.scale(zoom, zoom);
      g.translate(-me.x, -me.z);
      g.drawImage(bg, -WORLD.halfX, -WORLD.halfZ, WORLD.halfX * 2, WORLD.halfZ * 2);

      // Bases
      for (const [f, b] of Object.entries(BASES)) {
        g.beginPath(); g.arc(b.x, b.z, b.r, 0, Math.PI * 2);
        g.fillStyle = f === 'c' ? 'rgba(127,157,255,0.35)' : 'rgba(247,212,23,0.35)';
        g.fill();
      }
      // Today's objective: pulsing ring (or the whole square at curfew)
      if (objective) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 280);
        g.lineWidth = 2.5 / zoom;
        g.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * pulse})`;
        g.fillStyle = 'rgba(255,255,255,0.18)';
        if (objective.plaza) {
          g.fillRect(PLAZA.minX, PLAZA.minZ, PLAZA.maxX - PLAZA.minX, PLAZA.maxZ - PLAZA.minZ);
          g.strokeRect(PLAZA.minX, PLAZA.minZ, PLAZA.maxX - PLAZA.minX, PLAZA.maxZ - PLAZA.minZ);
        } else {
          g.beginPath(); g.arc(objective.x, objective.z, objective.r, 0, Math.PI * 2);
          g.fill(); g.stroke();
        }
      }
      // Police line: a red marker where the shields are
      if (line) dot(line.x, line.z, 6, '#ff4d5e', true);
      if (truck) dot(truck.x, truck.z, 5, '#ffffff', true);
      for (const o of others) dot(o.x, o.z, 3.5, COLORS[o.faction] || '#fff', true);
      g.restore();

      // You: an arrow in the centre (always pointing up = where the camera looks)
      g.save();
      g.translate(half, half);
      g.beginPath();
      g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath();
      g.fillStyle = COLORS[me.faction] || '#fff';
      g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
      g.restore();

      // Objective out of view: a small arrow on the rim pointing towards it.
      if (objective && !objective.plaza) {
        const dx = objective.x - me.x, dz = objective.z - me.z;
        const dist = Math.hypot(dx, dz);
        if (dist - objective.r > VIEW_RADIUS * 0.95) {
          const sx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
          const sy = dx * Math.sin(yaw) + dz * Math.cos(yaw);
          const a = Math.atan2(sy, sx);
          g.save();
          g.translate(half + Math.cos(a) * (half - 16), half + Math.sin(a) * (half - 16));
          g.rotate(a);
          g.beginPath(); g.moveTo(10, 0); g.lineTo(-7, 8); g.lineTo(-7, -8); g.closePath();
          g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
          g.restore();
        }
      }
    },
  };
}
