import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { normalizeCustomRecipeInput, validateCustomRecipeInput } from "@/lib/customRecipeValidation";
import { createCustomRecipe, customRecipeInputFromMealRecipe, getCustomRecipeMealRecipe, updateCustomRecipe } from "@/services/customRecipeService";
import type { CustomRecipeInput } from "@/types/customRecipe";
import type { Ingredient, MealRecipe } from "@/types/mealPlan";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", name: "", prep: "" });

const emptyForm: CustomRecipeInput = {
  title: "",
  mealType: "dinner",
  servings: 4,
  prepTimeMinutes: 30,
  tags: [],
  ingredients: [emptyIngredient()],
  steps: [""],
  toddlerTip: "",
  glucoseTip: "",
  flavorNotes: "",
};

function tagsToText(tags: string[]) {
  return tags.join(", ");
}

function textToTags(value: string) {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

const CustomRecipeEditor = () => {
  const { id } = useParams();
  const isEditing = !!id;
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<CustomRecipeInput>(emptyForm);
  const [tagText, setTagText] = useState("");
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setIsLoading(true);
    getCustomRecipeMealRecipe(id)
      .then((recipe: MealRecipe) => {
        if (!active) return;
        const input = customRecipeInputFromMealRecipe(recipe);
        setForm(input);
        setTagText(tagsToText(input.tags));
      })
      .catch((error) => {
        toast({
          title: "Recipe unavailable",
          description: error instanceof Error ? error.message : "Could not load recipe.",
          variant: "destructive",
        });
        navigate("/recipes", { replace: true });
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, navigate, toast]);

  const normalized = useMemo(() => normalizeCustomRecipeInput({ ...form, tags: textToTags(tagText) }), [form, tagText]);
  const validationErrors = useMemo(() => validateCustomRecipeInput(normalized), [normalized]);

  const updateIngredient = (index: number, patch: Partial<Ingredient>) => {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, i) => i === index ? { ...ingredient, ...patch } : ingredient),
    }));
  };

  const removeIngredient = (index: number) => {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.length === 1
        ? [emptyIngredient()]
        : current.ingredients.filter((_, i) => i !== index),
    }));
  };

  const updateStep = (index: number, value: string) => {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step, i) => i === index ? value : step),
    }));
  };

  const removeStep = (index: number) => {
    setForm((current) => ({
      ...current,
      steps: current.steps.length === 1 ? [""] : current.steps.filter((_, i) => i !== index),
    }));
  };

  const handleSave = async () => {
    if (!user || isSaving) return;
    if (validationErrors.length > 0) {
      toast({ title: "Recipe needs a few fields", description: validationErrors[0], variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      if (id) {
        await updateCustomRecipe(id, user.id, normalized);
        toast({ title: "Recipe updated" });
      } else {
        await createCustomRecipe(user.id, normalized);
        toast({ title: "Recipe created" });
      }
      navigate("/recipes", { state: { showMyRecipes: true } });
    } catch (error) {
      toast({
        title: "Could not save recipe",
        description: error instanceof Error ? error.message : "The nutrition estimate or save failed.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="pt-24 pb-12 min-h-screen">
      <div className="container mx-auto px-6 max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <Button variant="ghost" onClick={() => navigate("/recipes")} className="mb-4 -ml-3">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Recipes
          </Button>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h1 className="font-heading font-bold text-3xl md:text-4xl text-foreground">
                {isEditing ? "Edit Custom Recipe" : "Create Custom Recipe"}
              </h1>
              <p className="text-muted-foreground text-lg mt-2">
                Structured ingredients become store-ready shopping lists.
              </p>
            </div>
            <Button onClick={handleSave} disabled={isSaving || isLoading} className="gradient-hero text-primary-foreground border-0 font-semibold">
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {isSaving ? "Estimating..." : "Save Recipe"}
            </Button>
          </div>
        </motion.div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-8">
            <section className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Name</Label>
                  <Input id="title" value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Meal Type</Label>
                  <Select value={form.mealType} onValueChange={(value) => setForm((current) => ({ ...current, mealType: value as MealRecipe["mealType"] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="breakfast">Breakfast</SelectItem>
                      <SelectItem value="lunch">Lunch</SelectItem>
                      <SelectItem value="dinner">Dinner</SelectItem>
                      <SelectItem value="snack">Snack</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="servings">Servings</Label>
                  <Input id="servings" type="number" min="1" value={form.servings} onChange={(e) => setForm((current) => ({ ...current, servings: Number(e.target.value) }))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prepTime">Prep Time</Label>
                  <Input id="prepTime" type="number" min="0" value={form.prepTimeMinutes ?? ""} onChange={(e) => setForm((current) => ({ ...current, prepTimeMinutes: e.target.value ? Number(e.target.value) : null }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Tags</Label>
                <Input id="tags" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="Mediterranean, high-protein, family favorite" />
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-heading font-semibold text-xl text-foreground">Ingredients</h2>
                <Button variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, ingredients: [...current.ingredients, emptyIngredient()] }))}>
                  <Plus className="w-4 h-4 mr-2" />
                  Row
                </Button>
              </div>
              <div className="space-y-3">
                {form.ingredients.map((ingredient, index) => (
                  <div key={index} className="grid grid-cols-[1fr_1fr_40px] md:grid-cols-[80px_90px_1fr_1fr_40px] gap-2 items-center">
                    <Input aria-label={`Ingredient ${index + 1} quantity`} type="number" min="0" step="0.25" value={ingredient.quantity} onChange={(e) => updateIngredient(index, { quantity: Number(e.target.value) })} />
                    <Input aria-label={`Ingredient ${index + 1} unit`} value={ingredient.unit} onChange={(e) => updateIngredient(index, { unit: e.target.value })} placeholder="unit" />
                    <Input aria-label={`Ingredient ${index + 1} name`} value={ingredient.name} onChange={(e) => updateIngredient(index, { name: e.target.value })} placeholder="ingredient" className="col-span-2 md:col-span-1" />
                    <Input aria-label={`Ingredient ${index + 1} prep`} value={ingredient.prep ?? ""} onChange={(e) => updateIngredient(index, { prep: e.target.value })} placeholder="prep" className="col-span-2 md:col-span-1" />
                    <Button variant="ghost" size="icon" onClick={() => removeIngredient(index)} aria-label={`Remove ingredient ${index + 1}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-heading font-semibold text-xl text-foreground">Instructions</h2>
                <Button variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, steps: [...current.steps, ""] }))}>
                  <Plus className="w-4 h-4 mr-2" />
                  Step
                </Button>
              </div>
              <div className="space-y-3">
                {form.steps.map((step, index) => (
                  <div key={index} className="grid grid-cols-[32px_1fr_40px] gap-2 items-start">
                    <div className="h-10 flex items-center justify-center text-sm font-semibold text-muted-foreground">{index + 1}</div>
                    <Textarea value={step} onChange={(e) => updateStep(index, e.target.value)} rows={2} />
                    <Button variant="ghost" size="icon" onClick={() => removeStep(index)} aria-label={`Remove step ${index + 1}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="toddlerTip">Toddler Notes</Label>
                <Textarea id="toddlerTip" value={form.toddlerTip ?? ""} onChange={(e) => setForm((current) => ({ ...current, toddlerTip: e.target.value }))} rows={4} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="glucoseTip">Glucose Notes</Label>
                <Textarea id="glucoseTip" value={form.glucoseTip ?? ""} onChange={(e) => setForm((current) => ({ ...current, glucoseTip: e.target.value }))} rows={4} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="flavorNotes">Flavor Notes</Label>
                <Textarea id="flavorNotes" value={form.flavorNotes ?? ""} onChange={(e) => setForm((current) => ({ ...current, flavorNotes: e.target.value }))} rows={4} />
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
};

export default CustomRecipeEditor;
