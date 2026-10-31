import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, Users, Flame, Dumbbell, Wheat, Droplets, Baby, Activity, Check, Heart, PlusCircle, ShieldAlert, Minus, Plus, ArrowLeftRight, UtensilsCrossed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import type { MealRecipe } from "@/types/mealPlan";
import { ingredientToString } from "@/lib/ingredientParser";
import { STATUS_BADGE_CLASSNAME, STATUS_LABEL, compactMinutes } from "@/lib/mealStatus";
import { BATCH_BADGE_CLASSNAME } from "@/lib/batchDisplay";

const CREATES_LEFTOVER_BADGE_CLASSNAME =
  "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-200";

const MAX_SERVINGS = 12;

interface RecipeDetailModalProps {
  recipe: MealRecipe | null;
  onClose: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onAddToPlan?: () => void;
  showToddlerTips?: boolean;
  showGlucoseTips?: boolean;
  /** True when another meal in the plan links to this recipe via source_meal_id
   * (this meal is the source of a later leftover). Drives the modal-only
   * CREATES LEFTOVER badge. Omitted in library context. */
  isLeftoverSource?: boolean;
  /** Plan context only: renders a servings stepper under the stats. Called with
   * the new count (current ± 1); the caller rescales the recipe. */
  onServingsChange?: (servings: number) => void;
  /** Lower bound for the stepper (e.g. dependents' servings + 1 for a leftover source). */
  minServings?: number;
  /** Plan context only: footer actions above Add to Plan. */
  onSwap?: () => void;
  onSkip?: () => void;
}

const RecipeContent = ({
  recipe,
  onClose,
  isFavorite,
  onToggleFavorite,
  onAddToPlan,
  showToddlerTips = true,
  showGlucoseTips = true,
  isLeftoverSource,
  onServingsChange,
  minServings,
  onSwap,
  onSkip,
}: RecipeDetailModalProps & { recipe: MealRecipe }) => {
  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(new Set());
  const servingsMin = Math.max(1, minServings ?? 1);

  useEffect(() => {
    setCheckedSteps(new Set());
  }, [recipe.id]);

  const toggleStep = (idx: number) => {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 bg-background/90 backdrop-blur-sm px-5 sm:px-6 py-4 border-b border-border flex items-start justify-between z-10">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-heading font-bold text-lg sm:text-xl text-foreground">{recipe.title}</h2>
            {onToggleFavorite && (
              <button onClick={onToggleFavorite} className="p-2 rounded-full hover:bg-muted flex-shrink-0 tap-highlight-none touch-target">
                <Heart className={`w-5 h-5 ${isFavorite ? "text-destructive fill-destructive" : "text-muted-foreground"}`} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {recipe.status && (
              <Badge variant="outline" className={STATUS_BADGE_CLASSNAME[recipe.status]}>
                {STATUS_LABEL[recipe.status]}
              </Badge>
            )}
            {isLeftoverSource && (
              <Badge variant="outline" className={CREATES_LEFTOVER_BADGE_CLASSNAME}>
                CREATES LEFTOVER
              </Badge>
            )}
            {recipe.cautionNote && (
              <Badge variant="destructive">CAUTION</Badge>
            )}
            {(recipe.tags ?? []).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs bg-muted text-muted-foreground rounded-md">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg hover:bg-muted text-muted-foreground tap-highlight-none touch-target">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-5 sm:px-6 py-5 sm:py-6 space-y-5 sm:space-y-6">
        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {[
            { icon: Clock, label: "Time", value: (recipe.cookTime && recipe.totalTime) ? recipe.totalTime : recipe.prepTime },
            { icon: Users, label: "Serves", value: String(recipe.servings) },
            { icon: Flame, label: "Cal", value: `${recipe.calories}` },
            { icon: Dumbbell, label: "Protein", value: `${recipe.protein}g` },
          ].map((stat) => (
            <div key={stat.label} className="bg-card rounded-md p-2.5 sm:p-3 text-center">
              <stat.icon className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
              <div className="font-heading font-semibold text-xs sm:text-sm text-foreground">{stat.value}</div>
              <div className="text-[10px] sm:text-xs text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Servings stepper (plan context only) — mirrors the Profile household stepper */}
        {onServingsChange && (
          recipe.status === "leftover" ? (
            <p className="text-sm text-muted-foreground">
              Portions come from its source meal — change servings there.
            </p>
          ) : (
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-foreground">Serves</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full"
                onClick={() => onServingsChange(recipe.servings - 1)}
                disabled={recipe.servings <= servingsMin}
                aria-label="Decrease servings"
              >
                <Minus className="w-4 h-4" />
              </Button>
              <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">
                {recipe.servings}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full"
                onClick={() => onServingsChange(recipe.servings + 1)}
                disabled={recipe.servings >= MAX_SERVINGS}
                aria-label="Increase servings"
              >
                <Plus className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">people</span>
            </div>
          )
        )}

        {/* Time-breakdown caption */}
        {recipe.cookTime && recipe.totalTime && (
          <p className="text-xs text-muted-foreground">
            Prep {compactMinutes(recipe.prepTime)} • Cook {compactMinutes(recipe.cookTime)} • Total {compactMinutes(recipe.totalTime)}
          </p>
        )}

        {/* Macros bar */}
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Wheat className="w-3.5 h-3.5 text-secondary" /> Carbs: {recipe.carbs}g</span>
          <span className="flex items-center gap-1"><Droplets className="w-3.5 h-3.5 text-accent" /> Fats: {recipe.fats}g</span>
        </div>

        {/* Batch IDs line */}
        {((recipe.uses?.length ?? 0) > 0 || recipe.creates) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {(recipe.uses?.length ?? 0) > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {recipe.status === "leftover" ? "Uses leftover" : "Uses"}
                </span>
                <span className="flex gap-1">
                  {recipe.uses.map((id) => (
                    <Badge key={id} variant="outline" className={BATCH_BADGE_CLASSNAME}>{id}</Badge>
                  ))}
                </span>
              </span>
            )}
            {(recipe.uses?.length ?? 0) > 0 && recipe.creates && <span className="text-muted-foreground">•</span>}
            {recipe.creates && (
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Creates</span>
                <Badge variant="outline" className={BATCH_BADGE_CLASSNAME}>{recipe.creates}</Badge>
              </span>
            )}
          </div>
        )}

        {/* Workflow / Storage lines */}
        {recipe.workflow && <p className="text-sm text-foreground">{recipe.workflow}</p>}
        {recipe.storage && <p className="text-sm text-foreground">{recipe.storage}</p>}

        {/* Caution box */}
        {recipe.cautionNote && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-4 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-heading font-semibold text-sm text-foreground">Caution</span>
              <p className="text-sm text-muted-foreground mt-1">{recipe.cautionNote}</p>
            </div>
          </div>
        )}

        {/* Flavor notes */}
        {recipe.flavorNotes && (
          <p className="text-sm italic text-muted-foreground">{recipe.flavorNotes}</p>
        )}

        {/* Ingredients */}
        <div>
          <h3 className="font-heading font-semibold text-foreground mb-3">Ingredients</h3>
          <ul className="space-y-2">
            {(recipe.ingredients ?? []).map((ing, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-center gap-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                {ingredientToString(ing)}
              </li>
            ))}
          </ul>
        </div>

        {/* Steps */}
        <div>
          <h3 className="font-heading font-semibold text-foreground mb-3">Instructions</h3>
          <ol className="space-y-3">
            {(recipe.steps ?? []).map((step, i) => (
              <li key={i}>
                <button
                  onClick={() => toggleStep(i)}
                  className={`flex items-start gap-3 text-left w-full transition-opacity py-1 tap-highlight-none ${
                    checkedSteps.has(i) ? "opacity-50" : ""
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors touch-target ${
                      checkedSteps.has(i) ? "bg-primary border-primary" : "border-border"
                    }`}
                  >
                    {checkedSteps.has(i) && <Check className="w-4 h-4 text-primary-foreground" />}
                  </span>
                  <span className={`text-sm leading-relaxed ${checkedSteps.has(i) ? "line-through text-muted-foreground" : "text-foreground"}`}>
                    {step}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        {/* Tips */}
        {showToddlerTips && recipe.toddlerTip && (
          <div className="bg-secondary/10 rounded-md p-4 flex items-start gap-3">
            <Baby className="w-5 h-5 text-secondary flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-heading font-semibold text-sm text-foreground">Toddler Tip</span>
              <p className="text-sm text-muted-foreground mt-1">{recipe.toddlerTip}</p>
            </div>
          </div>
        )}

        {showGlucoseTips && recipe.glucoseTip && (
          <div className="bg-accent/20 rounded-md p-4 flex items-start gap-3">
            <Activity className="w-5 h-5 text-accent-foreground flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-heading font-semibold text-sm text-foreground">Glucose Friendly</span>
              <p className="text-sm text-muted-foreground mt-1">{recipe.glucoseTip}</p>
            </div>
          </div>
        )}

        {/* Plan edit actions (plan context only) */}
        {(onSwap || onSkip) && (
          <div className="flex flex-col sm:flex-row gap-2">
            {onSwap && (
              <Button variant="outline" onClick={onSwap} className="w-full sm:flex-1 touch-target">
                <ArrowLeftRight className="w-4 h-4 mr-2" />
                Swap this meal
              </Button>
            )}
            {onSkip && (
              <Button variant="ghost" onClick={onSkip} className="w-full sm:flex-1 touch-target">
                <UtensilsCrossed className="w-4 h-4 mr-2" />
                Not cooking this — skip it
              </Button>
            )}
          </div>
        )}

        {/* Add to Plan Button */}
        {onAddToPlan && (
          <Button
            onClick={onAddToPlan}
            className="w-full gradient-hero text-primary-foreground border-0 font-semibold touch-target active-scale"
          >
            <PlusCircle className="w-4 h-4 mr-2" />
            Add to Meal Plan
          </Button>
        )}
      </div>
    </>
  );
};

const RecipeDetailModal = (props: RecipeDetailModalProps) => {
  const { recipe, onClose } = props;
  const isMobile = useIsMobile();

  // Handle Escape key for desktop modal
  useEffect(() => {
    if (!recipe || isMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [recipe, isMobile, onClose]);

  // Mobile: use vaul drawer for swipe-to-dismiss
  if (isMobile) {
    return (
      <Drawer open={!!recipe} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DrawerContent className="h-[100dvh] flex flex-col">
          <DrawerTitle className="sr-only">{recipe?.title}</DrawerTitle>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {recipe && <RecipeContent {...props} recipe={recipe} />}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: AnimatePresence wraps the conditional so exit animations fire
  return (
    <AnimatePresence>
      {recipe && (
        <motion.div
          key="recipe-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={recipe.title}
          className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-background rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
          >
            <RecipeContent {...props} recipe={recipe} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default RecipeDetailModal;
