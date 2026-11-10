// client/ui/startMenu.js
// The first screen, in two simple steps:
//   1. Pick a side (two big cards with your character), type your name, Play.
//   2. Optional: "Customise character" opens the outfit editor, placard text and role, then "Done".
// Calls onPlay(...) once.

import { FACTIONS, MAX_NAME_LENGTH, MAX_SLOGAN_LENGTH, ROLES, roleFor, badgeText, badgeForDays } from '../../shared/constants.js';
import { loadProfile, updateProfile } from '../profile.js';
import { createOutfitEditor, loadSavedLook, saveLook } from './outfitEditor.js';
import { currentScenario, scenarioLabel } from '../../shared/timeline.js';
import { loadProgress, levelProgress } from './progress.js';
import { openShop } from './shop.js';
import { lookPicture } from '../shop/thumbs.js';
import { sfx } from '../audio/sfx.js';

const SLOGAN_PRESETS = ['Lower prices!', 'Fair wages', 'Hands off pensions', 'We want to be heard', 'Peaceful and loud', 'Our future!'];
const SIDE_TEXT = {
  g: 'March, hold the square, tag the walls. Fight with a baguette.',
  c: 'Hold the line, clear the barricades. Fight with a rubber chicken.',
};
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export function showStartMenu(onPlay) {
  const overlay = document.createElement('div');
  overlay.className = 'menu-overlay';
  overlay.innerHTML = `
    <form class="menu-card start">
      <section class="step-home">
        <header class="start-head">
          <h1>Place de la République</h1>
          <p class="subtitle">One protest day in Paris. Pick a side and join in. Cartoon brawls only.</p>
          <p class="today"><b>Today: ${scenarioLabel()}.</b> ${currentScenario().blurb}</p>
        </header>

        <div class="side-cards">
          ${Object.entries(FACTIONS).map(([code, f], i) => `
            <label class="side-card" data-f="${code}" style="--team:${hex(f.color)}">
              <input type="radio" name="faction" value="${code}" ${i === 0 ? 'checked' : ''} />
              <img class="side-pic" alt="${f.plural}" width="220" height="220" />
              <span class="side-name">${f.plural}</span>
              <span class="side-text">${SIDE_TEXT[code]}</span>
              <span class="side-count count" data-f="${code}"></span>
            </label>`).join('')}
        </div>

        <div class="start-row">
          <input id="name" name="name" maxlength="${MAX_NAME_LENGTH}" placeholder="Your name" autocomplete="off" required aria-label="Your name" />
          <button type="submit" class="play">Play</button>
        </div>
        <div class="start-links">
          <button type="button" class="link customise">✎ Customise character</button>
          <button type="button" class="link menu-shop">Shop</button>
          <button type="button" class="link watch" title="Walk around as a spectator: no body, no score, nobody can hit you">Just watch</button>
        </div>
        <p class="online" hidden></p>
        <p class="streak" hidden></p>
        <p class="lastday" hidden></p>
        <details class="controls"><summary>Controls and rules</summary>
          <p class="help">Mouse: look around · Shift: run · C: dodge roll · Click / F: hit · Right mouse / Q: block · G: grab/throw ·
            E: truck · H: tear gas (Police) · R: role ability · P: missions and badges · T: emotes · V: tag a wall · Enter: chat · 1–4: chants · M: mute · Esc: free the mouse</p>
          <p class="help">Violence backfires: a K.O. costs public opinion for whoever strikes. Hold the route, chant together and keep the march peaceful.
            Inspired by the real protests in France in autumn 2026. Fictional characters, cartoon brawls only.</p>
          <label class="sound-opt"><input type="checkbox" id="sound-on" /> Sound on (or press M in the game)</label>
        </details>
      </section>

      <section class="step-custom" hidden>
        <div class="custom-head">
          <button type="button" class="link back">← Back</button>
          <h2>Your <span class="custom-side"></span></h2>
          <button type="button" class="done">Done</button>
        </div>
        <div class="custom-editor"></div>
        <div class="custom-extra">
          <div class="custom-slogan">
            <label for="slogan" class="slogan-label">Text on your placard</label>
            <input id="slogan" name="slogan" maxlength="${MAX_SLOGAN_LENGTH}" placeholder="Lower prices!" autocomplete="off" />
            <div class="slogan-presets">${SLOGAN_PRESETS.map((t) => `<button type="button" class="chip">${t}</button>`).join('')}</div>
          </div>
          <div class="custom-role">
            <span class="label">Role (optional)</span>
            <div class="roles"></div>
            <p class="role-blurb"></p>
          </div>
        </div>
      </section>
    </form>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('form');
  const $ = (s) => form.querySelector(s);
  const nameInput = $('#name');
  const sloganInput = $('#slogan');
  try {
    nameInput.value = localStorage.getItem('playerName') || '';
    sloganInput.value = localStorage.getItem('playerSlogan') || '';
  } catch { /* ignore */ }
  nameInput.focus();

  // ---- welcome back, last day, who is online
  const profile = loadProfile();
  if (profile.days > 0) {
    const stars = badgeText(badgeForDays(profile.days));
    const lv = levelProgress(loadProgress(profile).xp).level;
    const el = $('.streak');
    el.hidden = false;
    el.textContent = `Welcome back${stars ? ' ' + stars : ''} · Level ${lv} · ${profile.streak}-day streak · ${profile.wins} day${profile.wins === 1 ? '' : 's'} won`;
  }
  const room = new URLSearchParams(location.search).get('room') || 'main';
  fetch(`/last?room=${encodeURIComponent(room)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((r) => {
      if (!r || !r.scn) return;
      const el = $('.lastday');
      el.hidden = false;
      el.textContent = `Yesterday: ${r.winner === 'draw' ? 'a draw' : `${FACTIONS[r.winner]?.plural ?? 'Nobody'} won`} ${r.g}–${r.c}. Can you change that today?`;
    })
    .catch(() => {});
  const onlineEl = $('.online');
  const loadOnline = () => fetch(`/online?room=${encodeURIComponent(room)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((o) => {
      if (!o) return;
      form.querySelectorAll('.count').forEach((el) => { el.textContent = o[el.dataset.f] ? `${o[el.dataset.f]} playing now` : ''; });
      onlineEl.hidden = false;
      onlineEl.textContent = o.total
        ? `${o.total} on the square right now.${o.g !== o.c ? ` The ${o.g < o.c ? 'protesters' : 'police'} need more players.` : ''}`
        : 'Nobody is on the square yet: you would be the first. Share the link with a friend.';
    })
    .catch(() => {});
  loadOnline();
  const onlineTimer = setInterval(loadOnline, 10000);

  // ---- side, outfit pictures
  let faction = 'g';
  let role = profile.role || '';
  const looks = { g: loadSavedLook('g'), c: loadSavedLook('c') };
  const drawCards = () => {
    for (const code of Object.keys(FACTIONS)) {
      const img = form.querySelector(`.side-card[data-f="${code}"] .side-pic`);
      try { img.src = lookPicture(code, looks[code]); } catch { /* no WebGL: the card works without a picture */ }
    }
  };
  // Draw after the first paint so the menu shows at once.
  requestAnimationFrame(() => setTimeout(drawCards, 0));
  form.querySelectorAll('input[name=faction]').forEach((r) => r.addEventListener('change', () => {
    faction = new FormData(form).get('faction');
  }));

  // ---- step 2: customise
  let editor = null;
  const rolesEl = $('.roles');
  const roleBlurb = $('.role-blurb');
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
    roleBlurb.textContent = role ? ROLES[role].blurb : 'No role: you just play your side. A role adds one ability on the R key.';
  };
  const buildEditor = () => {
    editor?.destroy();
    editor = createOutfitEditor({
      faction, look: looks[faction], slogan: sloganInput.value.trim(),
      onChange: (l) => { looks[faction] = l; saveLook(faction, l); },
    });
    $('.custom-editor').appendChild(editor.element);
  };
  const showCustom = (on) => {
    $('.step-home').hidden = on;
    $('.step-custom').hidden = !on;
    if (on) {
      $('.custom-side').textContent = faction === 'c' ? 'police officer' : 'protester';
      $('.custom-slogan').hidden = faction !== 'g';
      buildRoles();
      buildEditor();
    } else {
      editor?.destroy();
      editor = null;
      drawCards();
      nameInput.focus();
    }
  };
  $('.customise').addEventListener('click', () => showCustom(true));
  $('.back').addEventListener('click', () => showCustom(false));
  $('.done').addEventListener('click', () => showCustom(false));
  form.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
    sloganInput.value = chip.textContent;
    buildEditor(); // redraw the placard in the preview
  }));
  sloganInput.addEventListener('change', buildEditor);

  // ---- play / watch / shop
  const finish = () => { editor?.destroy(); clearInterval(onlineTimer); overlay.remove(); };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!$('.step-custom').hidden) { showCustom(false); return; } // Enter in the placard field = Done
    const name = nameInput.value.trim().slice(0, MAX_NAME_LENGTH) || 'Anonymous';
    const slogan = faction === 'g' ? sloganInput.value.trim() || 'Lower prices!' : '';
    try {
      localStorage.setItem('playerName', name);
      localStorage.setItem('playerSlogan', sloganInput.value.trim());
    } catch { /* ignore */ }
    role = roleFor(role, faction);
    const look = { ...looks[faction] };
    delete look.v;
    finish();
    updateProfile({ role });
    onPlay({ name, faction, slogan, look, role });
  });
  const soundOn = $('#sound-on');
  soundOn.checked = !sfx.settings.muted;
  soundOn.addEventListener('change', () => sfx.setMuted(!soundOn.checked));
  $('.menu-shop').addEventListener('click', () => openShop({
    faction, look: looks[faction], slogan: sloganInput.value.trim(),
    onClose: () => { looks.g = loadSavedLook('g'); looks.c = loadSavedLook('c'); drawCards(); },
  }));
  $('.watch').addEventListener('click', () => { finish(); onPlay({ spectate: true }); });
}
