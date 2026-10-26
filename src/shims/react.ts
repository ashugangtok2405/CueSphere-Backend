// React's `cache` for the website's services outside Next.js. In a React Server Component
// it memoizes per request; plain Node's React makes it a no-op, so lookups like
// getClubBySlug or getProfileByUserId ran again every time a route (and the website code it
// calls) asked. This memoizes per API request instead — same calls, same arguments, one query.
import { requestContext } from '../context';

export function cache<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args: A) => {
    const store = requestContext.getStore();
    if (!store) return fn(...args);
    let byArgs = store.memo.get(fn) as Map<string, R> | undefined;
    if (!byArgs) {
      byArgs = new Map();
      store.memo.set(fn, byArgs);
    }
    const key = JSON.stringify(args);
    if (!byArgs.has(key)) byArgs.set(key, fn(...args));
    return byArgs.get(key)!;
  };
}
