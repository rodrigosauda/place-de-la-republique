// worker/index.js
// The Cloudflare Worker entry point. It does only two things:
//   1. /ws  -> forwards the WebSocket upgrade to the GameRoom Durable Object
//   2. anything else -> serves the built Vite client (static assets in dist/)

import { GameRoom } from './GameRoom.js';
import { Wallet } from './Wallet.js';
import { handleShop } from './shop.js';

// Wrangler needs the Durable Object class to be exported from the main module.
export { GameRoom, Wallet };

const COOKIE = "place_gate";
const GATE_PAYLOAD = "place.micumujo.gate";

function cookieValue(request) {
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]+)`));
  return m ? m[1] : "";
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a[i] ^ b[i];
  return n === 0;
}

async function gateToken(secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(GATE_PAYLOAD));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isUnlocked(request, env) {
  if (!env.GAME_PASSWORD) return true;
  const got = cookieValue(request);
  if (!got) return false;
  const expect = await gateToken(env.GAME_PASSWORD);
  return got.length === expect.length && bytesEqual(
    new TextEncoder().encode(got),
    new TextEncoder().encode(expect),
  );
}

function lockPage(wrong) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Locked · Place de la République</title>
<link rel="icon" href="https://micumujo.com/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@800&family=Nunito+Sans:wght@400;600;700&display=swap">
<style>
:root { --bg:#f3f6fb; --panel:#fff; --ink:#1f2a37; --muted:#5f6b7a; --line:#dfe5ee; --accent:#2f6fdf; --err:#a12a2a; }
html, body { margin:0; min-height:100%; }
body { background:var(--bg); color:var(--ink); font-family:"Nunito Sans",sans-serif; display:grid; place-items:center; padding:24px; }
.card { width:min(420px,100%); background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:28px 24px; display:grid; gap:14px; }
.brand { display:flex; align-items:center; gap:10px; font-family:Nunito,sans-serif; font-weight:800; font-size:18px; color:var(--ink); text-decoration:none; }
.brand img { width:28px; height:28px; }
.lock { width:36px; height:36px; color:var(--accent); }
h1 { font-family:Nunito,sans-serif; font-weight:800; font-size:22px; margin:0; letter-spacing:-0.02em; }
p { margin:0; color:var(--muted); }
.err { color:var(--err); font-size:14px; font-weight:600; }
form { display:grid; gap:10px; }
input { font:inherit; padding:10px 12px; border:1px solid var(--line); border-radius:10px; }
button { font:inherit; font-weight:700; padding:10px 14px; border:0; border-radius:10px; background:var(--accent); color:#fff; cursor:pointer; }
</style>
</head>
<body>
  <div class="card">
    <a class="brand" href="https://micumujo.com"><img src="https://micumujo.com/mark.svg" alt="">Micumujo</a>
    <svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2"/>
      <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
    </svg>
    <h1>This game is locked</h1>
    <p>Place de la République is not open to everyone. Ask for the password.</p>
    ${wrong ? '<p class="err">That password is wrong.</p>' : ""}
    <form method="post" action="/unlock">
      <input type="password" name="password" autocomplete="current-password" required autofocus placeholder="Password">
      <button type="submit">Unlock</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: wrong ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handleUnlock(request, env) {
  const body = await request.formData();
  const given = String(body.get("password") || "");
  const want = env.GAME_PASSWORD || "";
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(want);
  const ok = want && a.length === b.length && bytesEqual(a, b);
  if (!ok) {
    return new Response(null, { status: 303, headers: { location: "/unlock?bad=1" } });
  }
  const token = await gateToken(want);
  const secure = new URL(request.url).protocol === "https:";
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}`,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (env.GAME_PASSWORD) {
      if (url.pathname === "/unlock" && request.method === "POST") {
        return handleUnlock(request, env);
      }
      const unlocked = await isUnlocked(request, env);
      if (!unlocked) {
        if (url.pathname === "/ws") {
          return new Response("Unauthorized", { status: 401 });
        }
        return lockPage(url.searchParams.get("bad") === "1");
      }
    }

    if (url.pathname === '/ws') {
      // Only accept real WebSocket upgrade requests.
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }

      // One Durable Object instance per room name. For the pilot everyone
      // joins "main". Later: /ws?room=abc gives you separate rooms for free.
      const roomName = (url.searchParams.get('room') || 'main')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 32) || 'main';

      const id = env.GAME_ROOM.idFromName(roomName);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request); // the DO answers with the 101 Switching Protocols
    }

    // Player statistics: https://<your-game>.workers.dev/stats
    // Set a secret with `npx wrangler secret put STATS_KEY` to protect it: /stats?key=<secret>
    if (url.pathname === '/stats') {
      if (env.STATS_KEY && url.searchParams.get('key') !== env.STATS_KEY) {
        return new Response('Forbidden', { status: 403 });
      }
      const room = (url.searchParams.get('room') || 'main').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'main';
      return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(room)).fetch(request);
    }

    // Who is on the square right now (public, tiny): shown in the start menu.
    if (url.pathname === '/online') {
      const room = (url.searchParams.get('room') || 'main').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'main';
      return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(room)).fetch(request);
    }

    // How the last finished game day ended (public, tiny): shown in the start menu.
    if (url.pathname === '/last') {
      const room = (url.searchParams.get('room') || 'main').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'main';
      return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(room)).fetch(request);
    }

    // The shop: checkout and wallet lookups (see worker/shop.js).
    if (url.pathname.startsWith('/shop/')) return handleShop(request, env);

    // Everything else: the static game client.
    return env.ASSETS.fetch(request);
  },
};
