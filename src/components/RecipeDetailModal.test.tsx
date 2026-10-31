import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RecipeDetailModal from "./RecipeDetailModal";
import MealSwapDrawer from "./MealSwapDrawer";
import type { MealRecipe } from "@/types/mealPlan";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

const recipe = (overrides: Partial<MealRecipe> = {}): MealRecipe => ({
  id: "r1",
  title: "Lentil Soup",
  mealType: "dinner",
  prepTime: "20 min",
  servings: 4,
  calories: 400,
  protein: 20,
  carbs: 40,
  fats: 10,
  tags: [],
  ingredients: [],
  steps: [],
  ...overrides,
});

describe("RecipeDetailModal servings stepper", () => {
  it("calls onServingsChange with ±1 and disables at the bounds", () => {
    const onServingsChange = vi.fn();
    const { rerender } = render(
      <RecipeDetailModal recipe={recipe()} onClose={vi.fn()} onServingsChange={onServingsChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Decrease servings" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase servings" }));
    expect(onServingsChange.mock.calls).toEqual([[3], [5]]);

    // minServings bound (leftover source: dependents' servings + 1)
    rerender(
      <RecipeDetailModal recipe={recipe()} onClose={vi.fn()} onServingsChange={onServingsChange} minServings={4} />,
    );
    expect(screen.getByRole("button", { name: "Decrease servings" })).toBeDisabled();

    // hard max of 12
    rerender(
      <RecipeDetailModal recipe={recipe({ servings: 12 })} onClose={vi.fn()} onServingsChange={onServingsChange} />,
    );
    expect(screen.getByRole("button", { name: "Increase servings" })).toBeDisabled();
  });

  it("shows the source-meal note instead of a stepper for leftovers", () => {
    render(
      <RecipeDetailModal
        recipe={recipe({ status: "leftover", source_meal_id: "r0" })}
        onClose={vi.fn()}
        onServingsChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Portions come from its source meal/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decrease servings" })).not.toBeInTheDocument();
  });

  it("renders no stepper or edit actions without plan-context handlers", () => {
    render(<RecipeDetailModal recipe={recipe()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Increase servings" })).not.toBeInTheDocument();
    expect(screen.queryByText("Swap this meal")).not.toBeInTheDocument();
    expect(screen.queryByText(/skip it/)).not.toBeInTheDocument();
  });

  it("names the dismiss button Close and wires it to onClose (261007-slz P5)", () => {
    const onClose = vi.fn();
    render(<RecipeDetailModal recipe={recipe()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wires the Swap / Skip footer actions", () => {
    const onSwap = vi.fn();
    const onSkip = vi.fn();
    render(<RecipeDetailModal recipe={recipe()} onClose={vi.fn()} onSwap={onSwap} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: /Swap this meal/ }));
    fireEvent.click(screen.getByRole("button", { name: /skip it/ }));
    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe("MealSwapDrawer skip action", () => {
  it("renders 'Skip this meal instead' only when onSkip is provided and disables it while swapping", () => {
    const onSkip = vi.fn();
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      dayLabel: "Monday",
      mealType: "dinner",
      currentTitle: "Lentil Soup",
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<MealSwapDrawer {...props} isSwapping={false} />);
    expect(screen.queryByText("Skip this meal instead")).not.toBeInTheDocument();

    rerender(<MealSwapDrawer {...props} isSwapping={false} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: /Skip this meal instead/ }));
    expect(onSkip).toHaveBeenCalledTimes(1);

    rerender(<MealSwapDrawer {...props} isSwapping={true} onSkip={onSkip} />);
    expect(screen.getByRole("button", { name: /Skip this meal instead/ })).toBeDisabled();
  });
});
