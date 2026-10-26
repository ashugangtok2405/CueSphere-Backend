// next/server for the website's actions outside Next.js: only after() is used —
// live-update signals and push notifications that shouldn't hold up the response.
import { ctx } from '../../context';

export function after(task: (() => unknown) | Promise<unknown>): void {
  ctx().after.push(typeof task === 'function' ? task : () => task);
}
