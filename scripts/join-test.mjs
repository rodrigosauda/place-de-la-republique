// Joining and outfit changes: the clock sent on join, the outfit flood limit, a full room.
// Run with wrangler dev on :8787.
const ROOM = 'join' + Math.floor(Math.random() * 1e6);
const BASE = process.env.BASE || 'localhost:8787';
const S = process.env.BASE ? 's' : '';
const U = `ws${S}://${BASE}/ws?room=${ROOM}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, bad = 0;
const check = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); c ? ok++ : bad++; };
const { MSG, MAX_PLAYERS, syncClock, gameMinutes } = await import('../shared/constants.js');
const { LOOK_SLOTS } = await import('../shared/looks.js');

function client(join) {
  return new Promise((res) => {
    const ws = new WebSocket(U);
    const c = { ws, id: null, msgs: [], open: false, send: (o) => ws.send(JSON.stringify(o)) };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === MSG.WELCOME) c.id = m.id; c.msgs.push(m); };
    ws.onopen = () => { c.open = true; if (join) c.send(join); setTimeout(() => res(c), 500); };
    ws.onerror = () => res(c); // refused (room full)
  });
}
const rosters = (c) => c.msgs.filter((m) => m.t === MSG.ROSTER);
const myLook = (c) => rosters(c).pop()?.l.find((r) => r[0] === c.id)?.[5];

// 1. The join answer carries the server's clock.
const A = await client({ t: MSG.JOIN, n: 'Joiner', f: 'g', s: 'x' });
const w = A.msgs.find((m) => m.t === MSG.WELCOME);
check('welcome: an id of 4 characters that is not an NPC id', /^[a-mo-z0-9][a-z0-9]{3}$/.test(w?.id ?? ''), JSON.stringify(w));
check('welcome: the server clock, close to ours', Math.abs((w?.now ?? 0) - Date.now()) < 5000, String(w?.now));

// 2. syncClock: small differences are ignored, a wrong computer clock is corrected.
syncClock(Date.now() - 300);
check('clock: network delay does not move the game clock', (globalThis.__clockOffset || 0) === 0);
const now = Date.now(), wrong = now - 7 * 60 * 1000; // this "computer" is 7 minutes behind
const truth = gameMinutes(now);                      // the hour everyone else sees
syncClock(now, wrong);
check('clock: a computer 7 minutes behind shows the same game hour as everyone', Math.abs(gameMinutes(wrong) - truth) < 0.01, `${gameMinutes(wrong).toFixed(1)} vs ${truth.toFixed(1)}`);
globalThis.__clockOffset = 0;

// 3. Outfit changes: the same outfit again changes nothing, and a flood is cut down.
const TRAIL = LOOK_SLOTS.indexOf('trail');
const look = [...myLook(A)];
A.msgs.length = 0;
A.send({ t: MSG.LOOK, l: look }); await sleep(400);
check('same outfit again: nobody is told', rosters(A).length === 0, `${rosters(A).length} rosters`);
A.msgs.length = 0;
for (let i = 0; i < 30; i++) { look[TRAIL] = 1 + (i % 2); A.send({ t: MSG.LOOK, l: look }); }
await sleep(500);
check('30 outfit changes at once: only the first counts', rosters(A).length === 1 && myLook(A)?.[TRAIL] === 1, `${rosters(A).length} rosters, trail ${myLook(A)?.[TRAIL]}`);
look[TRAIL] = 2;
A.send({ t: MSG.LOOK, l: look }); await sleep(400);
check('a change a moment later still works', myLook(A)?.[TRAIL] === 2, JSON.stringify(myLook(A)));

// 4. A full room: the next socket is refused, and /online says why.
const crowd = [];
for (let i = 1; i < MAX_PLAYERS; i++) crowd.push(client({ t: MSG.JOIN, sp: 1 }));
const watchers = await Promise.all(crowd);
check(`${MAX_PLAYERS} people fit in a room`, watchers.every((c) => c.open && c.id), `${watchers.filter((c) => c.open).length + 1} in`);
check('ids are unique', new Set([A.id, ...watchers.map((c) => c.id)]).size === MAX_PLAYERS);
const late = await client({ t: MSG.JOIN, n: 'Late', f: 'g' });
check('one more is refused', !late.open && !late.id);
const online = await (await fetch(`http${S}://${BASE}/online?room=${ROOM}`)).json();
check('/online shows the room is full', online.total + online.watching >= MAX_PLAYERS, JSON.stringify(online));

for (const c of [A, late, ...watchers]) c.ws.close();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
