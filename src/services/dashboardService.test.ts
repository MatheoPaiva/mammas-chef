import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSingleMealSkipSlots, buildWeekSkipSlots } from "@/lib/plannerV2Slots";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mockFrom },
}));

import { getWeeklyPlanSummaries } from "./dashboardService";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Row = Record<string, unknown>;

/** One plan row plus its day rows and N recipe rows per cooking day. */
function planFixture(planId: string, skipSlots: Row, recipesPerDay: Record<string, number>) {
  const plan = { id: planId, title: "Week", created_at: "2026-10-05T12:00:00Z", start_date: "2026-10-05", skip_slots: skipSlots };
  const days = Object.keys(recipesPerDay).map((day) => ({ id: `${planId}-${day}`, meal_plan_id: planId }));
  const recipes = Object.entries(recipesPerDay).flatMap(([day, n]) =>
    Array.from({ length: n }, () => ({ day_id: `${planId}-${day}` })),
  );
  return { plan, days, recipes };
}

function mockSummaryQueries({ plans, days, recipes }: { plans: Row[]; days: Row[]; recipes: Row[] }) {
  const inQuery = (data: Row[]) => ({ select: () => ({ in: vi.fn().mockResolvedValue({ data, error: null }) }) });
  mockFrom.mockImplementation((table: string) => {
    if (table === "meal_plans") {
      return { select: () => ({ eq: () => ({ order: vi.fn().mockResolvedValue({ data: plans, error: null }) }) }) };
    }
    if (table === "meal_plan_days") return inQuery(days);
    if (table === "shopping_lists") return inQuery([]);
    if (table === "recipes") return inQuery(recipes);
    throw new Error(`Unexpected table ${table}`);
  });
}

// Breakfast + lunch + dinner, Wednesday off: 7 snack keys + 3 Wednesday keys.
const wednesdayOff = buildWeekSkipSlots(DAYS, ["breakfast", "lunch", "dinner"], ["Wednesday"]);
const cookingDays = DAYS.filter((d) => d !== "Wednesday");

beforeEach(() => {
  mockFrom.mockReset();
});

describe("getWeeklyPlanSummaries", () => {
  it("does not flag a complete plan whose fully skipped day has no day row (D2b)", async () => {
    expect(Object.keys(wednesdayOff)).toHaveLength(10);
    const week = planFixture("week", wednesdayOff, Object.fromEntries(cookingDays.map((d) => [d, 3])));
    mockSummaryQueries({ plans: [week.plan], days: week.days, recipes: week.recipes });

    const [summary] = await getWeeklyPlanSummaries("user-1");

    expect(summary.mealCount).toBe(18);
    expect(summary.hasGaps).toBe(false);
  });

  it("flags a plan missing one requested meal (D2b guard)", async () => {
    const perDay = Object.fromEntries(cookingDays.map((d) => [d, 3]));
    perDay.Friday = 2;
    const week = planFixture("week", wednesdayOff, perDay);
    mockSummaryQueries({ plans: [week.plan], days: week.days, recipes: week.recipes });

    const [summary] = await getWeeklyPlanSummaries("user-1");

    expect(summary.mealCount).toBe(17);
    expect(summary.hasGaps).toBe(true);
  });

  it("leaves one-meal ideas (27 of 28 slots skipped) out of the weekly summaries (D2c)", async () => {
    const oneMealSkips = buildSingleMealSkipSlots(DAYS, "Tuesday", "dinner");
    expect(Object.keys(oneMealSkips)).toHaveLength(27);
    const week = planFixture("week", wednesdayOff, Object.fromEntries(cookingDays.map((d) => [d, 3])));
    const oneMeal = planFixture("one-meal", oneMealSkips, { Tuesday: 1 });
    mockSummaryQueries({
      plans: [oneMeal.plan, week.plan],
      days: [...oneMeal.days, ...week.days],
      recipes: [...oneMeal.recipes, ...week.recipes],
    });

    const summaries = await getWeeklyPlanSummaries("user-1");

    expect(summaries.map((s) => s.id)).toEqual(["week"]);
  });
});
