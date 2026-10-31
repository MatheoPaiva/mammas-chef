/**
 * Generic retry logic with exponential backoff.
 *
 * Two modes:
 * 1. `withRetry(fn)` — retries on transient errors (429, 5xx, timeout)
 * 2. Use separately for validation-failure retries (pass a fix prompt to AI)
 */

// ---------------------------------------------------------------------------
// Transient error retry
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of retries (default: 2) */
  maxRetries?: number;
  /** Base delay in ms before first retry (default: 2000) */
  baseDelay?: number;
  /** Optional label for logging */
  label?: string;
}

/** Check if an error is retryable (transient). */
function isRetryable(err: unknown): boolean {
  const name = (err as Error)?.name;
  // A classified parse failure (brace-balanced but token-invalid JSON) almost
  // always parses on a fresh AI sample — treat as transient.
  if (name === "ParseFailureError") return true;
  // AbortSignal.timeout rejects with name "TimeoutError"; explicit so intent survives runtime message rewording.
  if (name === "TimeoutError") return true;

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    // Word-boundary status codes so "at position 5003" doesn't false-match "500".
    /\b(429|500|502|503|504)\b/.test(msg) ||
    msg.includes("truncated") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("rate limit") ||
    // Cerebras structured-output nondeterminism (400 wrong_api_format) — a
    // fresh sample usually adheres to the schema; see generate-shopping-list.
    msg.includes("wrong_api_format")
  );
}

/**
 * Retry an async function with exponential backoff on transient errors.
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 2, baseDelay = 2000, label = "operation" } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxRetries;
      if (isLast || !isRetryable(err)) {
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[retry] ${label} attempt ${attempt + 1}/${maxRetries + 1} failed: ${msg.slice(0, 200)}. Retrying in ${delay}ms...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error(`[retry] ${label} exhausted all retries`);
}
