import * as Sentry from "@sentry/react";
import React from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import { stripUrlFragment } from "./lib/sentryExpected";

Sentry.init({
  // Off unless the person running this copy sets their own VITE_SENTRY_DSN.
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,

  integrations: [
    Sentry.reactRouterV6BrowserTracingIntegration({
      useEffect: React.useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
    // Email links land with #access_token=...; the replay recording embeds the href where no hook can scrub it.
    ...(window.location.hash.includes("access_token")
      ? []
      : [Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        })]),
    Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
    Sentry.feedbackIntegration({
      colorScheme: "system",
      buttonLabel: "Report a Bug",
      submitButtonLabel: "Send Report",
      formTitle: "Report a Bug",
      messagePlaceholder: "What happened? What did you expect?",
      successMessageText: "Thanks! We'll look into this.",
      showBranding: false,
      isNameRequired: false,
      isEmailRequired: false,
      autoInject: true,
    }),
  ],

  // Logs
  enableLogs: true,

  // Tracing
  tracesSampleRate: 1.0, // lower to 0.1–0.2 once beta stabilizes
  tracePropagationTargets: ["localhost"],

  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Filter out transient Supabase auth lock timeouts (upstream SDK issue)
  beforeSend(event) {
    const message = event.exception?.values?.[0]?.value ?? "";
    if (message.includes("Navigator LockManager lock") && message.includes("timed out")) {
      return null;
    }
    return event;
  },
});

// beforeSend skips transactions, and the pageload transaction carries the landing URL with its token fragment.
Sentry.addEventProcessor((event) => {
  if (event.request?.url) event.request.url = stripUrlFragment(event.request.url);
  // Navigation-timing spans are named after the document URL.
  event.spans?.forEach((span) => {
    if (span.description?.includes("access_token")) span.description = stripUrlFragment(span.description);
  });
  // If the token check fails, auth-js leaves the fragment in place and later navigations and feedback record it.
  event.breadcrumbs?.forEach((crumb) => {
    for (const key of ["from", "to"]) {
      if (typeof crumb.data?.[key] === "string") crumb.data[key] = stripUrlFragment(crumb.data[key]);
    }
  });
  const feedback = event.contexts?.feedback;
  if (typeof feedback?.url === "string") feedback.url = stripUrlFragment(feedback.url);
  return event;
});
