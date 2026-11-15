import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// The flag only exists on Node 22.4+; passing it to Node 20 makes the test workers exit at once.
const noWebStorage = process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
  ? ["--no-experimental-webstorage"]
  : [];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Placeholders so the tests run on a fresh clone and in CI, where there is no .env.local.
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
    // Node 22.4+ ships an experimental built-in `localStorage` global that
    // takes precedence over jsdom's implementation and is missing methods
    // (e.g. `.clear`) unless backed by `--localstorage-file`. Disable it in
    // the test worker so jsdom's real localStorage is used instead.
    poolOptions: {
      forks: { execArgv: noWebStorage },
      threads: { execArgv: noWebStorage },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
