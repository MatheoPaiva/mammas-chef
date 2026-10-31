import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  keepUnrelatedPrepTips,
  mergePrepTipDelta,
  nightBeforeDay,
  type PrepTip,
} from "./prepTipMerge.ts";

// 261007-slz P1 — the 2026-10-07 e2e trace: a Monday-start, dinner-only week
// (prep day Sunday). Breakfast, lunch and snack are skipped on every day and
// Wednesday:dinner is skipped too, so Wednesday is fully skipped.
const MON = "b7cf5ed9-6fda-4d9c-9ada-88841b2ae81a";
const TUE = "4154e66a-3806-4dca-96d7-688393370aa0";
const THU = "c6c3cd79-8e65-4b94-b17d-6957cb5e4f20";
const FRI = "7628c7d5-f35c-47bd-91ec-e02965590026";
const SAT = "468701d5-ab24-4db1-acdc-8a1d5c2fee8b";
const SUN = "c6378bf9-ef3b-4d8c-b786-30723828c7ce";

const ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PREP = "Sunday";
const SKIPS: Record<string, true> = {};
for (const d of ORDER) for (const t of ["breakfast", "lunch", "snack"]) SKIPS[`${d}:${t}`] = true;
SKIPS["Wednesday:dinner"] = true;

// The 9 tips the client sent. tip-prep-1 also references TUE (the mixed-ref case).
const TRACE9: PrepTip[] = [
  { id: "tip-prep-1", day: "Sunday", tip: "Cook 3 cups dry quinoa on Sunday, divide into 3 portions…", referenced_meal_ids: [MON, THU, SUN, TUE] },
  { id: "tip-prep-2", day: "Sunday", tip: "Soak 1 cup dry chickpeas overnight and simmer until tender on Sunday for Monday dinner (~35 min).", referenced_meal_ids: [MON] },
  { id: "tip-prep-3", day: "Sunday", tip: "Rinse and simmer 1.5 cups dry black beans on Sunday, then portion for Tuesday dinner (~40 min).", referenced_meal_ids: [TUE] },
  { id: "tip-prep-4", day: "Sunday", tip: "Marinate 1.2 lbs chicken breast with olive oil, cumin, and lemon juice; freeze in a single portion for Thursday dinner.", referenced_meal_ids: [THU] },
  { id: "tip-prep-5", day: "Sunday", tip: "Mix chipotle-lime rub, coat the pork tenderloin, and cube 2 medium sweet potatoes…", referenced_meal_ids: [FRI] },
  { id: "tip-prep-6", day: "Sunday", tip: "Combine coconut yogurt with chopped mint, lime zest, and a pinch of cumin…", referenced_meal_ids: [SUN] },
  { id: "tip-monday-night", day: "Monday", tip: "Thaw the beef sirloin strips, portion the cooked black beans, and dice the ripe avocado for Tuesday's Mexican bowl.", referenced_meal_ids: [TUE] },
  { id: "tip-thursday-night", day: "Thursday", tip: "Thaw the pork tenderloin, cube the sweet potatoes, and mix the chipotle-lime rub for Friday's pork.", referenced_meal_ids: [FRI] },
  { id: "tip-friday-night", day: "Friday", tip: "Thaw the shrimp if frozen, chop the shallot, and set out red pepper flakes for Saturday's scampi.", referenced_meal_ids: [SAT] },
];

const ids = (tips: PrepTip[]) => tips.map((t) => t.id);
const KEPT7_IDS = [
  "tip-prep-1", "tip-prep-2", "tip-prep-4", "tip-prep-5", "tip-prep-6",
  "tip-thursday-night", "tip-friday-night",
];

// ---------------------------------------------------------------------------
// keepUnrelatedPrepTips
// ---------------------------------------------------------------------------

Deno.test("keepUnrelatedPrepTips drops only tips solely about the replaced meal (mixed refs stay)", () => {
  const kept = keepUnrelatedPrepTips(TRACE9, [TUE]);
  assertEquals(ids(kept), KEPT7_IDS);
  // tip-prep-3 and tip-monday-night (refs subset of {TUE}) are gone; the mixed-ref tip is intact.
  assertEquals(kept[0].referenced_meal_ids, [MON, THU, SUN, TUE]);
});

Deno.test("keepUnrelatedPrepTips keeps ref-less legacy tips and drops nothing for empty replacedIds", () => {
  const legacy = { day: "Monday", tip: "Soak the beans." };
  assertEquals(keepUnrelatedPrepTips([legacy], [TUE]), [legacy]);
  assertEquals(ids(keepUnrelatedPrepTips(TRACE9, [])), ids(TRACE9));
});

Deno.test("keepUnrelatedPrepTips drops malformed entries and rebuilds known fields only", () => {
  const kept = keepUnrelatedPrepTips([
    null,
    7,
    "x",
    { day: "Monday" },
    { tip: "no day" },
    { day: 3, tip: "numeric day" },
    { id: 9, day: "Monday", tip: "numeric id", referenced_meal_ids: ["a", 1, null, "b"], evil: "drop me" },
  ], []);
  assertEquals(kept, [{ day: "Monday", tip: "numeric id", referenced_meal_ids: ["a", "b"] }]);
});

Deno.test("keepUnrelatedPrepTips returns [] for a non-array", () => {
  for (const v of [undefined, null, "x", 5, {}]) assertEquals(keepUnrelatedPrepTips(v, [TUE]), []);
});

Deno.test("keepUnrelatedPrepTips regen shape: drops tips whose refs are all in the replaced set", () => {
  const tips: PrepTip[] = [
    { id: "all", day: "Sunday", tip: "t", referenced_meal_ids: ["A", "B"] },
    { id: "one", day: "Sunday", tip: "t", referenced_meal_ids: ["B"] },
    { id: "mixed", day: "Sunday", tip: "t", referenced_meal_ids: ["A", "C"] },
  ];
  assertEquals(ids(keepUnrelatedPrepTips(tips, ["A", "B"])), ["mixed"]);
});

// ---------------------------------------------------------------------------
// nightBeforeDay (mirror of generate-meal-plan D-08)
// ---------------------------------------------------------------------------

Deno.test("nightBeforeDay lands on the previous active cook night", () => {
  assertEquals(nightBeforeDay("Tuesday", ORDER, PREP, SKIPS), "Monday");
  // Wednesday is fully skipped, so Thursday's night-before chains back to Tuesday.
  assertEquals(nightBeforeDay("Thursday", ORDER, PREP, SKIPS), "Tuesday");
  // The week's first day is prepped on the prep day.
  assertEquals(nightBeforeDay("Monday", ORDER, PREP, SKIPS), "Sunday");
  // A meal on the prep day itself takes the previous cook night.
  assertEquals(nightBeforeDay("Sunday", ORDER, PREP, SKIPS), "Saturday");
});

Deno.test("nightBeforeDay falls back to calendar adjacency without skipSlots", () => {
  assertEquals(nightBeforeDay("Thursday", ORDER, PREP, undefined), "Wednesday");
  assertEquals(nightBeforeDay("Thursday", ORDER, PREP, null), "Wednesday");
  assertEquals(nightBeforeDay("Thursday", ORDER, PREP, ["Wednesday:dinner"]), "Wednesday");
  assertEquals(nightBeforeDay("Nopeday", ORDER, PREP, SKIPS), "Sunday");
});

// ---------------------------------------------------------------------------
// mergePrepTipDelta
// ---------------------------------------------------------------------------

const CTX = { prepDay: PREP, nightDay: "Monday", orderedDays: ORDER, tagIds: [TUE], idPrefix: `tip-swap-${TUE}` };
const DELTA = {
  prepDayTask: "Simmer 1.5 cups black beans for Tuesday's turkey chili (~40 min).",
  nightBeforeTip: "Thaw the ground turkey in the fridge for Tuesday's chili.",
};

Deno.test("mergePrepTipDelta appends the tagged delta and sorts into week order", () => {
  const kept = keepUnrelatedPrepTips(TRACE9, [TUE]);
  const merged = mergePrepTipDelta(kept, DELTA, CTX);
  assertEquals(ids(merged), [
    "tip-prep-1", "tip-prep-2", "tip-prep-4", "tip-prep-5", "tip-prep-6",
    `tip-swap-${TUE}-1`, `tip-swap-${TUE}-2`,
    "tip-thursday-night", "tip-friday-night",
  ]);
  assertEquals(merged[5], { id: `tip-swap-${TUE}-1`, day: "Sunday", tip: DELTA.prepDayTask, referenced_meal_ids: [TUE] });
  assertEquals(merged[6], { id: `tip-swap-${TUE}-2`, day: "Monday", tip: DELTA.nightBeforeTip, referenced_meal_ids: [TUE] });
});

Deno.test("mergePrepTipDelta never wipes: a missing, empty or malformed delta returns the kept tips", () => {
  const kept = keepUnrelatedPrepTips(TRACE9, [TUE]);
  const deltas = [undefined, null, [], "x", {}, { prepDayTask: "  ", nightBeforeTip: null }];
  for (const d of deltas) assertEquals(ids(mergePrepTipDelta(kept, d, CTX)), KEPT7_IDS);
});

Deno.test("mergePrepTipDelta numbers only the tips it adds and trims their text", () => {
  const merged = mergePrepTipDelta([], { prepDayTask: null, nightBeforeTip: "  Thaw it.  " }, CTX);
  assertEquals(merged, [{ id: `tip-swap-${TUE}-1`, day: "Monday", tip: "Thaw it.", referenced_meal_ids: [TUE] }]);
});

Deno.test("mergePrepTipDelta sorts out-of-week-order tips stably (prep day first)", () => {
  const kept: PrepTip[] = [
    { id: "tip-friday-night", day: "Friday", tip: "f" },
    { id: "tip-prep-1", day: "Sunday", tip: "p1" },
    { id: "tip-monday-night", day: "Monday", tip: "m" },
    { id: "tip-prep-2", day: "Sunday", tip: "p2" },
  ];
  assertEquals(ids(mergePrepTipDelta(kept, undefined, CTX)), [
    "tip-prep-1", "tip-prep-2", "tip-monday-night", "tip-friday-night",
  ]);
});

Deno.test("mergePrepTipDelta omits referenced_meal_ids when tagIds is empty", () => {
  const merged = mergePrepTipDelta([], DELTA, { ...CTX, tagIds: [] });
  assertEquals(merged.length, 2);
  for (const t of merged) assertEquals("referenced_meal_ids" in t, false);
});
