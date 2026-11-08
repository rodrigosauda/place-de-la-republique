// worker/shop.js
// The shop backend: checkout + wallet lookups.
//
//   POST /shop/checkout   { items: [productId...], code?: 'RPR-...' }  -> { ok, code, owned, test }
//   GET  /shop/wallet?code=RPR-...                                      -> { owned }
//
// PAYMENT MODE
//   env.PAYMENT_MODE = 'test' (default): checkout is FAKE. Nothing is charged and the items are granted at once.
//   env.PAYMENT_MODE = 'live': a real payment provider must confirm the payment first. That part is not
//   wired up yet: `startLiveCheckout` below is where Stripe / Lemon Squeezy / Paddle goes. Flow to build:
//     1. startLiveCheckout() creates a hosted checkout session for `totalPrice(items)` and returns its URL
//        (put the wallet code and item list in the session metadata);
//     2. the provider calls POST /shop/webhook when the payment succeeded (verify its signature!);
//     3. the webhook calls grantItems(env, code, keys), the same function the test checkout uses.
//   Until then 'live' answers 501 so nobody can get items for free by accident.

import { grantsOf, totalPrice, normalizeCode, newCode } from '../shared/shop.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const walletStub = (env, code) => env.WALLET.get(env.WALLET.idFromName(code));

export async function getOwned(env, code) {
  const c = normalizeCode(code);
  if (!c || !env.WALLET) return new Set();
  try {
    const res = await walletStub(env, c).fetch('https://wallet/');
    return new Set((await res.json()).owned || []);
  } catch { return new Set(); }
}

export async function grantItems(env, code, keys) {
  const res = await walletStub(env, code).fetch('https://wallet/grant', { method: 'POST', body: JSON.stringify({ keys }) });
  return (await res.json()).owned;
}

async function startLiveCheckout(/* env, request, items, code */) {
  return json({ error: 'Payments are not switched on yet.' }, 501);
}

export async function handleShop(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/shop/wallet' && request.method === 'GET') {
    const code = normalizeCode(url.searchParams.get('code'));
    if (!code) return json({ error: 'That code does not look right.' }, 400);
    return json({ code, owned: [...(await getOwned(env, code))] });
  }

  if (url.pathname === '/shop/checkout' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    const items = (Array.isArray(body?.items) ? body.items : []).filter((x) => typeof x === 'string').slice(0, 40);
    const keys = grantsOf(items);
    if (!keys.length) return json({ error: 'Nothing to buy.' }, 400);

    let code = body.code ? normalizeCode(body.code) : null;
    if (body.code && !code) return json({ error: 'That code does not look right.' }, 400);
    if (!code) code = newCode(crypto.getRandomValues(new Uint8Array(16)));

    if (env.PAYMENT_MODE === 'live') return startLiveCheckout(env, request, items, code);

    // TEST MODE: no money moves. `wouldCharge` is what a real checkout would ask for.
    const before = await getOwned(env, code);
    const wouldCharge = totalPrice(items, before);
    const owned = await grantItems(env, code, keys);
    return json({ ok: true, test: true, code, owned, wouldCharge });
  }

  return json({ error: 'not found' }, 404);
}
