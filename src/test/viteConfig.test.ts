// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vite";
import config from "../../vite.config";

describe("vite.config", () => {
  it("answers /__open-in-editor with 403 instead of reaching Vite's launch-editor", () => {
    const plugins = config({ command: "serve", mode: "development" }).plugins!.flat() as Plugin[];
    const plugin = plugins.find((p) => p.name === "block-open-in-editor");
    expect(plugin).toBeDefined();

    const use = vi.fn();
    (plugin!.configureServer as (server: unknown) => void)({ middlewares: { use } });
    expect(use).toHaveBeenCalledTimes(1);
    const [route, handler] = use.mock.calls[0];
    expect(route).toBe("/__open-in-editor");

    const res = { statusCode: 200, end: vi.fn() };
    const next = vi.fn();
    handler({ url: "/?file=package.json" }, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });
});
