import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrepStrategyContent from "./PrepStrategyContent";
import type { WeekPlan } from "@/types/mealPlan";

const weekPlanWithBatches: WeekPlan = {
  title: "Batch Week",
  batches: [
    { id: "Q1", task: "Cook 3 cups quinoa. Cool and portion.", yield: "3 cups cooked quinoa", storage: "Refrigerate up to 4 days.", useBy: "Thursday", time: "~20 min" },
  ],
  days: [
    {
      day: "Wednesday",
      meals: [
        {
          id: "wed-dinner",
          title: "Mediterranean Quinoa Bowl",
          mealType: "dinner",
          prepTime: "15 min",
          servings: 4,
          calories: 480,
          protein: 28,
          carbs: 52,
          fats: 16,
          tags: [],
          ingredients: [],
          steps: [],
          uses: ["Q1"],
        },
      ],
    },
  ],
};

const weekPlan: WeekPlan = {
  title: "Prep Week",
  days: [
    {
      day: "Monday",
      meals: [
        {
          id: "meal-1",
          title: "Chicken Bowls",
          mealType: "dinner",
          prepTime: "50 min",
          servings: 4,
          calories: 500,
          protein: 35,
          carbs: 45,
          fats: 18,
          tags: [],
          ingredients: [],
          steps: [],
        },
      ],
    },
  ],
};

describe("PrepStrategyContent", () => {
  it("shows a data-derived time-saved estimate in the header", () => {
    render(
      <PrepStrategyContent
        batchCookDay="Sunday"
        weekPlan={weekPlan}
        prepTips={[
          { day: "Sunday", tip: "Cook grains for Monday bowls (~20 min)." },
          { day: "Sunday", tip: "Make yogurt sauce and portion vegetables, about 15 min." },
          { day: "Monday", tip: "Set out tomorrow's containers, 5 min." },
        ]}
      />,
    );

    expect(screen.getByText(/About 30 min saved/)).toBeInTheDocument();
    expect(screen.queryByText(/3\.5 Hours/i)).not.toBeInTheDocument();
  });

  it("shows 'Estimate unavailable' when prep tasks do not include durations (PREP-06 D-05)", () => {
    // The invented per-task heuristic was removed: with no real per-task minutes
    // there is nothing honest to report, so the header shows "unavailable".
    render(
      <PrepStrategyContent
        batchCookDay="Sunday"
        weekPlan={weekPlan}
        prepTips={[
          { day: "Sunday", tip: "Wash produce and chop vegetables for the bowls." },
          { day: "Sunday", tip: "Cook grains and portion sauces." },
          { day: "Monday", tip: "Set out tomorrow's containers." },
        ]}
      />,
    );

    expect(screen.getByText(/Estimate unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/no task times/i)).toBeInTheDocument();
    expect(screen.queryByText(/About .* saved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/estimated from/i)).not.toBeInTheDocument();
  });

  it("labels the prep day and shows its tasks while keeping nightly tips separate (Phase 11 D-08)", () => {
    // Post-normalizeMealPlan state for Kristina's case: prep tasks re-tagged to
    // "Sunday" (the batchCookDay), nightly tip left on "Monday". The labeled prep
    // day must match where prep tasks display (criterion 1 at the UI boundary).
    render(
      <PrepStrategyContent
        batchCookDay="Sunday"
        weekPlan={weekPlan}
        prepTips={[
          { id: "tip-prep-1", day: "Sunday", tip: "Roast chicken for the week." },
          { id: "tip-prep-2", day: "Sunday", tip: "Cook rice and portion for the week." },
          { id: "tip-monday-night", day: "Monday", tip: "Set out Tuesday breakfast ingredients." },
        ]}
      />,
    );

    // Labeled prep day is "Sunday"
    expect(screen.getByText("Sunday Prep Day")).toBeInTheDocument();
    // A re-tagged prep-day task renders in the prep-day section
    expect(screen.getByText(/Roast chicken for the week/)).toBeInTheDocument();
    // The nightly tip renders in the night-before section (not absorbed into prep day)
    expect(screen.getByText(/Set out Tuesday breakfast ingredients/)).toBeInTheDocument();
    expect(screen.getByText(/Monday Night/)).toBeInTheDocument();
  });
});

describe("PrepStrategyContent FRAC-02 decimal→fraction display", () => {
  it("renders tsp/Tbsp/cup decimals as kitchen fractions, leaving non-target units and integers untouched", () => {
    render(
      <PrepStrategyContent
        batchCookDay="Sunday"
        weekPlan={weekPlan}
        prepTips={[
          { day: "Sunday", tip: "Portion 0.5 cup yogurt and 1.5 cups oats (~10 min)." },
          { day: "Sunday", tip: "Measure 0.25 Tbsp salt and 0.33 cup rice (~8 min)." },
          { day: "Sunday", tip: "Trim 0.3 lb chicken and 2 cups spinach (~12 min)." },
          { day: "Sunday", tip: "Sprinkle 0.37 tsp nutmeg (~5 min)." },
          { day: "Monday", tip: "Whisk 0.5 cup marinade for tomorrow (~6 min)." },
        ]}
      />,
    );

    // 0.5 → 1/2, 1.5 → 1 1/2 (cup/cups, prep-day render site)
    expect(screen.getByText(/Portion 1\/2 cup yogurt and 1 1\/2 cups oats/)).toBeInTheDocument();
    // 0.25 → 1/4 (Tbsp casing preserved), 0.33 → 1/3 (within toDisplayFraction's ±0.02 snap)
    expect(screen.getByText(/Measure 1\/4 Tbsp salt and 1\/3 cup rice/)).toBeInTheDocument();
    // Non-target unit (lb) and integer (2 cups) are left exactly as written
    expect(screen.getByText(/Trim 0.3 lb chicken and 2 cups spinach/)).toBeInTheDocument();
    // Out-of-tolerance decimal falls back to toDisplayFraction's one-decimal string (0.37 → 0.4)
    expect(screen.getByText(/Sprinkle 0.4 tsp nutmeg/)).toBeInTheDocument();
    // Night-before render site is transformed too (0.5 → 1/2)
    expect(screen.getByText(/Whisk 1\/2 cup marinade for tomorrow/)).toBeInTheDocument();
  });

  it("leaves a tip with no quantity unchanged", () => {
    render(
      <PrepStrategyContent
        batchCookDay="Sunday"
        weekPlan={weekPlan}
        prepTips={[
          { day: "Sunday", tip: "Thaw the salmon fillets overnight (~3 min)." },
        ]}
      />,
    );

    expect(screen.getByText(/Thaw the salmon fillets overnight/)).toBeInTheDocument();
  });
});

describe("PrepStrategyContent batch-driven checklist + Checklist/Pipeline toggle (D-14/D-16/D-17)", () => {
  it("renders batch id chips and a Used-by line, and NOT the prepTips numbered list, when batches are present", () => {
    render(
      <PrepStrategyContent
        batchCookDay="Sunday"
        weekPlan={weekPlanWithBatches}
        prepTips={[
          { day: "Sunday", tip: "This numbered prepTip must not render when batches are present." },
        ]}
      />,
    );

    // Batch id chip renders
    expect(screen.getByText("Q1")).toBeInTheDocument();
    // Derived Used-by line renders (client-derived, never AI-emitted per D-02)
    expect(screen.getByText(/Used by: Wednesday dinner/)).toBeInTheDocument();
    // The legacy prepTips numbered-circle list is replaced, not additive
    expect(screen.queryByText(/This numbered prepTip must not render/)).not.toBeInTheDocument();
  });

  it("renders the prepTips list and NO Checklist/Pipeline toggle when batches are empty/absent (D-17)", () => {
    render(
      <PrepStrategyContent
        batchCookDay="Sunday"
        weekPlan={{ title: "Legacy Week", days: [] }}
        prepTips={[
          { day: "Sunday", tip: "Roast chicken for the week." },
        ]}
      />,
    );

    // Legacy prepTips list still renders
    expect(screen.getByText(/Roast chicken for the week/)).toBeInTheDocument();
    // No tab control present at all — hidden, not disabled (D-17)
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Checklist/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Pipeline/i })).not.toBeInTheDocument();
  });

  it("shows the Checklist/Pipeline toggle when batches are present (D-16)", () => {
    render(
      <PrepStrategyContent
        batchCookDay="Sunday"
        weekPlan={weekPlanWithBatches}
        prepTips={[]}
      />,
    );

    expect(screen.getByRole("tab", { name: /Checklist/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Pipeline/i })).toBeInTheDocument();
  });
});

describe("PrepStrategyContent night label (261007-slz P5)", () => {
  const thursdayPlan: WeekPlan = {
    title: "Dinner-only Week",
    days: [
      {
        day: "Thursday",
        meals: [
          {
            id: "thu-dinner",
            title: "Souvlaki",
            mealType: "dinner",
            prepTime: "30 min",
            servings: 4,
            calories: 500,
            protein: 35,
            carbs: 30,
            fats: 20,
            tags: [],
            ingredients: [],
            steps: [],
          },
        ],
      },
    ],
  };

  it("labels a night card by the day of the meal it references, not the next calendar day", () => {
    render(
      <PrepStrategyContent
        batchCookDay="Sunday"
        weekPlan={thursdayPlan}
        prepTips={[
          { id: "tip-tuesday-night", day: "Tuesday", tip: "Thaw the chicken.", referenced_meal_ids: ["thu-dinner"] },
        ]}
      />,
    );

    expect(screen.getByText("PREP FOR THURSDAY")).toBeInTheDocument();
    expect(screen.queryByText("PREP FOR WEDNESDAY")).not.toBeInTheDocument();
  });

  it("falls back to the next calendar day for a ref-less tip", () => {
    render(
      <PrepStrategyContent
        batchCookDay="Sunday"
        weekPlan={thursdayPlan}
        prepTips={[{ day: "Monday", tip: "Set out the containers." }]}
      />,
    );

    expect(screen.getByText("PREP FOR TUESDAY")).toBeInTheDocument();
  });
});
