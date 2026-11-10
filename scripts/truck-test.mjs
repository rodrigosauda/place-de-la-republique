// Water cannon tests: police only, two seats (driver + cannon operator), aim, stall. Run with wrangler dev on :8787.
const ROOM = 'truck' + Math.floor(Math.random() * 1e6);
const BASE = process.env.BASE || 'localhost:8787';
const U = `ws${process.env.BASE ? 's' : ''}://${BASE}/ws?room=${ROOM}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, bad = 0;
const check = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); c ? ok++ : bad++; };
function client(join) {
  return new Promise((res) => {
    const ws = new WebSocket(U);
    const c = { ws, id: null, msgs: [], snap: null, send: (o) => ws.send(JSON.stringify(o)) };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'w') c.id = m.id; if (m.t === 'S') c.snap = m; c.msgs.push(m); };
    ws.onopen = () => { c.send(join); setTimeout(() => res(c), 700); };
  });
}
const { TRUCK_SPAWN } = await import('../shared/constants.js');
const at = [TRUCK_SPAWN.x + 2, 1, TRUCK_SPAWN.z];
const A = await client({ t: 'j', n: 'CopA', f: 'c', s: '', p: at, r: 0 });
const B = await client({ t: 'j', n: 'CopB', f: 'c', s: '', p: at, r: 0 });
const G = await client({ t: 'j', n: 'Riot', f: 'g', s: 'x', p: at, r: 0 });
for (const c of [A, B, G]) c.send({ t: 's', p: at, r: 0, v: 0, b: 0, w: 0 });
await sleep(400);
G.send({ t: 'e' }); await sleep(400);
check('protester cannot get in', G.msgs.some((m) => m.t === 'N' && /Only the police/.test(m.m)));
A.send({ t: 'e' }); await sleep(400);
const v1 = A.msgs.filter((m) => m.t === 'v').pop();
check('first cop = driver', v1?.o === A.id && !v1.g, JSON.stringify(v1));
B.send({ t: 'e' }); await sleep(400);
const v2 = B.msgs.filter((m) => m.t === 'v').pop();
check('second cop = cannon operator', v2?.o === A.id && v2.g === B.id, JSON.stringify(v2));
A.send({ t: 'w', on: 1, a: 1.0 }); await sleep(300);
check('driver cannot spray when an operator is there', !(A.snap?.v?.[5]), JSON.stringify(A.snap?.v));
B.send({ t: 'w', on: 1, a: 1.5 }); await sleep(400);
check('operator sprays + aims', A.snap?.v?.[5] === 1 && A.snap.v[8] === 1.5, JSON.stringify(A.snap?.v));
B.send({ t: 'x' }); await sleep(400);
const v3 = A.msgs.filter((m) => m.t === 'v').pop();
check('operator gets out, driver stays', v3?.o === A.id && v3.g === 0, JSON.stringify(v3));
// Surround the truck with the protester (counts 1) -> not enough; stall needs 3
A.send({ t: 's', p: [TRUCK_SPAWN.x, TRUCK_SPAWN.y, TRUCK_SPAWN.z], r: TRUCK_SPAWN.r, v: 1, b: 0, w: 1 });
await sleep(400);
check('one protester does not stop it', A.snap?.v?.[9] === 0, JSON.stringify(A.snap?.v));
G.ws.close(); await sleep(300);
// Stall: 3 protesters are not enough, 6 stop it. Then paint the windscreen.
const fx = Math.sin(TRUCK_SPAWN.r), fz = Math.cos(TRUCK_SPAWN.r);
const front = [TRUCK_SPAWN.x + fx * 3.6, 1, TRUCK_SPAWN.z + fz * 3.6];
const crowd = [];
for (let i = 0; i < 6; i++) {
  const pos = [front[0] + (i % 3) * 0.6, 1, front[2] + Math.floor(i / 3) * 0.6];
  const c = await client({ t: 'j', n: 'Riot' + i, f: 'g', s: 'x', p: pos, r: 0 });
  c.send({ t: 's', p: pos, r: TRUCK_SPAWN.r + Math.PI, v: 0, b: 0, w: 0 });
  crowd.push(c);
  if (i === 2) { await sleep(500); check('3 protesters do not stop it', A.snap?.v?.[9] === 0, JSON.stringify(A.snap?.v)); }
}
await sleep(600);
check('6 protesters stop it', A.snap?.v?.[9] === 1, JSON.stringify(A.snap?.v));
crowd[0].send({ t: 'a', p: [front[0], 1, front[2]], r: TRUCK_SPAWN.r + Math.PI }); await sleep(400);
check('hitting the windscreen paints it', A.snap?.v?.[10] === 1, JSON.stringify(A.snap?.v));
for (const c of crowd) c.ws.close();
for (const c of [A, B]) c.ws.close();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
