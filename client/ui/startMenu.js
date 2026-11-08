// client/ui/startMenu.js
// The HTML overlay shown before playing: name, faction, placard slogan and
// the outfit editor (with a live 3D preview). Calls onPlay(...) once.

import { FACTIONS, MAX_NAME_LENGTH, MAX_SLOGAN_LENGTH, ROLES, roleFor, badgeText, badgeForDays } from '../../shared/constants.js';
import { loadProfile, updateProfile } from '../profile.js';
import { createOutfitEditor, loadSavedLook, saveLook } from './outfitEditor.js';
import { currentScenario, scenarioLabel } from '../../shared/timeline.js';
import { loadProgress, levelProgress } from './progress.js';

const SLOGAN_PRESETS = ['Lower prices!', 'Fair wages', 'Hands off pensions', 'We want to be heard', 'Peaceful and loud', 'Our future!'];

export function showStartMenu(onPlay) {
  const overlay = document.createElement('div');
  overlay.className = 'menu-overlay';
  overlay.innerHTML = `
    <form class="menu-card wide">
      <div class="menu-left">
        <h1>Place de la République</h1>
        <p class="subtitle">A protest day on Place de la République in Paris: the crowd gathers in the morning, marches at 14:00,
          clashes with the police at 17:00, and the curfew starts at 23:00. Pick a side. Cartoon brawls only: 3 bonks and you're K.O. Protesters fight with a baguette, police with a rubber chicken.</p>

        <p class="today"><b>On the square right now: ${scenarioLabel()}.</b> ${currentScenario().blurb}</p>
        <p class="lastday" hidden></p>
        <p class="streak" hidden></p>
        <p class="online" hidden></p>

        <span class="label">Faction</span>
        <div class="factions">
          ${Object.entries(FACTIONS).map(([code, f], i) => `
            <label class="faction">
              <input type="radio" name="faction" value="${code}" ${i === 0 ? 'checked' : ''} />
              <span class="swatch" style="background:#${f.color.toString(16).padStart(6, '0')}"></span>
              <span>${f.label}<em class="count" data-f="${code}"></em></span>
            </label>`).join('')}
        </div>

        <span class="label">Role (optional)</span>
        <div class="roles"></div>
        <p class="role-blurb"></p>

        <label for="name">Your name</label>
        <input id="name" name="name" maxlength="${MAX_NAME_LENGTH}" placeholder="Your name" autocomplete="off" required />

        <label for="slogan" class="slogan-label">Your placard (Yellow Vests)</label>
        <input id="slogan" name="slogan" maxlength="${MAX_SLOGAN_LENGTH}" placeholder="Lower prices!" autocomplete="off" />
        <div class="slogan-presets">${SLOGAN_PRESETS.map((t) => `<button type="button" class="chip">${t}</button>`).join('')}</div>

        <div class="menu-actions">
          <button type="submit">Play</button>
          <button type="button" class="watch" title="Walk around the square as a spectator: no body, no score, nobody can hit you">Just watch</button>
        </div>
        <p class="help">Mouse: look around · Shift: run · C: dodge roll · Click / F: hit · Right mouse / Q: block · G: grab/throw ·
          E: truck · H: tear gas (Police) · R: role ability · P: missions and badges · T: emotes · V: tag a wall · Enter: chat · 1–4: chants · M: mute · Esc: free the mouse</p>
        <p class="help">Violence backfires: a K.O. costs public opinion for whoever strikes. Hold the route, chant together and keep the march peaceful.
          Inspired by the real protests in France in autumn 2026. Fictional characters, cartoon brawls only.</p>
      </div>
      <div class="menu-right"></div>
    </form>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('form');
  const nameInput = form.querySelector('#name');
  const sloganInput = form.querySelector('#slogan');
  const right = form.querySelector('.menu-right');
  try {
    nameInput.value = localStorage.getItem('playerName') || '';
    sloganInput.value = localStorage.getItem('playerSlogan') || '';
  } catch { /* ignore */ }
  nameInput.focus();

  // ---- what happened last time, and your streak (the browser remembers you)
  const profile = loadProfile();
  const streakEl = form.querySelector('.streak');
  if (profile.days > 0) {
    const stars = badgeText(badgeForDays(profile.days));
    const nextAt = [3, 7, 15].find((n) => profile.days < n);
    streakEl.hidden = false;
    const lv = levelProgress(loadProgress(profile).xp).level;
    streakEl.textContent = `Welcome back${stars ? ' ' + stars : ''}. Level ${lv} · Day streak: ${profile.streak} · ${profile.days} day${profile.days > 1 ? 's' : ''} played · ${profile.wins} day${profile.wins === 1 ? '' : 's'} won`
      + (nextAt ? ` · next star at ${nextAt} days` : '');
  }
  const lastEl = form.querySelector('.lastday');
  const winnerText = (r) => (r.winner === 'draw' ? 'ended in a draw' : `${FACTIONS[r.winner]?.plural ?? 'Nobody'} won`)
    + ` ${r.g}–${r.c} · opinion ${r.o}% with the protesters`
    + (r.top?.length ? ` · top: ${r.top.map(([n, , pts]) => `${n} ${pts}`).join(', ')}` : '');
  fetch(`/last?room=${encodeURIComponent(new URLSearchParams(location.search).get('room') || 'main')}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((r) => { if (r && r.scn) { lastEl.hidden = false; lastEl.textContent = `Last day (${r.scn}): ${winnerText(r)}. Can you change that today?`; } })
    .catch(() => {});

  // ---- who is on the square right now (refreshed while the menu is open)
  const onlineEl = form.querySelector('.online');
  const roomName = new URLSearchParams(location.search).get('room') || 'main';
  const loadOnline = () => fetch(`/online?room=${encodeURIComponent(roomName)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((o) => {
      if (!o) return;
      form.querySelectorAll('.count').forEach((el) => { el.textContent = o[el.dataset.f] ? ` · ${o[el.dataset.f]} online` : ''; });
      onlineEl.hidden = false;
      const parts = [`${o.g} protester${o.g === 1 ? '' : 's'}`, `${o.c} police`];
      if (o.watching) parts.push(`${o.watching} watching`);
      onlineEl.textContent = o.total
        ? `On the square right now: ${parts.join(', ')}.${o.g !== o.c ? ` ${o.g < o.c ? 'Protesters' : 'Police'} could use more players.` : ''}`
        : 'Nobody is playing right now: you would be the first on the square. Share the link and invite a friend.';
    })
    .catch(() => {});
  loadOnline();
  const onlineTimer = setInterval(loadOnline, 10000);

  form.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
    sloganInput.value = chip.textContent;
    buildEditor(); // redraw the placard in the preview
  }));

  let faction = 'g';
  let role = profile.role || '';
  const rolesEl = form.querySelector('.roles');
  const roleBlurb = form.querySelector('.role-blurb');
  const buildRoles = () => {
    role = roleFor(role, faction);
    rolesEl.innerHTML = '';
    for (const code of ['', ...Object.keys(ROLES).filter((c) => ROLES[c].factions.includes(faction))]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'role-btn' + (role === code ? ' on' : '');
      b.textContent = code ? `${ROLES[code].icon} ${ROLES[code].label}` : 'None';
      b.onclick = () => { role = code; buildRoles(); };
      rolesEl.append(b);
    }
    roleBlurb.textContent = role ? ROLES[role].blurb : 'No role: you just play your side. Roles add one ability on the R key.';
  };
  let editor = null;
  let look = null;
  const buildEditor = () => {
    editor?.destroy();
    look = loadSavedLook(faction);
    editor = createOutfitEditor({
      faction, look, slogan: sloganInput.value.trim(),
      onChange: (l) => { look = l; saveLook(faction, l); },
    });
    right.appendChild(editor.element);
  };

  const updateFaction = () => {
    faction = new FormData(form).get('faction');
    buildRoles();
    sloganInput.disabled = faction !== 'g';
    form.querySelector('.slogan-label').style.opacity = faction === 'g' ? 1 : 0.4;
    form.querySelector('.slogan-presets').style.display = faction === 'g' ? '' : 'none';
    buildEditor();
  };
  form.querySelectorAll('input[name=faction]').forEach((r) => r.addEventListener('change', updateFaction));
  sloganInput.addEventListener('change', buildEditor); // redraw the placard in the preview
  updateFaction();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim().slice(0, MAX_NAME_LENGTH) || 'Anonymous';
    const slogan = faction === 'g' ? sloganInput.value.trim() || 'Lower prices!' : '';
    try {
      localStorage.setItem('playerName', name);
      localStorage.setItem('playerSlogan', sloganInput.value.trim());
    } catch { /* ignore */ }
    const finalLook = editor.getLook();
    editor.destroy();
    clearInterval(onlineTimer);
    overlay.remove();
    updateProfile({ role });
    onPlay({ name, faction, slogan, look: finalLook, role });
  });

  form.querySelector('.watch').addEventListener('click', () => {
    editor.destroy();
    clearInterval(onlineTimer);
    overlay.remove();
    onPlay({ spectate: true });
  });
}
