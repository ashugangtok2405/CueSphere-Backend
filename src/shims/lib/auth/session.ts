// Stands in for the website's src/lib/auth/session.ts: the signed-in user comes from
// the request's Bearer token (verified once per request) or, during sign-in / sign-up,
// from the session that request just created.
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { SessionUser } from '@/types/user';

import { ctx } from '../../../context';

export async function getSession(): Promise<SessionUser | null> {
  const c = ctx();
  if (c.user) return c.user;
  if (!c.token && c.storage.size === 0) return null;

  const supabase = await createSupabaseServerClient();
  // getClaims() verifies the token's signature locally (ES256 keys); with no argument it
  // reads the session a sign-in stored for this request.
  const { data, error } = c.token ? await supabase.auth.getClaims(c.token) : await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  c.user = { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : '' };
  return c.user;
}

export async function destroySession() {
  const c = ctx();
  c.user = null;
  c.storage.clear();
}
