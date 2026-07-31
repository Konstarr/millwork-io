import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Don't crash the app if env is missing — surface a clear console warning.
  // The UI will show its "not configured" state.
  // eslint-disable-next-line no-console
  console.warn('[millwork.io] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill in.');
}

export const supabase = createClient(
  url || 'http://localhost:0',
  key || 'anon-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export const isConfigured = Boolean(url && key);
