import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://pdfgqlvovmyzhdnumypq.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_cZnuDJwbDbtF2dDJ_M6rCg_-e-nWdMX";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
