import * as Sentry from "@sentry/react";

/**
 * A daily rate-limit rejection (10/day generation, 20/day swap — see
 * `_shared/rateLimit.ts`) is the system working as designed, not a defect.
 * 429 is the sole HTTP source of that condition; "daily limit" is the
 * stable substring of the edge function's error body (mirrors the existing
 * `nonTransient` check in mealPlanService.ts).
 */
export function isRateLimitRejection(errorText: string, status?: number): boolean {
  if (status === 429) return true;
  return /daily limit/i.test(errorText || "");
}

/**
 * Captures a Sentry issue unless the error is an expected rate-limit
 * rejection, in which case it leaves a breadcrumb instead (still enriches
 * any later real error, never creates its own issue).
 */
export function captureUnlessRateLimit(
  message: string,
  context: Parameters<typeof Sentry.captureMessage>[1],
  rateLimit: { errorText: string; status?: number },
): void {
  if (isRateLimitRejection(rateLimit.errorText, rateLimit.status)) {
    Sentry.addBreadcrumb({
      category: "rate_limit",
      level: "info",
      message,
      data: { status: rateLimit.status },
    });
    return;
  }
  Sentry.captureMessage(message, context);
}
