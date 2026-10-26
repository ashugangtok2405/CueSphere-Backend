import { createClient, type Session } from '@supabase/supabase-js';
import { Hono } from 'hono';

import { loginAction, registerAccountAction } from '@/app/actions/auth-actions';
import { getViewer } from '@/lib/auth/get-viewer';
import { getClubById } from '@/services/club-service';
import { listMembershipsForUser } from '@/services/club-service';

import { ctx } from '../context';
import { body, fail, ok, requireUser, unwrap } from '../http';

export const auth = new Hono();

/** The session a sign-in / sign-up stored during this request (see shims/lib/supabase/server.ts). */
function sessionFromRequest(): Session | null {
  for (const value of ctx().storage.values()) {
    try {
      const parsed = JSON.parse(value) as Session;
      if (parsed?.access_token && parsed?.refresh_token) return parsed;
    } catch {
      // not a session entry
    }
  }
  return null;
}

const tokensOf = (s: Session) => ({ accessToken: s.access_token, refreshToken: s.refresh_token });

/** POST /auth/signin — the website's loginAction (same messages, ensures the player profile). */
auth.post('/auth/signin', async (c) => {
  const { email, password } = await body<{ email?: string; password?: string }>(c);
  unwrap(await loginAction({ email: email ?? '', password: password ?? '' }));
  const session = sessionFromRequest();
  if (!session) return fail(c, 'Incorrect email or password.', 401);
  return ok(c, tokensOf(session));
});

/** POST /auth/signup — the website's registerAccountAction (min 8 characters, email confirmation rule). */
auth.post('/auth/signup', async (c) => {
  const { email, password } = await body<{ email?: string; password?: string }>(c);
  unwrap(await registerAccountAction({ email: email ?? '', password: password ?? '' }));
  const session = sessionFromRequest();
  if (!session) return fail(c, 'Account created — check your email to confirm it before logging in.', 422);
  return ok(c, tokensOf(session), 201);
});

/** POST /auth/refresh — swaps a refresh token for a new pair (Supabase rotates refresh tokens). */
auth.post('/auth/refresh', async (c) => {
  const { refreshToken } = await body<{ refreshToken?: string }>(c);
  if (!refreshToken) return fail(c, 'Refresh token required.', 401);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return fail(c, 'Your session has expired. Please log in again.', 401);
  return ok(c, tokensOf(data.session));
});

/** POST /auth/signout — ends this device's session. */
auth.post('/auth/signout', async (c) => {
  const token = ctx().token;
  if (token) {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await admin.auth.admin.signOut(token, 'local').catch(() => {});
  }
  return ok(c, null);
});

/** GET /viewer — the website's getViewer, plus what the app needs on top: the
 * platform-admin flag on the user and the approved clubs the viewer runs. */
auth.get('/viewer', async (c) => {
  const user = await requireUser();
  const [viewer, memberships] = await Promise.all([getViewer(), listMembershipsForUser(user.id)]);
  const adminClubs = await Promise.all(memberships.filter((m) => m.role === 'club_admin').map((m) => getClubById(m.clubId)));
  const ownedClubs = adminClubs
    .filter((club) => club?.status === 'approved')
    .map((club) => ({ id: club!.id, slug: club!.slug, name: club!.name, logoUrl: club!.logoUrl }));

  return ok(c, {
    user: { id: user.id, email: user.email, isPlatformAdmin: viewer.isPlatformAdmin },
    profile: viewer.profile,
    memberships,
    isPlatformAdmin: viewer.isPlatformAdmin,
    pendingClubCount: viewer.pendingClubCount,
    // The website has no separate club-enquiry step; new clubs wait as "pending" clubs.
    pendingEnquiryCount: 0,
    ownedClubs,
  });
});
