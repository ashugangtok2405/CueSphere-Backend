// next/cache for the website's actions outside Next.js. Page caches belong to the
// website, so revalidating them from here is a no-op: the website's pages are dynamic
// and read fresh data on their next request.
export function revalidatePath(_path: string, _type?: 'page' | 'layout'): void {}
export function revalidateTag(_tag: string): void {}
export function unstable_cache<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
