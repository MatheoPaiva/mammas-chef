import { useState } from "react";
import { getOrderedDays, getBatchCookDay } from "@/constants/preferences";
import { BATCH_BADGE_CLASSNAME, compactBatchTime } from "@/lib/batchDisplay";
import { STATUS_DOT_CLASSNAME, STATUS_LABEL } from "@/lib/mealStatus";
import type { MealRecipe, PrepBatch, WeekPlan } from "@/types/mealPlan";

interface PrepPipelineProps {
  weekPlan: WeekPlan;
}

const MEAL_TYPE_ORDER: MealRecipe["mealType"][] = ["breakfast", "lunch", "dinner", "snack"];

const DAY_SHORT: Record<string, string> = {
  Sunday: "Sun", Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed",
  Thursday: "Thu", Friday: "Fri", Saturday: "Sat",
};

/** One meal, flattened out of weekPlan.days, tagged with its day name so
 * day-ordering and short-day-label rendering don't need to re-walk the plan. */
export interface LaneItem {
  meal: MealRecipe;
  day: string;
}

/** One batch lane: the batch itself, the meal that created it (null when this
 * is a prep-day batch with no creator meal), and every meal that consumes it,
 * in day order. */
export interface Lane {
  batch: PrepBatch;
  creator: LaneItem | null;
  consumers: LaneItem[];
}

export interface LaneModel {
  lanes: Lane[];
  unbatched: LaneItem[];
  batchCookDay: string;
}

/** Pure builder — partitions every meal in weekPlan into per-batch lanes
 * (creator + day-ordered consumers) plus an unbatched bucket. This is the
 * ONLY layout logic in the Batch Lanes view: no SVG/grid geometry, no DOM
 * measurement, render-free and unit-testable in isolation. */
export function buildLaneModel(weekPlan: WeekPlan): LaneModel {
  const startDay = weekPlan.days[0]?.day ?? "Sunday";
  const orderedDays = getOrderedDays(startDay);
  const batchCookDay = getBatchCookDay(startDay);
  const batches = weekPlan.batches ?? [];

  const dayOrder = new Map(orderedDays.map((day, index) => [day, index]));

  const items: LaneItem[] = [];
  for (const day of weekPlan.days) {
    for (const meal of day.meals ?? []) {
      items.push({ meal, day: day.day });
    }
  }
  items.sort((a, b) => {
    const dayDiff = (dayOrder.get(a.day) ?? 0) - (dayOrder.get(b.day) ?? 0);
    if (dayDiff !== 0) return dayDiff;
    return MEAL_TYPE_ORDER.indexOf(a.meal.mealType) - MEAL_TYPE_ORDER.indexOf(b.meal.mealType);
  });

  const lanes: Lane[] = batches.map((batch) => ({
    batch,
    creator: items.find((item) => item.meal.creates === batch.id) ?? null,
    consumers: items.filter((item) => item.meal.uses?.includes(batch.id)),
  }));

  const unbatched = items.filter((item) => !item.meal.creates && !(item.meal.uses?.length));

  return { lanes, unbatched, batchCookDay };
}

/** Sketch 001 Variant A "Batch Lanes" — one lane card per batch. Containment
 * (the lane card + its "feeds" rail) replaces the shipped grid's SVG connector
 * lines entirely; unrelated meals collapse behind a "Show them" toggle rather
 * than rendering 20+ unrelated chips. Mobile-first: base is a stacked column
 * of consumer cards on a left violet rail, sm:+ restacks into a wrapping row. */
const PrepPipeline = ({ weekPlan }: PrepPipelineProps) => {
  const model = buildLaneModel(weekPlan);
  const [showUnbatched, setShowUnbatched] = useState(false);
  const unbatchedCount = model.unbatched.length;

  return (
    <div className="space-y-4">
      {model.lanes.map((lane) => {
        const { batch, creator, consumers } = lane;
        return (
          <div key={batch.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-md border px-2 py-0.5 text-xs font-bold font-heading ${BATCH_BADGE_CLASSNAME}`}>
                  {batch.id}
                </span>
                {batch.task && (
                  <span className="font-heading font-semibold text-sm text-foreground">{batch.task}</span>
                )}
                {batch.time && (
                  <span className="text-xs font-semibold text-muted-foreground">{compactBatchTime(batch.time)}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {batch.yield && (
                  <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">{batch.yield}</span>
                )}
                {batch.storage && (
                  <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">{batch.storage}</span>
                )}
                {batch.useBy && (
                  <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">{batch.useBy}</span>
                )}
              </div>
            </div>

            <div className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {creator ? (
                <>
                  <span
                    className={`inline-block w-2 h-2 rounded-full mr-1.5 align-middle ${
                      creator.meal.status ? STATUS_DOT_CLASSNAME[creator.meal.status] : "bg-muted-foreground/40"
                    }`}
                  >
                    <span className="sr-only">
                      {creator.meal.status ? STATUS_LABEL[creator.meal.status] : "Status unknown"}
                    </span>
                  </span>
                  Cooked fresh &middot;{" "}
                  <span className="text-foreground font-semibold capitalize">
                    {creator.day} {creator.meal.mealType}
                  </span>
                  {" "}— {creator.meal.title}
                </>
              ) : (
                <>Prep day &middot; {model.batchCookDay}</>
              )}
            </div>

            {consumers.length > 0 && (
              <div className="relative mt-3 pt-3 border-t border-border">
                <span className="absolute -top-2 left-0 bg-card pr-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  feeds
                </span>
                <div className="flex flex-col gap-2.5 border-l-2 border-border pl-3.5 sm:flex-row sm:flex-wrap sm:gap-3 sm:border-l-0 sm:pl-0">
                  {consumers.map((item) => (
                    <div
                      key={item.meal.id}
                      className="rounded-md border border-border bg-background px-3 py-2.5 sm:min-w-[150px] sm:max-w-[220px] sm:flex-1"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            item.meal.status ? STATUS_DOT_CLASSNAME[item.meal.status] : "bg-muted-foreground/40"
                          }`}
                        >
                          <span className="sr-only">
                            {item.meal.status ? STATUS_LABEL[item.meal.status] : "Status unknown"}
                          </span>
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground capitalize">
                          {DAY_SHORT[item.day] ?? item.day.slice(0, 3)} &middot; {item.meal.mealType}
                        </span>
                      </div>
                      <div className="text-sm font-medium leading-snug">{item.meal.title}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {unbatchedCount > 0 && (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground flex flex-wrap items-center gap-3">
          <span>
            {unbatchedCount} meal{unbatchedCount === 1 ? "" : "s"} this week{" "}
            {unbatchedCount === 1 ? "doesn’t" : "don’t"} use a batch — they stay in Calendar and Checklist.
          </span>
          <button
            type="button"
            onClick={() => setShowUnbatched((open) => !open)}
            className="rounded-full border border-border px-3.5 py-1 text-xs font-heading hover:border-primary hover:text-primary transition-colors"
          >
            {showUnbatched ? "Hide them" : "Show them"}
          </button>
          {showUnbatched && (
            <div
              className="w-full mt-2 grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}
            >
              {model.unbatched.map((item) => (
                <div
                  key={item.meal.id}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs opacity-75"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      item.meal.status ? STATUS_DOT_CLASSNAME[item.meal.status] : "bg-muted-foreground/40"
                    }`}
                  >
                    <span className="sr-only">
                      {item.meal.status ? STATUS_LABEL[item.meal.status] : "Status unknown"}
                    </span>
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-shrink-0">
                    {DAY_SHORT[item.day] ?? item.day.slice(0, 3)}
                  </span>
                  <span className="truncate" title={item.meal.title}>{item.meal.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PrepPipeline;
