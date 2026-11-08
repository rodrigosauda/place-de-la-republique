// client/profile.js
// What this browser remembers about you (localStorage only; nothing leaves your device except the
// cosmetic loyalty badge, which is sent when you join). Days played, streak, last result, tutorial.

import { badgeForDays } from '../shared/constants.js';

const KEY = 'republique.profile.v1';

const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dateKey(d); };

const EMPTY = { days: 0, streak: 0, best: 0, last: '', wins: 0, finished: 0, tutorialDone: false, role: '', lastResult: null };

export function loadProfile() {
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...EMPTY }; }
}

function save(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: ignore */ }
  return p;
}

// Call when you press Play: counts one more day, extends or restarts the streak.
export function recordVisit() {
  const p = loadProfile();
  const today = dateKey();
  if (p.last !== today) {
    p.streak = p.last === yesterdayKey() ? p.streak + 1 : 1;
    p.best = Math.max(p.best, p.streak);
    p.days += 1;
    p.last = today;
  }
  return save(p);
}

// Call when an end-of-day summary arrives while you play.
export function recordSummary(msg, faction) {
  const p = loadProfile();
  p.finished += 1;
  if (msg.winner === faction) p.wins += 1;
  p.lastResult = { scn: msg.scn || '', winner: msg.winner, g: msg.g, c: msg.c, o: msg.o, at: dateKey(), faction };
  return save(p);
}

export function updateProfile(patch) {
  return save({ ...loadProfile(), ...patch });
}

export const badgeOf = (p = loadProfile()) => badgeForDays(p.days);
