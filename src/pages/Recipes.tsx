import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Heart, ChevronDown, ChevronUp, ChevronRight, Pin, ArrowRight, Loader2, Plus, Pencil, Archive } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { recipeLibrarySeedFallbackRecipes } from "@/data/recipeLibrarySeedFallback";
import { getFavorites, addFavorite, removeFavorite } from "@/services/mealPlanDbService";
import { chooseRecipeLibraryDisplay } from "@/lib/recipeLibraryDisplay";
import { recipeIdentityKey } from "@/lib/recipeIdentity";
import { parseRecipeSearchQuery, recipeMatchesSearch, type ModifierCategory } from "@/lib/recipeSearchQuery";
import { searchMealRecipesFromLibrary } from "@/services/recipeLibraryService";
import { archiveCustomRecipe, listCustomRecipes } from "@/services/customRecipeService";
import { getRecipeReviewAdminStatus } from "@/services/recipeReviewService";
import { supabase } from "@/integrations/supabase/client";
import RecipeDetailModal from "@/components/RecipeDetailModal";
import AddToPlanDialog from "@/components/AddToPlanDialog";
import type { MealRecipe } from "@/types/mealPlan";

const FILTERS = ["All", "Breakfast", "Lunch", "Dinner", "Snack"] as const;

// Locked URL vocabularies — T-10-04 mitigation (whitelist on hydration)
const PROTEIN_ALLOWED = ["chicken", "beef", "pork", "fish", "shrimp", "tofu", "beans-lentils", "eggs"] as const;
const TIME_ALLOWED = [15, 30, 45] as const;
const DIET_ALLOWED = ["vegetarian", "no-cook"] as const;

const PROTEIN_LABELS: Record<(typeof PROTEIN_ALLOWED)[number], string> = {
  chicken: "Chicken",
  beef: "Beef",
  pork: "Pork",
  fish: "Fish",
  shrimp: "Shrimp",
  tofu: "Tofu",
  "beans-lentils": "Beans/Lentils",
  eggs: "Eggs",
};

const MEAL_VALUE_TO_FILTER: Record<string, (typeof FILTERS)[number]> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

type TimeValue = (typeof TIME_ALLOWED)[number];

const Recipes = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [timeFilter, setTimeFilter] = useState<TimeValue | null>(null);
  const [proteinFilter, setProteinFilter] = useState<string[]>([]);
  const [dietFilter, setDietFilter] = useState<string[]>([]);
  const [toddlerOn, setToddlerOn] = useState<boolean>(false);
  const [glucoseOn, setGlucoseOn] = useState<boolean>(false);
  const [timePopoverOpen, setTimePopoverOpen] = useState(false);
  const [proteinPopoverOpen, setProteinPopoverOpen] = useState(false);
  const hydratedRef = useRef(false);
  const [clearedModifiers, setClearedModifiers] = useState<ReadonlySet<ModifierCategory>>(() => new Set());

  const addCleared = (category: ModifierCategory) =>
    setClearedModifiers((prev) => {
      if (prev.has(category)) return prev;
      const next = new Set(prev);
      next.add(category);
      return next;
    });

  const removeCleared = (category: ModifierCategory) =>
    setClearedModifiers((prev) => {
      if (!prev.has(category)) return prev;
      const next = new Set(prev);
      next.delete(category);
      return next;
    });

  const [favorites, setFavorites] = useState<{ recipe_title: string; recipe_data: MealRecipe }[]>([]);
  const [favOpen, setFavOpen] = useState(true);
  const [selectedRecipe, setSelectedRecipe] = useState<MealRecipe | null>(null);
  const [addToPlanRecipe, setAddToPlanRecipe] = useState<MealRecipe | null>(null);
  const [showToddlerTips, setShowToddlerTips] = useState(false);
  const [showGlucoseTips, setShowGlucoseTips] = useState(false);
  const [libraryRecipes, setLibraryRecipes] = useState<MealRecipe[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryUnavailable, setLibraryUnavailable] = useState(false);
  const [libraryHasAny, setLibraryHasAny] = useState<boolean | null>(null);
  const [customRecipes, setCustomRecipes] = useState<MealRecipe[]>([]);
  const [customLoading, setCustomLoading] = useState(false);
  const [myRecipesOpen, setMyRecipesOpen] = useState(true);
  const [canReviewLibrary, setCanReviewLibrary] = useState(false);

  // Selected recipes for meal generation
  const [selectedForPlan, setSelectedForPlan] = useState<MealRecipe[]>(() => {
    // Initialize from location state if we navigated from Planner
    return location.state?.pinnedRecipes || [];
  });

  // Load favorites
  useEffect(() => {
    if (!user) return;
    getFavorites(user.id).then(setFavorites).catch(() => { });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setCustomLoading(true);
    listCustomRecipes()
      .then((recipes) => {
        if (active) setCustomRecipes(recipes);
      })
      .catch(() => {
        if (active) setCustomRecipes([]);
      })
      .finally(() => {
        if (active) setCustomLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  // Fetch user tip preferences
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("toddler_friendly, glucose_friendly")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const profile = data as { toddler_friendly?: boolean; glucose_friendly?: boolean };
        setShowToddlerTips(!!profile.toddler_friendly);
        setShowGlucoseTips(!!profile.glucose_friendly);
      });
  }, [user]);

  useEffect(() => {
    let active = true;
    if (!user) {
      setCanReviewLibrary(false);
      return;
    }

    getRecipeReviewAdminStatus(user.id)
      .then((value) => {
        if (active) setCanReviewLibrary(value);
      })
      .catch(() => {
        if (active) setCanReviewLibrary(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    let active = true;
    const fetchLibraryRecipes = async () => {
      setLibraryLoading(true);
      setLibraryUnavailable(false);
      try {
        const merged = buildMergedFilters(search);
        const recipes = await searchMealRecipesFromLibrary(merged.filters, merged.query);
        if (!active) return;
        setLibraryRecipes(recipes);
        if (activeFilter === "All" && !search.trim() && !hasAnyActiveFilter) {
          setLibraryHasAny(recipes.length > 0);
        }
      } catch {
        if (!active) return;
        setLibraryRecipes([]);
        setLibraryUnavailable(true);
        setLibraryHasAny(null);
      } finally {
        if (active) setLibraryLoading(false);
      }
    };

    fetchLibraryRecipes();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, search, timeFilter, proteinFilter, dietFilter, toddlerOn, glucoseOn, clearedModifiers]);

  // Hydrate filter state from URL search params once on mount (D-14, T-10-04 mitigation).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const mealRaw = searchParams.get("meal");
    if (mealRaw) {
      const mapped = MEAL_VALUE_TO_FILTER[mealRaw.toLowerCase()];
      if (mapped) setActiveFilter(mapped);
    }

    const timeRaw = searchParams.get("time");
    if (timeRaw) {
      const n = Number(timeRaw);
      if ((TIME_ALLOWED as readonly number[]).includes(n)) {
        setTimeFilter(n as TimeValue);
      }
    }

    const proteinRaw = searchParams.get("protein");
    if (proteinRaw) {
      const cleaned = proteinRaw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .filter((v) => (PROTEIN_ALLOWED as readonly string[]).includes(v));
      if (cleaned.length > 0) setProteinFilter(cleaned);
    }

    const dietRaw = searchParams.get("diet");
    if (dietRaw) {
      const cleaned = dietRaw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .filter((v) => (DIET_ALLOWED as readonly string[]).includes(v));
      if (cleaned.length > 0) setDietFilter(cleaned);
    }

    if (searchParams.get("toddler") === "1") setToddlerOn(true);
    if (searchParams.get("glucose") === "1") setGlucoseOn(true);

    const qRaw = searchParams.get("q");
    if (qRaw) {
      setSearch(qRaw);
      // D-16: reflect any modifiers in q back into chip state (e.g. ?q=under:30 → Time chip).
      const parsed = parseRecipeSearchQuery(qRaw);
      if (parsed.filters.maxTotalTimeMinutes && (TIME_ALLOWED as readonly number[]).includes(parsed.filters.maxTotalTimeMinutes)) {
        setTimeFilter(parsed.filters.maxTotalTimeMinutes as TimeValue);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync filter state back to URL search params on every change (D-14).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const next = new URLSearchParams();
    if (activeFilter !== "All") next.set("meal", activeFilter.toLowerCase());
    if (timeFilter !== null) next.set("time", String(timeFilter));
    if (proteinFilter.length > 0) next.set("protein", proteinFilter.join(","));
    if (dietFilter.length > 0) next.set("diet", dietFilter.join(","));
    if (toddlerOn) next.set("toddler", "1");
    if (glucoseOn) next.set("glucose", "1");
    if (search.trim()) next.set("q", search.trim());
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, search, timeFilter, proteinFilter, dietFilter, toddlerOn, glucoseOn, clearedModifiers]);

  // Build the merged RecipeSearchFilters shape used by both the library fetch and the
  // in-memory matchers (favorites, custom, fallback). Chips win on conflict (D-16).
  const buildMergedFilters = (rawQuery: string) => {
    const mealType = activeFilter === "All" ? undefined : activeFilter.toLowerCase() as MealRecipe["mealType"];
    const parsed = parseRecipeSearchQuery(
      rawQuery,
      mealType ? { mealType } : {},
      { suppress: clearedModifiers },
    );
    const merged = { ...parsed.filters };

    if (timeFilter !== null) {
      merged.maxTotalTimeMinutes = timeFilter;
    }
    if (proteinFilter.length > 0) {
      merged.includeIngredients = [...(merged.includeIngredients ?? []), ...proteinFilter];
    }
    if (dietFilter.length > 0) {
      merged.dietTags = [...(merged.dietTags ?? []), ...dietFilter];
    }
    if (toddlerOn) merged.toddlerFriendly = true;
    if (glucoseOn) merged.glucoseFriendly = true;

    return { query: parsed.query, filters: merged };
  };

  const hasAnyActiveFilter =
    activeFilter !== "All" ||
    search.trim() !== "" ||
    timeFilter !== null ||
    proteinFilter.length > 0 ||
    dietFilter.length > 0 ||
    toddlerOn ||
    glucoseOn;

  const handleClearAll = () => {
    setActiveFilter("All");
    setSearch("");
    setTimeFilter(null);
    setProteinFilter([]);
    setDietFilter([]);
    setToddlerOn(false);
    setGlucoseOn(false);
    setClearedModifiers(new Set(["time", "protein", "diet", "meal"] as ModifierCategory[]));
  };

  const toggleProtein = (value: string) => {
    setProteinFilter((prev) => {
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      if (next.length === 0) addCleared("protein");
      else removeCleared("protein");
      return next;
    });
  };

  const toggleDiet = (value: string) => {
    setDietFilter((prev) => {
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      if (next.length === 0) addCleared("diet");
      else removeCleared("diet");
      return next;
    });
  };

  const isFavorite = (recipe: MealRecipe) => {
    const key = recipeIdentityKey(recipe);
    return favorites.some((favorite) => (
      favorite.recipe_title === key ||
      favorite.recipe_title === recipe.title ||
      recipeIdentityKey(favorite.recipe_data) === key
    ));
  };

  const toggleFavorite = async (recipe: MealRecipe) => {
    if (!user) return;
    try {
      if (isFavorite(recipe)) {
        await removeFavorite(user.id, recipe);
        const key = recipeIdentityKey(recipe);
        setFavorites((prev) => prev.filter((f) => f.recipe_title !== recipe.title && f.recipe_title !== key && recipeIdentityKey(f.recipe_data) !== key));
        toast({ title: "Removed from favorites" });
      } else {
        await addFavorite(user.id, recipe);
        setFavorites((prev) => [...prev, { recipe_title: recipeIdentityKey(recipe), recipe_data: recipe }]);
        toast({ title: "Added to favorites ❤️" });
      }
    } catch {
      toast({ title: "Failed to update favorite", variant: "destructive" });
    }
  };

  const fallbackFiltered = useMemo(() => {
    const merged = buildMergedFilters(search);
    return recipeLibrarySeedFallbackRecipes.filter((recipe) => recipeMatchesSearch(recipe, merged.filters, merged.query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, search, timeFilter, proteinFilter, dietFilter, toddlerOn, glucoseOn, clearedModifiers]);

  const customFiltered = useMemo(() => {
    const merged = buildMergedFilters(search);
    return customRecipes.filter((recipe) => recipeMatchesSearch(recipe, merged.filters, merged.query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, search, timeFilter, proteinFilter, dietFilter, toddlerOn, glucoseOn, customRecipes, clearedModifiers]);

  const display = chooseRecipeLibraryDisplay(libraryRecipes, fallbackFiltered, { libraryUnavailable, libraryHasAny, libraryLoading });
  const filtered = display.recipes;

  const favoriteRecipes = favorites.map((f) => f.recipe_data);

  const isSelected = (recipe: MealRecipe) => {
    const key = recipeIdentityKey(recipe);
    return selectedForPlan.some((selected) => recipeIdentityKey(selected) === key);
  };

  const toggleSelection = (recipe: MealRecipe) => {
    const key = recipeIdentityKey(recipe);
    if (isSelected(recipe)) {
      setSelectedForPlan((prev) => prev.filter((selected) => recipeIdentityKey(selected) !== key));
    } else {
      setSelectedForPlan((prev) => [...prev, recipe]);
    }
  };

  const handleGeneratePlan = () => {
    navigate("/planner", { state: { pinnedRecipes: selectedForPlan } });
  };

  const handleArchiveCustomRecipe = async (recipe: MealRecipe) => {
    if (!recipe.customRecipeId) return;
    try {
      await archiveCustomRecipe(recipe.customRecipeId);
      setCustomRecipes((prev) => prev.filter((item) => item.customRecipeId !== recipe.customRecipeId));
      toast({ title: "Recipe archived" });
    } catch {
      toast({ title: "Failed to archive recipe", variant: "destructive" });
    }
  };

  return (
    <main className="pt-24 pb-12 min-h-screen">
      <div className="container mx-auto px-6 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="font-heading font-bold text-3xl md:text-4xl text-foreground mb-2">
            Recipe Library
          </h1>
          <p className="text-muted-foreground text-lg mb-8">
            Browse recipes, save your favorites, and add them to your meal plans.
          </p>
          <div className="flex flex-wrap gap-3 mb-8">
            <Button onClick={() => navigate("/recipes/new")} className="gradient-hero text-primary-foreground border-0">
              <Plus className="w-4 h-4 mr-2" />
              Create Recipe
            </Button>
            {canReviewLibrary ? (
              <Button variant="outline" onClick={() => navigate("/recipe-review")}>
                Review draft recipes
              </Button>
            ) : null}
          </div>
        </motion.div>

        {/* Favorites Section */}
        {favoriteRecipes.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-10">
            <button
              onClick={() => setFavOpen(!favOpen)}
              className="flex items-center gap-2 mb-4 group"
            >
              <Heart className="w-5 h-5 text-destructive fill-destructive" />
              <h2 className="font-heading font-semibold text-xl text-foreground">
                My Favorites ({favoriteRecipes.length})
              </h2>
              {favOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {favOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {favoriteRecipes.map((recipe) => (
                  <RecipeLibraryCard
                    key={recipeIdentityKey(recipe)}
                    recipe={recipe}
                    isFav={true}
                    isSelected={isSelected(recipe)}
                    isCustom={!!recipe.customRecipeId}
                    onToggleFav={() => toggleFavorite(recipe)}
                    onToggleSelect={() => toggleSelection(recipe)}
                    onClick={() => setSelectedRecipe(recipe)}
                    onAddToPlan={() => setAddToPlanRecipe(recipe)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* My Recipes Section */}
        {user && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-10">
            <button
              onClick={() => setMyRecipesOpen(!myRecipesOpen)}
              className="flex items-center gap-2 mb-4 group"
            >
              <Pin className="w-5 h-5 text-primary" />
              <h2 className="font-heading font-semibold text-xl text-foreground">
                My Recipes ({customFiltered.length})
              </h2>
              {myRecipesOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {myRecipesOpen && (
              customLoading ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : customFiltered.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {customFiltered.map((recipe) => (
                    <RecipeLibraryCard
                      key={`custom-${recipe.id}`}
                      recipe={recipe}
                      isFav={isFavorite(recipe)}
                      isSelected={isSelected(recipe)}
                      isCustom={true}
                      onToggleFav={() => toggleFavorite(recipe)}
                      onToggleSelect={() => toggleSelection(recipe)}
                      onClick={() => setSelectedRecipe(recipe)}
                      onAddToPlan={() => setAddToPlanRecipe(recipe)}
                      onEdit={() => recipe.customRecipeId && navigate(`/recipes/${recipe.customRecipeId}/edit`)}
                      onArchive={() => handleArchiveCustomRecipe(recipe)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 px-5 py-6">
                  <p className="font-medium text-foreground">
                    {customRecipes.length > 0 ? "No custom recipes match this search." : "Your custom recipes will live here."}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                    {customRecipes.length > 0
                      ? "Try a different search or meal type filter to bring them back."
                      : "Create family favorites once, then add them to plans from this page or pin them when generating a new plan."}
                  </p>
                  {customRecipes.length === 0 ? (
                    <Button variant="outline" onClick={() => navigate("/recipes/new")} className="mt-4">
                      <Plus className="w-4 h-4 mr-2" />
                      Create Recipe
                    </Button>
                  ) : null}
                </div>
              )
            )}
          </motion.div>
        )}

        {/* Browse Section */}
        <div>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-heading font-semibold text-xl text-foreground">Browse Recipes</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {display.message}
              </p>
            </div>
            {libraryLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground shrink-0" />}
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex gap-2 flex-wrap">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      setActiveFilter(f);
                      if (f === "All") {
                        addCleared("meal");
                      } else {
                        removeCleared("meal");
                      }
                    }}
                    className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all tap-highlight-none touch-target ${activeFilter === f
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search recipes, ingredient:chickpea avoid:shrimp under:30..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    if (clearedModifiers.size > 0) setClearedModifiers(new Set());
                  }}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Second filter chip row (D-09 locked order): Time | Protein | Toddler-friendly | Glucose-friendly | Vegetarian | No-cook */}
            <div className="flex gap-2 flex-wrap items-center">
              {/* Time chip */}
              <Popover open={timePopoverOpen} onOpenChange={setTimePopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all tap-highlight-none touch-target inline-flex items-center gap-1.5 ${timeFilter !== null
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    <span>{timeFilter !== null ? `Time: ≤${timeFilter} min` : "Time"}</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-3" align="start">
                  <div className="flex flex-col gap-1">
                    {TIME_ALLOWED.map((value) => {
                      const active = timeFilter === value;
                      return (
                        <button
                          key={value}
                          onClick={() => {
                            setTimeFilter(value);
                            setTimePopoverOpen(false);
                            removeCleared("time");
                          }}
                          className="flex items-center gap-2 px-2 py-2 rounded-md text-sm hover:bg-muted text-left"
                        >
                          <span className={`inline-block w-2 h-2 rounded-full ${active ? "bg-primary" : "bg-transparent border border-muted-foreground"}`} />
                          <span className="text-foreground">{`≤${value} min`}</span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => {
                        setTimeFilter(null);
                        setTimePopoverOpen(false);
                        addCleared("time");
                      }}
                      className="mt-1 px-2 py-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline text-left"
                    >
                      Clear
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Protein chip */}
              <Popover open={proteinPopoverOpen} onOpenChange={setProteinPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all tap-highlight-none touch-target inline-flex items-center gap-1.5 ${proteinFilter.length > 0
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    <span>
                      {proteinFilter.length === 0
                        ? "Protein"
                        : proteinFilter.length === 1
                          ? `Protein: ${PROTEIN_LABELS[proteinFilter[0] as keyof typeof PROTEIN_LABELS] ?? proteinFilter[0]}`
                          : `Protein: ${PROTEIN_LABELS[proteinFilter[0] as keyof typeof PROTEIN_LABELS] ?? proteinFilter[0]} +${proteinFilter.length - 1}`}
                    </span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                  <div className="flex flex-col gap-1">
                    {PROTEIN_ALLOWED.map((value) => {
                      const checked = proteinFilter.includes(value);
                      return (
                        <button
                          key={value}
                          onClick={() => toggleProtein(value)}
                          className="flex items-center gap-2 px-2 py-2 rounded-md text-sm hover:bg-muted text-left"
                        >
                          <span className={`inline-flex items-center justify-center w-4 h-4 rounded border ${checked ? "bg-primary border-primary text-primary-foreground" : "bg-transparent border-muted-foreground"}`}>
                            {checked ? <span className="text-[10px] leading-none">✓</span> : null}
                          </span>
                          <span className="text-foreground">{PROTEIN_LABELS[value]}</span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => {
                        setProteinFilter([]);
                        setProteinPopoverOpen(false);
                        addCleared("protein");
                      }}
                      className="mt-1 px-2 py-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline text-left"
                    >
                      Clear
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Toddler-friendly chip */}
              <button
                onClick={() => setToddlerOn((v) => !v)}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all tap-highlight-none touch-target ${toddlerOn
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
              >
                Toddler-friendly
              </button>

              {/* Glucose-friendly chip */}
              <button
                onClick={() => setGlucoseOn((v) => !v)}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all tap-highlight-none touch-target ${glucoseOn
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
              >
                Glucose-friendly
              </button>

              {/* Vegetarian chip */}
              <button
                onClick={() => toggleDiet("vegetarian")}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all tap-highlight-none touch-target ${dietFilter.includes("vegetarian")
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
              >
                Vegetarian
              </button>

              {/* No-cook chip */}
              <button
                onClick={() => toggleDiet("no-cook")}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all tap-highlight-none touch-target ${dietFilter.includes("no-cook")
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
              >
                No-cook
              </button>

              {/* Clear all link (D-15) */}
              {hasAnyActiveFilter && (
                <button
                  onClick={handleClearAll}
                  className="ml-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((recipe) => (
              <RecipeLibraryCard
                key={recipe.id}
                recipe={recipe}
                isFav={isFavorite(recipe)}
                isSelected={isSelected(recipe)}
                isCustom={!!recipe.customRecipeId}
                onToggleFav={() => toggleFavorite(recipe)}
                onToggleSelect={() => toggleSelection(recipe)}
                onClick={() => setSelectedRecipe(recipe)}
                onAddToPlan={() => setAddToPlanRecipe(recipe)}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-12">No recipes match your search.</p>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      <RecipeDetailModal
        recipe={selectedRecipe}
        onClose={() => setSelectedRecipe(null)}
        isFavorite={selectedRecipe ? isFavorite(selectedRecipe) : false}
        onToggleFavorite={() => selectedRecipe && toggleFavorite(selectedRecipe)}
        onAddToPlan={() => {
          if (selectedRecipe) {
            setAddToPlanRecipe(selectedRecipe);
            setSelectedRecipe(null);
          }
        }}
        showToddlerTips={showToddlerTips}
        showGlucoseTips={showGlucoseTips}
      />

      {/* Add to Plan Dialog */}
      {addToPlanRecipe && (
        <AddToPlanDialog
          open={!!addToPlanRecipe}
          onOpenChange={(open) => { if (!open) setAddToPlanRecipe(null); }}
          recipe={addToPlanRecipe}
        />
      )}

      {/* Sticky Bottom Bar for Plan Generation */}
      <AnimatePresence>
        {selectedForPlan.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-0 left-0 right-0 p-4 z-50 pointer-events-none"
          >
            <div className="container mx-auto px-2 max-w-5xl flex justify-center">
              <div className="bg-card shadow-elevated border border-border rounded-2xl px-5 py-3 flex items-center gap-4 pointer-events-auto w-full sm:w-auto overflow-hidden">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">
                    {selectedForPlan.length} recipe{selectedForPlan.length !== 1 ? 's' : ''} selected
                  </p>
                  <p className="text-xs text-muted-foreground truncate hidden sm:block">
                    {selectedForPlan.map(r => r.title).join(', ')}
                  </p>
                </div>
                <Button
                  onClick={handleGeneratePlan}
                  className="gradient-hero text-primary-foreground border-0 font-medium whitespace-nowrap"
                >
                  Generate Plan <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
};

// --- Card sub-component ---
interface RecipeLibraryCardProps {
  recipe: MealRecipe;
  isFav: boolean;
  isSelected: boolean;
  isCustom?: boolean;
  onToggleFav: () => void;
  onToggleSelect: () => void;
  onClick: () => void;
  onAddToPlan: () => void;
  onEdit?: () => void;
  onArchive?: () => void;
}

const RecipeLibraryCard = ({ recipe, isFav, isSelected, isCustom = false, onToggleFav, onToggleSelect, onClick, onAddToPlan, onEdit, onArchive }: RecipeLibraryCardProps) => (
  <div
    onClick={onClick}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    }}
    className={`bg-card rounded-lg p-4 sm:p-5 shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all group relative active-scale tap-highlight-none cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none border-2 ${isSelected ? 'border-primary' : 'border-transparent'}`}
  >
    <ChevronRight
      className="absolute top-3 right-3 w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors"
      aria-hidden="true"
    />
    <button onClick={onClick} className="text-left w-full">
      <div className="flex items-start gap-2 mb-1.5 pr-6">
        <h3 className="font-heading font-semibold text-foreground group-hover:text-primary transition-colors flex-1">
          {recipe.title}
        </h3>
        {isCustom ? (
          <Badge variant="outline" className="text-[10px] rounded-md px-1.5 py-0">
            Custom
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
        <span>{recipe.prepTime}</span>
        <span>•</span>
        <span>{recipe.calories} cal</span>
        <span>•</span>
        <span>{recipe.protein}g protein</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {recipe.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs bg-muted text-muted-foreground font-normal rounded-md px-2 py-0.5">
            {tag}
          </Badge>
        ))}
      </div>
    </button>

    <div className="flex items-center justify-between mt-1">
      <button
        onClick={(e) => { e.stopPropagation(); onAddToPlan(); }}
        className="text-xs font-medium text-primary hover:underline py-1 tap-highlight-none touch-target flex-1 text-left"
      >
        + Add to Plan
      </button>

      <div className="flex items-center gap-1">
        {/* Fav toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
          className="p-2 rounded-full hover:bg-muted transition-colors z-10 tap-highlight-none touch-target"
          title={isFav ? "Remove from favorites" : "Add to favorites"}
        >
          <Heart className={`w-4.5 h-4.5 ${isFav ? "text-destructive fill-destructive" : "text-muted-foreground"}`} />
        </button>

        {/* Select for Plan toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className={`p-2 rounded-full transition-colors z-10 tap-highlight-none touch-target ${isSelected ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
          title={isSelected ? "Remove from plan selection" : "Select for meal plan"}
        >
          <Pin className={`w-4.5 h-4.5 ${isSelected ? "fill-primary text-primary" : ""}`} />
        </button>

        {onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-2 rounded-full hover:bg-muted transition-colors z-10 tap-highlight-none touch-target text-muted-foreground"
            title="Edit recipe"
          >
            <Pencil className="w-4.5 h-4.5" />
          </button>
        )}

        {onArchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="p-2 rounded-full hover:bg-muted transition-colors z-10 tap-highlight-none touch-target text-muted-foreground"
            title="Archive recipe"
          >
            <Archive className="w-4.5 h-4.5" />
          </button>
        )}
      </div>
    </div>
  </div>
);

export default Recipes;
