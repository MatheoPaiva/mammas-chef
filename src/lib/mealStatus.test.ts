import { describe, expect, it } from "vitest";

import {
  STATUS_BADGE_CLASSNAME,
  STATUS_COMPACT_LABEL,
  STATUS_COMPACT_TEXT_CLASSNAME,
  STATUS_DOT_CLASSNAME,
  STATUS_LABEL,
  compactMinutes,
  extractStorageDuration,
  isFreezerStorage,
} from "@/lib/mealStatus";

describe("compactMinutes", () => {
  it("converts '8 min' to '8m'", () => {
    expect(compactMinutes("8 min")).toBe("8m");
  });

  it("converts '8 minutes' to '8m'", () => {
    expect(compactMinutes("8 minutes")).toBe("8m");
  });

  it("passes through unparseable input unchanged", () => {
    expect(compactMinutes("Time varies")).toBe("Time varies");
  });

  it("returns undefined for undefined input", () => {
    expect(compactMinutes(undefined)).toBeUndefined();
  });
});

describe("extractStorageDuration", () => {
  it("extracts days from 'Refrigerate up to 4 days'", () => {
    expect(extractStorageDuration("Refrigerate up to 4 days")).toBe("4d");
  });

  it("extracts hours from 'Store 2 hours at room temp'", () => {
    expect(extractStorageDuration("Store 2 hours at room temp")).toBe("2h");
  });

  it("returns undefined when nothing parses", () => {
    expect(extractStorageDuration("Best fresh")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(extractStorageDuration(undefined)).toBeUndefined();
  });
});

describe("isFreezerStorage", () => {
  it("returns true for 'Freeze up to 1 month'", () => {
    expect(isFreezerStorage("Freeze up to 1 month")).toBe(true);
  });

  it("returns false for 'Refrigerate 4 days'", () => {
    expect(isFreezerStorage("Refrigerate 4 days")).toBe(false);
  });

  it("returns false for undefined input", () => {
    expect(isFreezerStorage(undefined)).toBe(false);
  });
});

describe("status maps", () => {
  const expectedKeys = ["fresh", "prep-linked", "leftover"].sort();

  it("STATUS_LABEL has exactly the three status keys", () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(expectedKeys);
  });

  it("STATUS_COMPACT_LABEL has exactly the three status keys", () => {
    expect(Object.keys(STATUS_COMPACT_LABEL).sort()).toEqual(expectedKeys);
  });

  it("STATUS_BADGE_CLASSNAME has exactly the three status keys", () => {
    expect(Object.keys(STATUS_BADGE_CLASSNAME).sort()).toEqual(expectedKeys);
  });

  it("STATUS_DOT_CLASSNAME has exactly the three status keys", () => {
    expect(Object.keys(STATUS_DOT_CLASSNAME).sort()).toEqual(expectedKeys);
  });

  it("STATUS_COMPACT_TEXT_CLASSNAME has exactly the three status keys", () => {
    expect(Object.keys(STATUS_COMPACT_TEXT_CLASSNAME).sort()).toEqual(expectedKeys);
  });
});
