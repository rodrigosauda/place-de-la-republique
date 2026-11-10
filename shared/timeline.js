// shared/timeline.js
// "Act I": every game day replays a protest day inspired by 17 October 2026,
// when the cost-of-living march left Place de la République for Place de Clichy,
// the Bastille route was banned, clashes followed and a curfew was imposed.
// Kept cartoonish: no real people, no fire, no looting.
//
// Both the server (objectives, scoring) and every browser (crowd, news, smoke)
// read this same file and the same game clock, so everyone sees the same day.

import { gameDayNumber } from './constants.js';

// Where things happen (x, z on the map). Streets leave the square at x = ±50.
// Real places (OpenStreetMap coordinates, origin = the monument, see shared/constants.js).
export const PLACES = {
  marchExit: { x: -122, z: -40, label: 'Boulevard de Magenta (march route to Clichy)' },
  bannedRoute: { x: 133, z: 31, label: 'Boulevard du Temple (route to Bastille, banned)' },
  metro: { x: 29, z: -1, label: 'République métro entrance' },
  plaza: { x: 0, z: 0, label: 'Place de la République' },
};


// ---------------------------------------------------------------------------
// Scenarios: each game day replays a DIFFERENT real day of the October-November 2026
// protests in France (rotating, same on the server and in every browser, no messages needed).
// Still cartoonish and fictional: no real people, no fire, no looting.
//   rain        0..1  weather (client visuals + sound)
//   swing       how strongly public-opinion events move the meter
//   lineSpeed   how fast the police line advances (1 = normal)
//   gas         how often the line fires tear gas (1 = normal)
//   police      share of the shield line on duty: a number, or [[hour, share], ...] (reinforcements arrive)
//   calm        { until, lineSpeed, gas }: gentler until that hour (a cheerful march, then a masked fringe)
//   routeChange the march objective moves at that hour
//   news        headlines that replace / add to the default ones (at = minutes after midnight)
// ---------------------------------------------------------------------------
export const SCENARIOS = [
  {
    id: 'act1', date: '17 Oct', title: 'Act I',
    blurb: 'Far more people than anyone expected. The police are caught short, and reinforcements arrive through the afternoon.',
    rain: 0, swing: 1, lineSpeed: 1, gas: 1, police: [[14, 0.6], [17, 0.85], [19.5, 1]],
    news: [
      { at: 6 * 60, text: 'Act I, 17 October: far more people than expected are heading for the square.' },
      { at: 16 * 60 + 30, text: 'Police reinforcements are arriving: more riot-police vans on the square.' },
    ],
  },
  {
    id: 'act2', date: '24 Oct', title: 'Act II',
    blurb: 'Rain, marches banned in many cities, and the route changed at the last minute.',
    rain: 0.85, swing: 1, lineSpeed: 0.9, gas: 0.9, police: 1,
    routeChange: {
      at: 15, zone: { x: 122, z: 20, r: 12 },
      g: 'The route was changed: take the march east to Boulevard du Temple',
      c: 'Stop the march at Boulevard du Temple',
    },
    news: [
      { at: 6 * 60, text: 'Act II, 24 October: rain over Paris, and several marches are banned.' },
      { at: 15 * 60, text: 'The prefecture changes the route at the last minute: the march must go east.' },
    ],
  },
  {
    id: 'halloween', date: '31 Oct', title: 'Halloween march',
    blurb: 'A cheerful march in costumes. At the end, a masked group wants a fight.',
    rain: 0, swing: 1.2, lineSpeed: 1.3, gas: 1.3, police: 1,
    calm: { until: 18.5, lineSpeed: 0.5, gas: 0.4 },
    events: { band: { title: 'Costume parade', g: 'Join the costume parade and dance: the march gains support', news: 'A parade of witches, ghosts and skeletons dances along Boulevard de Magenta.' } },
    news: [
      { at: 6 * 60, text: 'Third wave, 31 October: marchers come in Halloween costumes.' },
      { at: 18 * 60 + 30, text: 'The march is over, but a masked group stays behind and the mood turns.' },
    ],
  },
  {
    id: 'union', date: '5 Nov', title: 'Union strike day',
    blurb: 'Workers, students and retirees fill the boulevards. Calm and loud, and every act counts for more.',
    rain: 0, swing: 1.5, lineSpeed: 0.4, gas: 0.25, police: 0.8,
    events: { speech: { title: 'Union leaders speak at the monument', news: 'Union leaders speak from the monument steps to a huge crowd.' } },
    news: [
      { at: 6 * 60, text: 'Union strike day, 5 November: the whole country is called to march for wages.' },
      { at: 14 * 60, text: 'Workers, students and retirees march together with drums and whistles.' },
    ],
  },
];
export const scenarioForDay = (day) => SCENARIOS[((day % SCENARIOS.length) + SCENARIOS.length) % SCENARIOS.length];
// globalThis.__scenario = 'act2' forces a scenario (testing only: ?scenario=act2 in the browser, SCENARIO=act2 for the worker).
export const currentScenario = (nowMs = Date.now()) =>
  (globalThis.__scenario && SCENARIOS.find((s) => s.id === globalThis.__scenario)) || scenarioForDay(gameDayNumber(nowMs));
export const scenarioLabel = (scn = currentScenario()) => `${scn.title} · ${scn.date}`;

// Linear blend through [[hour, value], ...]; 1 before the first point.
function ramp(points, h) {
  if (typeof points === 'number') return points;
  if (!points || h < points[0][0]) return 1;
  for (let i = 1; i < points.length; i++) {
    if (h < points[i][0]) {
      const [h0, v0] = points[i - 1], [h1, v1] = points[i];
      return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
    }
  }
  return points[points.length - 1][1];
}
// What the scenario changes at hour h: { lineSpeed, gas, police }
export function scenarioMods(h, scn = currentScenario()) {
  const calm = scn.calm && h < scn.calm.until ? scn.calm : null;
  return {
    lineSpeed: calm ? calm.lineSpeed : scn.lineSpeed,
    gas: calm ? calm.gas : scn.gas,
    police: ramp(scn.police, h),
  };
}

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
export function policeLine(h, push = null, scn = currentScenario()) {
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
  // The scenario can thin the shield line out (but never below the 0.5 that switches it on).
  if (L.active > 0.5) L = { ...L, active: Math.max(0.55, L.active * scenarioMods(h, scn).police) };
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

// Events: short happenings with a zone on the map (a ring on the ground and on the minimap).
//   kind 'rally'   -> protesters standing in the zone slowly win public support (the server caps it per day;
//                     a drummer in the zone makes it stronger, more police than protesters there cancels it)
//   kind 'cameras' -> live TV: every K.O. inside the zone moves public opinion TWICE as much
// A scenario can rename an event with `scn.events = { id: { title, news, g, c } }`.
export const EVENTS = [
  {
    id: 'students', from: 9.5, to: 10.5, kind: 'rally', zone: { x: 70, z: -15, r: 13 },
    title: 'Students arrive with banners',
    g: 'Welcome the students arriving from the east: gather round them and the march gains support',
    c: 'Let the students through peacefully',
    news: 'Hundreds of students arrive at the square with banners and a sound system.',
  },
  {
    id: 'speech', from: 11.5, to: 12.5, kind: 'rally', zone: { x: 0, z: 0, r: 16 },
    title: 'Open-air speech at the monument',
    g: 'Gather around the monument and hear the speaker: the crowd wins support',
    c: 'Keep order around the speech, and keep it peaceful',
    news: 'A union speaker addresses the crowd from the monument steps.',
  },
  {
    id: 'band', from: 13, to: 13.75, kind: 'rally', zone: { x: -60, z: -10, r: 12 },
    title: 'Brass band on Boulevard de Magenta',
    g: 'Follow the brass band west and dance: the march gains support',
    c: 'Keep the boulevard open for the brass band',
    news: 'A brass band leads the crowd along Boulevard de Magenta.',
  },
  {
    id: 'vigil', from: 20, to: 21, kind: 'rally', zone: { x: 0, z: 0, r: 18 },
    title: 'Candlelight vigil at the monument',
    g: 'Gather quietly at the monument for the candlelight vigil: peace wins hearts',
    c: 'Keep your distance: the vigil is peaceful',
    news: 'People light candles around the monument for a silent vigil.',
  },
  {
    id: 'cameras', from: 17.5, to: 18.5, kind: 'cameras', zone: { x: 118, z: 18, r: 18 },
    title: 'Live TV at the front line',
    g: 'Cameras are rolling at Boulevard du Temple: keep it peaceful, the whole country is watching',
    c: 'Cameras are rolling at Boulevard du Temple: any violence there counts double',
    news: 'Live TV cameras are filming the front line at Boulevard du Temple.',
  },
];

// The event running at this time (or null). Same on the server and in every browser.
export function eventAt(minutes, scn = currentScenario()) {
  const h = minutes / 60;
  const e = EVENTS.find((x) => h >= x.from && h < x.to);
  return e ? { ...e, ...(scn.events?.[e.id] || {}) } : null;
}

export function phaseAt(minutes) {
  const h = minutes / 60;
  return PHASES.find((p) => h >= p.from && h < p.to) || PHASES[0];
}

// The objective active at this time (curfew wraps past midnight: 23:00-06:00).
export function objectiveAt(minutes, scn = currentScenario()) {
  const h = minutes / 60;
  const hh = h < 6 ? h + 24 : h;
  const o = OBJECTIVES.find((x) => hh >= x.from && hh < x.to) || null;
  const rc = scn.routeChange;
  if (o && o.id === 'march' && rc && hh >= rc.at) return { ...o, zone: rc.zone, g: rc.g, c: rc.c }; // route changed
  return o;
}

// The latest news item at or before this time (null before 06:00 except curfew).
const newsCache = new Map();
function newsList(scn) {
  if (!newsCache.has(scn.id)) {
    const merged = NEWS.filter((n) => !(scn.news || []).some((m) => m.at === n.at)).concat(scn.news || []);
    newsCache.set(scn.id, merged.sort((a, b) => a.at - b.at));
  }
  return newsCache.get(scn.id);
}
export function newsAt(minutes, scn = currentScenario()) {
  const list = newsList(scn);
  let last = null;
  for (const n of list) if (minutes >= n.at) last = n;
  return last || list[list.length - 1];
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

// The brawl: it NEVER stops (day and night). It happens in FIGHT SPOTS ("circles") that flare up
// and die down. People don't run across the square from one fight to the next: groups of
// protesters walk in from a street, the police send a squad from their side, they fight for a
// few minutes and leave by a street again (see fighterPlan). Every browser and the server work
// out the same spots from the clock.
export const MELEE_RADIUS = 12;
export const FIGHT_SPOTS = [
  { x: 0, z: 0, ring: true, r: 9 },  // all around the statue: always busy
  { x: 62, z: -10, r: 9 },            // east part of the square
  { x: -62, z: -16, r: 9 },           // west part
  { x: 24, z: -30, r: 8 },            // north side
  { x: -24, z: 8, r: 8 },             // south side
];
// Streets around the square (points ~30 m into each street): where groups come from and go to.
export const STREETS = [
  { x: 144, z: -6 }, { x: 110, z: 35 }, { x: 59, z: 45 }, { x: -10, z: 52 },
  { x: -96, z: 35 }, { x: -133, z: -42 }, { x: 18, z: -74 }, { x: 130, z: -55 },
];
// Where police squads come from: the barracks (north side) and the streets behind the police lines.
export const POLICE_STREETS = [{ x: -27.5, z: -58 }, { x: 18, z: -74 }, { x: 130, z: -55 }, { x: -133, z: -42 }];

// How hot each spot is right now, 0..1 (the statue is always fairly busy).
export function spotHeat(k, tSec) {
  if (k === 0) return 0.7;
  return 0.5 + 0.5 * Math.sin(tSec / (150 + 37 * k) + k * 2.1);
}
const near = (list, p, n) => [...list].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, n);
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
// Pick a spot, more often the hot ones.
export function pickSpot(tSec, r) {
  const w = FIGHT_SPOTS.map((_, k) => 0.1 + spotHeat(k, tSec) ** 2);
  let x = r * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < w.length; k++) { x -= w[k]; if (x <= 0) return k; }
  return 0;
}

// Fighter pair j (one protester + one officer) over time. Pairs come in groups of 4 that arrive together:
//   'in'    walking in, the protesters from a street near the spot, the officers from the police side
//   'fight' brawling at the spot
//   'out'   walking away to a street
//   'away'  gone for a moment (out of sight in the street)
// Returns { stage, spot, u (0..1 progress of in/out), from: {g, c}, to: exit, member }.
export function fighterPlan(j, tSec) {
  const group = Math.floor(j / 4), member = j % 4;
  const P = 300 + (group % 5) * 40;                      // seconds per visit
  const off = rng(group * 2654435761 + 17)() * P;
  const cycle = Math.floor((tSec + off) / P), local = (tSec + off) % P;
  const r = rng(group * 7919 + cycle * 104729 + 3);
  const spot = pickSpot(tSec - local, r());
  const S = FIGHT_SPOTS[spot];
  const g = near(STREETS, S, 2)[Math.floor(r() * 2)];
  const c = near(POLICE_STREETS, S, 2)[Math.floor(r() * 2)];
  const exit = near(STREETS, S, 3)[Math.floor(r() * 3)];
  const start = member * 1.5;                             // a little column, one after the other
  const IN = 45, OUT = 35, AWAY = 8;
  let stage, u = 0;
  if (local < start) { stage = 'away'; }
  else if (local < start + IN) { stage = 'in'; u = (local - start) / IN; }
  else if (local < P - OUT - AWAY) { stage = 'fight'; }
  else if (local < P - AWAY) { stage = 'out'; u = (local - (P - OUT - AWAY)) / OUT; }
  else stage = 'away';
  return { stage, spot, u, from: { g, c }, to: exit, member, group };
}

// The three busiest places right now (the statue + the two hottest spots); used by the server NPCs.
export function meleeCenters(tSec = Date.now() / 1000) {
  const order = FIGHT_SPOTS.map((s, k) => [k, spotHeat(k, tSec)]).filter(([k]) => k > 0).sort((a, b) => b[1] - a[1]);
  return [FIGHT_SPOTS[0], FIGHT_SPOTS[order[0][0]], FIGHT_SPOTS[order[1][0]]];
}
export const meleeCenter = (tSec) => meleeCenters(tSec)[1 + (Math.floor((tSec ?? Date.now() / 1000) / 30) % 2)];
