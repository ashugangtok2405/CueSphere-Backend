import { serve } from '@hono/node-server';

import { listCities, listStates } from '@/services/location-service';

import { app } from './app';

/** Local dev: npm run dev. */
const port = Number(process.env.PORT ?? 5100);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`CueSphere API on http://localhost:${port}/api/v1 (same Supabase project as the website)`);
  // Warm up: open the connection to Supabase and load the hot code paths now, so the
  // first player to open the app doesn't pay for it (the locations it loads stay cached).
  void Promise.all([listStates(), listCities()]).catch(() => {});
});
