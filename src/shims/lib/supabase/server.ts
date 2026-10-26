// Stands in for the website's src/lib/supabase/server.ts (which reads Next.js cookies).
// Same project and key; the caller is identified by their Bearer token instead, so
// queries run as that user and Row Level Security applies exactly as on the website.
import { createClient } from '@supabase/supabase-js';

import { ctx } from '../../../context';

export async function createSupabaseServerClient() {
  const c = ctx();
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // Per-request memory: a sign-in during this request is visible to later clients in it.
      storage: {
        getItem: (key) => c.storage.get(key) ?? null,
        setItem: (key, value) => void c.storage.set(key, value),
        removeItem: (key) => void c.storage.delete(key),
      },
    },
    global: c.token ? { headers: { Authorization: `Bearer ${c.token}` } } : undefined,
  });
}
