import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import { Loader2, Replace, Plus, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { insertRecipeIntoPlan } from "@/services/mealPlanDbService";
import { sortMealPlanDays } from "@/lib/mealPlanDayOrder";
import { preferredPlanSlotForRecipe } from "@/lib/recipePlanSlot";
import { addLibraryRecipeToPlan } from "@/services/recipeLibraryService";
import { addCustomRecipeToPlan } from "@/services/customRecipeService";
import type { MealRecipe, SkipSlots } from "@/types/mealPlan";
import { isSlotSkipped } from "@/types/mealPlan";

interface AddToPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: MealRecipe;
}

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;

const AddToPlanDialog = ({ open, onOpenChange, recipe }: AddToPlanDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<{ id: string; title: string }[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [days, setDays] = useState<{ id: string; day_name: string }[]>([]);
  const [selectedDayId, setSelectedDayId] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [existingMeals, setExistingMeals] = useState<{ id: string; title: string; meal_type: string }[]>([]);
  const [replaceMode, setReplaceMode] = useState(false);
  const [planSkipSlots, setPlanSkipSlots] = useState<SkipSlots | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch user's saved plans
  useEffect(() => {
    if (!open || !user) return;
    const fetchPlans = async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from("meal_plans")
        .select("id, title")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setPlans(data ?? []);
      setIsLoading(false);
    };
    fetchPlans();
    // Reset selections
    setSelectedPlanId("");
    setSelectedDayId("");
    setSelectedSlot(preferredPlanSlotForRecipe(recipe));
    setExistingMeals([]);
    setReplaceMode(false);
  }, [open, user, recipe]);

  // Fetch days and skip_slots when plan selected
  useEffect(() => {
    if (!selectedPlanId) { setDays([]); setPlanSkipSlots(undefined); return; }
    const fetchDays = async () => {
      const [{ data: daysData }, { data: planData }] = await Promise.all([
        supabase.from("meal_plan_days").select("id, day_name").eq("meal_plan_id", selectedPlanId),
        supabase.from("meal_plans").select("skip_slots").eq("id", selectedPlanId).single(),
      ]);
      setDays(sortMealPlanDays(daysData ?? []));
      const ss = planData?.skip_slots;
      setPlanSkipSlots(ss && typeof ss === "object" && !Array.isArray(ss) ? ss as SkipSlots : undefined);
      setSelectedDayId("");
      setSelectedSlot(preferredPlanSlotForRecipe(recipe));
      setExistingMeals([]);
    };
    fetchDays();
  }, [selectedPlanId, recipe]);

  // Fetch existing meals when day+slot selected
  useEffect(() => {
    if (!selectedDayId || !selectedSlot) { setExistingMeals([]); return; }
    const fetchExisting = async () => {
      const { data } = await supabase
        .from("recipes")
        .select("id, title, meal_type")
        .eq("day_id", selectedDayId)
        .eq("meal_type", selectedSlot);
      setExistingMeals(data ?? []);
      setReplaceMode((data ?? []).length > 0);
    };
    fetchExisting();
  }, [selectedDayId, selectedSlot]);

  const handleConfirm = async () => {
    if (!selectedDayId || !selectedSlot) return;
    setIsSaving(true);
    try {
      const mealType = selectedSlot as MealRecipe["mealType"];
      if (recipe.libraryRecipeId) {
        await addLibraryRecipeToPlan(recipe.libraryRecipeId, selectedDayId, mealType, replaceMode);
      } else if (recipe.customRecipeId) {
        await addCustomRecipeToPlan(recipe.customRecipeId, selectedDayId, mealType, replaceMode);
      } else {
        await insertRecipeIntoPlan(selectedDayId, { ...recipe, mealType }, replaceMode);
      }
      const planId = selectedPlanId;
      toast({
        title: "Recipe added to plan!",
        description: "Shopping list refreshed from the saved plan recipes.",
        action: (
          <ToastAction altText="View updated plan" onClick={() => navigate(`/planner?plan=${planId}`)}>
            View plan
          </ToastAction>
        ),
      });
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to add recipe", description: message, variant: "destructive" });
    }
    setIsSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Add to Meal Plan</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Adding <span className="font-semibold text-foreground">{recipe.title}</span>
          </p>

          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !user ? (
            <p className="text-sm text-muted-foreground py-4">Sign in to add this recipe to a saved meal plan.</p>
          ) : plans.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No saved plans yet. Generate and save a meal plan first.</p>
          ) : (
            <>
              {/* Select Plan */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Meal Plan</label>
                <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                  <SelectTrigger><SelectValue placeholder="Select a plan" /></SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Select Day */}
              {days.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Day</label>
                  <Select value={selectedDayId} onValueChange={setSelectedDayId}>
                    <SelectTrigger><SelectValue placeholder="Select a day" /></SelectTrigger>
                    <SelectContent>
                      {days.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.day_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Select Meal Slot */}
              {selectedDayId && (
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Meal Slot</label>
                  <Select value={selectedSlot} onValueChange={setSelectedSlot}>
                    <SelectTrigger><SelectValue placeholder="Select meal slot" /></SelectTrigger>
                    <SelectContent>
                      {MEAL_SLOTS.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Skipped slot warning */}
              {selectedDayId && selectedSlot && (() => {
                const dayName = days.find(d => d.id === selectedDayId)?.day_name;
                const skipped = dayName && isSlotSkipped(planSkipSlots, dayName, selectedSlot);
                return skipped ? (
                  <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      This slot was marked as skipped. Adding a recipe here is fine — you may also want to pick a different day.
                    </p>
                  </div>
                ) : null;
              })()}

              {/* Existing meals warning */}
              {existingMeals.length > 0 && (
                <div className="bg-muted rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium text-foreground">This slot already has:</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {existingMeals.map((m) => (
                      <li key={m.id}>• {m.title}</li>
                    ))}
                  </ul>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant={replaceMode ? "default" : "outline"}
                      onClick={() => setReplaceMode(true)}
                      className="text-xs"
                    >
                      <Replace className="w-3 h-3 mr-1" /> Replace
                    </Button>
                    <Button
                      size="sm"
                      variant={!replaceMode ? "default" : "outline"}
                      onClick={() => setReplaceMode(false)}
                      className="text-xs"
                    >
                      <Plus className="w-3 h-3 mr-1" /> Add alongside
                    </Button>
                  </div>
                </div>
              )}

              {/* Confirm */}
              <Button
                onClick={handleConfirm}
                disabled={!selectedDayId || !selectedSlot || isSaving}
                className="w-full gradient-hero text-primary-foreground border-0 font-semibold"
              >
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {isSaving ? "Adding..." : "Confirm"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddToPlanDialog;
