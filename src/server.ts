import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { servePlayerPhoto } from '@/app/api/player-photo/serve';
import { getSession } from '@/lib/auth/session';

import { newContext, requestContext } from './context';
import { HttpError } from './http';
import { auth } from './routes/auth';
import { clubs } from './routes/clubs';
import { playerActions } from './routes/player-actions';
import { players } from './routes/players';
import { tournaments } from './routes/tournaments';
import type { NavigationError } from './shims/next/navigation';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

// Run every request inside its own context (the caller's token, sign-in session,
// after() work), the way the website's code expects a Next.js request around it.
app.use('*', async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const store = newContext(token);
  await requestContext.run(store, async () => {
    // A token that's there but no longer valid gets a 401 up front, so the app refreshes
    // it (the website's actions would only say "You must be logged in." with a 422).
    // Sign-in, sign-up and refresh work without a valid token.
    if (token && !c.req.path.startsWith('/api/v1/auth/') && !(await getSession())) {
      c.res = c.json({ success: false, message: 'Your session has expired. Please log in again.' }, 401);
      return;
    }
    await next();
    // after(): live-update signals and push notifications, once the reply is on its way.
    const tasks = store.after.splice(0);
    if (tasks.length) {
      setImmediate(() => requestContext.run(store, () => Promise.allSettled(tasks.map(async (t) => t()))));
    }
  });
});

// Player photos, at the same address the website serves them (profiles carry
// "/api/player-photo/<id>/<version>"; the app loads it from this server).
app.get('/api/player-photo/:playerId/:version', (c) => servePlayerPhoto(c.req.param('playerId'), true));
app.get('/api/player-photo/:playerId', (c) => servePlayerPhoto(c.req.param('playerId'), false));

const api = new Hono();
api.get('/health', (c) => c.json({ success: true, data: { ok: true } }));
api.route('/', auth);
api.route('/', clubs);
api.route('/', tournaments);
api.route('/', players);
api.route('/', playerActions);
app.route('/api/v1', api);

app.notFound((c) => c.json({ success: false, message: `No such endpoint: ${c.req.method} ${c.req.path}` }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ success: false, message: err.message }, err.status);
  // By name: website code loads its own copy of the shim (CommonJS), so instanceof won't match.
  if (err.name === 'NavigationError' && (err as NavigationError).kind === 'notFound') return c.json({ success: false, message: 'Not found.' }, 404);
  console.error(err);
  return c.json({ success: false, message: 'Something went wrong. Please try again.' }, 500);
});

const port = Number(process.env.PORT ?? 5100);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`CueSphere API on http://localhost:${port}/api/v1 (same Supabase project as the website)`);
});
