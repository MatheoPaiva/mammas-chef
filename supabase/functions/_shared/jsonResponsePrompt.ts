/**
 * Shared JSON-only prompt directive + parse-failure helpers for AI edge functions.
 *
 * Used by all 5 AI edge functions (generate-meal-plan, swap-meal,
 * regenerate-day, generate-shopping-list, estimate-custom-recipe-nutrition) to:
 *  1. Append a single, consistent JSON-only instruction at the very end of the
 *     system prompt (final instruction wins for "lost in the middle" models).
 *  2. Wrap unrecoverable JSON.parse failures in `ParseFailureError` so the
 *     outer catch can return HTTP 502 (transient AI malformed output) instead
 *     of HTTP 500 (server bug). Carries a redacted snippet of the offending
 *     AI response for Sentry triage.
 *  3. Parse the AI response body through the single shared `parseAIJson()`
 *     chain (see below) instead of each function inlining its own copy.
 */

export const JSON_ONLY_DIRECTIVE = `# OUTPUT FORMAT — STRICT

Respond with valid JSON ONLY. No markdown code fences. No prose, explanation, or commentary before or after the JSON. The very first character of your response MUST be \`{\` and the very last character MUST be \`}\`. Anything else will be rejected.`;

/**
 * Redact known-sensitive substrings from an arbitrary string and truncate to
 * maxLen characters. Used to sanitize AI response bodies before surfacing them
 * to clients / Sentry as `parseErrorSnippet`.
 *
 * Patterns redacted:
 *  - `Bearer <token>` (Authorization headers if echoed)
 *  - `sk-...` (OpenAI key prefix) and `eyJ...` (JWT prefix), 10+ chars
 *  - Live values of the AI provider key env vars if present
 */
export function redactForSnippet(input: string, maxLen = 400): string {
  if (typeof input !== "string" || input.length === 0) return "";

  let redacted = input;

  // Bearer tokens
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");

  // OpenAI keys (sk-...) and JWTs (eyJ...) — at least 10 chars after prefix
  redacted = redacted.replace(/(sk-|eyJ)[A-Za-z0-9._-]{10,}/g, "[redacted]");

  // Live env values — only read inside the function so the module imports
  // cleanly even if env vars are missing.
  try {
    for (const name of ["AI_API_KEY", "CEREBRAS_API_KEY", "AI_GATEWAY_API_KEY"]) {
      const secret = Deno.env.get(name);
      if (secret && secret.length >= 8) {
        // Escape regex metachars in the secret before substitution
        const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        redacted = redacted.replace(new RegExp(escaped, "g"), "[redacted]");
      }
    }
  } catch {
    // Deno.env may be unavailable in some test contexts — non-fatal.
  }

  return redacted.slice(0, maxLen);
}

/**
 * Walk a JSON-bearing string from the `{` at `start` and return the index of
 * its matching closing `}`, honoring string literals and backslash escapes so
 * braces inside strings don't count. Returns -1 if the braces never balance
 * (truncated / malformed). Pure: no throwing, no logging, no fence-stripping —
 * each edge function keeps its OWN fence-strip, error types, log prefix, and
 * truncation semantics at the call site.
 */
export function findBalancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Signals that the AI response could not be parsed as JSON even after the
 * balanced-brace extractor fallback. Caught by the outer try/catch in each
 * edge function and rendered as HTTP 502 instead of HTTP 500.
 */
export class ParseFailureError extends Error {
  snippet?: string;

  constructor(message: string, snippet?: string) {
    super(message);
    this.name = "ParseFailureError";
    this.snippet = snippet;
  }
}

/**
 * The canonical AI-JSON parse chain, shared by all 5 AI edge functions:
 * trim → strip ```(json)? fences (case-insensitive) → JSON.parse → on
 * failure, extract the first balanced `{...}` object via
 * `findBalancedObjectEnd` → JSON.parse the extracted candidate → on failure,
 * throw a classified `ParseFailureError` with a redacted, position-anchored
 * snippet for Sentry triage.
 *
 * `opts.label` tags the console.warn/error lines so logs stay attributable
 * per caller (e.g. "swap-meal", "generate-meal-plan").
 *
 * `opts.onUnbalanced` lets a caller substitute its OWN error class when the
 * braces never balance (unbalanced === likely truncated mid-generation).
 * swap-meal uses this to throw its `TruncationError` instead of
 * `ParseFailureError` so its higher-budget re-request shell can catch it
 * specifically (D-10). Callers that don't pass it get the default
 * `ParseFailureError` (still retryable, still → HTTP 502).
 *
 * Does NOT: check `finish_reason`, apply `stripNulls`, or touch
 * `response.ok` — those remain call-site concerns because they differ per
 * function (token-budget field, finish_reason semantics, stripNulls
 * presence/absence, wrong_api_format handling). Folding them in here would
 * silently change behavior for one of the 5 callers.
 */
export function parseAIJson(
  content: string,
  opts: { label?: string; onUnbalanced?: (snippet: string) => Error } = {},
): Record<string, unknown> {
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  }

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // AI may have appended text after the JSON — extract the outermost balanced {}
    const start = cleaned.indexOf("{");
    if (start === -1) {
      throw new ParseFailureError("No JSON object found in AI response", redactForSnippet(cleaned, 400));
    }

    const end = findBalancedObjectEnd(cleaned, start);
    if (end === -1) {
      const snippet = redactForSnippet(cleaned, 400);
      throw opts.onUnbalanced
        ? opts.onUnbalanced(snippet)
        : new ParseFailureError(
          "Unable to extract JSON from AI response (unbalanced braces — likely truncated)",
          snippet,
        );
    }

    console.warn(
      `[${opts.label ?? "parseAIJson"}] JSON.parse failed on full text, extracted balanced object (chars ${start}–${end})`,
    );
    const candidate = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch (e) {
      // Brace-balanced but token-invalid (e.g. `"carbs": thirty`). Classify as a
      // retryable ParseFailureError instead of relaying the raw V8 SyntaxError to
      // the user. Log a redacted snippet around the error position for triage.
      const pos = e instanceof Error ? Number(e.message.match(/position (\d+)/)?.[1]) : NaN;
      const from = Number.isFinite(pos) ? Math.max(0, pos - 80) : 0;
      const snippet = redactForSnippet(candidate.slice(from, from + 160), 400);
      console.error(`[${opts.label ?? "parseAIJson"}] Reparse failed: ${e instanceof Error ? e.message : e}. Snippet: ${snippet}`);
      throw new ParseFailureError("Unable to parse extracted JSON object from AI response", snippet);
    }
  }
}
