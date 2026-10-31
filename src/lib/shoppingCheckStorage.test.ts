/**
 * Unit tests for shoppingCheckStorage — round-trip persistence of checked
 * shopping-list item names, keyed per meal plan (quick task 260707-tl3).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadCheckedNames, saveCheckedNames } from "./shoppingCheckStorage";

describe("shoppingCheckStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips: save then load returns the same names", () => {
    saveCheckedNames("plan-1", ["Zucchini", "Bell pepper"]);
    const loaded = loadCheckedNames("plan-1");
    expect(loaded).toEqual(new Set(["Zucchini", "Bell pepper"]));
  });

  it("returns an empty Set for an unseen planId", () => {
    expect(loadCheckedNames("never-seen")).toEqual(new Set());
  });

  it("does not collide between two different planIds", () => {
    saveCheckedNames("plan-a", ["Zucchini"]);
    saveCheckedNames("plan-b", ["Bell pepper"]);
    expect(loadCheckedNames("plan-a")).toEqual(new Set(["Zucchini"]));
    expect(loadCheckedNames("plan-b")).toEqual(new Set(["Bell pepper"]));
  });

  it("clears the entry when saved with an empty array, subsequent load returns empty Set", () => {
    saveCheckedNames("plan-1", ["Zucchini"]);
    expect(loadCheckedNames("plan-1")).toEqual(new Set(["Zucchini"]));

    saveCheckedNames("plan-1", []);
    expect(loadCheckedNames("plan-1")).toEqual(new Set());
    expect(localStorage.getItem("shopping-checked:plan-1")).toBeNull();
  });

  it("returns an empty Set for malformed (non-JSON) data at the key", () => {
    localStorage.setItem("shopping-checked:plan-1", "not valid json{{{");
    expect(loadCheckedNames("plan-1")).toEqual(new Set());
  });

  it("returns an empty Set for JSON that is not a string array", () => {
    localStorage.setItem("shopping-checked:plan-1", JSON.stringify({ foo: "bar" }));
    expect(loadCheckedNames("plan-1")).toEqual(new Set());

    localStorage.setItem("shopping-checked:plan-1", JSON.stringify([1, 2, 3]));
    expect(loadCheckedNames("plan-1")).toEqual(new Set());
  });
});
