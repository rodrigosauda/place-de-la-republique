// vite.config.js — the client dev server + production build.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',        // wrangler.jsonc serves this folder as static assets
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000, // Rapier ships its WASM inlined (~4 MB), that's expected
    rollupOptions: {
      output: {
        // Separate files download in parallel and stay cached when only the game code changes.
        manualChunks(id) {
          if (id.includes('@dimforge')) return 'rapier';
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('mapData.json')) return 'map';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // During `npm run dev`, the browser talks to Vite (5173).
      // WebSocket requests to /ws are forwarded to `wrangler dev` (8787),
      // where the Durable Object runs locally.
      '/ws': { target: 'ws://localhost:8787', ws: true },
      // The small HTTP endpoints of the Worker (start menu: who is online, how yesterday ended; the shop).
      // Without these, Vite answers them with index.html and the start menu quietly shows nothing.
      '/online': 'http://localhost:8787',
      '/last': 'http://localhost:8787',
      '/stats': 'http://localhost:8787',
      '/shop': 'http://localhost:8787',
    },
  },
});
