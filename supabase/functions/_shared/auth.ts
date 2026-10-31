import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Verify the request's JWT and return the authenticated user ID, or null.
 *
 * Primary path is `auth.getClaims(token)`, which verifies the JWT locally against the
 * project's JWKS. This is required for the 2026-06 asymmetric (ES256) JWT signing
 * migration: `getUser()` alone returned 401 for ES256 tokens (it depends on the
 * server/apikey path), which silently broke auth on every edge function once signing
 * keys went asymmetric. `getClaims()` handles asymmetric tokens locally and falls back
 * to a server call for symmetric (HS256) tokens.
 *
 * A `getUser(token)` fallback is kept for resilience during the migration.
 */
export async function verifyUser(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  // Primary: local JWKS verification — handles asymmetric (ES256/RS256) tokens.
  try {
    const { data, error } = await supabase.auth.getClaims(token);
    const sub = data?.claims?.sub;
    if (!error && sub) return String(sub);
  } catch {
    // fall through to server-side fallback
  }

  // Fallback: server-side validation (covers symmetric HS256 / any getClaims edge case).
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) return user.id;
  } catch {
    // ignore — treated as unauthorized below
  }

  return null;
}
