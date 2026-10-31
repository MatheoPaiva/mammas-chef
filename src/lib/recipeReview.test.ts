import { describe, expect, it } from "vitest";
import { filterRecipeReviewItems, summarizeRecipeReviewCounts, type RecipeReviewCandidate } from "./recipeReview";

const recipes: RecipeReviewCandidate[] = [
  {
    id: "1",
    title: "Lemon Chickpea Skillet",
    status: "draft",
    mealTypes: ["dinner"],
    cuisine: "Mediterranean",
    region: "Greek-inspired",
    dietTags: ["high-fiber"],
    flavorTags: ["lemony"],
    ingredients: [{ name: "chickpeas", quantity: 1, unit: "can" }],
    machineReviewDecision: "approve",
    machineReviewTags: ["quick-win"],
  },
  {
    id: "2",
    title: "Berry Yogurt Bowl",
    status: "reviewed",
    mealTypes: ["breakfast"],
    cuisine: "Mediterranean",
    region: null,
    dietTags: ["vegetarian"],
    flavorTags: ["sweet"],
    ingredients: [{ name: "Greek yogurt", quantity: 1, unit: "cup" }],
    machineReviewDecision: null,
    machineReviewTags: [],
  },
];

describe("summarizeRecipeReviewCounts", () => {
  it("counts recipes by status", () => {
    expect(summarizeRecipeReviewCounts(recipes)).toEqual({
      draft: 1,
      reviewed: 1,
      tested: 0,
      archived: 0,
    });
  });
});

describe("filterRecipeReviewItems", () => {
  it("filters by status, meal type, and query terms", () => {
    expect(filterRecipeReviewItems(recipes, {
      query: "lemon chickpea",
      mealType: "dinner",
      status: "draft",
      machineReviewDecision: "all",
    }).map((recipe) => recipe.id)).toEqual(["1"]);
  });

  it("returns non-matching recipes when a term is missing", () => {
    expect(filterRecipeReviewItems(recipes, {
      query: "shrimp",
      mealType: "all",
      status: "all",
      machineReviewDecision: "all",
    })).toEqual([]);
  });

  it("filters by machine review decision", () => {
    expect(filterRecipeReviewItems(recipes, {
      query: "",
      mealType: "all",
      status: "all",
      machineReviewDecision: "approve",
    }).map((recipe) => recipe.id)).toEqual(["1"]);
  });

  it("filters unreviewed recipes", () => {
    expect(filterRecipeReviewItems(recipes, {
      query: "",
      mealType: "all",
      status: "all",
      machineReviewDecision: "unreviewed",
    }).map((recipe) => recipe.id)).toEqual(["2"]);
  });
});
