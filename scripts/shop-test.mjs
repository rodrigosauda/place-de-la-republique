// Shop tests: the (switched-off) checkout endpoints still answer, and since the game is free the server
// accepts any valid item on JOIN and LOOK.
const ROOM = 'shop' + Math.floor(Math.random() * 1e6);
const BASE = process.env.BASE || 'localhost:8787';
const SEC = process.env.BASE ? 's' : '';
const U = `ws${SEC}://${BASE}/ws?room=${ROOM}`;
const H = `http${SEC}://${BASE}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); cond ? ok++ : bad++; };
const post = (path, body) => fetch(H + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ s: r.status, j: await r.json() }));
const get = (path) => fetch(H + path).then(async (r) => ({ s: r.status, j: await r.json() }));

function client(join) {
  return new Promise((res) => {
    const ws = new WebSocket(U);
    const c = { ws, id: null, roster: [], send: (o) => ws.send(JSON.stringify(o)) };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'w') c.id = m.id; if (m.t === 'r') c.roster = m.l; };
    ws.onopen = () => { c.send(join); setTimeout(() => res(c), 700); };
  });
}
const mine = (c) => c.roster.find((r) => r[0] === c.id)?.[5];
const HAT = 6, TRAIL = 11, FLAIR = 12; // look array positions
const base = [0, 1, 0, 1, 4, 0, 0, 0, 0, 0, 0, 0, 0];
const withLook = (o) => { const l = [...base]; for (const [k, v] of Object.entries(o)) l[k] = v; return l; };

// 1. checkout errors
let r = await post('/shop/checkout', { items: [] });
check('empty checkout rejected', r.s === 400);
r = await post('/shop/checkout', { items: ['hat:phrygian'], code: 'nonsense' });
check('bad code rejected', r.s === 400);
r = await get('/shop/wallet?code=RPR-AAAA');
check('bad wallet code rejected', r.s === 400);
r = await post('/shop/checkout', { items: ['nope:nothing'] });
check('unknown product rejected', r.s === 400);

// 2. buy one item
r = await post('/shop/checkout', { items: ['hat:phrygian'] });
check('checkout ok in test mode', r.s === 200 && r.j.ok && r.j.test, JSON.stringify(r.j));
const code = r.j.code;
check('code format', /^RPR(-[A-Z0-9]{4}){4}$/.test(code), code);
check('owns the cap', r.j.owned.includes('hat:phrygian') && r.j.owned.length === 1);
check('would-charge is the price (coins)', r.j.wouldCharge === 200, String(r.j.wouldCharge));
r = await get(`/shop/wallet?code=${encodeURIComponent(code.toLowerCase())}`);
check('wallet lookup (lowercase ok)', r.s === 200 && r.j.owned.length === 1);
r = await post('/shop/checkout', { items: ['bundle:founder'], code });
check('bundle adds to the same wallet', r.j.code === code && ['flair:founder', 'trail:gold', 'placard:gold', 'back:cape', 'hat:phrygian'].every((k) => r.j.owned.includes(k)), r.j.owned?.join());
check('bundle price counted (coins)', r.j.wouldCharge === 700, String(r.j.wouldCharge));
r = await get('/shop/wallet?code=RPR-AAAA-AAAA-AAAA-AAAA');
check('unknown code = empty wallet', r.s === 200 && r.j.owned.length === 0);

// 3. server enforcement
const a = await client({ t: 'j', n: 'NoWallet', f: 'g', s: 'x', l: withLook({ [HAT]: 5, [TRAIL]: 1, [FLAIR]: 3 }) });
// The game is free now (PREMIUM_ENFORCED = false): coins and unlocked items live in the browser,
// so the server lets any valid item through.
check('free game: premium hat allowed without a wallet', mine(a)?.[HAT] === 5, JSON.stringify(mine(a)));
check('free game: trail and flair allowed without a wallet', mine(a)?.[TRAIL] === 1 && mine(a)?.[FLAIR] === 3);
const b = await client({ t: 'j', n: 'Owner', f: 'g', s: 'x', l: withLook({ [HAT]: 5, [TRAIL]: 1, [FLAIR]: 3 }), ow: code });
check('join with wallet: owned hat kept', mine(b)?.[HAT] === 5);
check('join with wallet: flair and trail kept', mine(b)?.[FLAIR] === 3 && mine(b)?.[TRAIL] === 1, JSON.stringify(mine(b)));
const c2 = await client({ t: 'j', n: 'Forger', f: 'g', s: 'x', l: withLook({ [HAT]: 5 }), ow: 'RPR-AAAA-AAAA-AAAA-AAAA' });
check('made-up code: still allowed (free game)', mine(c2)?.[HAT] === 5);

// 4. LOOK after buying mid-game (fresh lookup, not the cached empty wallet)
a.send({ t: 'L', l: withLook({ [TRAIL]: 2 }), ow: '' });
await sleep(500);
check('LOOK without wallet: trail allowed (free game)', mine(a)?.[TRAIL] !== undefined);
const buy = await post('/shop/checkout', { items: ['trail:feathers'] });
a.send({ t: 'L', l: withLook({ [TRAIL]: 2 }), ow: buy.j.code });
await sleep(700);
check('LOOK right after buying: trail kept', mine(a)?.[TRAIL] === 2, JSON.stringify(mine(a)));
// free items still fine
a.send({ t: 'L', l: withLook({ [HAT]: 2 }), ow: '' });
await sleep(500);
check('free items need no wallet', mine(a)?.[HAT] === 2);

console.log(`\n${ok} passed, ${bad} failed`);
[a, b, c2].forEach((c) => c.ws.close());
process.exit(bad ? 1 : 0);
