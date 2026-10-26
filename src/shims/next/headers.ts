// next/headers for website code outside Next.js. The API has no cookies; the
// caller's token is passed on as an Authorization header.
import { ctx } from '../../context';

export async function cookies() {
  return {
    get: (_name: string) => undefined,
    getAll: () => [] as { name: string; value: string }[],
    set: () => {},
    delete: () => {},
    has: () => false,
  };
}

export async function headers() {
  const h = new Headers();
  const token = ctx().token;
  if (token) h.set('authorization', `Bearer ${token}`);
  return h;
}
