// worker/GameRoom.js
// The multiplayer "server". One GameRoom Durable Object = one shared room.
//
// How it works (simple version):
//  - Each browser opens a WebSocket to /ws. The Worker forwards it here.
//  - We use the WebSocket *Hibernation* API (ctx.acceptWebSocket). This lets
//    Cloudflare put the object to sleep when the room is quiet, so you don't
//    pay (in free-plan quota) for idle time. Sockets stay connected meanwhile.
//  - Clients send their own state ~TICK_RATE times per second.
//  - A ticker broadcasts one compact snapshot of everyone to everyone,
//    also TICK_RATE times per second, but only when something changed.
//  - The server is the referee for everything that involves 2+ people:
//    truck ownership, hits, blocks, the water jet, thrown props, scores.
//  - It also runs the NPCs: every player who ever joined walks around the
//    square as an NPC while they're offline.
//
// Hibernation gotcha: when the object sleeps, normal JS variables are lost.
// That's why each socket carries a small "attachment" (serializeAttachment)
// with the player's data, and the truck / props / score / NPC list are saved to storage.

import { DurableObject } from 'cloudflare:workers';
import {
  MSG, TICK_MS, TICK_RATE, FACTIONS, DEFAULT_FACTION, SPAWNS, TRUCK_SPAWN, inSafeZone,
  VEHICLE_ENTER_DISTANCE, WORLD, MAX_PLAYERS, MAX_NAME_LENGTH,
  MAX_SLOGAN_LENGTH, MAX_CHAT_LENGTH, CHAT_COOLDOWN_MS, MAX_MESSAGES_PER_SECOND,
  MAX_MESSAGE_BYTES, MAX_HP, KO_MS, FRIENDLY_FIRE, WEAPONS, DEFAULT_WEAPON,
  SPRAY_RANGE, SPRAY_HALF_ANGLE, SPRAY_PUSH_SPEED, SPRAY_PROP_SPEED,
  TRUCK_KNOCKDOWN, TRUCK_HIT_SPEED, TRUCK_HIT_LAUNCH,
  WATER_MAX, WATER_USE_PER_SEC, WATER_REFILL_PER_SEC, PROPS, PROP_PUSH_RANGE,
  GRAB_RANGE, THROW_SPEED, THROW_HIT_RADIUS, THROW_KNOCK,
  NPC_MAX, NPC_MIN_CROWD, NPC_SPEED, NPC_CHANT_CHANCE, EMOTES, EMOTE_LIST, TAGS_PER_DAY, MAX_TAGS, TAG_RANGE,
  PLAZA, inPlaza, CURFEW_SCORE_EVERY_MS, gameMinutes, isCurfew, gameDayNumber, round2,
  FIGHT_WEAPONS, GAS_COOLDOWN_MS, GAS_RANGE, GAS_DURATION_MS, GAS_PICKUP_MS, GAS_PICKUP_RANGE, OPINION, ROLES, roleFor,
} from '../shared/constants.js';
import {
  objectiveAt, policeLine, phaseAt, linePhase, LINE_PUSH_MAX, meleeCenters, MELEE_RADIUS,
  currentScenario, scenarioForDay, scenarioMods, scenarioLabel, eventAt,
} from '../shared/timeline.js';
import { sanitize } from '../shared/filter.js';
import { getOwned } from './shop.js';
import { sanitizeLook, lookToArray, defaultLook, randomLook } from '../shared/looks.js';

// Places NPCs should not walk into (monument, café, métro entrances, kiosk): [x, z, halfW, halfD]
// Places NPCs don't walk into: the monument, métro entrances on the square, the two bases.
const NPC_AVOID = [[0, 0, 9.5, 9.5], [29.2, -1.5, 2.5, 3.5], [-78.5, -12.7, 2.5, 3.5], [108.7, -5.9, 2.5, 3.5], [-27.5, -54, 9, 6], [60, 49, 5, 4]];
const NPC_FIGHT_RANGE = 1.7;   // NPCs hit enemies this close
const NPC_FIGHT_COOLDOWN = 1400;
const LINE_HIT_COOLDOWN = 1300; // the riot-police line hits protesters in front of it
const LINE = { id: 'L', f: 'x', npc: true }; // "attacker" for line hits (no points for anyone)
const CROWD = { id: 'X', f: 'x', npc: true }; // "attacker" for the angry crowd hitting police who charge in alone
const CROWD_HIT_COOLDOWN = 1600;
// Anti-cheat: nobody legitimately moves faster than this (run = 10.5 m/s, dash = 15, truck = 14,
// knockback bursts a bit more). Positions further away than that are pulled back towards the server's copy.
const MAX_MOVE_SPEED = 30;      // m/s
const MOVE_BUDGET_MAX = 12;     // metres of "lag spike" a player may catch up in one go
const JOIN_TIMEOUT_MS = 15000;  // a socket that never sends JOIN is closed after this long
const TRUCK_AFK_MS = 45000;     // a parked, silent driver loses the truck after this long
const AD_NAMES_MAX = 500;       // unique names remembered per ad campaign per day
// How the line reacts (metres per real second).
const LINE_SPEED = { clashes: 0.25, curfew: 3 };  // advancing speed with no resistance
const LINE_RETREAT = { clashes: 0.35, curfew: 2 };  // falling back when protesters overwhelm it

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    if (env.CLOCK_OFFSET_MS) globalThis.__clockOffset = Number(env.CLOCK_OFFSET_MS) || 0; // testing only
    if (env.SCENARIO) globalThis.__scenario = env.SCENARIO; // testing only

    // id -> player. Fields (all mirrored in the socket attachment):
    //   id, n (name), f (faction), s (slogan), x, y, z, r (rotation), w (weapon)
    //   v  = 1 while driving the truck      b  = 1 while blocking (right mouse)
    //   hp = health (0 = knocked out)       ko = time (ms) when the KO ends
    //   at = time of the last attack        ct = time of the last chat message
    //   th = time of the last truck hit
    this.players = new Map();
    this.sockets = new Map();     // id -> WebSocket
    this.spectators = new Map();  // id -> WebSocket: people just watching (no body, no score, not counted as players)
    this.boardSig = '';           // last leaderboard sent (only re-sent when it changes)
    this.lastBoardAt = 0;
    this.rate = new Map();        // id -> { second, count } for the message rate limit

    // NPCs: id ("n0", "n1"...) -> same fields as a player + npc: true, tx/tz (walk target), kx/kz (knockback)
    this.npcs = new Map();
    this.registry = [];           // [{ n, f, s, l }] most recent players first (saved in storage)
    this.tags = [];               // graffiti: [{ x, y, z, nx, ny, nz, n (name), f, d (day) }]
    this.stats = {};              // day -> { j: joins, u: [unique names], pk: peak players }
    this.day = { day: gameDayNumber(), people: {}, flags: {}, evb: {} }; // per-player stats for the end-of-day summary
    this.line = { phase: null, push: 0, state: 1 }; // the reactive police line (see updatePoliceLine)
    this.gas = [];      // tear-gas clouds on the ground: { id, x, z, t }
    this.gasId = 0;
    this.lastAmbientGas = 0;

    // Truck. o = owner id (0 = nobody), sp = spraying (0/1), w = water left.
    this.truck = { x: TRUCK_SPAWN.x, y: TRUCK_SPAWN.y, z: TRUCK_SPAWN.z, r: TRUCK_SPAWN.r, o: 0, sp: 0, w: WATER_MAX };

    // Street props: current [x, z] of each one in shared PROPS.
    this.props = PROPS.map((p) => [p.x, p.z]);
    this.carried = new Map();     // prop index -> carrier id
    this.flying = new Map();      // prop index -> { x, y, z, vx, vy, vz, by, hit }
    this.changedProps = new Set(); // indexes to include in the next snapshot

    // Faction scores for the current game day.
    this.score = { g: 0, c: 0, day: gameDayNumber(), o: OPINION.start }; // o = public opinion (see OPINION in shared/constants.js)
    this.opinionAt = 0;      // when the opinion last drifted back towards 50
    this.lastOpinionSent = -1;
    this.lastCurfewPoint = 0;
    this.violence = [];     // recent K.O.s between the sides: { t, x, z, side, used } (what a journalist can photograph)
    this.lastEventTick = 0;
    this.last = null;       // summary of the last finished day (served at /last)

    this.ticker = null;   // setInterval handle
    this.dirty = false;   // did anything change since the last broadcast?
    this.idleTicks = 0;
    this.saveDue = false; // props/score need saving to storage
    this.statsDue = false; // ad impressions need saving
    this.lastStatsSave = 0;
    this.lastSave = 0;

    // Rebuild players after waking up from hibernation.
    for (const ws of this.ctx.getWebSockets()) {
      const p = ws.deserializeAttachment();
      if (p && p.id && p.sp) {
        this.spectators.set(p.id, ws);
      } else if (p && p.id) {
        this.players.set(p.id, p);
        this.sockets.set(p.id, ws);
      }
    }

    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get(['truck', 'props', 'score', 'registry', 'tags', 'stats', 'day', 'last']);
      if (saved.get('day')?.day === this.score.day) this.day = { evb: {}, ...saved.get('day') };
      this.last = saved.get('last') || null;
      const sameDay = saved.get('score')?.day === this.score.day; // world from an older day = start fresh
      this.tags = sameDay ? saved.get('tags') || [] : [];
      this.stats = saved.get('stats') || {};
      if (sameDay && saved.get('truck')) this.truck = { ...this.truck, ...saved.get('truck'), o: 0, sp: 0 };
      if (sameDay && saved.get('props')?.length === PROPS.length) this.props = saved.get('props');
      if (saved.get('score')?.day === this.score.day) this.score = saved.get('score');
      this.registry = saved.get('registry') || [];
      // If someone was driving when the room fell asleep, give the truck back to them.
      for (const p of this.players.values()) {
        if (p.v) {
          Object.assign(this.truck, { x: p.x, y: p.y, z: p.z, r: p.r, o: p.id });
          break;
        }
      }
      this.rebuildNpcs();
    });
  }

  // Called by worker/index.js for every new connection (and for /stats).
  async fetch(request) {
    if (new URL(request.url).pathname === '/last') {
      // How the last finished day ended (shown in the start menu).
      try {
        return Response.json(this.last ?? null, { headers: { 'cache-control': 'public, max-age=30' } });
      } catch (e) {
        return new Response(`last-day error: ${e && e.stack ? e.stack : e}`, { status: 500 });
      }
    }
    if (new URL(request.url).pathname === '/online') {
      // Who is on the square right now (public, tiny): shown in the start menu.
      let g = 0, c = 0;
      for (const p of this.players.values()) { if (p.f === 'g') g++; else if (p.f === 'c') c++; }
      return Response.json({ g, c, watching: this.spectators.size, total: this.players.size }, { headers: { 'cache-control': 'public, max-age=5' } });
    }
    if (new URL(request.url).pathname === '/stats') {
      // Simple player statistics (last 14 game days): joins, unique players, peak online.
      const days = Object.entries(this.stats).slice(-14).map(([day, s]) => ({ day: Number(day), joins: s.j, unique: s.u.length, peak: s.pk, ads: s.ads || {} }));
      return Response.json({ online: this.players.size, npcs: this.npcs.size, days });
    }
    // Count joined players + sockets still waiting to JOIN; close the ones that waited too long.
    const nowMs = Date.now();
    let open = 0;
    for (const sock of this.ctx.getWebSockets()) {
      const a = sock.deserializeAttachment();
      if (a && a.id) { open++; continue; }
      if (a && a.pending && nowMs - a.pending > JOIN_TIMEOUT_MS) {
        try { sock.close(1008, 'join timeout'); } catch { /* already closed */ }
        continue;
      }
      open++;
    }
    if (open >= MAX_PLAYERS) {
      return new Response('Room is full', { status: 503 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server); // Hibernation API
    server.serializeAttachment({ pending: nowMs }); // not joined yet
    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------------------
  // Incoming messages
  // ------------------------------------------------------------------------
  // Items owned by a wallet code, cached for a minute so the Wallet object is not asked on every message.
  async ownedFor(code, fresh = false) {
    if (!code || typeof code !== 'string') return new Set();
    this.walletCache ??= new Map();
    const hit = this.walletCache.get(code);
    if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.owned; // `fresh`: just bought something
    const owned = await getOwned(this.env, code);
    if (this.walletCache.size > 500) this.walletCache.clear();
    this.walletCache.set(code, { at: Date.now(), owned });
    return owned;
  }

  async webSocketMessage(ws, raw) {
    // Ignore binary or oversized messages (cheap protection).
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    // Premium outfit items are checked against the player's wallet code (cached, see ownedFor).
    const owned = msg.t === MSG.JOIN || msg.t === MSG.LOOK ? await this.ownedFor(msg.ow, msg.t === MSG.LOOK) : null;

    const me = ws.deserializeAttachment(); // null until JOIN
    const p = me && this.players.get(me.id);
    if (p && this.overRateLimit(p.id)) return;

    switch (msg.t) {
      case MSG.JOIN: return this.handleJoin(ws, me, msg, owned);
      case MSG.STATE: return p && this.handleState(ws, p, msg);
      case MSG.ENTER: return p && this.handleEnter(ws, p);
      case MSG.EXIT: return p && this.handleExit(p, msg);
      case MSG.ATTACK: return p && this.handleAttack(ws, p, msg);
      case MSG.RESPAWN: return p && this.handleRespawn(ws, p, msg);
      case MSG.CHAT: return p && this.handleChat(p, msg);
      case MSG.SPRAY: return p && this.handleSpray(p, msg);
      case MSG.PROP: return p && this.handleProp(p, msg);
      case MSG.GRAB: return p && this.handleGrab(p, msg);
      case MSG.THROW: return p && this.handleThrow(p, msg);
      case MSG.LOOK: return p && this.handleLook(ws, p, msg, owned);
      case MSG.EMOTE: return p && this.handleEmote(p, msg);
      case MSG.TAG: return p && this.handleTag(ws, p, msg);
      case MSG.AD_SEEN: return p && this.handleAdSeen(p, msg);
      case MSG.GAS: return p && this.handleGas(p, msg);
      case MSG.CROWD: return p && this.handleCrowdHit(p, msg);
      case MSG.ABILITY: return p && this.handleAbility(ws, p);
    }
  }

  async webSocketClose(ws, code) {
    this.removePlayer(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }

  async webSocketError(ws) {
    this.removePlayer(ws);
  }

  // ------------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------------
  handleJoin(ws, me, msg, owned) {
    if (me && me.id) return; // already joined
    if (msg.sp === 1) return this.handleSpectate(ws);

    const name = sanitize(msg.n, MAX_NAME_LENGTH) || 'Anonymous';
    const faction = FACTIONS[msg.f] ? msg.f : DEFAULT_FACTION;
    const slogan = faction === 'g' ? sanitize(msg.s, MAX_SLOGAN_LENGTH) : '';

    const id = this.newId();
    const spawn = SPAWNS[faction];
    const player = {
      id, n: name, f: faction, s: slogan, x: spawn.x, y: 1, z: spawn.z, r: 0,
      v: 0, b: 0, w: DEFAULT_WEAPON[faction], hp: MAX_HP, ko: 0, at: 0, ct: 0, th: 0,
      l: lookToArray(sanitizeLook(msg.l, faction, owned)), // outfit (validated against the catalog and the wallet)
      tg: 0, tgDay: -1, // graffiti tags sprayed today
      ro: roleFor(msg.ro, faction), // optional role (medic / journalist / drummer)
      bd: [0, 1, 2, 3].includes(msg.bd) ? msg.bd : 0, // loyalty badge (cosmetic)
      ab: 0, // time the role ability is ready again
    };
    // After a reconnect the client sends where it was, so nobody jumps back to spawn.
    this.applyPosition(player, msg.p, msg.r);

    this.players.set(id, player);
    this.sockets.set(id, ws);
    ws.serializeAttachment(player);

    // Remember this player so they become an NPC when they leave.
    this.register(name, faction, slogan, player.l);
    this.countJoin(name);

    this.send(ws, { t: MSG.WELCOME, id });
    this.send(ws, { t: MSG.VEHICLE, o: this.truck.o });
    this.send(ws, { t: MSG.PROPS, l: this.props.map((pr, i) => [pr[0], pr[1], this.carried.get(i) || 0]) });
    this.updateOpinion(Date.now());
    this.send(ws, this.scoreMessage());
    this.send(ws, { t: MSG.TAGS, l: this.tags });
    this.send(ws, { t: MSG.TAGS_LEFT, n: this.tagsLeft(player) });
    this.rebuildNpcs();
    this.broadcastRoster();
    this.markDirty();
  }

  // "Just watch": you get the world (roster, snapshots, chat, news) but no body and no score.
  handleSpectate(ws) {
    const id = this.newId();
    this.spectators.set(id, ws);
    ws.serializeAttachment({ id, sp: 1 });
    this.send(ws, { t: MSG.WELCOME, id });
    this.send(ws, { t: MSG.VEHICLE, o: this.truck.o });
    this.send(ws, { t: MSG.PROPS, l: this.props.map((pr, i) => [pr[0], pr[1], this.carried.get(i) || 0]) });
    this.updateOpinion(Date.now());
    this.send(ws, this.scoreMessage());
    this.send(ws, { t: MSG.TAGS, l: this.tags });
    this.send(ws, this.roster());
    this.send(ws, this.boardMessage());
    this.markDirty();
  }

  handleState(ws, p, msg) {
    if (!this.applyPosition(p, msg.p, msg.r, true)) return;
    // You can only be "in the vehicle" if the server says you own it.
    p.v = msg.v && this.truck.o === p.id ? 1 : 0;
    p.b = msg.b && p.hp > 0 && !p.v ? 1 : 0;
    p.w = DEFAULT_WEAPON[p.f] ?? 0; // one weapon per side for now (extra weapons = paid items later)

    if (p.v) {
      // The driver's position IS the truck's position.
      const now = Date.now();
      const t = this.truck;
      const elapsed = (now - (t.lastMove || now)) / 1000;
      const speed = elapsed > 0 ? Math.hypot(p.x - t.x, p.z - t.z) / elapsed : 0;
      Object.assign(t, { x: p.x, y: p.y, z: p.z, r: p.r, lastMove: now });
      if (speed > 0.3 || t.sp) this.truckActive = now; // for the AFK check
      if (TRUCK_KNOCKDOWN && speed > TRUCK_HIT_SPEED && speed < 40) this.truckHits(p, speed, now);
    } else {
      this.truck.lastMove = 0;
    }

    ws.serializeAttachment(p); // survive hibernation
    this.markDirty();
  }

  handleEnter(ws, p) {
    const closeEnough = Math.hypot(p.x - this.truck.x, p.z - this.truck.z) <= VEHICLE_ENTER_DISTANCE + 2; // +2 = lag tolerance
    if (this.truck.o === 0 && closeEnough && p.hp > 0) {
      this.dropCarried(p.id);
      this.truck.o = p.id;
      this.truckActive = Date.now();
      this.broadcast({ t: MSG.VEHICLE, o: p.id }); // everyone learns the new driver
      this.markDirty();
    } else {
      this.send(ws, { t: MSG.VEHICLE, o: this.truck.o }); // denied
    }
  }

  handleExit(p, msg) {
    if (this.truck.o !== p.id) return;
    // Use the final pose the driver sent, if it's valid.
    if (Array.isArray(msg.p) && msg.p.length === 3 && msg.p.every(Number.isFinite) && Number.isFinite(msg.r)
        && Math.hypot(msg.p[0] - this.truck.x, msg.p[2] - this.truck.z) < 10) {
      Object.assign(this.truck, { x: round2(msg.p[0]), y: round2(msg.p[1]), z: round2(msg.p[2]), r: round2(msg.r) });
    }
    this.releaseTruck();
  }

  // Someone swings their weapon. The server decides who gets hit.
  handleAttack(ws, attacker, msg) {
    const now = Date.now();
    const weapon = WEAPONS[attacker.w] || WEAPONS[0];
    if (attacker.hp <= 0 || attacker.v || attacker.b) return;   // KO'd, driving or blocking
    if (inSafeZone(attacker.x, attacker.z)) return;             // no fighting inside a base
    if (this.isCarrying(attacker.id)) return;                   // hands full
    if (now - attacker.at < weapon.cooldown - 50) return;       // too fast (50 ms lag tolerance)
    attacker.at = now;
    this.applyPosition(attacker, msg.p, msg.r, true);           // freshest position + aim (speed-checked)

    this.broadcast({ t: MSG.SWING, id: attacker.id });          // everyone plays the animation

    const fx = Math.sin(attacker.r);  // attacker's forward direction on the ground
    const fz = Math.cos(attacker.r);

    for (const target of this.targets()) {
      if (target === attacker || target.hp <= 0 || target.v) continue;
      if (!FRIENDLY_FIRE && target.f === attacker.f) continue;

      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const dist = Math.hypot(dx, dz);
      if (dist > weapon.range || Math.abs(target.y - attacker.y) > 2) continue;
      // Must be roughly in front of the attacker (a ~140° cone).
      if (dist > 0.3 && (dx * fx + dz * fz) / dist < 0.35) continue;

      // Blocking (right mouse) and facing the attacker? Blocked!
      if (target.b && facing(target, attacker.x, attacker.z)) {
        this.broadcast({ t: MSG.BLOCKED, id: target.id });
        continue;
      }
      const kx = dist > 0.01 ? dx / dist : fx; // push the target away from the attacker
      const kz = dist > 0.01 ? dz / dist : fz;
      this.damage(target, attacker, 1, kx * weapon.knock, kz * weapon.knock, now);
    }

    ws.serializeAttachment(attacker);
    this.markDirty();
  }

  // KO is over: back on your feet (the client chose where).
  handleRespawn(ws, p, msg) {
    if (p.hp > 0 || Date.now() < p.ko - 300) return; // not KO'd, or too early
    p.hp = MAX_HP;
    p.ko = 0;
    this.applyPosition(p, msg.p, p.r);
    const base = SPAWNS[p.f] || SPAWNS.g; // you always get back up near your own base
    if (Math.hypot(p.x - base.x, p.z - base.z) > 8) { p.x = base.x; p.z = base.z; }
    ws.serializeAttachment(p);
    this.markDirty();
  }

  handleChat(p, msg) {
    const now = Date.now();
    if (now - p.ct < CHAT_COOLDOWN_MS) return;
    const m = sanitize(msg.m, MAX_CHAT_LENGTH);
    if (!m) return;
    p.ct = now;
    // Protesters chanting together win a little public support (at most once per 10 s each).
    if (p.f === 'g' && EMOTES.g.includes(msg.m) && now - (p.cn || 0) > 10000) {
      p.cn = now;
      this.shiftOpinion(OPINION.chant, 'c', p);
    }
    this.broadcast({ t: MSG.CHAT_OUT, id: p.id, m });
  }

  handleSpray(p, msg) {
    if (this.truck.o !== p.id) return;
    this.truck.sp = msg.on && this.truck.w > 1 ? 1 : 0;
    this.markDirty();
  }

  // A player (or the truck) pushed a bin / barrier. Accept it if they are close.
  handleProp(p, msg) {
    const i = msg.i;
    if (!this.validProp(i) || this.carried.has(i) || this.flying.has(i)) return;
    if (!Array.isArray(msg.p) || msg.p.length !== 2 || !msg.p.every(Number.isFinite)) return;
    const [x, z] = msg.p;
    const range = PROP_PUSH_RANGE + (p.v ? 4 : 0);
    if (Math.hypot(x - p.x, z - p.z) > range) return;          // too far from the pusher
    const old = this.props[i];
    if (Math.hypot(x - old[0], z - old[1]) > 3) return;        // moved too far in one go
    this.setProp(i, x, z);
  }

  // Pick up a bin / barrier.
  handleGrab(p, msg) {
    const i = msg.i;
    if (!this.validProp(i) || this.carried.has(i) || this.flying.has(i)) return;
    if (p.hp <= 0 || p.v || this.isCarrying(p.id)) return;
    const [x, z] = this.props[i];
    if (Math.hypot(x - p.x, z - p.z) > GRAB_RANGE + 1) return;   // +1 = lag tolerance
    this.carried.set(i, p.id);
    this.broadcast({ t: MSG.CARRY, i, id: p.id });
    this.markDirty();
  }

  // Throw the prop you carry. The server flies it and checks who it hits.
  handleThrow(p, msg) {
    const i = msg.i;
    if (this.carried.get(i) !== p.id) return;
    if (!Array.isArray(msg.v) || msg.v.length !== 3 || !msg.v.every(Number.isFinite)) return;
    let [vx, vy, vz] = msg.v;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > THROW_SPEED * 1.2) { const k = (THROW_SPEED * 1.2) / speed; vx *= k; vy *= k; vz *= k; }
    this.carried.delete(i);
    const start = { x: p.x, y: p.y + 1.2, z: p.z };
    this.flying.set(i, { ...start, vx, vy, vz, by: p.id, hit: false });
    this.broadcast({ t: MSG.FLY, i, p: [round2(start.x), round2(start.y), round2(start.z)], v: [round2(vx), round2(vy), round2(vz)], by: p.id });
    this.markDirty();
  }

  // New outfit chosen in the in-game editor.
  handleLook(ws, p, msg, owned) {
    p.l = lookToArray(sanitizeLook(msg.l, p.f, owned));
    ws.serializeAttachment(p);
    this.register(p.n, p.f, p.s, p.l);
    this.broadcastRoster();
  }

  handleEmote(p, msg) {
    if (!Number.isInteger(msg.e) || msg.e < 0 || msg.e >= EMOTE_LIST.length || p.hp <= 0 || p.v) return;
    this.broadcast({ t: MSG.EMOTE_OUT, id: p.id, e: msg.e });
  }

  // Spray a graffiti tag (your name) on a wall near you.
  handleTag(ws, p, msg) {
    if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(Number.isFinite)) return;
    if (!Array.isArray(msg.n) || msg.n.length !== 3 || !msg.n.every(Number.isFinite)) return;
    if (this.tagsLeft(p) <= 0 || p.hp <= 0 || p.v) return;
    const [x, y, z] = msg.p;
    if (Math.hypot(x - p.x, z - p.z) > TAG_RANGE + 1 || y < 0 || y > 6) return;
    const len = Math.hypot(...msg.n) || 1;
    const tag = {
      x: round2(x), y: round2(y), z: round2(z),
      nx: round2(msg.n[0] / len), ny: round2(msg.n[1] / len), nz: round2(msg.n[2] / len),
      n: p.n, f: p.f,
    };
    p.tg += 1;
    ws.serializeAttachment(p);
    this.tags.push(tag);
    this.person(p).tg += 1;
    if (this.tags.length > MAX_TAGS) this.tags.shift(); // oldest disappears
    this.ctx.storage.put('tags', this.tags);
    this.broadcast({ t: MSG.TAG_OUT, g: tag });
    this.send(ws, { t: MSG.TAGS_LEFT, n: this.tagsLeft(p) });
  }

  // Riot police throw a tear-gas canister. Everyone draws the cloud; each
  // browser applies the effect (cough, slow) to its own player.
  // Tear gas. Police throw it (H); protesters can pick up a fresh canister and throw it back (G).
  handleGas(p, msg) {
    const now = Date.now();
    if (p.hp <= 0 || p.v || inSafeZone(p.x, p.z)) return; // no tear gas from inside a base
    if (!Array.isArray(msg.p) || msg.p.length !== 2 || !msg.p.every(Number.isFinite)) return;
    let removed = 0;
    if (p.f === 'g') {
      // Throwing one back: there must be a fresh canister right next to you.
      this.gas = this.gas.filter((g) => now - g.t < GAS_DURATION_MS);
      const can = this.gas.find((g) => g.id === msg.back && now - g.t < GAS_PICKUP_MS && Math.hypot(g.x - p.x, g.z - p.z) < GAS_PICKUP_RANGE + 1);
      if (!can || now - (p.gb || 0) < 1500) return;
      p.gb = now;
      this.gas = this.gas.filter((g) => g !== can);
      removed = can.id;
      this.news(`${p.n} throws a tear-gas canister back at the police!`, 'gasback-' + p.n);
    } else {
      if (p.f !== 'c' || now - (p.gt || 0) < GAS_COOLDOWN_MS - 200) return;
      p.gt = now;
    }
    let [x, z] = msg.p;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > GAS_RANGE) { x = p.x + ((x - p.x) / d) * GAS_RANGE; z = p.z + ((z - p.z) / d) * GAS_RANGE; }
    this.addGasCloud(x, z, p.id, removed);
    // Gassing a crowd of protesters backfires on the police.
    if (p.f === 'c') {
      let crowd = 0;
      for (const t of this.targets()) if (t.f === 'g' && t.hp > 0 && Math.hypot(t.x - x, t.z - z) < 6) crowd++;
      if (crowd >= 4) this.shiftOpinion(OPINION.gas, 'g', p);
    }
    // NPCs inside the cloud run away from it.
    for (const n of this.npcs.values()) {
      const dx = n.x - x, dz = n.z - z, dist = Math.hypot(dx, dz);
      if (dist < 8 && n.hp > 0) { n.tx = n.x + (dx / (dist || 1)) * 12; n.tz = n.z + (dz / (dist || 1)) * 12; n.wait = 0; }
    }
  }

  addGasCloud(x, z, by, removed = 0) {
    const id = ++this.gasId;
    this.gas.push({ id, x, z, t: Date.now() });
    const msg = { t: MSG.GAS_OUT, id, p: [round2(x), round2(z)], by };
    if (removed) msg.rm = removed;
    this.broadcast(msg);
  }

  // New day: every bin, barrier, the truck, the graffiti and every player go back to the start.
  resetWorld() {
    this.carried.clear();
    this.flying.clear();
    this.props = PROPS.map((p) => [p.x, p.z]);
    this.truck = { x: TRUCK_SPAWN.x, y: TRUCK_SPAWN.y, z: TRUCK_SPAWN.z, r: TRUCK_SPAWN.r, o: 0, sp: 0, w: WATER_MAX };
    this.tags = [];
    const all = [...this.players.values()];
    for (const p of all) {
      const s = SPAWNS[p.f] || SPAWNS.g;
      Object.assign(p, { hp: MAX_HP, ko: 0, v: 0, b: 0, x: s.x, z: s.z, pt: 0, tg: 0, tgDay: gameDayNumber() });
      this.sockets.get(p.id)?.serializeAttachment(p);
    }
    for (const n of this.npcs.values()) Object.assign(n, { hp: MAX_HP, ko: 0 });
    this.broadcast({ t: MSG.RESET });
    this.broadcast({ t: MSG.VEHICLE, o: 0 });
    this.broadcast({ t: MSG.PROPS, l: this.props.map((pr) => [pr[0], pr[1], 0]) });
    this.broadcast({ t: MSG.TAGS, l: [] });
    this.broadcast({ t: MSG.TAGS_LEFT, n: TAGS_PER_DAY });
    this.ctx.storage.put({ props: this.props, truck: this.truck, tags: this.tags, score: this.score });
    this.markDirty();
  }

  // Per-player statistics for today's summary (kept by name, so reconnects count).
  person(p) {
    const key = p.n.toLowerCase();
    return this.day.people[key] || (this.day.people[key] = { n: p.n, f: p.f, ko: 0, tg: 0, zp: 0, hits: 0 });
  }

  // Dynamic breaking news, at most once per key per day.
  news(text, key = text) {
    if (this.day.flags[key]) return;
    this.day.flags[key] = 1;
    this.broadcast({ t: MSG.NEWS, m: text });
  }

  // Count banner impressions per campaign (shown in /stats for advertisers).
  handleAdSeen(p, msg) {
    if (typeof msg.c !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(msg.c)) return;
    p.ads = p.ads || [];
    if (p.ads.includes(msg.c)) return; // once per campaign per visit
    p.ads.push(msg.c);
    // ...and once per player name per campaign per game day, so reconnecting doesn't inflate the numbers.
    const s = this.todayStats();
    s.adu = s.adu || {};
    const seen = s.adu[msg.c] || (s.adu[msg.c] = []);
    const who = p.n.toLowerCase();
    if (seen.includes(who) || seen.length >= AD_NAMES_MAX) return;
    seen.push(who);
    s.ads = s.ads || {};
    s.ads[msg.c] = (s.ads[msg.c] || 0) + 1;
    this.statsDue = true;
  }

  todayStats() {
    const day = gameDayNumber();
    return this.stats[day] || (this.stats[day] = { j: 0, u: [], pk: 0 });
  }

  tagsLeft(p) {
    const day = gameDayNumber();
    if (p.tgDay !== day) { p.tgDay = day; p.tg = 0; }
    return Math.max(0, TAGS_PER_DAY - p.tg);
  }

  // Player statistics for /stats (one small storage write per join).
  countJoin(name) {
    const day = gameDayNumber();
    const s = this.stats[day] || (this.stats[day] = { j: 0, u: [], pk: 0 });
    s.j += 1;
    const key = name.toLowerCase();
    if (!s.u.includes(key)) s.u.push(key);
    s.pk = Math.max(s.pk, this.players.size);
    const keys = Object.keys(this.stats);
    if (keys.length > 30) delete this.stats[keys[0]]; // keep ~30 game days
    this.ctx.storage.put('stats', this.stats);
  }

  // ------------------------------------------------------------------------
  // Per-tick game logic (only runs while the room is active)
  // ------------------------------------------------------------------------
  tick() {
    const now = Date.now();
    this.updateWaterCannon();
    // Someone sitting in the truck without moving or spraying loses it, so one AFK player can't block it all day.
    if (this.truck.o && now - (this.truckActive || now) > TRUCK_AFK_MS) {
      const driverSocket = this.sockets.get(this.truck.o);
      if (driverSocket) this.send(driverSocket, { t: MSG.NEWS, m: 'You were asleep at the wheel: the truck is free again.' });
      this.releaseTruck();
    }
    this.updateFlyingProps(now);
    this.updateNpcs(now);
    this.updateNpcFights(now);
    this.updatePoliceLine(now);
    this.updateCurfew(now);
    this.updateEvent(now);
    this.updateOpinion(now);
    this.updateBoard(now);

    if (this.saveDue && now - this.lastSave > 5000) {
      // Save props + score at most every 5 s (storage writes count towards the free quota).
      this.saveDue = false;
      this.lastSave = now;
      this.ctx.storage.put({ props: this.props, score: this.score, day: this.day });
    }
    if (this.statsDue && now - this.lastStatsSave > 10000) {
      this.statsDue = false;
      this.lastStatsSave = now;
      this.ctx.storage.put('stats', this.stats);
    }

    if (this.dirty) {
      this.dirty = false;
      const p = [];
      for (const pl of this.targets()) {
        p.push([pl.id, round2(pl.x), round2(pl.y), round2(pl.z), round2(pl.r), pl.v ? 1 : 0, pl.hp, pl.b ? 1 : 0, pl.w]);
      }
      const t = this.truck;
      const snap = { t: MSG.SNAPSHOT, p, v: [t.x, t.y, t.z, t.r, t.o, t.sp, Math.round(t.w)] };
      if (this.line.phase) snap.l = [Math.round(this.line.push * 10) / 10, this.line.state];
      if (this.changedProps.size) {
        snap.o = [...this.changedProps].map((i) => [i, ...this.props[i]]);
        this.changedProps.clear();
      }
      this.broadcast(snap);
      return;
    }
    // Nothing happened for ~3 seconds: stop the timer so the object can hibernate.
    // (Not while people are online with NPCs walking, or during the curfew.)
    if (this.watchers() && (this.npcs.size || isCurfew(gameMinutes(now)))) return;
    if (++this.idleTicks > TICK_RATE * 3) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  // The water jet: pushes everyone (and the props) in a cone in front of the truck.
  updateWaterCannon() {
    const t = this.truck;
    const dt = TICK_MS / 1000;
    if (!t.o) t.sp = 0;
    if (t.sp) {
      t.w = Math.max(0, t.w - WATER_USE_PER_SEC * dt);
      if (t.w <= 0) t.sp = 0; // tank empty
      this.markDirty();
    } else if (t.w < WATER_MAX) {
      t.w = Math.min(WATER_MAX, t.w + WATER_REFILL_PER_SEC * dt);
      if (t.o) this.markDirty(); // keep the driver's water gauge updated
    }
    if (!t.sp) return;
    this.news('The water cannon opens fire on the square!', 'spray');

    const fx = Math.sin(t.r);
    const fz = Math.cos(t.r);
    const ox = t.x + fx * 3; // the jet starts at the front of the truck
    const oz = t.z + fz * 3;
    const inJet = (x, z) => {
      const dx = x - ox, dz = z - oz;
      const dist = Math.hypot(dx, dz);
      if (dist > SPRAY_RANGE || dist < 0.01) return 0;
      return (dx * fx + dz * fz) / dist >= Math.cos(SPRAY_HALF_ANGLE) ? dist : 0;
    };
    for (const p of this.targets()) {
      if (p.id === t.o || p.v) continue;
      const dist = inJet(p.x, p.z);
      if (!dist) continue;
      if (p.b && p.f === 'c' && facing(p, t.x, t.z)) continue; // the CRS shield blocks water
      const strength = SPRAY_PUSH_SPEED * (1 - (dist / SPRAY_RANGE) * 0.4); // weaker far away
      if (p.npc) { p.kx = fx * strength; p.kz = fz * strength; }
      else this.send(this.sockets.get(p.id), { t: MSG.PUSH, k: [round2(fx * strength), round2(fz * strength)] });
    }
    // The jet also slides bins and barriers (great for clearing barricades).
    const step = SPRAY_PROP_SPEED * dt;
    this.props.forEach((pr, i) => {
      if (this.carried.has(i) || this.flying.has(i) || !inJet(pr[0], pr[1])) return;
      this.setProp(i, pr[0] + fx * step, pr[1] + fz * step);
    });
  }

  // Thrown props fly in an arc; the first enemy they touch gets hit.
  updateFlyingProps(now) {
    if (!this.flying.size) return;
    const dt = TICK_MS / 1000 / 2;
    for (const [i, f] of this.flying) {
      for (let s = 0; s < 2; s++) { // 2 small steps per tick = more accurate hits
        f.vy -= 9.8 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;
        if (!f.hit) {
          const thrower = this.players.get(f.by);
          for (const target of this.targets()) {
            if (target.id === f.by || target.hp <= 0 || target.v) continue;
            if (!FRIENDLY_FIRE && thrower && target.f === thrower.f) continue;
            if (Math.hypot(target.x - f.x, target.z - f.z) > THROW_HIT_RADIUS || Math.abs(target.y - f.y) > 1.8) continue;
            f.hit = true;
            if (target.b && facing(target, f.x - f.vx, f.z - f.vz)) {
              this.broadcast({ t: MSG.BLOCKED, id: target.id });
            } else {
              const sp = Math.hypot(f.vx, f.vz) || 1;
              this.damage(target, thrower, 1, (f.vx / sp) * THROW_KNOCK, (f.vz / sp) * THROW_KNOCK, now);
            }
            f.vx *= 0.2; f.vz *= 0.2; // bounce off and drop
            break;
          }
        }
        if (f.y <= 0.5) { // landed
          this.flying.delete(i);
          this.setProp(i, f.x, f.z);
          break;
        }
      }
    }
    this.markDirty();
  }

  // NPCs wander around the plaza, sometimes stop, sometimes chant.
  updateNpcs(now) {
    if (!this.npcs.size || !this.watchers()) return;
    const dt = TICK_MS / 1000;
    for (const n of this.npcs.values()) {
      if (n.hp <= 0) {
        if (now >= n.ko) { // get up somewhere on the plaza
          Object.assign(n, randomPlazaPoint(), { hp: MAX_HP, ko: 0, kx: 0, kz: 0 });
        }
      }
      // Knockback (hits, water) fades out quickly.
      if (n.kx || n.kz) {
        n.x += n.kx * dt;
        n.z += n.kz * dt;
        n.kx *= 0.55; n.kz *= 0.55;
        if (Math.abs(n.kx) + Math.abs(n.kz) < 0.1) n.kx = n.kz = 0;
      } else if (n.hp > 0) {
        if (n.wait > 0) {
          n.wait -= dt;
        } else {
          const dx = n.tx - n.x, dz = n.tz - n.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.5) {
            // Arrived: pause a bit, then pick a new random target.
            n.wait = Math.random() < 0.5 ? 1 + Math.random() * 4 : 0;
            Object.assign(n, randomTarget(n, this.players));
          } else {
            // Each NPC has its own pace; they speed up a bit for long walks and turn smoothly.
            n.sp = n.sp || NPC_SPEED * (0.75 + Math.random() * 0.4);
            const step = Math.min(d, n.sp * (d > 12 ? 1.25 : 1) * dt);
            n.x += (dx / d) * step;
            n.z += (dz / d) * step;
            const turn = Math.atan2(Math.sin(Math.atan2(dx, dz) - n.r), Math.cos(Math.atan2(dx, dz) - n.r));
            n.r = round2(n.r + turn * 0.35);
          }
        }
        if (Math.random() < NPC_CHANT_CHANCE) {
          const lines = EMOTES[n.f];
          this.broadcast({ t: MSG.CHAT_OUT, id: n.id, m: lines[Math.floor(Math.random() * lines.length)] });
        }
        if (n.wait > 0 && Math.random() < NPC_CHANT_CHANCE * 2) {
          // While standing still, NPCs sometimes wave, clap, dance...
          this.broadcast({ t: MSG.EMOTE_OUT, id: n.id, e: Math.floor(Math.random() * (EMOTE_LIST.length - 1)) });
        }
      }
      // Don't walk through each other: gently push apart NPCs that overlap.
      for (const o of this.npcs.values()) {
        if (o === n || o.hp <= 0) continue;
        const ox = n.x - o.x, oz = n.z - o.z, od = Math.hypot(ox, oz);
        if (od > 0.01 && od < 0.85) { n.x += (ox / od) * (0.85 - od) * 0.5; n.z += (oz / od) * (0.85 - od) * 0.5; }
      }
      pushOutOfObstacles(n);
      n.x = clamp(n.x, PLAZA.minX - 40, PLAZA.maxX + 40);
      n.z = clamp(n.z, PLAZA.minZ - 20, PLAZA.maxZ + 20);
    }
    this.markDirty();
  }

  // NPCs fight: police NPCs go after protesters nearby (and the other way round),
  // and hit whoever is within reach. Same rules as players (blocking works, bases are safe).
  updateNpcFights(now) {
    if (!this.npcs.size || !this.watchers()) return;
    const tense = true; // constant chaos: NPCs always look for a fight
    const everyone = this.targets();
    for (const n of this.npcs.values()) {
      if (n.hp <= 0 || inSafeZone(n.x, n.z) || now < (n.calmUntil || 0)) continue;
      // Stuck behind the monument or a base while chasing? Give up for a while and walk elsewhere.
      if (n.chasing && now - (n.chaseCheck || 0) > 2000) {
        const moved = Math.hypot(n.x - (n.cx0 ?? n.x), n.z - (n.cz0 ?? n.z));
        n.chaseCheck = now; n.cx0 = n.x; n.cz0 = n.z;
        if (moved < 0.6 && n.chasing > 1) {
          n.chasing = 0; n.calmUntil = now + 6000;
          Object.assign(n, randomTarget(n, this.players));
          continue;
        }
      }
      let best = null, bestD = n.f === 'c' ? (tense ? 14 : 8) : (tense ? 8 : 4);
      for (const t of everyone) {
        if (t === n || t.f === n.f || t.hp <= 0 || t.v || (t.f !== 'g' && t.f !== 'c') || inSafeZone(t.x, t.z)) continue;
        const d = Math.hypot(t.x - n.x, t.z - n.z);
        if (d < bestD) { best = t; bestD = d; }
      }
      if (!best) { n.chasing = 0; continue; }
      const want = Math.atan2(best.x - n.x, best.z - n.z);
      n.r = round2(n.r + Math.atan2(Math.sin(want - n.r), Math.cos(want - n.r)) * 0.4); // turn smoothly
      if (bestD > NPC_FIGHT_RANGE) {            // walk up to them
        n.tx = best.x - Math.sin(want) * 1.2;
        n.tz = best.z - Math.cos(want) * 1.2;
        n.wait = 0;
        n.chasing = (n.chasing || 0) + 1;
        if (insideObstacle(n.tx, n.tz)) { n.chasing = 0; n.calmUntil = now + 4000; Object.assign(n, randomTarget(n, this.players)); }
        continue;
      }
      n.chasing = 0;
      n.wait = 0.5; // stand and fight
      if (now - (n.at || 0) < NPC_FIGHT_COOLDOWN + Math.random() * 600) continue;
      n.at = now;
      this.broadcast({ t: MSG.SWING, id: n.id });
      if (best.b && facing(best, n.x, n.z)) { this.broadcast({ t: MSG.BLOCKED, id: best.id }); continue; }
      const weapon = WEAPONS[DEFAULT_WEAPON[n.f] ?? 0];
      this.damage(best, n, 1, Math.sin(n.r) * weapon.knock, Math.cos(n.r) * weapon.knock, now);
    }
  }

  // The riot-police line (shared/timeline.js). During the clashes and the curfew sweep it
  // REACTS to what players do:
  //   - it advances by itself, faster with police (players + NPCs) backing it up;
  //   - protesters standing in front of the shields and bins/barriers piled there resist it;
  //   - enough resistance stops it, a lot pushes it back.
  // It also hits protesters right in front of the shields, shoves barricades forward,
  // and the angry crowd in front of it hits police who charge in alone.
  updatePoliceLine(now) {
    const h = gameMinutes(now) / 60;
    const phase = linePhase(h);
    const dt = TICK_MS / 1000;
    if (phase !== this.line.phase) {
      this.line = { phase, push: 0, state: 1, since: now };
      if (phase) this.markDirty();
    }
    let L = policeLine(h, phase ? this.line.push : null);
    if (L.active <= 0.5) return;
    const ca = Math.cos(L.a), sa = Math.sin(L.a);
    const local = (x, z) => { const dx = x - L.x, dz = z - L.z; return { along: dx * ca + dz * sa, front: dx * L.fx + dz * L.fz }; };
    const everyone = this.targets();

    if (phase) {
      // Who is pushing on each side?
      let protesters = 0, police = 0, barricade = 0;
      for (const t of everyone) {
        if (t.hp <= 0 || t.v) continue;
        const { along, front } = local(t.x, t.z);
        if (Math.abs(along) > L.len / 2 + 2) continue;
        // Real players count more than NPCs.
        if (t.f === 'g' && front > -0.5 && front < 5) protesters += t.npc ? 1 : 1.5;
        if (t.f === 'c' && front > -8 && front < 3) police += t.npc ? 0.5 : 1.5;
      }
      this.props.forEach((pr, i) => {
        if (this.carried.has(i) || this.flying.has(i)) return;
        const { along, front } = local(pr[0], pr[1]);
        if (Math.abs(along) < L.len / 2 + 1 && front > -0.5 && front < 4) barricade++;
      });
      const resistance = protesters + barricade * 1.5;
      const hold = 3 + Math.min(police, 6);
      if (globalThis.__clockOffset && now - (this.lineLog || 0) > 2000) { // testing only
        this.lineLog = now;
        console.log(`line ${phase} push=${this.line.push.toFixed(1)} protesters=${protesters} barricade=${barricade} police=${police} hold=${hold}`);
      }
      const before = this.line.state;
      // Today's scenario and public opinion change how fast the line moves (opinion 100 = x0.4, 0 = x1.6).
      const mods = scenarioMods(h);
      const op = (this.opinion() - 50) / 50; // -1 (all for the police) .. +1 (all for the protesters)
      let speed;
      if (resistance >= hold * 1.6) { speed = -LINE_RETREAT[phase] * (1 + 0.5 * op); this.line.state = -1; }
      else if (resistance >= hold) { speed = 0; this.line.state = 0; }
      else { speed = LINE_SPEED[phase] * mods.lineSpeed * clamp(1 - 0.6 * op, 0.4, 1.6) * (1 + Math.min(police, 4) * 0.2) * (1 - resistance / hold); this.line.state = 1; }
      const old = this.line.push;
      this.line.push = clamp(old + speed * dt, 0, LINE_PUSH_MAX[phase]);
      if (Math.abs(this.line.push - old) > 0.001) this.markDirty();
      if (before !== this.line.state) {
        this.markDirty();
        if (this.line.state === 0) this.news('Protesters are holding the police line!', 'hold-' + phase + Math.floor(now / 60000));
        if (this.line.state === -1) this.news('The police line is falling back!', 'back-' + phase + Math.floor(now / 60000));
      }
      L = policeLine(h, this.line.push);

      // An advancing line shoves the bins and barriers in front of it.
      if (speed > 0) {
        this.props.forEach((pr, i) => {
          if (this.carried.has(i) || this.flying.has(i)) return;
          const { along, front } = local(pr[0], pr[1]);
          if (Math.abs(along) < L.len / 2 + 0.5 && front > -0.5 && front < 1.2) this.setProp(i, pr[0] + L.fx * speed * dt * 1.5, pr[1] + L.fz * speed * dt * 1.5);
        });
      }

      // Tear gas fired by the line every ~9 s (in front of it).
      if (now - this.lastAmbientGas > 9000 / Math.max(0.1, mods.gas)) {
        this.lastAmbientGas = now;
        if (Math.random() < 0.6) {
          const along = (Math.random() - 0.5) * L.len, ahead = 6 + Math.random() * 10;
          this.addGasCloud(L.x + ca * along + L.fx * ahead, L.z + sa * along + L.fz * ahead, 'L');
        }
      }
    }

    for (const t of everyone) {
      if (t.hp <= 0 || t.v || inSafeZone(t.x, t.z)) continue;
      const { along, front } = local(t.x, t.z);
      // Protesters in front of the shields get hit by the line.
      if (t.f === 'g') {
        if (Math.abs(along) > L.len / 2 + 0.5 || front < -0.6 || front > 2.1) continue;
        if (now - (t.lh || 0) < LINE_HIT_COOLDOWN) continue;
        t.lh = now;
        this.broadcast({ t: MSG.SWING, id: 'L', p: [round2(L.x + ca * along), round2(L.z + sa * along)] });
        if (t.b && facing(t, t.x - L.fx, t.z - L.fz)) { this.broadcast({ t: MSG.BLOCKED, id: t.id }); continue; }
        this.damage(t, { ...LINE, x: L.x, z: L.z }, 1, L.fx * 7, L.fz * 7, now);
      } else if (t.f === 'c' && !t.npc && phase === 'clashes') {
        // A police player who charges alone into the crowd in front of the line gets mobbed.
        // Only where the crowd really stands (the row 2-4 m in front of the shields, see client/scene/riot.js).
        if (Math.abs(along) > L.len / 2 + 1 || front < 1.2 || front > 6) continue;
        if (now - (t.xh || 0) < CROWD_HIT_COOLDOWN) continue;
        t.xh = now;
        this.broadcast({ t: MSG.SWING, id: 'X', p: [round2(t.x + L.fx), round2(t.z + L.fz)] });
        if (t.b && facing(t, t.x + L.fx, t.z + L.fz)) { this.broadcast({ t: MSG.BLOCKED, id: t.id }); continue; }
        this.damage(t, { ...CROWD, x: t.x + L.fx * 2, z: t.z + L.fz * 2 }, 1, -L.fx * 6, -L.fz * 6, now);
      }
    }
  }

  // A player hit one of the background extras (drawn by every browser from the
  // shared timeline). The server just relays it so everyone sees them fall.
  handleCrowdHit(p, msg) {
    const now = Date.now();
    if (!Number.isInteger(msg.i) || msg.i < 0 || msg.i > 1100 || p.hp <= 0) return;
    if (now - (p.ch || 0) < 300) return;
    p.ch = now;
    const k = Array.isArray(msg.k) ? msg.k.map((v) => clamp(Number(v) || 0, -1, 1)) : [0, 0];
    this.broadcast({ t: MSG.CROWD_OUT, i: msg.i, k: [round2(k[0]), round2(k[1])], by: p.id });
  }

  // Today's objective (see shared/timeline.js): every few seconds, the side
  // that controls the zone scores a point. At 06:00 the day ends with a summary.
  updateCurfew(now) {
    const day = gameDayNumber(now);
    if (day !== this.score.day) this.endOfDay(day);
    if (now - this.lastCurfewPoint < CURFEW_SCORE_EVERY_MS) return;
    const obj = objectiveAt(gameMinutes(now));
    if (!obj) return;
    this.lastCurfewPoint = now;

    const inZone = (x, z) => obj.zone.plaza
      ? inPlaza(x, z)
      : Math.hypot(x - obj.zone.x, z - obj.zone.z) <= obj.zone.r;
    const present = { g: [], c: [] };
    for (const p of this.players.values()) { // real players only (not NPCs)
      if (p.hp > 0 && (p.f === 'g' || p.f === 'c') && inZone(p.x, p.z) && !inSafeZone(p.x, p.z)) present[p.f].push(p);
    }
    let winner = null;
    if (obj.type === 'barricade') {
      const piled = this.props.filter((pr, i) => !this.carried.has(i) && inZone(pr[0], pr[1])).length;
      if (piled >= 3 && present.g.length) winner = 'g';
      else if (piled < 3 && present.c.length) winner = 'c';
      if (piled >= 3) this.news('A barricade blocks Boulevard du Temple!', 'barricade');
    } else if (present.g.length || present.c.length) {
      winner = present.g.length > present.c.length ? 'g' : 'c';
    }
    if (!winner) return;
    this.addScore(winner, 1);
    for (const p of present[winner]) this.person(p).zp += 1;
    // Holding the route builds support for the protest; the police taking it back costs a little.
    this.shiftOpinion(winner === 'g' ? OPINION.hold : -OPINION.hold / 2, 'h');
  }

  // 06:00: send everyone a summary of the day that just ended, then reset.
  endOfDay(newDay) {
    const people = Object.values(this.day.people);
    const total = (p) => this.dayTotal(p);
    const top = people.sort((a, b) => total(b) - total(a)).slice(0, 5).map((p) => ({ ...p, total: total(p) }));
    const pick = (fn) => people.reduce((best, p) => (!best || fn(p) > fn(best) ? p : best), null);
    const brawler = pick((p) => p.ko), tagger = pick((p) => p.tg), healer = pick((p) => p.hl || 0), reporter = pick((p) => p.ph || 0);
    const winner = this.score.g === this.score.c ? 'draw' : this.score.g > this.score.c ? 'g' : 'c';
    this.updateOpinion(Date.now());
    const scn = scenarioForDay(this.score.day); // the day that just ended
    if (people.length) {
      this.broadcast({
        t: MSG.SUMMARY, g: this.score.g, c: this.score.c, o: Math.round(this.opinion()), scn: scenarioLabel(scn), winner, top,
        awards: [
          brawler?.ko ? `Most knock-outs: ${brawler.n} (${brawler.ko})` : null,
          tagger?.tg ? `Busiest graffiti artist: ${tagger.n} (${tagger.tg} tags)` : null,
          healer?.hl ? `Street medic of the day: ${healer.n} (${healer.hl} people treated)` : null,
          reporter?.ph ? `Reporter of the day: ${reporter.n} (${reporter.ph} photos)` : null,
        ].filter(Boolean),
      });
    }
    this.last = { g: this.score.g, c: this.score.c, o: Math.round(this.opinion()), scn: scenarioLabel(scn), winner, day: this.score.day, players: people.length, top: top.slice(0, 3).map((p) => [p.n, p.f, p.total]) };
    this.ctx.storage.put('last', this.last);
    this.score = { g: 0, c: 0, day: newDay, o: OPINION.start };
    this.opinionAt = Date.now();
    this.day = { day: newDay, people: {}, flags: {}, evb: {} };
    this.boardSig = ''; // new day: the big screen's top 3 starts empty right away
    this.broadcast(this.boardMessage());
    this.resetWorld();
    this.broadcast(this.scoreMessage());
    this.saveDue = true;
  }

  // The truck is moving fast: knock out anyone in its way.
  truckHits(driver, speed, now) {
    const t = this.truck;
    const fx = Math.sin(t.r), fz = Math.cos(t.r);   // truck forward
    const rx = -fz, rz = fx;                         // truck side
    for (const target of this.targets()) {
      if (target === driver || target.v || target.hp <= 0) continue;
      if (now - (target.th || 0) < 1500) continue;  // already hit a moment ago
      const dx = target.x - t.x, dz = target.z - t.z;
      const along = dx * fx + dz * fz;               // in front (+) / behind (-)
      const side = dx * rx + dz * rz;
      // Truck footprint (6 x 2.4 m) + body radius + a bit of lag tolerance.
      if (Math.abs(along) > 3 + 1.2 || Math.abs(side) > 1.2 + 1.2) continue;
      target.th = now;
      // Fly forwards and to the side the person was on.
      const sideSign = side >= 0 ? 1 : -1;
      const launch = Math.min(TRUCK_HIT_LAUNCH, speed * 1.5);
      this.damage(target, driver, MAX_HP,
        fx * launch + rx * sideSign * launch * 0.6,
        fz * launch + rz * sideSign * launch * 0.6, now, true);
    }
  }

  // ------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------

  // Real players + NPCs (everyone who can be hit).
  targets() {
    return [...this.players.values(), ...this.npcs.values()];
  }

  // Apply damage + knockback to a player or NPC and tell everybody.
  damage(target, attacker, amount, kx, kz, now, byTruck = false) {
    // Bases are safe zones: nobody inside can be hurt, and nobody can hurt from inside.
    if (inSafeZone(target.x, target.z) || (attacker && inSafeZone(attacker.x, attacker.z))) return;
    target.hp = Math.max(0, target.hp - amount);
    if (attacker && !attacker.npc) this.person(attacker).hits += 1;
    if (target.hp === 0) {
      target.ko = now + KO_MS;
      if (attacker && (attacker.f !== target.f || FRIENDLY_FIRE)) {
        this.addScore(attacker.f, 1); // a K.O. = 1 point
        if (!attacker.npc) this.person(attacker).ko += 1;
      }
      this.opinionFromKO(target, attacker, byTruck, now);
      if (byTruck) this.news('The water cannon truck is ploughing through the crowd!', 'truck-ko');
      this.dropCarried(target.id);
    }
    if (target.npc) { target.kx = kx; target.kz = kz; }
    const hit = { t: MSG.HIT, id: target.id, by: attacker?.id || 0, hp: target.hp, k: [round2(kx), round2(kz)] };
    if (byTruck) hit.v = 1;
    this.broadcast(hit);
    if (!target.npc) this.sockets.get(target.id)?.serializeAttachment(target);
    this.markDirty();
  }

  // Validates and stores a position [x,y,z] + rotation sent by a client.
  // limited = true: refuse impossible jumps (speed / teleport hacks). The player is moved towards the
  // claimed spot at the maximum allowed speed instead, so honest glitches still sort themselves out.
  applyPosition(player, pos, rot, limited = false) {
    if (!Array.isArray(pos) || pos.length !== 3) return false;
    let [x, y, z] = pos.map(Number);
    const r = Number(rot ?? player.r);
    if (![x, y, z, r].every(Number.isFinite)) return false;
    x = clamp(x, -WORLD.halfX - 5, WORLD.halfX + 5); // keep everybody inside the map
    z = clamp(z, -WORLD.halfZ - 5, WORLD.halfZ + 5);
    const now = Date.now();
    if (limited && player.pt) {
      // A "movement budget" (metres) that refills at MAX_MOVE_SPEED and holds at most MOVE_BUDGET_MAX,
      // which absorbs lag spikes. Spamming many small messages can't beat it.
      const elapsed = Math.min(2, (now - player.pt) / 1000);
      const budget = Math.min(MOVE_BUDGET_MAX, (player.mb ?? MOVE_BUDGET_MAX) + MAX_MOVE_SPEED * elapsed);
      const d = Math.hypot(x - player.x, z - player.z);
      if (d > budget) {
        x = player.x + ((x - player.x) / d) * budget;
        z = player.z + ((z - player.z) / d) * budget;
        player.mb = 0;
      } else player.mb = budget - d;
    } else player.mb = MOVE_BUDGET_MAX;
    player.pt = now;
    player.x = round2(x);
    player.y = round2(clamp(y, -10, 100));
    player.z = round2(z);
    player.r = round2(r);
    return true;
  }

  validProp(i) {
    return Number.isInteger(i) && i >= 0 && i < this.props.length;
  }

  setProp(i, x, z) {
    this.props[i] = [round2(clamp(x, -WORLD.halfX + 1, WORLD.halfX - 1)), round2(clamp(z, -WORLD.halfZ + 1, WORLD.halfZ - 1))];
    this.changedProps.add(i);
    this.saveDue = true;
    this.markDirty();
  }

  isCarrying(id) {
    for (const c of this.carried.values()) if (c === id) return true;
    return false;
  }

  // Drop whatever this player carries, at their feet.
  dropCarried(id) {
    for (const [i, c] of this.carried) {
      if (c !== id) continue;
      this.carried.delete(i);
      const p = this.players.get(id) || this.npcs.get(id);
      if (p) this.setProp(i, p.x + Math.sin(p.r) * 1.2, p.z + Math.cos(p.r) * 1.2);
      this.broadcast({ t: MSG.CARRY, i, id: 0 });
    }
  }

  // Remember a player (most recent first, NPC_MAX kept) and save the list.
  register(n, f, s, l) {
    const key = n.toLowerCase();
    this.registry = [{ n, f, s, l }, ...this.registry.filter((r) => r.n.toLowerCase() !== key)].slice(0, NPC_MAX);
    this.ctx.storage.put('registry', this.registry);
  }

  // NPCs = registered players who are NOT online right now.
  rebuildNpcs() {
    const online = new Set([...this.players.values()].map((p) => p.n.toLowerCase()));
    const old = new Map([...this.npcs.values()].map((n) => [n.n.toLowerCase(), n]));
    this.npcs.clear();
    this.registry.forEach((r) => {
      if (online.has(r.n.toLowerCase())) return;
      const prev = old.get(r.n.toLowerCase());
      const id = npcId(r.n);
      const look = r.l || lookToArray(defaultLook(r.f));
      const n = prev ? { ...prev, id, l: look } : {
        l: look,
        id, n: r.n, f: r.f, s: r.s, ...randomPlazaPoint(), y: 0.9, r: 0,
        v: 0, b: 0, w: DEFAULT_WEAPON[r.f], hp: MAX_HP, ko: 0, kx: 0, kz: 0, wait: Math.random() * 3, npc: true,
      };
      Object.assign(n, randomTarget(n));
      this.npcs.set(id, n);
    });
    // Not many past players yet? Fill the square with background extras so it never feels empty.
    for (let k = 0; this.npcs.size < NPC_MIN_CROWD && k < CROWD_NAMES.length; k++) {
      const name = CROWD_NAMES[k];
      if (online.has(name.toLowerCase()) || this.registry.some((r) => r.n.toLowerCase() === name.toLowerCase())) continue;
      const id = npcId(name);
      const f = k % 10 < 7 ? 'g' : 'c'; // ~70% protesters, ~30% police
      const prev = old.get(name.toLowerCase());
      const n = prev ? { ...prev, id } : {
        id, n: name, f, s: f === 'g' ? CROWD_SLOGANS[k % CROWD_SLOGANS.length] : '', l: lookToArray(randomLook(f, k)),
        ...randomPlazaPoint(), y: 0.9, r: 0, v: 0, b: 0, w: DEFAULT_WEAPON[f], hp: MAX_HP, ko: 0, kx: 0, kz: 0,
        wait: Math.random() * 3, npc: true,
      };
      Object.assign(n, randomTarget(n));
      this.npcs.set(id, n);
    }
  }

  // Simple flood protection: ignore a player's messages above N per second.
  overRateLimit(id) {
    const second = Math.floor(Date.now() / 1000);
    let r = this.rate.get(id);
    if (!r || r.second !== second) { r = { second, count: 0 }; this.rate.set(id, r); }
    return ++r.count > MAX_MESSAGES_PER_SECOND;
  }

  removePlayer(ws) {
    const me = ws.deserializeAttachment();
    if (me && me.sp) { this.spectators.delete(me.id); return; }
    if (!me || !this.players.has(me.id)) return;
    this.dropCarried(me.id);
    const left = this.players.get(me.id);
    this.players.delete(me.id);
    this.sockets.delete(me.id);
    this.rate.delete(me.id);
    if (this.truck.o === me.id) this.releaseTruck();
    this.rebuildNpcs();
    // The player's NPC appears exactly where they left.
    for (const n of this.npcs.values()) {
      if (n.n.toLowerCase() === left.n.toLowerCase()) Object.assign(n, { x: left.x, z: left.z, r: left.r });
    }
    this.broadcastRoster();
    this.markDirty();
  }

  releaseTruck() {
    const driver = this.players.get(this.truck.o);
    if (driver) driver.v = 0; // the driver is on foot again
    this.truck.o = 0;
    this.truck.sp = 0;
    this.ctx.storage.put('truck', this.truck); // rare write: only on exit
    this.broadcast({ t: MSG.VEHICLE, o: 0 });
    this.markDirty();
  }

  newId() {
    let id; // short random id, e.g. "k3f9", unique in this room
    do { id = Math.random().toString(36).slice(2, 6); } while (this.players.has(id) || id.startsWith('n'));
    return id;
  }

  roster() {
    const l = [
      ...[...this.players.values()].map((p) => [p.id, p.n, p.f, p.s, 0, p.l, p.ro || '', p.bd || 0]),
      ...[...this.npcs.values()].map((n) => [n.id, n.n, n.f, n.s, 1, n.l]),
    ];
    return { t: MSG.ROSTER, l };
  }

  broadcastRoster() {
    this.broadcast(this.roster());
  }

  // Points of one person today (same formula as the end-of-day summary).
  dayTotal(p) {
    return p.ko * 3 + p.zp + p.tg * 2 + (p.hl || 0) * 2 + (p.ph || 0);
  }

  // Today's top 5 (live leaderboard). Re-sent only when it changes.
  boardMessage() {
    const l = Object.values(this.day.people)
      .map((p) => [p.n, p.f, this.dayTotal(p)])
      .filter((r) => r[2] > 0)
      .sort((a, b) => b[2] - a[2])
      .slice(0, 5);
    // Big screen: today's 3 players with the most knock-outs on each side (reset at 06:00 with the day).
    const top3 = (f) => Object.values(this.day.people)
      .filter((p) => p.f === f && p.ko > 0)
      .sort((a, b) => b.ko - a.ko)
      .slice(0, 3)
      .map((p) => [p.n, p.ko]);
    return { t: MSG.BOARD, l, k: { g: top3('g'), c: top3('c') } };
  }

  updateBoard(now) {
    if (now - this.lastBoardAt < 5000) return;
    this.lastBoardAt = now;
    const m = this.boardMessage();
    const sig = JSON.stringify([m.l, m.k]);
    if (sig === this.boardSig) return;
    this.boardSig = sig;
    this.broadcast(m);
  }

  addScore(faction, points) {
    if (faction !== 'g' && faction !== 'c') return;
    this.score[faction] = Math.max(0, this.score[faction] + points);
    this.broadcast(this.scoreMessage());
    this.saveDue = true;
  }

  // ------------------------------------------------------------------------
  // Public opinion (0..100, 100 = for the protesters). Violence backfires on whoever uses it.
  // ------------------------------------------------------------------------
  opinion() {
    return this.score.o ?? OPINION.start;
  }

  scoreMessage(why) {
    const m = { t: MSG.SCORE, g: this.score.g, c: this.score.c, o: Math.round(this.opinion() * 10) / 10 };
    if (why) m.r = why;
    this.lastOpinionSent = Math.round(m.o);
    return m;
  }

  // Drift back towards 50 (worked out from the elapsed time, so it also works after the room slept).
  updateOpinion(now) {
    const dt = Math.min(3600, Math.max(0, (now - (this.opinionAt || now)) / 1000));
    this.opinionAt = now;
    const o = this.opinion();
    if (dt > 0 && Math.abs(o - 50) > 0.001) {
      this.score.o = o + Math.sign(50 - o) * Math.min(Math.abs(50 - o), OPINION.decayPerSec * dt);
    }
    if (Math.round(this.opinion()) !== this.lastOpinionSent) this.broadcast(this.scoreMessage());
  }

  // delta > 0 helps the protesters. why = one-letter reason shown to everyone (see client REASONS), actor = who did it.
  shiftOpinion(delta, why, actor = null) {
    const now = Date.now();
    this.updateOpinion(now);
    let d = delta * currentScenario(now).swing;
    if (actor) { // nobody can swing the meter alone: a per-player budget per minute
      if (!actor.ow || now - actor.ow.t > 60000) actor.ow = { t: now, sum: 0 };
      const room = OPINION.perPlayerPerMinute - actor.ow.sum;
      d = Math.sign(d) * Math.min(Math.abs(d), Math.max(0, room));
      actor.ow.sum += Math.abs(d);
    }
    if (!d) return;
    const old = this.opinion();
    this.score.o = clamp(old + d, 0, 100);
    this.saveDue = true;
    this.broadcast(this.scoreMessage(why));
    this.markDirty();
    const o = this.opinion();
    if (old < OPINION.high && o >= OPINION.high) this.news('Public opinion swings behind the protesters: the police line slows down.', 'op-hi');
    if (old > OPINION.low && o <= OPINION.low) this.news('Public opinion turns against the protest: the police press forward.', 'op-lo');
  }

  // A K.O. between the two sides moves public opinion against whoever struck (see OPINION in shared/constants.js).
  opinionFromKO(target, attacker, byTruck, now) {
    if (!attacker || (attacker.npc && target.npc)) return; // NPC-vs-NPC brawls don't count
    const side = attacker.id === 'L' ? 'c' : attacker.id === 'X' ? 'g' : attacker.f; // the police line / the angry crowd
    if ((side !== 'g' && side !== 'c') || side === target.f) return;
    const actor = attacker.npc ? null : attacker;
    // What a journalist can photograph for the next 15 s.
    this.violence.push({ t: now, x: target.x, z: target.z, side });
    if (this.violence.length > 40) this.violence.shift();
    // Live TV: a K.O. in front of the cameras counts double.
    const ev = eventAt(gameMinutes(now));
    const cam = ev && ev.kind === 'cameras' && Math.hypot(target.x - ev.zone.x, target.z - ev.zone.z) <= ev.zone.r ? 2 : 1;
    if (side === 'g') {
      this.shiftOpinion(-OPINION.violence * (byTruck ? 2 : 1) * cam, 'v', actor);
    } else {
      const marching = ['gathering', 'march'].includes(phaseAt(gameMinutes(now)).id);
      this.shiftOpinion(OPINION.backlash * (byTruck ? 2 : 1) * (marching ? 1.5 : 1) * cam, 'b', actor);
    }
  }

  // ------------------------------------------------------------------------
  // Roles (R key) and events
  // ------------------------------------------------------------------------
  handleAbility(ws, p) {
    const role = ROLES[p.ro];
    const now = Date.now();
    if (!role || p.hp <= 0 || p.v || now < p.ab) return;
    p.ab = now + role.cooldown;
    let out = { t: MSG.ABILITY_OUT, id: p.id, k: p.ro, ok: 0 };
    if (p.ro === 'm') {
      // The nearest hurt or K.O. person within range (anyone: street medics treat everybody).
      let best = null, bestD = role.range;
      for (const t of this.targets()) {
        if (t === p || t.v || (t.hp >= MAX_HP && t.hp > 0)) continue;
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (d <= bestD) { best = t; bestD = d; }
      }
      if (!best) { // nobody to treat: no cooldown, just tell the medic
        p.ab = now + 800;
        this.send(ws, out);
        return;
      }
      {
        best.hp = MAX_HP;
        best.ko = 0;
        if (!best.npc) this.sockets.get(best.id)?.serializeAttachment(best);
        out = { ...out, ok: 1, to: best.id, hp: best.hp };
        this.person(p).hl = (this.person(p).hl || 0) + 1;
        this.shiftOpinion(OPINION.medic, 'm', p);
      }
    } else if (p.ro === 'j') {
      const near = this.violence.filter((v) => !v.used && now - v.t < 15000 && Math.hypot(v.x - p.x, v.z - p.z) <= role.range);
      const police = near.filter((v) => v.side === 'c'), clash = near.filter((v) => v.side === 'g');
      near.forEach((v) => { v.used = true; }); // each incident can only be photographed once
      if (police.length) this.shiftOpinion(OPINION.photoPolice * Math.min(3, police.length), 'p', p);
      else if (clash.length) this.shiftOpinion(-OPINION.photoClash * Math.min(3, clash.length), 'q', p);
      else this.shiftOpinion(OPINION.photoPeace, 'o', p);
      this.person(p).ph = (this.person(p).ph || 0) + 1;
      out.ok = 1;
    } else if (p.ro === 'd') {
      let crowd = 0;
      for (const t of this.targets()) {
        if (t.f === 'g' && t.hp > 0 && Math.hypot(t.x - p.x, t.z - p.z) <= role.range) crowd++;
      }
      if (crowd >= 6) this.shiftOpinion(OPINION.drums, 'd', p);
      out.ok = 1;
    }
    this.broadcast(out);
    ws.serializeAttachment(p);
  }

  // Rally events: protesters standing in the zone win support (capped per event per day).
  updateEvent(now) {
    if (now - this.lastEventTick < 4000) return;
    this.lastEventTick = now;
    const ev = eventAt(gameMinutes(now));
    if (!ev) return;
    this.news(ev.news, `ev-${ev.id}`);
    if (ev.kind !== 'rally') return;
    const inZone = (x, z) => Math.hypot(x - ev.zone.x, z - ev.zone.z) <= ev.zone.r;
    const prot = [], police = [];
    let drummer = false;
    for (const p of this.players.values()) {
      if (p.hp <= 0 || !inZone(p.x, p.z) || inSafeZone(p.x, p.z)) continue;
      if (p.f === 'g') { prot.push(p); if (p.ro === 'd') drummer = true; } else if (p.f === 'c') police.push(p);
    }
    if (!prot.length || police.length > prot.length) return; // nobody there, or the police crowd them out
    this.day.evb = this.day.evb || {};
    const used = this.day.evb[ev.id] || 0;
    if (used >= OPINION.eventBudget) return;
    const gain = OPINION.event * (drummer ? 1.5 : 1);
    this.day.evb[ev.id] = used + gain;
    for (const p of prot) this.person(p).zp += 1;
    this.shiftOpinion(gain, 'e');
  }

  // People who can see the world: players + spectators (keeps NPCs walking for someone who only watches).
  watchers() {
    return this.players.size + this.spectators.size;
  }

  // Something changed -> make sure the ticker is running.
  markDirty() {
    this.dirty = true;
    this.idleTicks = 0;
    if (!this.ticker) this.ticker = setInterval(() => this.tick(), TICK_MS);
  }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const ws of this.sockets.values()) {
      try { ws.send(data); } catch { /* socket closing; cleanup happens in webSocketClose */ }
    }
    for (const ws of this.spectators.values()) {
      try { ws.send(data); } catch { /* socket closing; cleanup happens in webSocketClose */ }
    }
  }

  send(ws, obj) {
    try { ws?.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Is p looking towards point (x, z)? (within ~70° each side)
function facing(p, x, z) {
  const dx = x - p.x;
  const dz = z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  return (dx * Math.sin(p.r) + dz * Math.cos(p.r)) / d > 0.35;
}

// Background extras (fictional people) used when the square is quiet.
const CROWD_NAMES = ['Alex', 'Sam', 'Jordan', 'Robin', 'Charlie', 'Morgan', 'Taylor', 'Jamie', 'Casey', 'Riley',
  'Avery', 'Quinn', 'Noor', 'Leo', 'Maya', 'Theo', 'Ines', 'Hugo', 'Lena', 'Omar'];
const CROWD_SLOGANS = ['Lower prices!', 'Fair wages', 'Fuel is too expensive', 'We want to be heard', 'Our future!'];

// Stable short id for an NPC, from its name (so the id never changes).
function npcId(name) {
  let h = 5381;
  for (const ch of name.toLowerCase()) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return 'n' + h.toString(36);
}

function insideObstacle(x, z) {
  return NPC_AVOID.some(([ox, oz, hw, hd]) => Math.abs(x - ox) < hw && Math.abs(z - oz) < hd);
}

function randomPlazaPoint() {
  for (let k = 0; k < 20; k++) {
    const x = PLAZA.minX + 4 + Math.random() * (PLAZA.maxX - PLAZA.minX - 8);
    const z = PLAZA.minZ + 4 + Math.random() * (PLAZA.maxZ - PLAZA.minZ - 8);
    if (!insideObstacle(x, z)) return { x, z };
  }
  return { x: -20, z: 10 };
}

// Next place to walk to: usually nearby, sometimes across the square.
function randomTarget(n, players) {
  // 40% of the time, walk towards a real player: the crowd gathers where people are.
  if (players?.size && Math.random() < 0.4) {
    const list = [...players.values()].filter((p) => !p.v);
    const p = list[Math.floor(Math.random() * list.length)];
    if (p) {
      const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 7;
      const t = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d };
      if (inPlaza(t.x, t.z, 3) && !insideObstacle(t.x, t.z)) return { tx: t.x, tz: t.z };
    }
  }
  // Half the time, NPCs head into the brawl in the middle of the square (it never stops).
  if (Math.random() < 0.5) {
    const c = meleeCenters()[Math.floor(Math.random() * 3)];
    const a = Math.random() * Math.PI * 2, d = (c.ring ? 11 : 0) + Math.random() * MELEE_RADIUS;
    const t = { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d * 0.8 };
    if (inPlaza(t.x, t.z, 3) && !insideObstacle(t.x, t.z)) return { tx: t.x, tz: t.z };
  }
  // During the march and the clashes, NPCs head for the action.
  const obj = objectiveAt(gameMinutes());
  if (obj && !obj.zone.plaza && Math.random() < 0.35) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * obj.zone.r * 1.2;
    return { tx: obj.zone.x + Math.cos(a) * d, tz: obj.zone.z + Math.sin(a) * d };
  }
  for (let k = 0; k < 20; k++) {
    const far = Math.random() < 0.25;
    const t = far ? randomPlazaPoint() : { x: n.x + (Math.random() - 0.5) * 16, z: n.z + (Math.random() - 0.5) * 16 };
    if (inPlaza(t.x, t.z, 3) && !insideObstacle(t.x, t.z)) return { tx: t.x, tz: t.z };
  }
  return { tx: -20, tz: 10 };
}

// If an NPC ended up inside an obstacle (pushed by water...), slide it out.
function pushOutOfObstacles(n) {
  for (const [ox, oz, hw, hd] of NPC_AVOID) {
    const dx = n.x - ox, dz = n.z - oz;
    if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
    if (hw - Math.abs(dx) < hd - Math.abs(dz)) n.x = ox + Math.sign(dx || 1) * hw;
    else n.z = oz + Math.sign(dz || 1) * hd;
  }
}
