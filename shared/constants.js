// shared/constants.js
// Values used by BOTH the browser client and the Cloudflare Worker / Durable Object.
// Change things here, not in the individual files.

// ---------------------------------------------------------------------------
// Network timing
// ---------------------------------------------------------------------------

// How many times per second clients send their state AND the server broadcasts
// snapshots. Raise to 20 later for smoother movement (costs 2x more requests).
export const TICK_RATE = 10;
export const TICK_MS = 1000 / TICK_RATE;

// Remote players are drawn this many ms "in the past", so we always have two
// snapshots to interpolate between. Rule of thumb: >= 1 to 1.5 tick intervals.
// If remote players stutter at TICK_RATE = 10, try 150.
export const INTERP_DELAY_MS = 100;

// ---------------------------------------------------------------------------
// Message types (short keys keep messages small)
// Every message is JSON with a "t" (type) field.
// ---------------------------------------------------------------------------
export const MSG = {
  // client -> server
  JOIN: 'j',        // { t, n: name, f: faction, s: slogan, l: look array, p?: [x,y,z], r? } (p = keep position after a reconnect)
  LOOK: 'L',        // { t, l: look array }  I changed my outfit
  EMOTE: 'm',       // { t, e }              play emote number e (see EMOTE_LIST)
  TAG: 'y',         // { t, p: [x,y,z], n: [nx,ny,nz] }  spray my tag on a wall
  AD_SEEN: 'd',     // { t, c: campaignId }  I saw the advertising banner (once per campaign per visit)
  CROWD: 'u',       // { t, i, k: [kx, kz] }  I hit background extra number i
  GAS: 'h',         // { t, p: [x, z] }      (police) throw a tear-gas canister at x, z
  STATE: 's',       // { t, p: [x, y, z], r: rotationY, v: 0|1 (in vehicle), b: 0|1 (blocking), w: weapon index }
  ENTER: 'e',       // { t }                 ask to drive the truck
  EXIT: 'x',        // { t, p: [x,y,z], r }  leave the truck (with its final pose)
  ATTACK: 'a',      // { t, p: [x,y,z], r }  swing your weapon (server checks who gets hit)
  RESPAWN: 'R',     // { t, p: [x,y,z] }     KO is over, I'm back on my feet at p
  CHAT: 'c',        // { t, m: text }        say something (bubble above your head)
  SPRAY: 'w',       // { t, on: 0|1 }        driver turns the water cannon on/off
  PROP: 'o',        // { t, i, p: [x, z] }   I pushed street prop number i to (x, z)
  GRAB: 'g',        // { t, i }              pick up street prop i
  THROW: 'T',       // { t, i, p: [x,y,z], v: [vx,vy,vz] }  throw the prop I'm carrying

  // server -> client
  WELCOME: 'w',     // { t, id }                         your player id
  ROSTER: 'r',      // { t, l: [[id, name, faction, slogan, isNpc, look], ...] } who is in the room (players + NPCs)
  SNAPSHOT: 'S',    // { t, p: [[id,x,y,z,r,v,hp,b,w], ...], v: [x,y,z,r,ownerId|0,spraying,water], o?: [[i,x,z], ...] }
  VEHICLE: 'v',     // { t, o: ownerId|0 }               truck owner changed
  SWING: 'A',       // { t, id }                         someone swung (play the animation)
  HIT: 'H',         // { t, id, by, hp, k: [kx, kz], v?: 1 } someone got hit (+ knockback; v=1: hit by the truck)
  BLOCKED: 'B',     // { t, id }                         someone blocked a hit with their shield
  PUSH: 'P',        // { t, k: [kx, kz] }                (only to you) the water jet pushes you
  CHAT_OUT: 'C',    // { t, id, m }                      someone said something
  SCORE: 'K',       // { t, g, c }                       faction scores
  PROPS: 'O',       // { t, l: [[x, z, carrierId|0], ...] } all street props (sent when you join)
  CARRY: 'G',       // { t, i, id }                      prop i is now carried by id (0 = dropped)
  FLY: 'F',         // { t, i, p: [x,y,z], v: [vx,vy,vz], by } prop i was thrown
  EMOTE_OUT: 'M',   // { t, id, e }                      someone plays an emote
  TAG_OUT: 'Y',     // { t, g: tag }                     a new graffiti tag
  TAGS: 'Z',        // { t, l: [tag, ...] }              all tags (sent when you join)
  TAGS_LEFT: 'W',   // { t, n }                          how many tags you can still spray today
  GAS_OUT: 'X',     // { t, p: [x, z], by }              a tear-gas cloud appears
  NEWS: 'N',        // { t, m }                          breaking news (dynamic events)
  RESET: 'V',
  CROWD_OUT: 'I',   // { t, i, k: [kx, kz], by }         a background extra was knocked down       // { t }                              new day: everything goes back to its place
  SUMMARY: 'U',     // { t, ... }                        end-of-day summary (at 06:00)
  ERROR: 'E',       // { t, m: message }
};

// ---------------------------------------------------------------------------
// Factions (one-letter codes on the wire)
// ---------------------------------------------------------------------------
export const FACTIONS = {
  g: { label: 'Yellow Vest', plural: 'Yellow Vests', color: 0xf7d417 }, // protester, yellow
  c: { label: 'Riot Police', plural: 'Riot Police', color: 0x1d2b4f },                    // riot police, dark blue
};
export const DEFAULT_FACTION = 'g';

// Number keys 1-4 say one of these lines (different per faction).
export const EMOTES = {
  g: ["We won't give up!", 'All together!', 'Lower prices!', '*claps*'],
  c: ['Disperse!', 'Move back!', 'Move along!', '*bangs shield*'],
};

// ---------------------------------------------------------------------------
// World / gameplay
// ---------------------------------------------------------------------------

// Each side has a base on its own end of the square: you start there and come back
// there after a K.O. Inside ANY base nobody can hit or be hit (safe zone).
export const BASES = {
  c: { x: -27.5, z: -54, r: 7, label: 'POLICE BASE' },          // north side, in front of the Caserne Vérines, between two police buses
  g: { x: 60, z: 47.5, r: 6.5, label: 'CAFÉ RÉPUBLIQUE' },     // south side, the real Café République terrace
};
export function inSafeZone(x, z) {
  for (const b of Object.values(BASES)) if (Math.hypot(x - b.x, z - b.z) < b.r) return true;
  return false;
}

// Spawn areas per faction (x/z centre + random radius). y is set by physics.
export const SPAWNS = {
  g: { x: 60, z: 46.5, radius: 1.8 },    // on the pavement in front of Café République
  c: { x: -27.5, z: -54, radius: 2 },    // between the police buses
};

// Where the water-cannon truck starts (on the square, east of the monument, facing west).
export const TRUCK_SPAWN = { x: 70, y: 1.3, z: -20, r: -Math.PI / 2 };

// You must be closer than this (metres) to the truck to press E and drive.
export const VEHICLE_ENTER_DISTANCE = 5;

// The map: the real streets around Place de la République (OpenStreetMap), 1 unit = 1 metre.
// Origin = the monument. x runs along the square: -x = west (Boulevard de Magenta,
// Boulevard Saint-Martin), +x = east (Boulevard du Temple, Boulevard Voltaire,
// Avenue de la République). Invisible walls at the edge of the map.
export const WORLD = { halfX: 325, halfZ: 255 };
export const WORLD_HALF_SIZE = 325; // (old name, kept for clamps)

// The pedestrian square itself (used for "control the square" and where NPCs wander).
export const PLAZA = { minX: -104, maxX: 114, minZ: -45, maxZ: 23 };
export const inPlaza = (x, z, margin = 0) =>
  x >= PLAZA.minX + margin && x <= PLAZA.maxX - margin && z >= PLAZA.minZ + margin && z <= PLAZA.maxZ - margin;

// ---------------------------------------------------------------------------
// Combat (cartoon brawl: knockback + KO, no blood)
// ---------------------------------------------------------------------------
export const MAX_HP = 3;                // hits before you are knocked out
export const ATTACK_RANGE = 2.6;        // metres in front of you
export const ATTACK_COOLDOWN_MS = 600;  // time between two swings
export const KO_MS = 3000;              // how long you lie on the ground
export const KNOCKBACK_SPEED = 8;       // m/s push when you get hit
export const FRIENDLY_FIRE = false;     // true = you can also hit your own faction

// Weapons: ONE funny weapon per side for now (no switching).
// range in metres, cooldown in ms, knock = push speed. Both are balanced the same.
export const WEAPONS = [
  { id: 'baguette', label: 'Baguette', range: 2.4, cooldown: 600, knock: 9 },          // Yellow Vests
  { id: 'chicken', label: 'Rubber chicken', range: 2.4, cooldown: 600, knock: 9 },     // Riot Police (it squeaks)
];
export const FIGHT_WEAPONS = WEAPONS.length;
export const DEFAULT_WEAPON = { g: 0, c: 1 }; // baguette, rubber chicken
// Ideas for extra weapons to sell later (not in the game yet):
// fists, baseball bat, metal bar, flag, umbrella, pool noodle, giant croissant.

// Tear gas (riot police: press H). Masks protect you (see shared/looks.js).
export const GAS_COOLDOWN_MS = 12000;
export const GAS_RANGE = 16;            // how far you can throw it
export const GAS_RADIUS = 5.5;          // size of the cloud
export const GAS_DURATION_MS = 14000;
export const GAS_PICKUP_MS = 8000;       // protesters can throw a canister back while it is younger than this
export const GAS_PICKUP_RANGE = 2.2;     // metres


// Throwing street props (bins, barriers)
export const GRAB_RANGE = 2.8;          // metres
export const THROW_SPEED = 15;          // m/s
export const THROW_HIT_RADIUS = 1.1;    // metres
export const THROW_KNOCK = 10;          // m/s push when a thrown prop hits you

// Truck hits: driving into someone faster than this knocks them out (cartoon "BOOM!").
// Set TRUCK_KNOCKDOWN = false if you'd rather the truck just bumps people.
export const TRUCK_KNOCKDOWN = true;
export const TRUCK_HIT_SPEED = 4;       // m/s (~15 km/h)
export const TRUCK_HIT_LAUNCH = 12;     // m/s how hard people fly away

// ---------------------------------------------------------------------------
// Water cannon
// ---------------------------------------------------------------------------
export const SPRAY_RANGE = 18;          // metres
export const SPRAY_HALF_ANGLE = 0.35;   // radians (~20°) each side of the barrel
export const SPRAY_PUSH_SPEED = 14;     // m/s push on people in the jet (you can't walk against it)
export const SPRAY_PROP_SPEED = 3;      // m/s the jet slides bins and barriers
export const WATER_MAX = 100;           // tank size
export const WATER_USE_PER_SEC = 12;    // empties in ~8 s
export const WATER_REFILL_PER_SEC = 6;  // refills in ~17 s when not spraying

// ---------------------------------------------------------------------------
// Street props (bins + metal crowd barriers) you can push around
// kind: 'bin' (round) or 'barrier' (long). r = rotation (barriers only)
// ---------------------------------------------------------------------------
export const PROPS = [
  // green Paris bins on the square
  { kind: 'bin', x: -80, z: -22 }, { kind: 'bin', x: -62, z: 12 }, { kind: 'bin', x: -32, z: -36 },
  { kind: 'bin', x: -14, z: 17 }, { kind: 'bin', x: 18, z: -32 }, { kind: 'bin', x: 46, z: 12 },
  { kind: 'bin', x: 70, z: -30 }, { kind: 'bin', x: 92, z: 14 }, { kind: 'bin', x: 102, z: -34 },
  { kind: 'bin', x: -96, z: 14 }, { kind: 'bin', x: 8, z: -42 }, { kind: 'bin', x: -46, z: 20 },
  // metal crowd barriers near Boulevard du Temple (the police like to line them up)
  { kind: 'barrier', x: 108, z: 2, r: Math.PI / 2 }, { kind: 'barrier', x: 108, z: 5, r: Math.PI / 2 },
  { kind: 'barrier', x: 108, z: 8, r: Math.PI / 2 }, { kind: 'barrier', x: 108, z: 11, r: Math.PI / 2 },
  { kind: 'barrier', x: 108, z: 14, r: Math.PI / 2 }, { kind: 'barrier', x: 108, z: 17, r: Math.PI / 2 },
];
export const PROP_PUSH_RANGE = 4;        // server: you must be this close to push a prop (truck: +4)

// ---------------------------------------------------------------------------
// Day / night + curfew ("couvre-feu")
// Everyone computes the game clock from the real time, so no messages needed.
// ---------------------------------------------------------------------------
export const GAME_DAY_MS = 12 * 60 * 1000; // one game day = 12 real minutes
export const CURFEW_START = 23 * 60;       // 23:00 (minutes after midnight)
export const CURFEW_END = 6 * 60;          // 06:00
export const CURFEW_SCORE_EVERY_MS = 5000; // during curfew, +1 point every 5 s to whoever controls the plaza

// Minutes since midnight in the game, e.g. 1380 = 23:00.
// For testing only: shift the game clock (never set in the live game).
const clockOffset = () => globalThis.__clockOffset || 0;
export function gameMinutes(nowMs = Date.now()) {
  return (((nowMs + clockOffset()) % GAME_DAY_MS) / GAME_DAY_MS) * 1440;
}
export function isCurfew(minutes) {
  return minutes >= CURFEW_START || minutes < CURFEW_END;
}
// Which game day it is (changes every GAME_DAY_MS). Used to reset scores at 06:00.
export function gameDayNumber(nowMs = Date.now()) {
  return Math.floor((nowMs + clockOffset() - (CURFEW_END / 1440) * GAME_DAY_MS) / GAME_DAY_MS);
}
export function formatClock(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Emotes (press T or use the bottom bar). `sec` = how long it plays (0 = until you move).
export const EMOTE_LIST = [
  { id: 'wave', label: 'Wave', sec: 2.5 },
  { id: 'fist', label: 'Raised fist', sec: 3 },
  { id: 'handsup', label: 'Hands up', sec: 3 },
  { id: 'clap', label: 'Clap', sec: 3 },
  { id: 'dance', label: 'Dance', sec: 6 },
  { id: 'sit', label: 'Sit', sec: 0 },
];

// Graffiti tags (press V facing a wall)
export const TAGS_PER_DAY = 5;          // per player per game day (premium could raise this later)
export const MAX_TAGS = 60;             // oldest tags disappear first
export const TAG_RANGE = 8;             // metres from the player

// NPCs: every player who ever joined stays on the square as an NPC
// when they're offline, wandering around semi-randomly.
export const NPC_MAX = 20;              // most recent players kept as NPCs
export const NPC_MIN_CROWD = 14;        // if fewer NPCs than this, background extras fill the square
export const NPC_SPEED = 1.6;           // m/s
export const NPC_CHANT_CHANCE = 0.0007; // per NPC per tick (~ every 2.5 min each)

// Room limits (protects your free-plan quota) + chat
// ---------------------------------------------------------------------------
export const MAX_PLAYERS = 40;
export const MAX_NAME_LENGTH = 16;
export const MAX_SLOGAN_LENGTH = 24;
export const MAX_CHAT_LENGTH = 80;
export const CHAT_COOLDOWN_MS = 800;
export const MAX_MESSAGE_BYTES = 512;
export const MAX_MESSAGES_PER_SECOND = 40; // per player; extra messages are ignored

// Round a number to 2 decimals before sending (centimetre precision is plenty).
export const round2 = (n) => Math.round(n * 100) / 100;
