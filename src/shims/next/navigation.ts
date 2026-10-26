// next/navigation for website code outside Next.js: a redirect or notFound can't
// navigate an API caller, so they surface as errors the route turns into a reply.
export class NavigationError extends Error {
  constructor(
    public kind: 'redirect' | 'notFound',
    public target?: string
  ) {
    super(kind === 'redirect' ? `Redirect to ${target}` : 'Not found');
    this.name = 'NavigationError';
  }
}

export function redirect(target: string): never {
  throw new NavigationError('redirect', target);
}

export function notFound(): never {
  throw new NavigationError('notFound');
}
