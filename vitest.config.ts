import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Node 22.4+ ships an experimental built-in `localStorage` global that
    // takes precedence over jsdom's implementation and is missing methods
    // (e.g. `.clear`) unless backed by `--localstorage-file`. Disable it in
    // the test worker so jsdom's real localStorage is used instead.
    poolOptions: {
      forks: { execArgv: ["--no-experimental-webstorage"] },
      threads: { execArgv: ["--no-experimental-webstorage"] },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
