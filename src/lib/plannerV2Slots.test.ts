import { describe, expect, it } from "vitest";
import {
  buildSingleMealSkipSlots,
  buildWeekSkipSlots,
  countActiveSlots,
  resolveWhenDay,
  summarizeWeekShape,
} from "./plannerV2Slots";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

describe("buildWeekSkipSlots", () => {
  it("skips snacks when they are not included", () => {
    const skipSlots = buildWeekSkipSlots(DAYS, ["breakfast", "lunch", "dinner"], []);
    expect(countActiveSlots(DAYS, skipSlots)).toBe(21);
    expect(skipSlots["Monday:snack"]).toBe(true);
    expect(skipSlots["Monday:dinner"]).toBeUndefined();
  });

  it("skips every meal on skipped days", () => {
    const skipSlots = buildWeekSkipSlots(DAYS, ["breakfast", "lunch", "dinner"], ["Friday", "Saturday"]);
    expect(skipSlots["Friday:dinner"]).toBe(true);
    expect(skipSlots["Saturday:breakfast"]).toBe(true);
    expect(countActiveSlots(DAYS, skipSlots)).toBe(15);
  });
});

describe("buildSingleMealSkipSlots", () => {
  it("leaves exactly one active slot", () => {
    const skipSlots = buildSingleMealSkipSlots(DAYS, "Wednesday", "dinner");
    expect(countActiveSlots(DAYS, skipSlots)).toBe(1);
    expect(skipSlots["Wednesday:dinner"]).toBeUndefined();
    expect(skipSlots["Wednesday:lunch"]).toBe(true);
    expect(skipSlots["Tuesday:dinner"]).toBe(true);
  });
});

describe("resolveWhenDay", () => {
  it("maps today and tomorrow from a fixed date", () => {
    const wednesday = new Date(2026, 7, 19); // Wednesday
    expect(resolveWhenDay("today", wednesday)).toBe("Wednesday");
    expect(resolveWhenDay("tomorrow", wednesday)).toBe("Thursday");
    expect(resolveWhenDay("Sunday", wednesday)).toBe("Sunday");
  });
});

describe("summarizeWeekShape", () => {
  it("names snack-off and skipped days", () => {
    expect(summarizeWeekShape(["breakfast", "lunch", "dinner"], ["Friday"], 18)).toBe(
      "We'll plan 18 meals · no snacks · skip Friday",
    );
  });
});
