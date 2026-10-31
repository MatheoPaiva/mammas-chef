import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildLaneModel } from "./PrepPipeline";
import PrepPipeline from "./PrepPipeline";
import type { MealRecipe, WeekPlan } from "@/types/mealPlan";

function meal(overrides: Partial<MealRecipe> & Pick<MealRecipe, "id" | "mealType" | "title">): MealRecipe {
  return {
    prepTime: "10 min",
    servings: 4,
    calories: 400,
    protein: 30,
    carbs: 30,
    fats: 15,
    tags: [],
    ingredients: [],
    steps: [],
    ...overrides,
  };
}

// The canonical "Friday Quinoa Taco Bowl repeated-uses" fixture: a prep-day
// batch (Q1, no `creates` ref on any meal) feeding two weeknight meals on
// different days — Wednesday dinner and Friday lunch, same recipe title
// repeated. mon-dinner has no uses/creates -> lands in unbatched.
function buildFixture(): WeekPlan {
  return {
    title: "Test Week",
    batches: [
      { id: "Q1", task: "Cook 3 cups quinoa.", yield: "3 cups quinoa", storage: "Refrigerate 4 days.", useBy: "Friday", time: "~20 min" },
    ],
    days: [
      { day: "Monday", meals: [meal({ id: "mon-dinner", mealType: "dinner", title: "Herb-Baked Salmon" })] },
      { day: "Tuesday", meals: [] },
      { day: "Wednesday", meals: [meal({ id: "wed-dinner", mealType: "dinner", title: "Mediterranean Quinoa Taco Bowl", uses: ["Q1"] })] },
      { day: "Thursday", meals: [] },
      { day: "Friday", meals: [meal({ id: "fri-lunch", mealType: "lunch", title: "Mediterranean Quinoa Taco Bowl", uses: ["Q1"] })] },
      { day: "Saturday", meals: [] },
      { day: "Sunday", meals: [] },
    ],
  };
}

// The S1 creator fixture: mon-dinner creates "S1", tue-lunch consumes it.
function buildCreatorFixture(): WeekPlan {
  return {
    title: "Test Week",
    batches: [
      { id: "S1", task: "Portion salmon leftovers.", yield: "2 servings", storage: "Fridge 2 days.", useBy: "Wednesday", time: null },
    ],
    days: [
      { day: "Monday", meals: [meal({ id: "mon-dinner", mealType: "dinner", title: "Herb-Baked Salmon", creates: "S1" })] },
      { day: "Tuesday", meals: [meal({ id: "tue-lunch", mealType: "lunch", title: "Salmon Leftovers", uses: ["S1"] })] },
    ],
  };
}

describe("buildLaneModel — creator resolution", () => {
  it("resolves the creator meal for a batch from meal.creates and its day", () => {
    const model = buildLaneModel(buildCreatorFixture());
    const lane = model.lanes.find((l) => l.batch.id === "S1");
    expect(lane).toBeDefined();
    expect(lane!.creator).not.toBeNull();
    expect(lane!.creator!.meal.id).toBe("mon-dinner");
    expect(lane!.creator!.day).toBe("Monday");
    expect(lane!.consumers.map((c) => c.meal.id)).toEqual(["tue-lunch"]);
  });
});

describe("buildLaneModel — consumer day-ordering", () => {
  it("orders consumers by day, not array/insertion order", () => {
    const model = buildLaneModel(buildFixture());
    const lane = model.lanes.find((l) => l.batch.id === "Q1");
    expect(lane).toBeDefined();
    expect(lane!.consumers.map((c) => c.meal.id)).toEqual(["wed-dinner", "fri-lunch"]);
  });
});

describe("buildLaneModel — prep-day fallback", () => {
  it("has a null creator and Sunday batchCookDay when no meal creates the batch", () => {
    const model = buildLaneModel(buildFixture());
    const lane = model.lanes.find((l) => l.batch.id === "Q1");
    expect(lane).toBeDefined();
    expect(lane!.creator).toBeNull();
    // startDay "Monday" -> batchCookDay "Sunday" (day before the week starts).
    expect(model.batchCookDay).toBe("Sunday");
  });
});

describe("buildLaneModel — unbatched partitioning", () => {
  it("puts meals with no uses/creates in unbatched, excludes meals with uses", () => {
    const model = buildLaneModel(buildFixture());
    const unbatchedIds = model.unbatched.map((u) => u.meal.id);
    expect(unbatchedIds).toContain("mon-dinner");
    expect(unbatchedIds).not.toContain("wed-dinner");
    expect(unbatchedIds).not.toContain("fri-lunch");
  });

  it("treats creates:null and uses:[] as unbatched; creates:'X' is not unbatched", () => {
    const plan: WeekPlan = {
      title: "Test Week",
      batches: [{ id: "X", task: "Task X", yield: null, storage: null, useBy: null, time: null }],
      days: [
        { day: "Monday", meals: [meal({ id: "mon-null-fields", mealType: "dinner", title: "No Batch Meal", creates: null, uses: [] })] },
        { day: "Tuesday", meals: [meal({ id: "tue-creator", mealType: "lunch", title: "Creator Meal", creates: "X" })] },
      ],
    };
    const model = buildLaneModel(plan);
    const unbatchedIds = model.unbatched.map((u) => u.meal.id);
    expect(unbatchedIds).toContain("mon-null-fields");
    expect(unbatchedIds).not.toContain("tue-creator");
  });
});

describe("buildLaneModel — zero consumers", () => {
  it("gives a batch with no consuming meal an empty consumers array", () => {
    const plan: WeekPlan = {
      title: "Test Week",
      batches: [{ id: "S1", task: "Bake muffins.", yield: "12 muffins", storage: "Fridge 4 days.", useBy: null, time: "~15 min" }],
      days: [{ day: "Monday", meals: [meal({ id: "mon-dinner", mealType: "dinner", title: "Herb-Baked Salmon" })] }],
    };
    const model = buildLaneModel(plan);
    const lane = model.lanes.find((l) => l.batch.id === "S1");
    expect(lane).toBeDefined();
    expect(lane!.consumers).toEqual([]);
  });
});

describe("buildLaneModel — nullable batch fields", () => {
  it("does not throw for a batch with all nullable fields null", () => {
    const plan: WeekPlan = {
      title: "Test Week",
      batches: [{ id: "N1", task: null, yield: null, storage: null, useBy: null, time: null }],
      days: [{ day: "Monday", meals: [meal({ id: "mon-dinner", mealType: "dinner", title: "Herb-Baked Salmon" })] }],
    };
    expect(() => buildLaneModel(plan)).not.toThrow();
    const model = buildLaneModel(plan);
    const lane = model.lanes.find((l) => l.batch.id === "N1");
    expect(lane).toBeDefined();
    expect(lane!.batch).toBe(plan.batches![0]);
  });
});

describe("PrepPipeline render", () => {
  it("renders a lane per batch", () => {
    render(<PrepPipeline weekPlan={buildFixture()} />);
    expect(screen.getByText("Q1")).toBeInTheDocument();
  });

  it("renders the consumer's full title verbatim, never truncated", () => {
    render(<PrepPipeline weekPlan={buildFixture()} />);
    expect(screen.getAllByText("Mediterranean Quinoa Taco Bowl").length).toBeGreaterThan(0);
  });

  it("shows the 'Show them' toggle and the collapsed count sentence when unbatched meals exist", () => {
    render(<PrepPipeline weekPlan={buildFixture()} />);
    expect(screen.getByRole("button", { name: /show them/i })).toBeInTheDocument();
    expect(screen.getByText(/(doesn|don)['’]?t use a batch/i)).toBeInTheDocument();
  });

  it("renders no SVG connector path", () => {
    const { container } = render(<PrepPipeline weekPlan={buildFixture()} />);
    expect(container.querySelector("path")).toBeNull();
  });
});
