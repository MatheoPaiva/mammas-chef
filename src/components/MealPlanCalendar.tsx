import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Calendar as CalendarIcon, ArrowLeftRight, Loader2, UtensilsCrossed, RefreshCw, AlertTriangle, ShieldAlert, Refrigerator, Snowflake, Link2, Boxes } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { WeekPlan, MealRecipe, SkipSlots } from "@/types/mealPlan";
import { isSlotSkipped } from "@/types/mealPlan";
import type { CompletenessResult } from "@/lib/planCompleteness";
import {
  STATUS_DOT_CLASSNAME,
  STATUS_COMPACT_LABEL,
  STATUS_COMPACT_TEXT_CLASSNAME,
  extractStorageDuration,
  isFreezerStorage,
} from "@/lib/mealStatus";
import { BATCH_COMPACT_TEXT_CLASSNAME } from "@/lib/batchDisplay";

interface MealPlanCalendarProps {
  weekPlan: WeekPlan;
  skipSlots?: SkipSlots;
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
  completeness?: CompletenessResult | null;
}

const mealTypes = ["breakfast", "lunch", "dinner", "snack"] as const;
const mealLabels: Record<string, string> = {
  breakfast: "BREAKFAST",
  lunch: "LUNCH",
  dinner: "DINNER",
  snack: "SNACK",
};

import { getOrderedDays, ALL_WEEKDAYS } from "@/constants/preferences";

/** Returns a DayOfWeek index (0=Sun..6=Sat) from a weekday name. */
function weekdayIndex(dayName: string): number {
  const idx = ALL_WEEKDAYS.indexOf(dayName as typeof ALL_WEEKDAYS[number]);
  return idx === -1 ? 0 : idx;
}

const MealPlanCalendar = ({
  weekPlan,
  skipSlots,
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
  weekStartDay = "Sunday",
  completeness,
}: MealPlanCalendarProps) => {
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Only allow selecting dates that fall on the user's week start day
  const allowedDayOfWeek = weekdayIndex(weekStartDay);
  const disableNonStartDays = (date: Date) => date.getDay() !== allowedDayOfWeek;

  // Authoritative display order — sort the days by the user's week-start preference
  // here so it's impossible for upstream state (load races, swap mutations,
  // out-of-order DB reads) to display days in the wrong order. Preserve each day's
  // original index so swap/regen callbacks still address the correct entry in the
  // parent's unsorted weekPlan.days array.
  const sortedDays = useMemo(() => {
    const order = getOrderedDays(weekStartDay);
    return weekPlan.days
      .map((day, originalIdx) => ({ day, originalIdx }))
      .sort((a, b) => order.indexOf(a.day.day) - order.indexOf(b.day.day));
  }, [weekPlan.days, weekStartDay]);

  return (
    <div>
      {/* Plan Header — Week Starting + notes */}
      <div className="bg-card rounded-[15px] p-5 md:p-6 shadow-card mb-6">
        <div className="space-y-3 md:space-y-0 md:grid md:grid-cols-2 md:gap-4">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 block">
              Week Starting
            </label>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start text-left font-normal rounded-lg border-border"
                >
                  <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                  {startDate ? `Week of ${format(startDate, "MMM d, yyyy")}` : `Pick a ${weekStartDay}`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div className="px-3 pt-3 pb-1">
                  <p className="text-xs text-muted-foreground">
                    Only {weekStartDay}s are selectable
                  </p>
                </div>
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={(d) => {
                    onStartDateChange(d);
                    setCalendarOpen(false);
                  }}
                  disabled={disableNonStartDays}
                  weekStartsOn={allowedDayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 block">
              Additional Notes
            </label>
            <Input
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              onBlur={onNotesBlur}
              placeholder="Add meal-specific tweaks..."
              className="rounded-lg border-border"
            />
          </div>
        </div>
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="flex items-center gap-2 bg-primary/10 text-primary rounded-lg px-4 py-2.5 mb-4">
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
          <p className="text-sm font-medium">Building your plan — meals appear as they're ready...</p>
        </div>
      )}

      {/* Incomplete plan banner */}
      {!isStreaming && completeness && !completeness.isComplete && (
        <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 mb-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm">
            This plan has <span className="font-semibold">{completeness.totalMissing} missing meal{completeness.totalMissing !== 1 ? "s" : ""}</span>.
            {" "}You can regenerate individual days or swap specific meals.
          </p>
        </div>
      )}

      {/* Day rows */}
      <div className="space-y-5">
        {sortedDays.map(({ day, originalIdx }, sortedIdx) => {
          const mealsByType: Record<string, MealRecipe | undefined> = {};
          (day.meals ?? []).forEach((m) => {
            mealsByType[m.mealType] = m;
          });
          const hasActiveSlot = mealTypes.some((t) => !isSlotSkipped(skipSlots, day.day, t));

          return (
            <motion.div
              key={day.day}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: sortedIdx * 0.04 }}
            >
              {/* Day label + regenerate button */}
              <div className="group border-l-4 border-secondary pl-3 mb-2 flex items-center justify-between">
                <h3 className="font-heading font-bold text-base md:text-lg text-foreground">
                  {day.day}
                  {regeneratingDayIndex === originalIdx && (
                    <Loader2 className="inline-block w-3.5 h-3.5 ml-2 animate-spin text-primary" />
                  )}
                </h3>
                {onRegenerateDay && !isStreaming && hasActiveSlot && (
                  <button
                    onClick={() => !isSwapping && !isRegeneratingDay && onRegenerateDay(originalIdx)}
                    disabled={isSwapping || isRegeneratingDay}
                    className="p-1.5 rounded transition-opacity text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed opacity-100"
                    title={`Regenerate ${day.day}`}
                    aria-label={`Regenerate all meals for ${day.day}`}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Meal cells — 2-col grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border rounded-[15px] overflow-hidden shadow-card">
                {mealTypes.map((type) => {
                  const meal = mealsByType[type];
                  const skipped = isSlotSkipped(skipSlots, day.day, type);

                  if (skipped) {
                    return (
                      <div key={type} className="bg-card">
                        <div className="w-full px-3 py-4 md:px-4 md:py-3 opacity-40">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">
                            {mealLabels[type]}
                          </p>
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <UtensilsCrossed className="w-3.5 h-3.5" />
                            <span className="italic">Skipped</span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const hasStorageHint = (meal?.status === "leftover" || meal?.status === "prep-linked") && !!meal?.storage;
                  const hasBatchUses = (meal?.uses?.length ?? 0) > 0;
                  const hasBatchCreates = !!meal?.creates;
                  const showRow3 = hasStorageHint || hasBatchUses || hasBatchCreates;

                  return (
                    <div key={type} className="relative group bg-card">
                      <button
                        onClick={() => meal && !isStreaming && onSelectRecipe(meal)}
                        disabled={!meal || isStreaming}
                        aria-label={meal ? `View ${type} recipe: ${meal.title}${meal.status ? `, ${STATUS_COMPACT_LABEL[meal.status]}` : ""}${meal.cautionNote ? ", caution" : ""}` : undefined}
                        className="w-full pl-3 pr-11 py-4 md:pl-4 md:py-3 text-left hover:bg-muted/50 active:bg-muted/70 transition-colors disabled:opacity-40 disabled:cursor-default tap-highlight-none active-scale touch-target"
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {mealLabels[type]}
                          </p>
                          {meal?.status && (
                            <span className="flex items-center gap-1">
                              <span className="flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_CLASSNAME[meal.status]}`} />
                                <span className={`text-[10px] font-semibold ${STATUS_COMPACT_TEXT_CLASSNAME[meal.status]}`}>
                                  {STATUS_COMPACT_LABEL[meal.status]}
                                </span>
                              </span>
                              {meal.cautionNote && (
                                <ShieldAlert className="w-3 h-3 text-red-500 dark:text-red-400 ml-1.5" aria-label="Caution" />
                              )}
                            </span>
                          )}
                        </div>
                        <p className={`text-sm font-medium leading-snug ${meal ? "text-foreground" : "text-amber-600 dark:text-amber-400 italic"}`}>
                          {meal?.title ?? "Missing"}
                        </p>
                        {showRow3 && (
                          <div className="flex items-center gap-3 mt-1">
                            {hasStorageHint && (
                              <div className="flex items-center gap-1">
                                {isFreezerStorage(meal.storage)
                                  ? <Snowflake className="w-3 h-3 text-muted-foreground" aria-label="Storage info" />
                                  : <Refrigerator className="w-3 h-3 text-muted-foreground" aria-label="Storage info" />}
                                {extractStorageDuration(meal.storage) && (
                                  <span className="text-[10px] font-semibold text-muted-foreground">
                                    {extractStorageDuration(meal.storage)}
                                  </span>
                                )}
                              </div>
                            )}
                            {(hasBatchUses || hasBatchCreates) && (
                              <div className="flex items-center gap-2">
                                {hasBatchUses && (
                                  <span className={`flex items-center gap-1.5 text-[10px] font-semibold ${BATCH_COMPACT_TEXT_CLASSNAME}`}>
                                    <Link2 className="w-3 h-3" />
                                    {meal.uses.join(",")}
                                  </span>
                                )}
                                {hasBatchCreates && (
                                  <span className={`flex items-center gap-1.5 text-[10px] font-semibold ${BATCH_COMPACT_TEXT_CLASSNAME}`}>
                                    <Boxes className="w-3 h-3" />
                                    {meal.creates}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </button>
                      {meal && onSwapMeal && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isSwapping) onSwapMeal(originalIdx, type);
                          }}
                          disabled={isSwapping}
                          className="absolute top-1/2 -translate-y-1/2 right-1.5 p-2 rounded-md transition-opacity text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed opacity-100"
                          title="Swap meal"
                          aria-label={`Swap ${type} on ${day.day}`}
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}

        {/* Missing-day placeholder cards */}
        {!isStreaming && completeness?.missingDays.map((dayName) => (
          <div key={dayName}>
            <div className="border-l-4 border-amber-400 pl-3 mb-2 flex items-center justify-between">
              <h3 className="font-heading font-bold text-base md:text-lg text-amber-700 dark:text-amber-300">
                {dayName}
              </h3>
            </div>
            <div className="rounded-[15px] border-2 border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20 p-6 text-center shadow-card">
              <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto mb-2" />
              <p className="text-sm text-amber-700 dark:text-amber-300 font-medium mb-3">
                No meals generated for {dayName}
              </p>
              {onRegenerateDay && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRegenerateDay(-1, dayName)}
                  disabled={isSwapping || isRegeneratingDay}
                  className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Regenerate {dayName}
                </Button>
              )}
            </div>
          </div>
        ))}

        {/* Skeleton rows for days still streaming */}
        {isStreaming && weekPlan.days.length < 7 &&
          getOrderedDays(weekPlan.days[0]?.day ?? "Sunday").slice(weekPlan.days.length).map((dayName) => (
            <div key={dayName} className="animate-pulse">
              <div className="border-l-4 border-muted pl-3 mb-2">
                <h3 className="font-heading font-bold text-base md:text-lg text-muted-foreground/50">
                  {dayName}
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border rounded-[15px] overflow-hidden shadow-card">
                {mealTypes.map((type) => (
                  <div key={type} className="bg-card px-3 py-4 md:px-4 md:py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 mb-0.5">
                      {mealLabels[type]}
                    </p>
                    <div className="h-4 w-3/4 bg-muted rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
};

export default MealPlanCalendar;
