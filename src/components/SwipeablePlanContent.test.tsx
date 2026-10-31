import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SwipeablePlanContent from "./SwipeablePlanContent";
import type { MealPlanResponse, MealRecipe } from "@/types/mealPlan";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), undefined],
}));

const mealPlan: MealPlanResponse = {
  weekPlan: {
    title: "Test Plan",
    days: [],
  },
  shoppingList: [
    { name: "lentils", quantity: "2 cups", aisle: "Grains & Pasta", status: "needed" },
  ],
  prepTips: [],
};

describe("SwipeablePlanContent", () => {
  it("renders the current plan shopping list instead of a navigation CTA", () => {
    render(
      <SwipeablePlanContent
        activeTab="shopping"
        onTabChange={vi.fn()}
        mealPlan={mealPlan}
        onSelectRecipe={vi.fn()}
        startDate={undefined}
        onStartDateChange={vi.fn()}
        notes=""
        onNotesChange={vi.fn()}
      />,
    );

    expect(screen.getByText("lentils")).toBeInTheDocument();
    expect(screen.queryByText("Go to Shopping List")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F3 — Shopping tab derives a list from recipes when shoppingList is empty
// (swap/regen/skip/servings edits clear it) and is never empty mid-plan.
// ---------------------------------------------------------------------------

function makeMeal(id: string, extra?: Partial<MealRecipe>): MealRecipe {
  return {
    id,
    title: `${id} title`,
    mealType: "dinner",
    prepTime: "10 min",
    servings: 2,
    calories: 400,
    protein: 20,
    carbs: 30,
    fats: 10,
    tags: [],
    ingredients: [{ name: "chicken thighs", quantity: 2, unit: "lb" }],
    steps: ["step"],
    ...extra,
  };
}

function makePlan(meals: MealRecipe[]): MealPlanResponse {
  return {
    weekPlan: { title: "Derived Plan", days: [{ day: "Monday", meals }] },
    shoppingList: [],
    prepTips: [],
  };
}

const shoppingTab = (plan: MealPlanResponse, isStreaming = false) => (
  <SwipeablePlanContent
    activeTab="shopping"
    onTabChange={vi.fn()}
    mealPlan={plan}
    onSelectRecipe={vi.fn()}
    isStreaming={isStreaming}
    startDate={undefined}
    onStartDateChange={vi.fn()}
    notes=""
    onNotesChange={vi.fn()}
  />
);

describe("SwipeablePlanContent derived shopping list", () => {
  it("builds the list from recipe ingredients when shoppingList is empty", () => {
    render(shoppingTab(makePlan([makeMeal("m-1")])));

    expect(screen.getByText(/chicken thighs/i)).toBeInTheDocument();
    expect(screen.queryByText("No shopping list available yet.")).not.toBeInTheDocument();
  });

  it("does not add a leftover meal's ingredients", () => {
    const source = makeMeal("m-1");
    const leftover = makeMeal("m-2", {
      status: "leftover",
      source_meal_id: source.id,
      ingredients: [{ name: "pita bread", quantity: 4, unit: "" }],
    });
    render(shoppingTab(makePlan([source, leftover])));

    expect(screen.getByText(/chicken thighs/i)).toBeInTheDocument();
    expect(screen.queryByText(/pita bread/i)).not.toBeInTheDocument();
  });

  it("keeps the empty state while streaming", () => {
    render(shoppingTab(makePlan([makeMeal("m-1")]), true));

    expect(screen.getByText("No shopping list available yet.")).toBeInTheDocument();
    expect(screen.queryByText(/chicken thighs/i)).not.toBeInTheDocument();
  });

  it("keeps checked state when the plan object changes but days/list/pantry references do not", () => {
    const plan = makePlan([makeMeal("m-1")]);
    const { rerender } = render(shoppingTab(plan));

    fireEvent.click(screen.getByText(/chicken thighs/i));
    expect(screen.getByText("1 of 1 needed items checked")).toBeInTheDocument();

    // Notes typing / renames spread a new mealPlan each keystroke.
    rerender(shoppingTab({ ...plan, notes: "x" }));
    expect(screen.getByText("1 of 1 needed items checked")).toBeInTheDocument();
  });
});
