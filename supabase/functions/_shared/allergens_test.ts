import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkAllergens, markAllergenCautions } from "./allergens.ts";

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
