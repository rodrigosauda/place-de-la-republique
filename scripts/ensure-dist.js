// `wrangler dev` refuses to start if the assets folder (dist/) does not exist yet.
// During development Vite serves the client, so an empty dist/ is enough.
import { mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
