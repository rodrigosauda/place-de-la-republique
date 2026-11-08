// client/ui/progress.js
// Daily missions, XP / level, badges (achievements) and today's leaderboard.
// Everything is stored in this browser only (localStorage); nothing here is sent to the server.
// Missions change every real day (local midnight) and depend on your side and role.
//
//   const progress = createProgress({ faction, role, name });
//   progress.event('chant')                      // something happened (see EVENTS below)
//   progress.tick(dt, { inZone, inEvent })       // every frame while you play
//   progress.setBoard([[name, faction, points]]) // today's top 5 from the server
//   P toggles the panel (or tap the tracker on a phone)

import { loadProfile, updateProfile } from '../profile.js';
import { FACTIONS } from '../../shared/constants.js';

// ---------------------------------------------------------------------------
// Pure helpers (also used by the start menu and the tests)
// ---------------------------------------------------------------------------
export const XP = { mission: 40, badge: 100, win: 60, perMinute: 3 };

// Level n starts at 60 * (n-1)^2 XP: 60, 240, 540... quick at first, then slower.
export const levelFor = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1;
export function levelProgress(xp) {
  const L = levelFor(xp);
  const from = 60 * (L - 1) ** 2, to = 60 * L ** 2;
  return { level: L, into: xp - from, need: to - from, ratio: (xp - from) / (to - from) };
}

// Event types -> what they add. 'time' kinds are measured in seconds, the others count occurrences.
export const MISSIONS = [
  { id: 'chant', ev: 'chant', goal: 8, text: (n) => `Chant ${n} times (keys 1–4)` },
  { id: 'hold', ev: 'hold', goal: 180, text: () => 'Stay in today\'s objective zone for 3 minutes', time: true },
  { id: 'peace', ev: 'peace', goal: 600, text: () => 'Play 10 minutes without knocking anyone out', time: true },
  { id: 'rally', ev: 'rally', goal: 90, text: () => 'Take part in an event on the square for 90 seconds', time: true },
  { id: 'tag', ev: 'tag', goal: 3, text: (n) => `Spray ${n} graffiti tags (V)`, factions: 'g' },
  { id: 'block', ev: 'block', goal: 5, text: (n) => `Block ${n} hits with your shield (right mouse)` },
  { id: 'dash', ev: 'dash', goal: 5, text: (n) => `Dodge-roll ${n} times (C)` },
  { id: 'treat', ev: 'treat', goal: 3, text: (n) => `Treat ${n} people (Medic, R)`, role: 'm' },
  { id: 'photo', ev: 'photo', goal: 4, text: (n) => `Take ${n} photos (Journalist, R)`, role: 'j' },
  { id: 'drum', ev: 'drum', goal: 8, text: (n) => `Drum ${n} times (Drummer, R)`, role: 'd' },
];

export const BADGES = [
  { id: 'steps', icon: '👣', label: 'First steps', desc: 'Finish the tutorial', test: (s) => s.tutorial },
  { id: 'voice', icon: '📣', label: 'Voice of the square', desc: 'Chant 25 times', test: (s) => s.counts.chant >= 25 },
  { id: 'writer', icon: '🖌️', label: 'Wall writer', desc: 'Spray 5 tags', test: (s) => s.counts.tag >= 5 },
  { id: 'medic', icon: '✚', label: 'Street medic', desc: 'Treat 5 people', test: (s) => s.counts.treat >= 5 },
  { id: 'press', icon: '📷', label: 'Press pass', desc: 'Take 5 photos', test: (s) => s.counts.photo >= 5 },
  { id: 'drums', icon: '🥁', label: 'Drum major', desc: 'Drum 10 times', test: (s) => s.counts.drum >= 10 },
  { id: 'holder', icon: '🚩', label: 'Held the route', desc: 'Spend 10 minutes in objective zones', test: (s) => s.counts.hold >= 600 },
  { id: 'peaceful', icon: '🕊️', label: 'Peaceful march', desc: 'Play 15 minutes without knocking anyone out', test: (s) => s.counts.peaceBest >= 900 },
  { id: 'regular', icon: '⏱️', label: 'Regular', desc: 'Play 60 minutes in total', test: (s) => s.counts.play >= 3600 },
  { id: 'streak3', icon: '🔥', label: 'Three days running', desc: 'A 3-day streak', test: (s) => s.profile.best >= 3 },
  { id: 'winner', icon: '🏆', label: 'Day won', desc: 'Be on the winning side at the end of a day', test: (s) => s.profile.wins >= 1 },
  { id: 'lvl5', icon: '⭐', label: 'Veteran', desc: 'Reach level 5', test: (s) => levelFor(s.xp) >= 5 },
];

const dateKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function seeded(seedText) {
  let h = 2166136261;
  for (const ch of seedText) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

// Today's three missions for this side and role: the same all day, different tomorrow.
export function pickMissions(faction, role, key = dateKey()) {
  const rnd = seeded(`${key}|${faction}|${role}`);
  const ok = MISSIONS.filter((m) => (!m.factions || m.factions.includes(faction)) && (!m.role || m.role === role));
  const mine = ok.filter((m) => m.role); // role missions first: they are the reason to pick a role
  const rest = ok.filter((m) => !m.role).sort(() => rnd() - 0.5);
  return [...mine.slice(0, 1), ...rest].slice(0, 3).map((m) => ({ id: m.id, p: 0, done: false }));
}

// ---------------------------------------------------------------------------
export function loadProgress(profile = loadProfile()) {
  const base = { xp: 0, counts: { chant: 0, tag: 0, treat: 0, photo: 0, drum: 0, hold: 0, play: 0, peaceBest: 0 }, badges: {}, daily: null };
  const p = profile.progress || {};
  return { ...base, ...p, counts: { ...base.counts, ...(p.counts || {}) }, badges: { ...(p.badges || {}) } };
}

export function createProgress({ faction, role, tutorial = false }) {
  let state = loadProgress();
  const key = dateKey();
  if (!state.daily || state.daily.key !== key || state.daily.faction !== faction || state.daily.role !== role) {
    state.daily = { key, faction, role, missions: pickMissions(faction, role, key) };
  }
  let board = [];
  let peaceRun = 0;         // seconds since you last knocked someone out
  let xpFraction = 0;       // XP from time played (fractions add up)
  let lastSave = 0;
  const toasts = [];

  const save = () => updateProfile({ progress: state });

  // ---------------------------------------------------------------- DOM
  const tracker = document.createElement('button');
  tracker.type = 'button';
  tracker.className = 'mission-tracker';
  tracker.title = 'Missions and badges (P)';
  const stack = document.createElement('div');
  stack.className = 'toast-stack';
  const panel = document.createElement('div');
  panel.className = 'progress-panel';
  panel.hidden = true;
  document.body.append(tracker, stack, panel);

  const missionDef = (id) => MISSIONS.find((m) => m.id === id);
  const label = (m) => missionDef(m.id).text(missionDef(m.id).goal);
  const pct = (m) => Math.min(100, Math.round((m.p / missionDef(m.id).goal) * 100));

  function toast(html, cls = '') {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.innerHTML = html;
    stack.append(el);
    while (stack.children.length > 3) stack.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4900);
  }

  function renderTracker() {
    const lv = levelProgress(state.xp);
    tracker.innerHTML = `<b>Lv ${lv.level}</b> <span class="xpbar"><i style="width:${Math.round(lv.ratio * 100)}%"></i></span>`
      + state.daily.missions.map((m) => `<div class="m ${m.done ? 'done' : ''}"><span>${m.done ? '✔' : '○'} ${label(m)}</span>`
        + `<span class="mbar"><i style="width:${m.done ? 100 : pct(m)}%"></i></span></div>`).join('');
  }

  function renderPanel() {
    const lv = levelProgress(state.xp);
    const profile = loadProfile();
    const colour = (f) => `#${(FACTIONS[f]?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
    panel.innerHTML = `
      <h3>Level ${lv.level} <small>${state.xp} XP · ${lv.need - lv.into} to the next level</small></h3>
      <div class="xpbar big"><i style="width:${Math.round(lv.ratio * 100)}%"></i></div>
      <h4>Today's missions <small>(new ones tomorrow · +${XP.mission} XP each)</small></h4>
      ${state.daily.missions.map((m) => `<div class="m ${m.done ? 'done' : ''}"><span>${m.done ? '✔' : '○'} ${label(m)}</span><span class="mbar"><i style="width:${m.done ? 100 : pct(m)}%"></i></span></div>`).join('')}
      <h4>Today's top players <small>(live)</small></h4>
      ${board.length ? board.map(([n, f, pts], i) => `<div class="b"><span>${i + 1}. <i style="background:${colour(f)}"></i>${escapeHtml(n)}</span><b>${pts}</b></div>`).join('') : '<p class="muted">Nobody has scored yet today. Knock-outs, holding the route, tags, treatments and photos all count.</p>'}
      <h4>Badges <small>${BADGES.filter((b) => state.badges[b.id]).length}/${BADGES.length}</small></h4>
      <div class="badges">${BADGES.map((b) => `<div class="badge ${state.badges[b.id] ? 'on' : ''}" title="${b.desc}"><span>${b.icon}</span><b>${b.label}</b><small>${b.desc}</small></div>`).join('')}</div>
      <p class="muted">${profile.streak ? `Streak: ${profile.streak} day${profile.streak > 1 ? 's' : ''} · ` : ''}${profile.days} day${profile.days === 1 ? '' : 's'} played · ${profile.wins} won. Press P to close.</p>`;
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function refresh() {
    renderTracker();
    if (!panel.hidden) renderPanel();
  }

  // ---------------------------------------------------------------- XP and badges
  function addXp(n, why) {
    const before = levelFor(state.xp);
    state.xp += n;
    const after = levelFor(state.xp);
    if (why) toast(`<b>+${n} XP</b> ${why}`);
    if (after > before) toast(`<b>Level ${after}!</b> You are getting known on the square`, 'level');
  }

  function checkBadges() {
    const ctx = { counts: state.counts, profile: loadProfile(), xp: state.xp, tutorial: !!loadProfile().tutorialDone || tutorial };
    for (const b of BADGES) {
      if (!state.badges[b.id] && b.test(ctx)) {
        state.badges[b.id] = true;
        toast(`${b.icon} <b>Badge: ${b.label}</b> ${b.desc}`, 'badge');
        addXp(XP.badge);
      }
    }
  }

  // ---------------------------------------------------------------- events
  // Count it for the missions and the totals. amount = occurrences (or seconds for time-based ones).
  function add(ev, amount = 1) {
    if (ev in state.counts) state.counts[ev] += amount;
    for (const m of state.daily.missions) {
      const def = missionDef(m.id);
      if (m.done || def.ev !== ev) continue;
      m.p = Math.min(def.goal, m.p + amount);
      if (m.p >= def.goal) {
        m.done = true;
        toast(`✔ <b>Mission complete</b> ${label(m)}`, 'mission');
        addXp(XP.mission);
      }
    }
  }

  function event(type, amount = 1) {
    if (type === 'tutorial') { checkBadges(); save(); refresh(); return; }
    if (type === 'win') addXp(XP.win, 'Your side won the day');
    else if (type === 'ko') {
      state.counts.peaceBest = Math.max(state.counts.peaceBest, peaceRun);
      peaceRun = 0;
      for (const m of state.daily.missions) if (m.id === 'peace' && !m.done) m.p = 0; // violence resets the peaceful streak
    } else add(type, amount);
    checkBadges();
    save();
    refresh();
  }

  let secondsAcc = 0;
  function tick(dt, ctx = {}) {
    if (dt > 1) return; // tab was in the background
    secondsAcc += dt;
    peaceRun += dt;
    state.counts.peaceBest = Math.max(state.counts.peaceBest, peaceRun);
    xpFraction += dt * XP.perMinute / 60;
    if (xpFraction >= 1) { const n = Math.floor(xpFraction); xpFraction -= n; state.xp += n; }
    if (secondsAcc < 1) return;
    const whole = Math.floor(secondsAcc);
    secondsAcc -= whole;
    state.counts.play += whole;
    add('peace', whole);
    if (ctx.inZone) add('hold', whole);
    if (ctx.inEvent) add('rally', whole);
    checkBadges();
    const now = performance.now();
    if (now - lastSave > 10000) { lastSave = now; save(); }
    refresh();
  }

  function setBoard(list) {
    board = Array.isArray(list) ? list : [];
    if (!panel.hidden) renderPanel();
  }

  function toggle(force) {
    panel.hidden = force === undefined ? !panel.hidden : !force;
    if (!panel.hidden) renderPanel();
  }
  tracker.addEventListener('click', () => toggle());

  refresh();
  checkBadges();
  save();

  return {
    event, tick, setBoard, toggle,
    get state() { return state; },
    show(on) { tracker.style.display = on ? '' : 'none'; if (!on) panel.hidden = true; },
    dispose() { save(); tracker.remove(); stack.remove(); panel.remove(); },
  };
}
