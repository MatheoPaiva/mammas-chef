import { describe, expect, it } from "vitest";

import {
  BATCH_BADGE_CLASSNAME,
  BATCH_BAR_CLASSNAME,
  BATCH_COMPACT_TEXT_CLASSNAME,
  compactBatchTime,
} from "@/lib/batchDisplay";

describe("compactBatchTime", () => {
  it("converts '~15 min' to '~15m', preserving the leading tilde", () => {
    expect(compactBatchTime("~15 min")).toBe("~15m");
  });

  it("converts '8 min' (no tilde) to '8m'", () => {
    expect(compactBatchTime("8 min")).toBe("8m");
  });

  it("converts '~8 minutes' to '~8m'", () => {
    expect(compactBatchTime("~8 minutes")).toBe("~8m");
  });

  it("passes through unparseable input unchanged", () => {
    expect(compactBatchTime("Overnight")).toBe("Overnight");
  });

  it("returns undefined for undefined input", () => {
    expect(compactBatchTime(undefined)).toBeUndefined();
  });
});

describe("batch identity classname constants", () => {
  it("BATCH_BADGE_CLASSNAME contains violet + dark: variants", () => {
    expect(BATCH_BADGE_CLASSNAME).toContain("violet");
    expect(BATCH_BADGE_CLASSNAME).toContain("dark:");
  });

  it("BATCH_COMPACT_TEXT_CLASSNAME contains violet + dark: variants", () => {
    expect(BATCH_COMPACT_TEXT_CLASSNAME).toContain("violet");
    expect(BATCH_COMPACT_TEXT_CLASSNAME).toContain("dark:");
  });

  it("BATCH_BAR_CLASSNAME contains violet + dark: variants", () => {
    expect(BATCH_BAR_CLASSNAME).toContain("violet");
    expect(BATCH_BAR_CLASSNAME).toContain("dark:");
  });
});
