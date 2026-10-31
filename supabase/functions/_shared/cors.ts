const ALLOWED_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
];

/**
 * Validate the request Origin against known patterns + optional env override.
 * Returns CORS headers with the validated origin (or empty origin to block).
 *
 * ALLOWED_ORIGIN supports both bare domain and www subdomain automatically.
 * e.g. "https://example.com" also allows "https://www.example.com".
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const envOrigin = Deno.env.get("ALLOWED_ORIGIN"); // e.g. "https://example.com"

  let envOriginMatch = false;
  if (envOrigin !== undefined) {
    envOriginMatch = origin === envOrigin;
    // Also allow www. variant: if ALLOWED_ORIGIN is "https://example.com",
    // accept "https://www.example.com" and vice versa.
    if (!envOriginMatch) {
      try {
        const envUrl = new URL(envOrigin);
        const originUrl = new URL(origin);
        const stripWww = (h: string) => h.replace(/^www\./, "");
        envOriginMatch =
          envUrl.protocol === originUrl.protocol &&
          stripWww(envUrl.hostname) === stripWww(originUrl.hostname);
      } catch { /* invalid URL, skip */ }
    }
  }

  const isAllowed =
    ALLOWED_PATTERNS.some((p) => p.test(origin)) || envOriginMatch;

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, baggage, sentry-trace, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Vary": "Origin",
  };
}
