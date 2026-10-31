import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MealPlanCalendar from "./MealPlanCalendar";
import { skipSlotKey, type MealRecipe, type WeekPlan } from "@/types/mealPlan";

const meal = (mealType: string, extra: Partial<MealRecipe> = {}): MealRecipe =>
  ({ title: `${mealType} dish`, mealType, ingredients: [], steps: [], ...extra }) as MealRecipe;

const weekPlan: WeekPlan = {
  title: "Test",
  days: [
    { day: "Monday", meals: [meal("dinner", { status: "leftover", cautionNote: "eat by Wed" })] },
    { day: "Tuesday", meals: [] },
  ],
};

const allTuesdaySkipped = Object.fromEntries(
  ["breakfast", "lunch", "dinner", "snack"].map((t) => [skipSlotKey("Tuesday", t), true as const]),
);

describe("MealPlanCalendar", () => {
  it("names meal cells, keeps swap visible, and hides Regenerate on a fully-skipped day", () => {
    render(
      <MealPlanCalendar
        weekPlan={weekPlan}
        skipSlots={allTuesdaySkipped}
        onSelectRecipe={vi.fn()}
        onSwapMeal={vi.fn()}
        onRegenerateDay={vi.fn()}
        startDate={undefined}
        onStartDateChange={vi.fn()}
        notes=""
        onNotesChange={vi.fn()}
        weekStartDay="Monday"
      />,
    );

    expect(
      screen.getByRole("button", { name: "View dinner recipe: dinner dish, LEFTOVER, caution" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Swap dinner on Monday" })).not.toHaveClass("opacity-0");
    expect(screen.getByRole("button", { name: "Regenerate all meals for Monday" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate all meals for Tuesday" })).not.toBeInTheDocument();
  });
});
