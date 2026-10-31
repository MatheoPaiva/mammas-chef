import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockInsertRecipeIntoPlan } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockInsertRecipeIntoPlan: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mockFrom },
}));

vi.mock("@/services/mealPlanDbService", () => ({
  insertRecipeIntoPlan: mockInsertRecipeIntoPlan,
}));

import { addLibraryRecipeToPlan, getRecipeLibraryMealRecipe, hydrateLibraryRecipeReferences, recipeLibraryRowToMealRecipe, scoreRecipeLibraryRow, searchRecipeLibrary, type RecipeLibraryRow } from "./recipeLibraryService";
import type { MealPlanResponse } from "@/types/mealPlan";

const row: RecipeLibraryRow = {
  id: "recipe-1",
  title: "Lemony Chickpea Bowls",
  cuisine: "Mediterranean",
  region: "Greek-inspired",
  meal_types: ["lunch", "dinner"],
  diet_tags: ["vegetarian", "high-fiber"],
  flavor_tags: ["lemony", "herby"],
  active_time_minutes: 15,
  total_time_minutes: 25,
  servings: 4,
  calories: 430,
  protein: 18,
  carbs: 52,
  fats: 16,
  ingredients: [
    { name: "chickpeas", quantity: 2, unit: "can", prep: "rinsed", category: "pantry" },
    { name: "cucumber", quantity: 1, unit: "", prep: "diced", category: "produce" },
  ],
  steps: [
    { order: 1, text: "Warm the chickpeas with olive oil and spices." },
    { order: 2, text: "Serve over grains with cucumber and lemon yogurt." },
  ],
  toddler_tip: "Serve components separately.",
  glucose_tip: "Use extra greens and a smaller grain portion.",
  status: "reviewed",
  source_attribution: "Mammas Chef Original",
};

beforeEach(() => {
  mockFrom.mockReset();
  mockInsertRecipeIntoPlan.mockReset();
});

describe("recipeLibraryRowToMealRecipe", () => {
  it("maps a canonical recipe library row into a saved-plan recipe snapshot", () => {
    const recipe = recipeLibraryRowToMealRecipe(row);

    expect(recipe).toMatchObject({
      id: "recipe-1",
      libraryRecipeId: "recipe-1",
      title: "Lemony Chickpea Bowls",
      mealType: "lunch",
      prepTime: "15 min active / 25 min total",
      servings: 4,
      calories: 430,
      protein: 18,
      carbs: 52,
      fats: 16,
      toddlerTip: "Serve components separately.",
      glucoseTip: "Use extra greens and a smaller grain portion.",
      flavorNotes: undefined,
    });
    expect(recipe.tags).toEqual(["vegetarian", "high-fiber", "lemony", "herby", "Mediterranean", "Greek-inspired"]);
    expect(recipe.ingredients).toEqual([
      { name: "chickpeas", quantity: 2, unit: "can", prep: "rinsed" },
      { name: "cucumber", quantity: 1, unit: "", prep: "diced" },
    ]);
    expect(recipe.steps).toEqual([
      "Warm the chickpeas with olive oil and spices.",
      "Serve over grains with cucumber and lemon yogurt.",
    ]);
  });

  it("uses safe defaults for partial rows", () => {
    const recipe = recipeLibraryRowToMealRecipe({ id: "recipe-2", title: "Simple Dinner", meal_types: ["side"] });

    expect(recipe.mealType).toBe("dinner");
    expect(recipe.prepTime).toBe("Time varies");
    expect(recipe.servings).toBe(2);
    expect(recipe.calories).toBe(350);
    expect(recipe.protein).toBe(0);
    expect(recipe.carbs).toBe(0);
    expect(recipe.fats).toBe(0);
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.steps).toEqual([]);
  });
});

describe("getRecipeLibraryMealRecipe", () => {
  it("fetches and maps one canonical library recipe", async () => {
    const singleSpy = vi.fn().mockResolvedValue({ data: row, error: null });
    const eqSpy = vi.fn(() => ({ single: singleSpy }));
    const selectSpy = vi.fn(() => ({ eq: eqSpy }));
    mockFrom.mockReturnValue({ select: selectSpy });

    const recipe = await getRecipeLibraryMealRecipe("recipe-1");

    expect(mockFrom).toHaveBeenCalledWith("recipe_library");
    expect(eqSpy).toHaveBeenCalledWith("id", "recipe-1");
    expect(recipe).toMatchObject({
      id: "recipe-1",
      libraryRecipeId: "recipe-1",
      title: "Lemony Chickpea Bowls",
    });
  });
});

describe("addLibraryRecipeToPlan", () => {
  it("hydrates a canonical recipe, pins it to the requested slot, and inserts a snapshot", async () => {
    const singleSpy = vi.fn().mockResolvedValue({ data: row, error: null });
    const eqSpy = vi.fn(() => ({ single: singleSpy }));
    const selectSpy = vi.fn(() => ({ eq: eqSpy }));
    mockFrom.mockReturnValue({ select: selectSpy });
    mockInsertRecipeIntoPlan.mockResolvedValue(undefined);

    const recipe = await addLibraryRecipeToPlan("recipe-1", "day-1", "dinner", true);

    expect(mockInsertRecipeIntoPlan).toHaveBeenCalledWith(
      "day-1",
      expect.objectContaining({
        id: "recipe-1",
        libraryRecipeId: "recipe-1",
        title: "Lemony Chickpea Bowls",
        mealType: "dinner",
      }),
      true
    );
    expect(recipe.mealType).toBe("dinner");
  });
});

describe("hydrateLibraryRecipeReferences", () => {
  it("replaces generated library-reference meals with canonical recipe snapshots", async () => {
    const libraryRecipeId = "11111111-1111-4111-8111-111111111111";
    const uuidRow = { ...row, id: libraryRecipeId };
    const inSpy = vi.fn().mockResolvedValue({ data: [uuidRow], error: null });
    const selectSpy = vi.fn(() => ({ in: inSpy }));
    mockFrom.mockReturnValue({ select: selectSpy });

    const mealPlan: MealPlanResponse = {
      weekPlan: {
        title: "Library week",
        days: [
          {
            day: "Monday",
            meals: [
              {
                id: "generated-meal-1",
                libraryRecipeId,
                title: "AI copy of Lemony Chickpea Bowls",
                mealType: "dinner",
                prepTime: "99 min",
                servings: 2,
                calories: 0,
                protein: 0,
                carbs: 0,
                fats: 0,
                tags: [],
                ingredients: [],
                steps: [],
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const hydrated = await hydrateLibraryRecipeReferences(mealPlan);

    expect(mockFrom).toHaveBeenCalledWith("recipe_library");
    expect(inSpy).toHaveBeenCalledWith("id", [libraryRecipeId]);
    expect(hydrated.weekPlan.days[0].meals[0]).toMatchObject({
      id: "generated-meal-1",
      libraryRecipeId,
      title: "Lemony Chickpea Bowls",
      mealType: "dinner",
      prepTime: "15 min active / 25 min total",
      servings: 4,
      ingredients: [
        { name: "chickpeas", quantity: 2, unit: "can", prep: "rinsed" },
        { name: "cucumber", quantity: 1, unit: "", prep: "diced" },
      ],
    });
  });

  it("preserves complete generated adaptations when hydrating library references", async () => {
    const libraryRecipeId = "11111111-1111-4111-8111-111111111111";
    const uuidRow = { ...row, id: libraryRecipeId };
    const inSpy = vi.fn().mockResolvedValue({ data: [uuidRow], error: null });
    const selectSpy = vi.fn(() => ({ in: inSpy }));
    mockFrom.mockReturnValue({ select: selectSpy });

    const mealPlan: MealPlanResponse = {
      weekPlan: {
        title: "Library week",
        days: [
          {
            day: "Monday",
            meals: [
              {
                id: "generated-meal-1",
                libraryRecipeId,
                title: "Lemony Chickpea Bowls",
                mealType: "dinner",
                prepTime: "15 min active / 25 min total",
                servings: 1,
                calories: 430,
                protein: 18,
                carbs: 52,
                fats: 16,
                tags: ["vegetarian"],
                ingredients: [
                  { name: "chickpeas", quantity: 0.5, unit: "can", prep: "rinsed" },
                  { name: "cucumber", quantity: 0.25, unit: "", prep: "diced" },
                ],
                steps: ["Warm the chickpeas with olive oil and spices."],
                flavorNotes: "Adapted to the user's household size.",
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const hydrated = await hydrateLibraryRecipeReferences(mealPlan);

    expect(hydrated.weekPlan.days[0].meals[0]).toMatchObject({
      id: "generated-meal-1",
      libraryRecipeId,
      title: "Lemony Chickpea Bowls",
      mealType: "dinner",
      servings: 1,
      ingredients: [
        { name: "chickpeas", quantity: 0.5, unit: "can", prep: "rinsed" },
        { name: "cucumber", quantity: 0.25, unit: "", prep: "diced" },
      ],
      flavorNotes: "Adapted to the user's household size.",
    });
  });

  it("does not query when there are no library recipe ids", async () => {
    const mealPlan: MealPlanResponse = {
      weekPlan: { title: "Generated week", days: [{ day: "Monday", meals: [] }] },
      shoppingList: [],
      prepTips: [],
    };

    await expect(hydrateLibraryRecipeReferences(mealPlan)).resolves.toBe(mealPlan);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("clears non-UUID library references before they reach the saved-plan foreign key", async () => {
    const mealPlan: MealPlanResponse = {
      weekPlan: {
        title: "Generated week",
        days: [
          {
            day: "Monday",
            meals: [
              {
                id: "generated-meal-1",
                libraryRecipeId: "recipe-1",
                title: "AI copy",
                mealType: "dinner",
                prepTime: "20 min",
                servings: 2,
                calories: 420,
                protein: 20,
                carbs: 30,
                fats: 12,
                tags: [],
                ingredients: [],
                steps: [],
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const hydrated = await hydrateLibraryRecipeReferences(mealPlan);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(hydrated.weekPlan.days[0].meals[0].libraryRecipeId).toBeUndefined();
  });
});

describe("searchRecipeLibrary", () => {
  function mockRecipeLibrarySearch(rows: RecipeLibraryRow[]) {
    const builder = {
      select: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      contains: vi.fn(() => builder),
      lte: vi.fn(() => builder),
      ilike: vi.fn(() => builder),
      textSearch: vi.fn(() => builder),
      then: vi.fn((resolve: (value: { data: RecipeLibraryRow[]; error: null }) => unknown) => (
        Promise.resolve(resolve({ data: rows, error: null }))
      )),
    };
    mockFrom.mockReturnValue(builder);
    return builder;
  }

  it("applies Supabase-side filters for meal type, diet tags, time, and text", async () => {
    const builder = mockRecipeLibrarySearch([row]);

    await searchRecipeLibrary({
      mealType: "lunch",
      dietTags: ["vegetarian"],
      flavorTags: ["lemony"],
      maxTotalTimeMinutes: 30,
      cuisine: "med",
    }, "chickpea bowl");

    expect(builder.contains).toHaveBeenCalledWith("meal_types", ["lunch"]);
    expect(builder.contains).toHaveBeenCalledWith("diet_tags", ["vegetarian"]);
    expect(builder.contains).toHaveBeenCalledWith("flavor_tags", ["lemony"]);
    expect(builder.lte).toHaveBeenCalledWith("total_time_minutes", 30);
    expect(builder.ilike).not.toHaveBeenCalled();
    expect(builder.textSearch).toHaveBeenCalledWith("search_vector", "chickpea bowl", { type: "websearch" });
  });

  it("uses ingredient and broad-tag filters to narrow indexed text search before client post-filtering", async () => {
    const builder = mockRecipeLibrarySearch([row]);

    await searchRecipeLibrary({ includeIngredients: ["cucumber"], tags: ["lemony"] });

    expect(builder.textSearch).toHaveBeenCalledWith("search_vector", "cucumber lemony", { type: "websearch" });
  });

  it("post-filters structured ingredients, broad tags, cuisine, and region", async () => {
    mockRecipeLibrarySearch([
      row,
      {
        ...row,
        id: "recipe-2",
        title: "Shrimp Couscous",
        flavor_tags: ["lemony"],
        ingredients: [
          { name: "shrimp", quantity: 1, unit: "lb" },
          { name: "couscous", quantity: 1, unit: "cup" },
        ],
      },
      {
        ...row,
        id: "recipe-3",
        title: "Plain Cucumber Salad",
        cuisine: "American",
        region: "California",
        diet_tags: ["vegetarian"],
        flavor_tags: ["crunchy"],
        ingredients: [{ name: "cucumber", quantity: 1, unit: "" }],
      },
    ]);

    const results = await searchRecipeLibrary({
      includeIngredients: ["cucumber"],
      avoidIngredients: ["shrimp"],
      tags: ["lemony"],
      cuisine: "greek",
    });

    expect(results.map((recipe) => recipe.title)).toEqual(["Lemony Chickpea Bowls"]);
  });

  it("ranks returned rows by query and structured-filter relevance before title", async () => {
    const alphabeticalFirst = {
      ...row,
      id: "recipe-a",
      title: "Aegean Turkey Plate",
      meal_types: ["dinner"],
      flavor_tags: ["savory"],
      ingredients: [{ name: "turkey", quantity: 1, unit: "lb" }],
    } satisfies RecipeLibraryRow;
    const strongestMatch = {
      ...row,
      id: "recipe-b",
      title: "Za'atar Chickpea Lemon Bowl",
      meal_types: ["lunch"],
      flavor_tags: ["lemony", "herby"],
      ingredients: [{ name: "chickpeas", quantity: 2, unit: "can" }],
    } satisfies RecipeLibraryRow;
    mockRecipeLibrarySearch([alphabeticalFirst, strongestMatch]);

    const results = await searchRecipeLibrary({}, "lemon chickpea");

    expect(results.map((recipe) => recipe.id)).toEqual(["recipe-b", "recipe-a"]);
    expect(scoreRecipeLibraryRow(strongestMatch, { mealType: "lunch", includeIngredients: ["chickpea"] }, "lemon chickpea"))
      .toBeGreaterThan(scoreRecipeLibraryRow(alphabeticalFirst, { mealType: "lunch", includeIngredients: ["chickpea"] }, "lemon chickpea"));
  });

  it("falls back to structured search when an older database is missing search_vector", async () => {
    const firstBuilder = mockRecipeLibrarySearch([]);
    firstBuilder.then.mockImplementationOnce((resolve: (value: { data: RecipeLibraryRow[] | null; error: { message: string } }) => unknown) => (
      Promise.resolve(resolve({ data: null, error: { message: "Could not find the 'search_vector' column of 'recipe_library' in the schema cache" } }))
    ));

    const fallbackBuilder = mockRecipeLibrarySearch([row]);
    mockFrom.mockReset();
    mockFrom.mockReturnValueOnce(firstBuilder).mockReturnValueOnce(fallbackBuilder);

    const results = await searchRecipeLibrary({ mealType: "lunch" }, "chickpea");

    expect(firstBuilder.textSearch).toHaveBeenCalledWith("search_vector", "chickpea", { type: "websearch" });
    expect(fallbackBuilder.textSearch).not.toHaveBeenCalled();
    expect(fallbackBuilder.contains).toHaveBeenCalledWith("meal_types", ["lunch"]);
    expect(results.map((recipe) => recipe.id)).toEqual(["recipe-1"]);
  });
});
