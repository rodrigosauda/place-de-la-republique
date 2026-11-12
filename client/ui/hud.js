// client/ui/hud.js
// On-screen texts:
//   top left    : connection status + who is online
//   top centre  : your hearts (or the K.O. countdown)
//   top right   : game clock, curfew banner and faction scores
//   bottom      : context hints ("Press E to drive") and the water gauge

import { MAX_HP, formatClock, isCurfew } from '../../shared/constants.js';

export function createHud() {
  const el = (cls) => {
    const d = document.createElement('div');
    d.className = cls;
    d.style.display = 'none';
    document.body.appendChild(d);
    return d;
  };
  const status = el('hud-status');
  const players = el('hud-players');
  const health = el('hud-health');
  const clock = el('hud-clock');
  const hint = el('hud-hint');
  const water = el('hud-water');
  const lockHint = el('hud-lock');
  lockHint.textContent = 'Click to play — move the mouse to look around · Esc frees the mouse';
  const crosshair = el('hud-crosshair');
  const hit = el('hud-hit'); // red edge flash when you get hit
  const pops = document.createElement('div'); // floating +/- public opinion numbers
  pops.className = 'op-pops';
  document.body.appendChild(pops);
  const shutter = document.createElement('div'); // white flash when you take a photo
  shutter.className = 'hud-shutter';
  document.body.appendChild(shutter);
  hit.style.display = 'block';
  water.innerHTML = '<span>Water</span><div class="bar"><div class="fill"></div></div>';
  const waterFill = water.querySelector('.fill');

  const show = (node, on) => { node.style.display = on ? 'block' : 'none'; };

  return {
    // Red flash around the screen edge. strength 0..1
    flashHit(strength = 1) {
      hit.style.setProperty('--hit', String(Math.min(1, Math.max(0.2, strength))));
      hit.classList.remove('on');
      void hit.offsetWidth; // restart the CSS animation
      hit.classList.add('on');
    },

    // A floating number near the opinion bar: delta > 0 helps the protesters (red), < 0 the police (blue).
    popOpinion(delta, label = '') {
      const pop = document.createElement('div');
      pop.className = 'op-pop ' + (delta > 0 ? 'up' : 'down');
      const n = Math.abs(delta) >= 1 ? Math.round(delta) : Math.round(delta * 10) / 10;
      pop.textContent = `${delta > 0 ? '+' : '−'}${Math.abs(n)}${label ? ' ' + label : ''}`;
      pops.appendChild(pop);
      while (pops.children.length > 5) pops.firstChild.remove();
      setTimeout(() => pop.remove(), 2200);
    },

    // Camera flash (journalist).
    flashShutter() {
      shutter.classList.remove('on');
      void shutter.offsetWidth;
      shutter.classList.add('on');
    },

    // These three are called every frame: only touch the page when the text really changed.
    // alert = a connection problem: always shown in full, even in a narrow window.
    setStatus(text, alert = false) {
      text = text || '';
      if (status.dataset.key === text) return;
      status.dataset.key = text;
      status.textContent = text;
      status.classList.toggle('alert', alert);
      show(status, !!text);
    },

    // List of everyone in the room (proves the connection works).
    setPlayers(list) {
      const text = list.join('\n');
      if (players.dataset.key === text) return;
      players.dataset.key = text;
      players.textContent = text;
      show(players, list.length > 0);
    },

    // Hearts for your health, or a K.O. countdown. hp = null hides it.
    setHealth(hp, koSeconds = 0, weaponText = '') {
      if (hp === null) return show(health, false);
      show(health, true);
      const text = hp > 0
        ? '♥'.repeat(hp) + '♡'.repeat(Math.max(0, MAX_HP - hp))
        : `K.O.! Back on your feet in ${Math.max(koSeconds, 0)}…`;
      const key = text + weaponText;
      if (health.dataset.key === key) return;
      health.dataset.key = key;
      health.innerHTML = '';
      const hearts = document.createElement('div');
      hearts.textContent = text;
      health.append(hearts);
      if (hp > 0 && weaponText) {
        const w = document.createElement('div');
        w.className = 'weapon';
        w.textContent = weaponText;
        health.append(w);
      }
      health.classList.toggle('ko', hp <= 0);
    },

    // Clock + curfew + score. `faction` = your faction, for the objective text.
    // opinion = public opinion 0..100 (100 = all for the protesters); scenario = today's label; note = why it just moved
    setClock(minutes, score, faction, opinion = 50, scenario = '', note = '') {
      if (minutes === null) return show(clock, false);
      show(clock, true);
      const key = `${Math.floor(minutes)}|${score.g}|${score.c}|${faction}|${opinion}|${scenario}|${note}`;
      if (key === clock.dataset.key) return; // nothing changed: don't rebuild
      clock.dataset.key = key;
      const curfew = isCurfew(minutes);
      clock.innerHTML = '';
      const time = document.createElement('div');
      time.className = 'time';
      time.textContent = formatClock(minutes);
      const sc = document.createElement('div');
      sc.className = 'score';
      sc.innerHTML = `<span class="g">Protesters ${score.g}</span> · <span class="c">Police ${score.c}</span>`;
      clock.append(time);
      if (scenario) {
        const scn = document.createElement('div');
        scn.className = 'scn';
        scn.textContent = scenario;
        clock.append(scn);
      }
      clock.append(sc);
      const op = document.createElement('div');
      op.className = 'opinion';
      op.innerHTML = '<div class="op-label"><span class="c">Police</span><span>Public opinion</span><span class="g">Protest</span></div>'
        + `<div class="op-bar"><i style="left:${Math.max(2, Math.min(98, opinion))}%"></i></div>`;
      clock.append(op);
      if (note) {
        const n = document.createElement('div');
        n.className = 'op-note';
        n.textContent = note;
        clock.append(n);
      }
      if (curfew) {
        const banner = document.createElement('div');
        banner.className = 'curfew';
        banner.textContent = 'CURFEW 23:00 – 06:00';
        clock.append(banner);
      }
    },

    setHint(text) {
      text = text || '';
      if (hint.dataset.key === text) return;
      hint.dataset.key = text;
      hint.textContent = text;
      show(hint, !!text);
    },

    // "Click to play" message when the mouse isn't captured, crosshair when it is.
    setMouseLocked(locked, active) {
      show(lockHint, active && !locked);
      show(crosshair, active && locked);
    },

    // Water gauge while driving (0..100), null hides it.
    setWater(level) {
      if (level === null) return show(water, false);
      show(water, true);
      waterFill.style.width = `${Math.max(0, Math.min(100, level))}%`;
    },
  };
}
