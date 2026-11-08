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
  water.innerHTML = '<span>Water</span><div class="bar"><div class="fill"></div></div>';
  const waterFill = water.querySelector('.fill');

  const show = (node, on) => { node.style.display = on ? 'block' : 'none'; };

  return {
    setStatus(text) {
      status.textContent = text || '';
      show(status, !!text);
    },

    // List of everyone in the room (proves the connection works).
    setPlayers(list) {
      players.textContent = list.join('\n');
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
    setClock(minutes, score, faction) {
      if (minutes === null) return show(clock, false);
      show(clock, true);
      const key = `${Math.floor(minutes)}|${score.g}|${score.c}|${faction}`;
      if (key === clock.dataset.key) return; // nothing changed: don't rebuild
      clock.dataset.key = key;
      const curfew = isCurfew(minutes);
      clock.innerHTML = '';
      const time = document.createElement('div');
      time.className = 'time';
      time.textContent = formatClock(minutes);
      const sc = document.createElement('div');
      sc.className = 'score';
      sc.innerHTML = `<span class="g">Yellow Vests ${score.g}</span> · <span class="c">Police ${score.c}</span>`;
      clock.append(time, sc);
      if (curfew) {
        const banner = document.createElement('div');
        banner.className = 'curfew';
        banner.textContent = 'CURFEW 23:00 – 06:00';
        clock.append(banner);
      }
    },

    setHint(text) {
      hint.textContent = text || '';
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
