import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@sentry/react", () => ({
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import * as Sentry from "@sentry/react";
import { isRateLimitRejection, captureUnlessRateLimit } from "./sentryExpected";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isRateLimitRejection", () => {
  it("returns true when status is 429, regardless of message", () => {
    expect(isRateLimitRejection("anything", 429)).toBe(true);
  });

  it("returns true on a 'daily limit' substring match, case-insensitive", () => {
    expect(
      isRateLimitRejection("You've reached the daily limit for meal plan generation...", undefined),
    ).toBe(true);
  });

  it("returns false for a non-rate-limit status and message", () => {
    expect(isRateLimitRejection("Error 500", 500)).toBe(false);
  });

  it("returns false for an empty message and no status", () => {
    expect(isRateLimitRejection("", undefined)).toBe(false);
  });
});

describe("captureUnlessRateLimit", () => {
  const message = "Meal plan API error: boom";
  const context = { level: "error" as const, tags: { feature: "generation" } };

  it("adds a breadcrumb and does not capture when the error is a rate-limit rejection", () => {
    captureUnlessRateLimit(message, context, { errorText: "daily limit reached", status: 429 });

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "rate_limit", message }),
    );
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("captures the message and does not add a breadcrumb for a real error", () => {
    captureUnlessRateLimit(message, context, { errorText: "boom", status: 500 });

    expect(Sentry.captureMessage).toHaveBeenCalledWith(message, context);
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });
});
