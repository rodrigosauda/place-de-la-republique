// client/ui/riotUi.js
// Screen overlays for the riot day:
//   - "BREAKING" news banner (timeline headlines + live events from the server)
//   - today's objective for your side (under the clock) + a ring on the ground
//   - tear-gas haze over the screen
//   - the end-of-day summary window

import * as THREE from 'three';
import { FACTIONS } from '../../shared/constants.js';

export function createRiotUi(scene) {
  const div = (cls, parent = document.body) => {
    const d = document.createElement('div');
    d.className = cls;
    parent.appendChild(d);
    return d;
  };

  // ---------------------------------------------------------- news banner
  const news = div('news-banner');
  news.innerHTML = '<span class="tag">BREAKING</span><span class="text"></span>';
  const newsText = news.querySelector('.text');
  let newsUntil = 0;
  const queue = [];

  // ---------------------------------------------------------- objective
  const objective = div('hud-objective');
  objective.style.display = 'none';

  // A pulsing ring on the ground where the objective is.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.94, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.userData.noMerge = true;
  ring.visible = false;
  scene.add(ring);

  // ---------------------------------------------------------- gas
  const gas = div('gas-overlay');

  // ---------------------------------------------------------- summary
  const summary = div('menu-overlay summary-overlay');
  summary.style.display = 'none';

  return {
    // Show a headline (queued if another one is still on screen).
    news(text) {
      if (!text) return;
      queue.push(text);
    },

    update(now) {
      if (now > newsUntil && queue.length) {
        newsText.textContent = queue.shift();
        news.classList.add('on');
        newsUntil = now + 9000;
      } else if (now > newsUntil) news.classList.remove('on');
    },

    // obj = today's objective from shared/timeline.js (or null), dist = metres to it.
    // lineState: 1 the police line is advancing, 0 held, -1 falling back, null = no clash now.
    setObjective(obj, faction, distance, phaseTitle, lineState = null) {
      if (!faction) { objective.style.display = 'none'; ring.visible = false; return; }
      objective.style.display = 'block';
      const text = obj ? obj[faction] : phaseTitle;
      const far = obj && !obj.zone.plaza && distance > obj.zone.r ? ` · ${Math.round(distance)} m` : '';
      const LINE = { 1: 'Police line: advancing', 0: 'Police line: HELD by protesters', '-1': 'Police line: FALLING BACK' };
      const status = lineState === null || lineState === undefined ? '' : LINE[lineState];
      const key = `${text}${far}${status}`;
      if (objective.dataset.key !== key) {
        objective.dataset.key = key;
        objective.innerHTML = '';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = obj ? 'GOAL' : phaseTitle.toUpperCase();
        objective.append(label, document.createTextNode(obj ? ` ${text}${far}` : ''));
        if (status) {
          const st = document.createElement('div');
          st.className = 'line-state s' + lineState;
          st.textContent = status;
          objective.append(st);
        }
        objective.classList.toggle('free', !obj);
      }
      ring.visible = !!obj && !obj.zone.plaza;
      if (ring.visible) {
        ring.position.set(obj.zone.x, 0.06, obj.zone.z);
        ring.scale.setScalar(obj.zone.r);
        ring.material.color.set(FACTIONS[faction]?.color ?? 0xffffff);
        ring.material.opacity = 0.35 + Math.sin(performance.now() / 300) * 0.15;
      }
    },

    // 0..1 how much gas you are breathing.
    setGas(level) {
      gas.style.opacity = String(Math.min(0.75, level * 0.75));
    },

    // The end-of-day window. msg = SUMMARY from the server.
    showSummary(msg, onClose) {
      const winner = msg.winner === 'draw' ? 'A draw!' : `${FACTIONS[msg.winner].label} win the day!`;
      summary.innerHTML = '';
      const card = div('menu-card summary', summary);
      const h = document.createElement('h1');
      h.textContent = 'End of the day';
      const w = document.createElement('p');
      w.className = 'winner';
      w.textContent = `${winner}  Yellow Vests ${msg.g} – ${msg.c} Police`;
      card.append(h, w);
      if (msg.top?.length) {
        const table = document.createElement('table');
        table.innerHTML = '<tr><th>Player</th><th>K.O.</th><th>Goal pts</th><th>Tags</th><th>Total</th></tr>';
        for (const p of msg.top) {
          const tr = document.createElement('tr');
          for (const v of [p.n, p.ko, p.zp, p.tg, p.total]) {
            const td = document.createElement('td');
            td.textContent = String(v);
            tr.append(td);
          }
          tr.firstChild.style.color = `#${(FACTIONS[p.f]?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
          table.append(tr);
        }
        card.append(table);
      }
      for (const a of msg.awards ?? []) {
        const p = document.createElement('p');
        p.className = 'award';
        p.textContent = `★ ${a}`;
        card.append(p);
      }
      const next = document.createElement('p');
      next.className = 'help';
      next.textContent = 'A new day begins on Place de la République. Scores are back to 0.';
      const btn = document.createElement('button');
      btn.textContent = 'Keep playing';
      btn.onclick = () => { summary.style.display = 'none'; onClose?.(); };
      card.append(next, btn);
      summary.style.display = 'flex';
    },
  };
}
