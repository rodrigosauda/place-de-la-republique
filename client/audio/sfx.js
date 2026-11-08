// client/audio/sfx.js
// Sound effects made with the Web Audio API. Short effects (hits, whooshes, drums...) are synthesised:
// a few oscillators / noise bursts shaped with volume envelopes.
// The helicopter and the curfew siren are real CC0 recordings in public/audio/ (credits in
// public/audio/CREDITS.md). They load in the background after the first click; until they arrive, or if
// they fail to load, synthesised versions play instead.
// There is deliberately NO crowd murmur or chanting sound: players found it unpleasant (it can come back
// by re-adding a layer in `ambience`).
// Browsers only allow audio after a click, so call `sfx.unlock()` from the Play button.
// Press M in game to mute/unmute.

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = false;
let sprayNode = null;
let ambient = null;
let rainNode = null;
let rainRumble = null;
let nextDrip = 0;

// ---- recorded loops -------------------------------------------------------------------------
const SAMPLE_FILES = ['heli', 'siren'];
const buffers = {};      // name -> AudioBuffer
let samplesState = 'idle'; // idle | loading | done
let layers = null;       // name -> GainNode (looping layers, started once)

function loadSamples() {
  if (samplesState !== 'idle') return;
  samplesState = 'loading';
  Promise.all(SAMPLE_FILES.map(async (name) => {
    try {
      const res = await fetch(`/audio/${name}.m4a`);
      if (!res.ok) throw new Error(res.status);
      buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) { console.warn('audio sample failed:', name, e); }
  })).then(() => { samplesState = 'done'; });
}

function startLayers() {
  layers = {};
  for (const name of ['heli']) {
    if (!buffers[name]) continue;
    const src = ctx.createBufferSource(); src.buffer = buffers[name]; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(g).connect(master);
    src.start(0, Math.random() * buffers[name].duration); // every visit starts somewhere else
    layers[name] = g;
  }
}

function init() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  // Gentle limiter: the recorded crowd layers plus a brawl must never clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10; limiter.knee.value = 12; limiter.ratio.value = 6; limiter.attack.value = 0.005; limiter.release.value = 0.2;
  master.connect(limiter).connect(ctx.destination);
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
    loadSamples();
  },

  // For debugging: which recordings are loaded and how loud each layer is right now.
  debugState() {
    return { state: samplesState, loaded: Object.keys(buffers), layers: layers ? Object.fromEntries(Object.entries(layers).map(([k, g]) => [k, +g.gain.value.toFixed(3)])) : null };
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
  // Hits vary a little every time (pitch) so a brawl does not sound like one looped sample.
  bonk(v = 1) { if (ready() && v > 0) { const j = 0.8 + Math.random() * 0.45; tone('square', 520 * j, 140 * j, 0.18, 0.35 * v); tone('sine', 900 * j, 300 * j, 0.1, 0.2 * v); noise(0.06, 0.18 * v, 1800, 500, 'lowpass'); } },
  clang(v = 1) { if (ready() && v > 0) { tone('triangle', 1800, 1500, 0.35, 0.25 * v); tone('square', 2400, 2000, 0.15, 0.08 * v); } },
  ko(v = 1) { if (ready() && v > 0) { tone('sine', 700, 120, 0.7, 0.35 * v); tone('sine', 120, 45, 0.35, 0.5 * v); noise(0.25, 0.25 * v, 900, 150, 'lowpass'); } },
  pop() { if (ready()) tone('sine', 600, 900, 0.08, 0.15); },
  splash(v = 1) { if (ready() && v > 0) noise(0.3, 0.3 * v, 2000, 600, 'lowpass'); },

  // Rubber chicken: a squeaky honk that bends down in pitch.
  squeak(v = 1) { if (ready() && v > 0) { const j = 0.85 + Math.random() * 0.4; tone('square', 1300 * j, 700 * j, 0.22, 0.18 * v); tone('sine', 1900 * j, 900 * j, 0.18, 0.12 * v); } },
  cough(v = 1) { if (ready() && v > 0) { noise(0.12, 0.35 * v, 900, 400); setTimeout(() => ready() && noise(0.14, 0.3 * v, 800, 350), 180); } },
  shutter() { if (ready()) { noise(0.04, 0.4, 4000, 3000, 'highpass'); setTimeout(() => ready() && noise(0.05, 0.3, 3000, 2500, 'highpass'), 70); } },
  gasPop(v = 1) { if (ready() && v > 0) { tone('sine', 180, 60, 0.15, 0.4 * v); noise(1.2, 0.25 * v, 3000, 1500, 'highpass'); } },
  whistle(v = 1) { if (ready() && v > 0) { const f = 2600 + Math.random() * 600; tone('sine', f, f * 0.98, 0.25, 0.08 * v); setTimeout(() => ready() && tone('sine', f, f, 0.4, 0.08 * v), 300); } },
  // UI feedback for public opinion: a soft tick for every change, a chime when a threshold is crossed.
  opinionTick(up) { if (ready()) tone('sine', up ? 660 : 520, up ? 880 : 380, 0.12, 0.1); },
  threshold(up) {
    if (!ready()) return;
    const notes = up ? [523, 659, 784] : [440, 349, 262];
    notes.forEach((f, i) => setTimeout(() => ready() && tone('triangle', f, f, 0.3, 0.16), i * 110));
  },
  ding() { if (ready()) { tone('sine', 880, 880, 0.18, 0.14); setTimeout(() => ready() && tone('sine', 1320, 1320, 0.28, 0.12), 110); } },
  heal(v = 1) { if (ready() && v > 0) [660, 880, 1100].forEach((f, i) => setTimeout(() => ready() && tone('sine', f, f * 1.02, 0.25, 0.14 * v), i * 90)); },
  noItem() { if (ready()) tone('square', 200, 150, 0.12, 0.06); },
  // A short drum phrase: boom - ta - boom.
  drumPhrase(v = 1) {
    if (!ready() || v <= 0) return;
    this.drum(v, true);
    setTimeout(() => this.drum(v * 0.8, false), 170);
    setTimeout(() => this.drum(v * 0.8, false), 340);
    setTimeout(() => this.drum(v, true), 520);
  },

  drum(v = 1, big = false) { if (ready() && v > 0) { tone('sine', big ? 120 : 200, big ? 45 : 90, big ? 0.35 : 0.15, (big ? 0.5 : 0.25) * v); if (!big) noise(0.08, 0.15 * v, 2500, 1200); } },

  // Continuous background sounds. Levels 0..1, called every frame:
  //   heli  helicopter overhead        siren  distant police sirens
  // (`murmur` and `chant` are still passed by main.js but ignored: no crowd sound.)
  ambience(murmur, heli, chant = 0, siren = 0) {
    if (!ctx || muted) {
      if (ambient) { for (const g of Object.values(ambient)) g.gain.value = 0; }
      if (layers) { for (const g of Object.values(layers)) g.gain.value = 0; }
      return;
    }
    if (samplesState === 'done' && !layers) startLayers();
    if (!ambient) {
      const loop = (type, freq, q) => {
        const src = ctx.createBufferSource(); src.buffer = noiseBuffer; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(f).connect(g); src.start();
        return { f, g };
      };
      // Helicopter (synthesised fallback): low rumble whose volume flutters ~12 times a second (the rotor).
      const h = loop('lowpass', 160, 1);
      const rotor = ctx.createGain(); rotor.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 12;
      const depth = ctx.createGain(); depth.gain.value = 0.5;
      lfo.connect(depth).connect(rotor.gain); lfo.start();
      h.g.connect(rotor).connect(master);
      // Distant siren: "pin-pon" through a low-pass so it sounds streets away.
      const sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
      const so = ctx.createOscillator(); so.type = 'square'; so.frequency.value = 580;
      const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1100;
      so.connect(sf).connect(sirenGain).connect(master); so.start();
      setInterval(() => { if (sirenGain.gain.value > 0.001) so.frequency.setValueAtTime(so.frequency.value > 500 ? 435 : 580, ctx.currentTime); }, 520);
      ambient = { h: h.g, s: sirenGain };
    }
    const t = ctx.currentTime;
    // The recorded helicopter replaces the synthesised one when it is available.
    if (layers?.heli) {
      ambient.h.gain.setTargetAtTime(0, t, 0.3);
      layers.heli.gain.setTargetAtTime(0.45 * heli, t, 0.5);
    } else ambient.h.gain.setTargetAtTime(0.5 * heli, t, 0.5);
    ambient.s.gain.setTargetAtTime(0.035 * siren, t, 1);
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
      // A low rumble under the hiss (rain on roofs and the street).
      const src2 = ctx.createBufferSource(); src2.buffer = noiseBuffer; src2.loop = true; src2.playbackRate.value = 0.7;
      const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 500;
      const g2 = ctx.createGain(); g2.gain.value = 0;
      src2.connect(f2).connect(g2).connect(master); src2.start();
      rainRumble = g2;
    }
    rainNode.gain.setTargetAtTime(muted ? 0 : 0.09 * level, ctx.currentTime, 0.6);
    rainRumble.gain.setTargetAtTime(muted ? 0 : 0.05 * level, ctx.currentTime, 0.6);
    // Drips: tiny random clicks, more of them in heavier rain.
    const nowMs = performance.now();
    if (!muted && level > 0.2 && nowMs > nextDrip) {
      nextDrip = nowMs + 70 + Math.random() * (260 - 180 * level);
      noise(0.025, 0.05 * level, 3500 + Math.random() * 3000, 2500, 'highpass');
    }
  },

  // French police siren "pin-pon" (curfew starts).
  siren() {
    if (!ready()) return;
    if (buffers.siren) {
      const src = ctx.createBufferSource(); src.buffer = buffers.siren;
      const g = ctx.createGain(); g.gain.value = 0.7;
      src.connect(g).connect(master); src.start();
      return;
    }
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
