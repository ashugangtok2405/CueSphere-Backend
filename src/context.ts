import { AsyncLocalStorage } from 'node:async_hooks';

import type { SessionUser } from '@/types/user';

/** Everything the website's code would normally get from the Next.js request
 * (cookies, the signed-in user, after() callbacks), held per API request. */
export interface RequestContext {
  /** The caller's Supabase access token (Authorization: Bearer …), if any. */
  token: string | null;
  /** The verified caller, once known. */
  user: SessionUser | null;
  /** Session storage for Supabase clients made during this request — sign-in and
   * sign-up write the new session here, so the route can hand the tokens to the app. */
  storage: Map<string, string>;
  /** Work queued with next/server's after(): runs once the response is sent. */
  after: (() => unknown)[];
  /** React `cache` results for this request (see shims/react.ts). */
  memo: Map<unknown, unknown>;
}

// The website's files load as CommonJS and the backend's as ES modules, so this file can
// be loaded twice; both copies must share one store.
const KEY = Symbol.for('cuesphere.requestContext');
const g = globalThis as typeof globalThis & { [KEY]?: AsyncLocalStorage<RequestContext> };
export const requestContext = (g[KEY] ??= new AsyncLocalStorage<RequestContext>());

export function ctx(): RequestContext {
  const store = requestContext.getStore();
  if (!store) throw new Error('No request context — website code must run inside an API request.');
  return store;
}

export function newContext(token: string | null): RequestContext {
  return { token, user: null, storage: new Map(), after: [], memo: new Map() };
}
