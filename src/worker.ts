import { app } from './app';

/** Hosted on Cloudflare Workers (npm run deploy). The Supabase keys are Worker secrets,
 * which nodejs_compat puts on process.env where the website's code reads them. */
export default app;
