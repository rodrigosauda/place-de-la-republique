// worker/Wallet.js
// One Durable Object per wallet code. It remembers which premium items that code owns.
// Nobody talks to it directly: worker/shop.js (checkout) and GameRoom (ownership check) do.
//   GET  /           -> { owned: ['hat:phrygian', ...] }
//   POST /grant      -> body { keys: [...] } adds items, returns { owned }

import { DurableObject } from 'cloudflare:workers';

export class Wallet extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const owned = new Set((await this.ctx.storage.get('owned')) || []);
    if (request.method === 'POST' && url.pathname === '/grant') {
      let body;
      try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
      for (const k of Array.isArray(body?.keys) ? body.keys.slice(0, 100) : []) {
        if (typeof k === 'string' && k.length < 40) owned.add(k);
      }
      await this.ctx.storage.put('owned', [...owned]);
      if (!(await this.ctx.storage.get('created'))) await this.ctx.storage.put('created', Date.now());
      return Response.json({ owned: [...owned] });
    }
    return Response.json({ owned: [...owned] });
  }
}
