import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ShoppingCart, Loader2, CookingPot, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import ChefLoader from "@/components/ChefLoader";
import ShoppingListContent from "@/components/ShoppingListContent";
import { normalizeGroceryItems } from "@/lib/groceryUtils";
import { generateShoppingList } from "@/services/shoppingListService";
import { useToast } from "@/hooks/use-toast";
import type { GroceryItem } from "@/types/mealPlan";

interface PlanOption {
  id: string;
  title: string;
  created_at: string;
}

const ShoppingList = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [groceries, setGroceries] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Fetch user's saved plans
  useEffect(() => {
    if (!user) return;
    const fetchPlans = async () => {
      const { data, error } = await supabase
        .from("meal_plans")
        .select("id, title, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) toast({ title: "Failed to load plans", variant: "destructive" });
      const planList = data ?? [];
      setPlans(planList);

      // Auto-select the most recent plan
      if (planList.length > 0) {
        setSelectedPlanId(planList[0].id);
      }
      setLoading(false);
    };
    fetchPlans();
  }, [user]);

  // Fetch cached shopping list when selected plan changes
  useEffect(() => {
    if (!selectedPlanId) {
      setGroceries([]);
      return;
    }
    let cancelled = false;
    const fetchList = async () => {
      setLoadingList(true);
      const { data, error } = await supabase
        .from("shopping_lists")
        .select("items")
        .eq("meal_plan_id", selectedPlanId)
        .maybeSingle();

      if (cancelled) return;
      if (error) toast({ title: "Failed to load shopping list", variant: "destructive" });
      const rawItems = data?.items;
      setGroceries(normalizeGroceryItems(Array.isArray(rawItems) ? rawItems : []));
      setLoadingList(false);
    };
    fetchList();
    return () => { cancelled = true; };
  }, [selectedPlanId, toast]);

  const handleGenerate = async () => {
    if (!selectedPlanId) return;
    setGenerating(true);
    try {
      const result = await generateShoppingList(selectedPlanId);
      setGroceries(result.items);
      if (result.source === "ai") {
        toast({ title: "Shopping list ready!" });
      } else {
        toast({
          title: "Shopping list ready",
          description: "Using basic formatting — AI humanization is unavailable right now.",
        });
      }
    } catch {
      toast({ title: "Failed to generate shopping list", description: "Please try again.", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <main className="pt-24 pb-16 min-h-screen flex items-center justify-center">
        <ChefLoader mode="indeterminate" phrases={["Gathering your groceries…"]} />
      </main>
    );
  }

  return (
    <main className="pt-24 pb-16 min-h-screen">
      <div className="container mx-auto px-6 max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="mb-8">
            <h1 className="font-heading font-bold text-3xl text-foreground mb-1">
              Shopping List
            </h1>
            <p className="text-muted-foreground text-sm">
              Generate a store-ready shopping list for any of your saved meal plans.
            </p>
          </div>

          {plans.length === 0 ? (
            <div className="text-center py-20">
              <CookingPot className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground mb-4">
                No saved plans yet. Generate and save a meal plan to see your shopping list here.
              </p>
              <Button variant="outline" onClick={() => navigate("/planner")}>
                Go to Planner
              </Button>
            </div>
          ) : (
            <>
              {/* Plan selector */}
              <div className="mb-6">
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  Meal Plan
                </label>
                <div className="flex gap-2">
                  <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedPlanId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/planner?plan=${selectedPlanId}`)}
                      title="View full plan"
                      className="shrink-0"
                    >
                      View Plan
                    </Button>
                  )}
                  {groceries.length > 0 && (
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={!selectedPlanId || generating || loadingList}
                      onClick={handleGenerate}
                      title="Regenerate shopping list with AI"
                    >
                      <RefreshCw className={`w-4 h-4 ${generating ? "animate-spin" : ""}`} />
                    </Button>
                  )}
                </div>
              </div>

              {/* Shopping list content */}
              {loadingList ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : generating ? (
                <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm">Building your shopping list…</p>
                </div>
              ) : groceries.length === 0 ? (
                <div className="text-center py-16">
                  <ShoppingCart className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground mb-2 text-sm">
                    No shopping list yet for this plan.
                  </p>
                  <p className="text-muted-foreground/70 mb-6 text-xs">
                    AI will convert your ingredients into store-friendly quantities and group them by aisle.
                  </p>
                  <Button onClick={handleGenerate} disabled={generating}>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Shopping List
                  </Button>
                </div>
              ) : (
                <ShoppingListContent groceries={groceries} planId={selectedPlanId ?? undefined} />
              )}
            </>
          )}
        </motion.div>
      </div>
    </main>
  );
};

export default ShoppingList;
