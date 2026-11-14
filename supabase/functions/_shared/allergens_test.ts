import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkAllergens, isPinnedStub, markAllergenCautions } from "./allergens.ts";

Deno.test("markAllergenCautions warns on the flagged meal only and keeps its existing note", () => {
  const meals: Array<{ title: string; ingredients: Array<{ name: string }>; cautionNote?: string | null }> = [
    { title: "Carrots with Hummus", ingredients: [{ name: "hummus" }], cautionNote: "Choking risk" },
    { title: "Tahini Bowl", ingredients: [{ name: "tahini" }], cautionNote: null },
    { title: "Plain Rice", ingredients: [{ name: "rice" }], cautionNote: null },
  ];
  markAllergenCautions(meals, checkAllergens(meals, ["Sesame"]));
  assertEquals(meals[0].cautionNote, "Allergy warning: may contain Sesame. Check every ingredient before cooking. Choking risk");
  assertEquals(meals[1].cautionNote, "Allergy warning: may contain Sesame. Check every ingredient before cooking.");
  assertEquals(meals[2].cautionNote, null);
});

Deno.test("checkAllergens matches allergy names case-insensitively and reports the canonical name", () => {
  const recipes = [{ title: "Hummus Wrap", ingredients: [{ name: "hummus" }] }];
  for (const name of ["sesame", "SESAME", " Sesame "]) {
    const violations = checkAllergens(recipes, [name]);
    assertEquals(violations.length, 1, name);
    assertEquals(violations[0].allergen, "Sesame");
  }
});

const violationsFor = (ingredient: string, allergen: string) =>
  checkAllergens([{ title: "Meal", ingredients: [{ name: ingredient }] }], [allergen]);

Deno.test("checkAllergens finds a real allergen next to a false-positive phrase", () => {
  assertEquals(violationsFor("coconut almond granola", "Nuts").map((v) => v.matchedKeyword), ["almond"]);
  assertEquals(violationsFor("eggplant and 2 eggs", "Eggs").map((v) => v.matchedKeyword), ["egg"]);
  assertEquals(violationsFor("peanut butter and cream cheese", "Milk").map((v) => v.matchedKeyword), ["cheese"]);
  assertEquals(violationsFor("butter, melted, or coconut milk", "Milk").map((v) => v.matchedKeyword), ["butter"]);
  // "oat milk" sits inside "goat milk"; a false-positive phrase only counts at the start of a word.
  assertEquals(violationsFor("2 cups goat milk", "Milk").map((v) => v.matchedKeyword), ["milk"]);
});

Deno.test("checkAllergens flags egg noodles for Eggs", () => {
  assertEquals(violationsFor("egg noodles", "Eggs").length, 1);
});

Deno.test("checkAllergens still ignores a false-positive phrase on its own", () => {
  assertEquals(violationsFor("1 can coconut milk", "Milk"), []);
  assertEquals(violationsFor("1 can coconut milk", "Nuts"), []);
  assertEquals(violationsFor("2 tbsp peanut butter", "Milk"), []);
  assertEquals(violationsFor("2 tbsp walnut butter", "Milk"), []);
  assertEquals(violationsFor("1 cup oat milk", "Milk"), []);
  assertEquals(violationsFor("1 large eggplant", "Eggs"), []);
  assertEquals(violationsFor("8 oz buckwheat noodles", "Wheat"), []);
  assertEquals(violationsFor("1 cup buckwheat flour", "Wheat"), []);
});

Deno.test("isPinnedStub trusts pinned only for a recipe the request pinned", () => {
  const requested = [{ id: "pin-1", title: "Grandma's Lasagna" }, { id: "pin-2", title: "L".repeat(120) }];
  // The model only saw the first 100 characters of a long title; the client would not match that, so neither do we.
  assertEquals(isPinnedStub({ pinned: true, id: "gen-8", title: "L".repeat(100) }, requested), false);
  assertEquals(isPinnedStub({ pinned: true, id: "pin-1", title: "anything" }, requested), true);
  // The model sometimes rewrites the stub id; the client then matches by title.
  assertEquals(isPinnedStub({ pinned: true, id: "gen-7", title: "  grandma's lasagna " }, requested), true);
  assertEquals(isPinnedStub({ pinned: true, id: "gen-7", title: "Almond Cheese Bake" }, requested), false);
  assertEquals(isPinnedStub({ pinned: false, id: "pin-1", title: "Grandma's Lasagna" }, requested), false);
  assertEquals(isPinnedStub({ pinned: true, id: "", title: "" }, [{}]), false);
  assertEquals(isPinnedStub({ pinned: true, id: "pin-1" }, undefined), false);
});

Deno.test("a meal the model marked pinned with an id nobody requested is still scanned", () => {
  const meals = [
    { id: "pin-1", title: "Grandma's Lasagna", pinned: true, ingredients: [] },
    { id: "gen-7", title: "Almond Cheese Bake", pinned: true, ingredients: [{ name: "almond flour" }, { name: "cheddar" }] },
  ];
  const scanned = meals.filter((m) => !isPinnedStub(m, [{ id: "pin-1", title: "Grandma's Lasagna" }]));
  assertEquals(scanned.map((m) => m.id), ["gen-7"]);
  assertEquals(checkAllergens(scanned, ["Nuts", "Milk"]).map((v) => v.allergen), ["Nuts", "Milk"]);
});
