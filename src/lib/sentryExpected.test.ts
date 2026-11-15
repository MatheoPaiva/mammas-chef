import { describe, expect, it, vi, beforeEach } from "vitest";

// Hoisted so the same spies survive vi.resetModules() in the instrument tests.
const sentryMock = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  init: vi.fn(),
  addEventProcessor: vi.fn(),
  reactRouterV6BrowserTracingIntegration: vi.fn(() => ({ name: "BrowserTracing" })),
  replayIntegration: vi.fn(() => ({ name: "Replay" })),
  consoleLoggingIntegration: vi.fn(() => ({ name: "ConsoleLogs" })),
  feedbackIntegration: vi.fn(() => ({ name: "Feedback" })),
}));
vi.mock("@sentry/react", () => sentryMock);

import * as Sentry from "@sentry/react";
import { isRateLimitRejection, captureUnlessRateLimit, stripUrlFragment } from "./sentryExpected";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stripUrlFragment", () => {
  it("removes a fragment carrying session tokens", () => {
    expect(
      stripUrlFragment("http://localhost:8080/reset-password#access_token=aaa&refresh_token=bbb&type=recovery"),
    ).toBe("http://localhost:8080/reset-password");
  });

  it("keeps the query string and leaves a URL without a fragment unchanged", () => {
    expect(stripUrlFragment("http://localhost:8080/planner?week=2#top")).toBe("http://localhost:8080/planner?week=2");
    expect(stripUrlFragment("http://localhost:8080/planner?week=2")).toBe("http://localhost:8080/planner?week=2");
  });
});

describe("instrument", () => {
  const tokenUrl = "http://localhost:8080/reset-password#access_token=aaa&refresh_token=bbb";

  async function load(hash: string) {
    vi.resetModules();
    window.location.hash = hash;
    await import("../instrument");
    window.location.hash = "";
    const integrations: { name: string }[] = sentryMock.init.mock.calls[0][0].integrations;
    return integrations.map((i) => i.name);
  }

  it("leaves Session Replay out when the page loads with tokens in the fragment", async () => {
    expect(await load("#access_token=aaa&refresh_token=bbb")).toEqual(["BrowserTracing", "ConsoleLogs", "Feedback"]);
  });

  it("keeps Session Replay on a normal page load", async () => {
    expect(await load("")).toContain("Replay");
  });

  it("strips the token fragment from request.url and span descriptions of every event", async () => {
    await load("");
    const processor = sentryMock.addEventProcessor.mock.calls[0][0];

    const event = processor({
      request: { url: tokenUrl },
      spans: [{ description: tokenUrl }, { description: "div#root > button#save" }, {}],
      breadcrumbs: [{ category: "navigation", data: { from: "/reset-password#access_token=a", to: "/auth" } }, { message: "plain" }],
      contexts: { feedback: { url: tokenUrl } },
    });

    expect(event.request.url).toBe("http://localhost:8080/reset-password");
    expect(event.spans).toEqual([
      { description: "http://localhost:8080/reset-password" },
      { description: "div#root > button#save" },
      {},
    ]);
    expect(event.breadcrumbs[0].data).toEqual({ from: "/reset-password", to: "/auth" });
    expect(event.contexts.feedback.url).toBe("http://localhost:8080/reset-password");
    expect(processor({ message: "no request" })).toEqual({ message: "no request" });
  });
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
