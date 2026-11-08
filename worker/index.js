// worker/index.js
// The Cloudflare Worker entry point. It does only two things:
//   1. /ws  -> forwards the WebSocket upgrade to the GameRoom Durable Object
//   2. anything else -> serves the built Vite client (static assets in dist/)

import { GameRoom } from './GameRoom.js';

// Wrangler needs the Durable Object class to be exported from the main module.
export { GameRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
    if (url.pathname === '/stats') {
      return env.GAME_ROOM.get(env.GAME_ROOM.idFromName('main')).fetch(request);
    }

    // Everything else: the static game client.
    return env.ASSETS.fetch(request);
  },
};
