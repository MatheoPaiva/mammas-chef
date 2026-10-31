import "./instrument";  // Sentry must init before anything else
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<p>Something went wrong. Please reload the page.</p>}>
    <App />
  </Sentry.ErrorBoundary>
);

