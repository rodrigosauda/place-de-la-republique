// Ice-cream van tests: +1 heart, cooldown, no fighting while eating / in the van's zone. Run with wrangler dev on :8787.
const ROOM = 'ice' + Math.floor(Math.random() * 1e6);
const BASE = process.env.BASE || 'localhost:8787';
const U = `ws${process.env.BASE ? 's' : ''}://${BASE}/ws?room=${ROOM}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, bad = 0;
const check = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); c ? ok++ : bad++; };
function client(join) {
  return new Promise((res) => {
    const ws = new WebSocket(U);
    const c = { ws, id: null, msgs: [], send: (o) => ws.send(JSON.stringify(o)) };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'w') c.id = m.id; c.msgs.push(m); };
    ws.onopen = () => { c.send(join); setTimeout(() => res(c), 700); };
  });
}
const { ICE_CREAM: V } = await import('../shared/constants.js');
const at = [V.x + 1, 1, V.z + 3];
const A = await client({ t: 'j', n: 'Eater', f: 'g', s: 'x', p: at, r: 0 });
A.send({ t: 's', p: at, r: 0, v: 0, b: 0, w: 0 }); await sleep(300);
A.send({ t: 'i' }); await sleep(400);
const e1 = A.msgs.filter((m) => m.t === 'J').pop();
check('ice cream: +1 heart (4 when full)', e1?.ok === 1 && e1.hp === 4, JSON.stringify(e1));
A.send({ t: 'i' }); await sleep(400);
const e2 = A.msgs.filter((m) => m.t === 'J').pop();
check('only one every 40 s', e2?.ok === 0 && e2.wait > 30, JSON.stringify(e2));
// A police officer next to the van (safe zone) cannot be hit.
const B = await client({ t: 'j', n: 'Cop', f: 'c', s: '', p: [at[0] + 0.8, 1, at[2]], r: 0 });
B.send({ t: 's', p: [at[0] + 0.8, 1, at[2]], r: 0, v: 0, b: 0, w: 1 }); await sleep(300);
A.msgs.length = 0;
A.send({ t: 'a', p: at, r: Math.PI / 2 }); await sleep(400);
check('no hits around the van / while eating', !A.msgs.some((m) => m.t === 'H'), JSON.stringify(A.msgs.filter((m) => m.t === 'H')));
const far = await client({ t: 'j', n: 'Far', f: 'g', s: 'x', p: [0, 1, 30], r: 0 });
far.send({ t: 'i' }); await sleep(300);
check('too far from the van: nothing', !far.msgs.some((m) => m.t === 'J'));
for (const c of [A, B, far]) c.ws.close();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
