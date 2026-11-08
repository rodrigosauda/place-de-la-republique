// client/network/interpolation.js
// Snapshot interpolation, explained simply:
//   The server sends positions ~10 times per second. If we drew remote
//   players exactly where the newest snapshot says, they would "teleport"
//   every 100 ms. Instead we draw them slightly in the PAST
//   (INTERP_DELAY_MS ago). At that moment in time we usually have one
//   snapshot just before and one just after, and we blend between the two.

import { INTERP_DELAY_MS } from '../../shared/constants.js';

const MAX_SAMPLES = 20; // ~2 seconds of history at 10 Hz is plenty

export class InterpolationBuffer {
  constructor() {
    this.samples = []; // [{ time, x, y, z, r }] oldest first
  }

  // time = performance.now() when the snapshot arrived.
  push(time, x, y, z, r) {
    this.samples.push({ time, x, y, z, r });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  // Forget history and jump to a pose (e.g. when the truck changes driver).
  reset(time, x, y, z, r) {
    this.samples = [{ time, x, y, z, r }];
  }

  // Returns the interpolated pose for "now - delay", or null if empty.
  sample(now, out = {}) {
    const s = this.samples;
    if (s.length === 0) return null;

    const renderTime = now - INTERP_DELAY_MS;

    // Before the oldest sample or after the newest: just hold the edge value.
    if (renderTime <= s[0].time) return copy(out, s[0]);
    const last = s[s.length - 1];
    if (renderTime >= last.time) return copy(out, last);

    // Find the two samples around renderTime and blend them.
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1];
      const b = s[i];
      if (renderTime >= a.time) {
        const t = (renderTime - a.time) / (b.time - a.time || 1);
        out.x = a.x + (b.x - a.x) * t;
        out.y = a.y + (b.y - a.y) * t;
        out.z = a.z + (b.z - a.z) * t;
        out.r = lerpAngle(a.r, b.r, t);
        return out;
      }
    }
    return copy(out, last);
  }
}

function copy(out, s) {
  out.x = s.x; out.y = s.y; out.z = s.z; out.r = s.r;
  return out;
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
