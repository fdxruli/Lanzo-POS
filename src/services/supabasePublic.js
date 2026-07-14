import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const SUPABASE_PUBLIC_AUTH_OPTIONS = Object.freeze({
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
  storageKey: 'lanzo-public-store-auth'
});

export const supabasePublicClient = (supabaseUrl && supabasePublishableKey)
  ? createClient(supabaseUrl, supabasePublishableKey, {
    auth: SUPABASE_PUBLIC_AUTH_OPTIONS
  })
  : null;

export const isSupabasePublicConfigured = Boolean(supabasePublicClient);
