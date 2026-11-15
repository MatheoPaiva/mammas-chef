import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  build: {
    sourcemap: "hidden",
  },
  server: {
    host: "localhost",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    // Nothing here uses this route. It accepts cross-site GETs and opens files in an editor, and has had command-injection bugs on Windows.
    {
      name: "block-open-in-editor",
      configureServer(server) {
        server.middlewares.use("/__open-in-editor", (_req, res) => {
          res.statusCode = 403;
          res.end();
        });
      },
    },
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
        })]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
