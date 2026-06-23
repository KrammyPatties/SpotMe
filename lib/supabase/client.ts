import { createClient } from "@supabase/supabase-js";

// Browser-side client using the PUBLIC anon key (safe to expose)
// Used only for the direct-to-Supabase signed upload - never for DB access.
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);