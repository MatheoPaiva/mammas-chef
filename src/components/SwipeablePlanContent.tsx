import { useCallback, useEffect, useMemo, useRef } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { GroceryItem, MealPlanResponse, MealRecipe } from "@/types/mealPlan";
import type { CompletenessResult } from "@/lib/planCompleteness";
import { buildShoppingListFromRecipes } from "@/lib/shoppingListBuilder";
import { applyPantryStatus } from "@/lib/groceryUtils";
import MealPlanCalendar from "./MealPlanCalendar";
import PrepStrategyContent from "./PrepStrategyContent";
import ExportContent from "./ExportContent";
import ShoppingListContent from "./ShoppingListContent";

/** Stable empty list — a fresh `[]` per render would defeat the shopping-list memo below. */
const NO_ITEMS: GroceryItem[] = [];

const TAB_KEYS = ["calendar", "shopping", "prep", "export"] as const;
const TAB_LABELS = ["Calendar", "Shopping", "Prep", "Export"];

interface SwipeablePlanContentProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  mealPlan: MealPlanResponse;
  onSelectRecipe: (recipe: MealRecipe) => void;
  onSwapMeal?: (dayIndex: number, mealType: string) => void;
  onRegenerateDay?: (dayIndex: number, dayLabel?: string) => void;
  isSwapping?: boolean;
  isRegeneratingDay?: boolean;
  regeneratingDayIndex?: number | null;
  isStreaming?: boolean;
  streamedDayCount?: number;
  startDate: Date | undefined;
  onStartDateChange: (date: Date | undefined) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  onNotesBlur?: () => void;
  weekStartDay?: string;
  showToddlerTips?: boolean;
  showGlucoseTips?: boolean;
  completeness?: CompletenessResult | null;
  planId?: string;
}

const SwipeablePlanContent = ({
  activeTab,
  onTabChange,
  mealPlan,
  onSelectRecipe,
  onSwapMeal,
  onRegenerateDay,
  isSwapping = false,
  isRegeneratingDay = false,
  regeneratingDayIndex = null,
  isStreaming = false,
  streamedDayCount = 0,
  startDate,
  onStartDateChange,
  notes,
  onNotesChange,
  onNotesBlur,
  weekStartDay,
  showToddlerTips = true,
  showGlucoseTips = true,
  completeness,
  planId,
}: SwipeablePlanContentProps) => {
  const isMobile = useIsMobile();
  const activeIndex = TAB_KEYS.indexOf(activeTab as typeof TAB_KEYS[number]);
  // Swap/regen/skip/servings edits clear shoppingList; derive a local list from the
  // recipes so the Shopping tab is never empty. Save persists the AI-humanized list.
  // Memo is keyed on stable references (not mealPlan itself) so notes typing /
  // renames don't reseed ShoppingListContent's local check/collapse state.
  const persistedList = mealPlan.shoppingList ?? NO_ITEMS;
  const { pantryItems } = mealPlan;
  const days = mealPlan.weekPlan.days;
  const shoppingList = useMemo(() => {
    if (persistedList.length > 0 || isStreaming) return persistedList;
    const recipes = days.flatMap((d) => d.meals.map((m) => ({ ...m, day: d.day })));
    const built = buildShoppingListFromRecipes(recipes);
    return built.length > 0 ? applyPantryStatus(built, pantryItems ?? []) : persistedList;
  }, [persistedList, days, pantryItems, isStreaming]);
  const ShoppingPanel = <ShoppingListContent groceries={shoppingList} planId={planId} />;

  // Canonical prep day — populated by normalizeMealPlan (D-05/D-06) for both new
  // and legacy plans. Read the single source of truth instead of recomputing.
  const batchDay = mealPlan.weekPlan.batchCookDay;

  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: false,
    watchDrag: isMobile,
    startIndex: activeIndex >= 0 ? activeIndex : 0,
  });

  const isUserSwipe = useRef(true);

  // Sync embla → state on swipe
  const onSelect = useCallback(() => {
    if (!emblaApi || !isUserSwipe.current) return;
    const idx = emblaApi.selectedScrollSnap();
    if (TAB_KEYS[idx] && TAB_KEYS[idx] !== activeTab) {
      onTabChange(TAB_KEYS[idx]);
    }
  }, [emblaApi, activeTab, onTabChange]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    return () => { emblaApi.off("select", onSelect); };
  }, [emblaApi, onSelect]);

  // Sync state → embla on programmatic tab change
  useEffect(() => {
    if (!emblaApi) return;
    const idx = TAB_KEYS.indexOf(activeTab as typeof TAB_KEYS[number]);
    if (idx >= 0 && emblaApi.selectedScrollSnap() !== idx) {
      isUserSwipe.current = false;
      emblaApi.scrollTo(idx);
      emblaApi.once("settle", () => { isUserSwipe.current = true; });
    }
  }, [emblaApi, activeTab]);

  if (!isMobile) {
    // Desktop: render active tab content directly (no swipe)
    return (
      <div>
        {activeTab === "calendar" && (
          <MealPlanCalendar weekPlan={mealPlan.weekPlan} skipSlots={mealPlan.skipSlots} onSelectRecipe={onSelectRecipe} onSwapMeal={onSwapMeal} onRegenerateDay={onRegenerateDay} isSwapping={isSwapping} isRegeneratingDay={isRegeneratingDay} regeneratingDayIndex={regeneratingDayIndex} isStreaming={isStreaming} streamedDayCount={streamedDayCount} startDate={startDate} onStartDateChange={onStartDateChange} notes={notes} onNotesChange={onNotesChange} onNotesBlur={onNotesBlur} weekStartDay={weekStartDay} completeness={completeness} />
        )}
        {activeTab === "shopping" && ShoppingPanel}
        {activeTab === "prep" && (mealPlan.prepTips?.length > 0 ? <PrepStrategyContent prepTips={mealPlan.prepTips} batchCookDay={batchDay} weekPlan={mealPlan.weekPlan} /> : <p className="text-muted-foreground text-center py-12">No prep tips for this plan.</p>)}
        {activeTab === "export" && <ExportContent mealPlan={mealPlan} startDate={startDate} prepTips={mealPlan.prepTips} showToddlerTips={showToddlerTips} showGlucoseTips={showGlucoseTips} />}
      </div>
    );
  }

  return (
    <div>
      {/* Tab indicator strip */}
      <div className="flex items-center gap-1 mb-4 px-1">
        {TAB_KEYS.map((key, i) => (
          <button
            key={key}
            onClick={() => onTabChange(key)}
            className="flex-1 flex flex-col items-center gap-1 tap-highlight-none py-1 touch-target"
          >
            <span className={`text-[10px] uppercase tracking-wider font-semibold transition-colors ${
              activeTab === key ? "text-primary" : "text-muted-foreground"
            }`}>
              {TAB_LABELS[i]}
            </span>
            <div className={`h-0.5 w-full rounded-full transition-colors ${
              activeTab === key ? "bg-primary" : "bg-transparent"
            }`} />
          </button>
        ))}
      </div>

      {/* Swipeable content */}
      <div ref={emblaRef} className="overflow-hidden -mx-6">
        <div className="flex">
          <div className="flex-[0_0_100%] min-w-0 px-6">
            <MealPlanCalendar weekPlan={mealPlan.weekPlan} skipSlots={mealPlan.skipSlots} onSelectRecipe={onSelectRecipe} onSwapMeal={onSwapMeal} onRegenerateDay={onRegenerateDay} isSwapping={isSwapping} isRegeneratingDay={isRegeneratingDay} regeneratingDayIndex={regeneratingDayIndex} isStreaming={isStreaming} streamedDayCount={streamedDayCount} startDate={startDate} onStartDateChange={onStartDateChange} notes={notes} onNotesChange={onNotesChange} onNotesBlur={onNotesBlur} weekStartDay={weekStartDay} completeness={completeness} />
          </div>
          <div className="flex-[0_0_100%] min-w-0 px-6">
            {ShoppingPanel}
          </div>
          <div className="flex-[0_0_100%] min-w-0 px-6">
            {mealPlan.prepTips && mealPlan.prepTips.length > 0 ? (
              <PrepStrategyContent prepTips={mealPlan.prepTips} batchCookDay={batchDay} weekPlan={mealPlan.weekPlan} />
            ) : (
              <p className="text-muted-foreground text-center py-12">No prep tips for this plan.</p>
            )}
          </div>
          <div className="flex-[0_0_100%] min-w-0 px-6">
            <ExportContent mealPlan={mealPlan} startDate={startDate} prepTips={mealPlan.prepTips} showToddlerTips={showToddlerTips} showGlucoseTips={showGlucoseTips} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SwipeablePlanContent;
