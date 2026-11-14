import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

type EventType = "page_view" | "action" | "error" | "api_error";

interface LogEntry {
  event_type: EventType;
  event_name: string;
  metadata?: Record<string, Json>;
  page_url?: string;
}

// Buffer logs and flush in batches to reduce DB writes
let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 5_000; // 5 seconds
const MAX_BUFFER = 20;

// Tracks whether the page is unloading (beforeunload or visibilitychange to hidden).
// Used by isBenignFlushError() to suppress nav-time "Failed to fetch" noise.
let isUnloading = false;

// Cached user ID — set by useActivityLogger hook so flush() never calls
// supabase.auth.getUser(), which would compete for the Navigator Lock.
let cachedUserId: string | null = null;

/** Update the cached user ID (call when auth state changes). */
export function setLoggerUserId(userId: string | null) {
  cachedUserId = userId;
}

/**
 * Returns true when a flush error is benign and should be silently dropped
 * rather than emitted via console.warn (which consoleLoggingIntegration would
 * forward to Sentry as a warning event, drowning out real failures).
 *
 * Benign cases:
 *  (a) DOMException AbortError — fetch was cancelled by the browser during
 *      navigation (e.g. React Router transition cancels in-flight requests).
 *  (b) "Failed to fetch" while the document is hidden — the page is being
 *      torn down / sent to bfcache; the failure is expected and non-actionable.
 *  (c) "Failed to fetch" while isUnloading — caught by the beforeunload /
 *      visibilitychange handlers set below.
 *
 * Mirrors the classify-before-decide pattern from mealPlanDbService.ts:
 *   isMissingColumnError() → classify → act.
 */
function isBenignFlushError(err: unknown): boolean {
  if (!err) return false;

  // (a) DOMException AbortError from aborted fetch during navigation
  if (err instanceof Error && err.name === "AbortError") return true;

  // Coerce to a string message for the remaining checks.
  // Supabase PostgrestError has { code, message, details, hint } — no .name.
  // Plain Error has .message. Anything else: convert via String().
  const msg: string =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);

  if (!msg.includes("Failed to fetch")) return false;

  // (b) Document not visible → page teardown / bfcache / tab backgrounded
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return true;
  }

  // (c) Unload flag was set by beforeunload or visibilitychange handler
  if (isUnloading) return true;

  return false;
}

async function flush() {
  if (buffer.length === 0) return;
  if (!cachedUserId) {
    // Don't log for unauthenticated users, but cap what waits for a login so a
    // long-running process (CLI/MCP) without one doesn't grow the buffer forever.
    buffer = buffer.slice(-MAX_BUFFER);
    return;
  }

  const entries = [...buffer];
  buffer = [];

  const rows = entries.map((e) => ({
    user_id: cachedUserId!,
    event_type: e.event_type,
    event_name: e.event_name,
    metadata: e.metadata || {},
    page_url: e.page_url || (typeof window !== "undefined" ? window.location.pathname : ""),
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  }));

  // Fire and forget — don't block the UI
  supabase.from("app_logs").insert(rows).then(({ error }) => {
    if (error && !isBenignFlushError(error)) {
      console.warn("[ActivityLogger] flush failed:", error.message);
    }
  });
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL);
}

function enqueue(entry: LogEntry) {
  buffer.push(entry);
  if (buffer.length >= MAX_BUFFER) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
  } else {
    scheduleFlush();
  }
}

/** Log a page view */
export function logPageView(path: string) {
  enqueue({ event_type: "page_view", event_name: path, page_url: path });
}

/** Log a user action (button click, feature usage) */
export function logAction(name: string, metadata?: Record<string, Json>) {
  enqueue({ event_type: "action", event_name: name, metadata });
}

/** Log a client-side error */
export function logError(name: string, metadata?: Record<string, Json>) {
  enqueue({ event_type: "error", event_name: name, metadata });
}

/** Log an API/network error */
export function logApiError(name: string, metadata?: Record<string, Json>) {
  enqueue({ event_type: "api_error", event_name: name, metadata });
}

/** Flush remaining logs (call on page unload) */
export function flushLogs() {
  flush();
}

/** Install global error handler */
export function installGlobalErrorHandler() {
  window.addEventListener("error", (event) => {
    logError("unhandled_error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    logError("unhandled_promise_rejection", {
      reason: String(event.reason),
    });
  });

  // Flip isUnloading when the tab is backgrounded / sent to bfcache.
  // beforeunload does not fire reliably on mobile (e.g. iOS Safari), so this
  // covers tab-switched / home-button teardowns.
  window.addEventListener("visibilitychange", () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      isUnloading = true;
      flushLogs(); // best-effort; isBenignFlushError suppresses noise if it fails
    }
  });

  // Final flush on page unload.
  window.addEventListener("beforeunload", () => {
    isUnloading = true;

    // Drain the buffer immediately so events aren't re-sent on bfcache restore.
    const rows = buffer.splice(0).map((e) => ({
      user_id: cachedUserId,
      event_type: e.event_type,
      event_name: e.event_name,
      metadata: e.metadata || {},
      page_url: e.page_url || window.location.pathname,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    }));

    if (rows.length === 0) return;

    const supabaseUrl: string =
      typeof import.meta !== "undefined" ? (import.meta.env?.VITE_SUPABASE_URL ?? "") : "";
    const anonKey: string =
      typeof import.meta !== "undefined"
        ? (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? "")
        : "";

    // sendBeacon best-effort: browser queues the request through navigation so it
    // survives teardown, unlike fetch which gets aborted. Tradeoff: sendBeacon
    // cannot set Authorization / apikey headers, so Supabase will reject the insert
    // with a 401 (RLS requires an authenticated caller). This is acceptable per D-07
    // because the foreground flush path (above) handles real failures with console.warn
    // → Sentry; the unload path is explicitly best-effort. If auth-less beacon inserts
    // are ever enabled on app_logs (e.g. via a service-role Edge Function relay), swap
    // the URL here. Until then fall back to the fire-and-forget fetch path.
    if (
      supabaseUrl &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const beaconSent = navigator.sendBeacon(
        `${supabaseUrl}/rest/v1/app_logs`,
        new Blob([JSON.stringify(rows)], { type: "application/json" })
      );
      if (beaconSent) return; // browser accepted the beacon; done
    }

    // Fallback: re-buffer the snapshot and call the normal flush.
    // This still uses fetch (which may be aborted), but isBenignFlushError()
    // will suppress any resulting warn so Sentry stays clean.
    buffer.unshift(...rows as LogEntry[]);
    flush();
  });
}
