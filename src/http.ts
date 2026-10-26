import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { getSession } from '@/lib/auth/session';
import type { SessionUser } from '@/types/user';

/** The app's envelope (CueSphere-App lib/api.ts): `{ success, data }` or `{ success: false, message }`. */
export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true, data }, status);
}

export function fail(c: Context, message: string, status: ContentfulStatusCode = 400) {
  return c.json({ success: false, message }, status);
}

/** Thrown inside a route to stop with an error reply. */
export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string
  ) {
    super(message);
  }
}

/** The signed-in caller, or a 401 the app answers by refreshing its token / signing out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new HttpError(401, 'You must be logged in.');
  return user;
}

/** The website's actions reply `{ success: true, ... } | { success: false, error }`. */
type ActionResult = { success: true } | { success: false; error?: string };

/** Unwraps a website action's result: its error becomes a 4xx with the same (user-facing) message. */
export function unwrap<T extends ActionResult>(result: T): Extract<T, { success: true }> {
  if (!result.success) throw new HttpError(422, (result as { error?: string }).error || 'Something went wrong. Please try again.');
  return result as Extract<T, { success: true }>;
}

export async function body<T = Record<string, unknown>>(c: Context): Promise<T> {
  return ((await c.req.json().catch(() => ({}))) ?? {}) as T;
}
