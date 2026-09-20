/* ============================================================
   Supabase client — vanilla JS / ESM equivalent of utils/supabase.ts
   Loaded via <script type="module" src="supabase-client.js">
   ============================================================ */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Publishable keys are safe to expose client-side (same idea as a
// Stripe publishable key) — this is not a secret.
const supabaseUrl = "https://avacwmhyrcqlbcwpblyk.supabase.co";
const supabaseKey = "sb_publishable_-U-1N1IC20BKBfbcweMIuw_XDwI43FY";

export const supabase = createClient(supabaseUrl, supabaseKey);
