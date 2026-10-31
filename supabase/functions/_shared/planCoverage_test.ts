import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { countActiveSlots, countMeals } from "./planCoverage.ts";

const ORDERED_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

Deno.test("countMeals sums meals across mixed days (missing/empty meals count as 0)", () => {
  assertEquals(countMeals([
    { meals: [{}, {}, {}, {}] },
    { meals: [] },
    {},
    { meals: [{}] },
  ]), 5);
  assertEquals(countMeals([]), 0);
});

Deno.test("countActiveSlots is 28 for a full week with no skips", () => {
  assertEquals(countActiveSlots(ORDERED_DAYS, {}), 28);
});

Deno.test("countActiveSlots subtracts a fully skipped day", () => {
  assertEquals(countActiveSlots(ORDERED_DAYS, {
    "Wednesday:breakfast": true,
    "Wednesday:lunch": true,
    "Wednesday:dinner": true,
    "Wednesday:snack": true,
  }), 24);
});

Deno.test("countActiveSlots ignores skip keys for days outside orderedDays", () => {
  assertEquals(countActiveSlots(["Monday", "Tuesday"], {
    "Monday:dinner": true,
    "Friday:dinner": true,
    "Friday:lunch": true,
  }), 7);
});
