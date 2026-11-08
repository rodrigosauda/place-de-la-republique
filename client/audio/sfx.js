// client/audio/sfx.js
// Sound effects made with the Web Audio API — no sound files needed.
// Every sound is a few oscillators / noise bursts shaped with volume envelopes.
// Browsers only allow audio after a click, so call `sfx.unlock()` from the Play button.
// Press M in game to mute/unmute.

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = false;
let sprayNode = null;
let ambient = null;
let rainNode = null;

function init() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  // 1 second of white noise, reused for whooshes, splashes and the water jet.
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

// volume 0..1 (use `distanceVolume` for sounds made by other players)
function envelope(volume, attack, decay) {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(master);
  return g;
}

function tone(type, from, to, duration, volume) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
  o.connect(envelope(volume, 0.005, duration));
  o.start();
  o.stop(ctx.currentTime + duration + 0.05);
}

function noise(duration, volume, filterFrom, filterTo, type = 'bandpass') {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(filterFrom, ctx.currentTime);
  f.frequency.exponentialRampToValueAtTime(filterTo, ctx.currentTime + duration);
  src.connect(f);
  f.connect(envelope(volume, 0.01, duration));
  src.start();
  src.stop(ctx.currentTime + duration + 0.05);
}

const ready = () => ctx && !muted;

export const sfx = {
  unlock() {
    init();
    if (ctx.state === 'suspended') ctx.resume();
  },

  toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    if (muted) this.spray(false);
    return muted;
  },

  // Quieter the further away (0 at 40 m).
  distanceVolume(distance) {
    return Math.max(0, 1 - distance / 40);
  },

  whoosh(v = 1) { if (ready() && v > 0) noise(0.22, 0.5 * v, 300, 3000); },
  bonk(v = 1) { if (ready() && v > 0) { tone('square', 520, 140, 0.18, 0.35 * v); tone('sine', 900, 300, 0.1, 0.2 * v); } },
  clang(v = 1) { if (ready() && v > 0) { tone('triangle', 1800, 1500, 0.35, 0.25 * v); tone('square', 2400, 2000, 0.15, 0.08 * v); } },
  ko(v = 1) { if (ready() && v > 0) { tone('sine', 700, 120, 0.7, 0.35 * v); } },
  pop() { if (ready()) tone('sine', 600, 900, 0.08, 0.15); },
  splash(v = 1) { if (ready() && v > 0) noise(0.3, 0.3 * v, 2000, 600, 'lowpass'); },

  // Rubber chicken: a squeaky honk that bends down in pitch.
  squeak(v = 1) { if (ready() && v > 0) { tone('square', 1300, 700, 0.22, 0.18 * v); tone('sine', 1900, 900, 0.18, 0.12 * v); } },
  cough(v = 1) { if (ready() && v > 0) { noise(0.12, 0.35 * v, 900, 400); setTimeout(() => ready() && noise(0.14, 0.3 * v, 800, 350), 180); } },
  shutter() { if (ready()) { noise(0.04, 0.4, 4000, 3000, 'highpass'); setTimeout(() => ready() && noise(0.05, 0.3, 3000, 2500, 'highpass'), 70); } },
  gasPop(v = 1) { if (ready() && v > 0) { tone('sine', 180, 60, 0.15, 0.4 * v); noise(1.2, 0.25 * v, 3000, 1500, 'highpass'); } },
  whistle(v = 1) { if (ready() && v > 0) { const f = 2600 + Math.random() * 600; tone('sine', f, f * 0.98, 0.25, 0.08 * v); setTimeout(() => ready() && tone('sine', f, f, 0.4, 0.08 * v), 300); } },
  drum(v = 1, big = false) { if (ready() && v > 0) { tone('sine', big ? 120 : 200, big ? 45 : 90, big ? 0.35 : 0.15, (big ? 0.5 : 0.25) * v); if (!big) noise(0.08, 0.15 * v, 2500, 1200); } },

  // Continuous background sounds (crowd murmur, helicopter). Levels 0..1, called every frame.
  ambience(murmur, heli) {
    if (!ctx || muted) { if (ambient) { ambient.m.gain.value = 0; ambient.h.gain.value = 0; } return; }
    if (!ambient) {
      const loop = (type, freq, q) => {
        const src = ctx.createBufferSource(); src.buffer = noiseBuffer; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(f).connect(g); src.start();
        return { f, g };
      };
      const m = loop('bandpass', 500, 0.6);
      m.g.connect(master);
      // Helicopter: low rumble whose volume flutters ~12 times a second (the rotor).
      const h = loop('lowpass', 160, 1);
      const rotor = ctx.createGain(); rotor.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 12;
      const depth = ctx.createGain(); depth.gain.value = 0.5;
      lfo.connect(depth).connect(rotor.gain); lfo.start();
      h.g.connect(rotor).connect(master);
      ambient = { m: m.g, h: h.g };
    }
    const t = ctx.currentTime;
    ambient.m.gain.setTargetAtTime(0.12 * murmur, t, 0.5);
    ambient.h.gain.setTargetAtTime(0.5 * heli, t, 0.5);
  },

  // Steady rain hiss (0..1). Called every frame; silent when the level is 0.
  rain(level) {
    if (!ctx) return;
    if (!rainNode) {
      if (level <= 0) return;
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2200;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(master); src.start();
      rainNode = g;
    }
    rainNode.gain.setTargetAtTime(muted ? 0 : 0.07 * level, ctx.currentTime, 0.6);
  },

  // French police siren "pin-pon" (curfew starts).
  siren() {
    if (!ready()) return;
    for (let i = 0; i < 4; i++) {
      setTimeout(() => tone('square', i % 2 ? 435 : 580, i % 2 ? 435 : 580, 0.45, 0.12), i * 500);
    }
  },

  // Looping hiss while the water cannon is on (only for the driver / nearby).
  spray(on, v = 1) {
    if (!ctx) return;
    if (on && !muted && !sprayNode && v > 0) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.value = 0.18 * v;
      src.connect(f).connect(g).connect(master);
      src.start();
      sprayNode = { src, g };
    } else if (sprayNode) {
      if (on) { sprayNode.g.gain.value = 0.18 * v; return; }
      sprayNode.src.stop();
      sprayNode = null;
    }
  },
};
