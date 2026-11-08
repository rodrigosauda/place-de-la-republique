// shared/timeline.js
// "Act I": every game day replays a protest day inspired by 17 October 2026,
// when the cost-of-living march left Place de la République for Place de Clichy,
// the Bastille route was banned, clashes followed and a curfew was imposed.
// Kept cartoonish: no real people, no fire, no looting.
//
// Both the server (objectives, scoring) and every browser (crowd, news, smoke)
// read this same file and the same game clock, so everyone sees the same day.

// Where things happen (x, z on the map). Streets leave the square at x = ±50.
// Real places (OpenStreetMap coordinates, origin = the monument, see shared/constants.js).
export const PLACES = {
  marchExit: { x: -122, z: -40, label: 'Boulevard de Magenta (march route to Clichy)' },
  bannedRoute: { x: 133, z: 31, label: 'Boulevard du Temple (route to Bastille, banned)' },
  metro: { x: 29, z: -1, label: 'République métro entrance' },
  plaza: { x: 0, z: 0, label: 'Place de la République' },
};

// Where the riot-police line stands at hour h (shared by every browser AND the server,
// so the server knows where the line hits people).
//   x, z = centre of the front row   a = angle of the line (direction along it = (cos a, sin a))
//   len = length (m)   active = share of the 36 officers on duty
// The shields face "front" = (-sin a, cos a).
const smoothStep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TEMPLE = { x: 133, z: 31, a: 2.42 }; // across Boulevard du Temple, shields towards the square
// The clash and the curfew sweep REACT to players: the server keeps a "push" value
// (metres the line has advanced) that grows when the police have the upper hand and
// shrinks when protesters hold the line or build a barricade. It reaches every browser
// in the snapshots. Without it (push = null) the line follows the default schedule.
export const LINE_PUSH_MAX = { clashes: 20, curfew: 200 };
export function linePhase(h) {
  if (h >= 17 && h < 20) return 'clashes';
  if (h >= 23) return 'curfew';
  return null;
}
export function policeLine(h, push = null) {
  const f = (a) => ({ fx: -Math.sin(a), fz: Math.cos(a) });
  let L;
  if (h >= 6 && h < 10) L = { x: -27.5, z: -45, a: 0, len: 10, active: 0.35 };          // a few officers by their base
  else if (h >= 10 && h < 17) L = { ...TEMPLE, len: 18, active: h < 14 ? 0.7 : 1 };     // the banned route is blocked
  else if (h >= 17 && h < 20) {                                                            // clashes: the line pushes towards the square
    const d = push ?? smoothStep(17, 19.5, h) * 14;
    const { fx, fz } = f(TEMPLE.a);
    L = { x: TEMPLE.x + fx * d, z: TEMPLE.z + fz * d, a: TEMPLE.a, len: 18, active: 1 };
  } else if (h >= 20 && h < 23) L = { x: 38, z: -1, a: Math.PI / 2, len: 14, active: 0.8 }; // guarding the métro
  else if (h >= 23) L = { x: 112 - (push ?? smoothStep(23, 24, h) * 200), z: -11, a: Math.PI / 2, len: 70, active: 1 }; // curfew sweep east -> west
  else L = { x: -88, z: -11, a: Math.PI / 2, len: 70, active: 0.6 };                       // night: square held
  return { ...L, ...f(L.a) };
}

// The day, hour by hour. `crowd` = 0..1 how many extras are on the square.
export const PHASES = [
  { id: 'night', from: 0, to: 6, crowd: 0, title: 'Curfew' },
  { id: 'morning', from: 6, to: 10, crowd: 0.15, title: 'Morning' },
  { id: 'gathering', from: 10, to: 14, crowd: 0.7, title: 'The crowd gathers' },
  { id: 'march', from: 14, to: 17, crowd: 1, title: 'The march' },
  { id: 'clashes', from: 17, to: 20, crowd: 0.9, title: 'Clashes' },
  { id: 'evening', from: 20, to: 23, crowd: 0.45, title: 'Evening' },
  { id: 'curfew', from: 23, to: 24, crowd: 0.1, title: 'Curfew' },
];

// Breaking news shown on everyone's screen at these hours.
export const NEWS = [
  { at: 6 * 60, text: 'A new day on Place de la République. Unions call for a march at 14:00.' },
  { at: 10 * 60, text: 'Protesters start gathering on the square: fuel prices and wages at the heart of the anger.' },
  { at: 14 * 60, text: 'The march leaves République for Place de Clichy via Boulevard de Magenta.' },
  { at: 15 * 60, text: 'Police ban the route to Bastille. Riot police block Boulevard du Temple.' },
  { at: 17 * 60, text: 'Tension rises: tear gas near Boulevard du Temple, barricades going up.' },
  { at: 18 * 60 + 30, text: 'The water cannon is deployed on the square.' },
  { at: 20 * 60, text: 'The crowd thins out. Many protesters head home.' },
  { at: 22 * 60 + 30, text: 'Curfew in 30 minutes: the square must be empty by 23:00.' },
  { at: 23 * 60, text: 'CURFEW. Police start clearing Place de la République.' },
];

// Objectives: a zone where the two sides compete during part of the day.
// type 'hold'     -> the side with more people in the zone scores every few seconds
// type 'barricade'-> protesters score if 3+ bins/barriers are piled in the zone;
//                    police score when the zone is clear of them
export const OBJECTIVES = [
  {
    id: 'march', from: 14, to: 17, type: 'hold', zone: { x: -118, z: -38, r: 12 },
    g: 'Push the march through to Boulevard de Magenta',
    c: 'Hold the line at Boulevard de Magenta',
  },
  {
    id: 'barricade', from: 17, to: 20, type: 'barricade', zone: { x: 122, z: 20, r: 12 },
    g: 'Build a barricade at Boulevard du Temple (pile 3+ bins/barriers)',
    c: 'Clear the barricade at Boulevard du Temple',
  },
  {
    id: 'metro', from: 20, to: 23, type: 'hold', zone: { x: 29, z: -1, r: 8 },
    g: 'Keep the métro entrance open',
    c: 'Secure the métro entrance',
  },
  {
    id: 'curfew', from: 23, to: 30, type: 'hold', zone: { x: 0, z: 0, r: 0, plaza: true },
    g: 'Curfew: stay on the square!',
    c: 'Curfew: clear the square!',
  },
];

export function phaseAt(minutes) {
  const h = minutes / 60;
  return PHASES.find((p) => h >= p.from && h < p.to) || PHASES[0];
}

// The objective active at this time (curfew wraps past midnight: 23:00-06:00).
export function objectiveAt(minutes) {
  const h = minutes / 60;
  const hh = h < 6 ? h + 24 : h;
  return OBJECTIVES.find((o) => hh >= o.from && hh < o.to) || null;
}

// The latest news item at or before this time (null before 06:00 except curfew).
export function newsAt(minutes) {
  let last = null;
  for (const n of NEWS) if (minutes >= n.at) last = n;
  return last || NEWS[NEWS.length - 1];
}

// How busy the square is (0..1), smoothed between phases.
export function crowdLevel(minutes) {
  const h = minutes / 60;
  const p = phaseAt(minutes);
  const i = PHASES.indexOf(p);
  const next = PHASES[(i + 1) % PHASES.length];
  const t = Math.min(1, Math.max(0, (h - (p.to - 0.5)) / 0.5)); // blend in the last half hour
  return p.crowd + (next.crowd - p.crowd) * t;
}

// The brawl: it NEVER stops (day and night). Three fights that move slowly:
//   0 = all around the statue, 1 = east of it, 2 = west of it
// (the open middle of the square; the tree rows are at both ends).
// Every browser and the server compute the same spots from the clock.
export const MELEE_RADIUS = 12;
export function meleeCenters(tSec = Date.now() / 1000) {
  return [
    { x: 0, z: 0, ring: true },                                                         // around the monument
    { x: 27 + Math.sin(tSec / 70) * 9, z: -12 + Math.sin(tSec / 50 + 1) * 13 },          // east
    { x: -26 + Math.sin(tSec / 64 + 2) * 9, z: -12 + Math.sin(tSec / 57 + 3) * 13 },     // west
  ];
}
export const meleeCenter = (tSec) => meleeCenters(tSec)[1 + (Math.floor((tSec ?? Date.now() / 1000) / 30) % 2)];
