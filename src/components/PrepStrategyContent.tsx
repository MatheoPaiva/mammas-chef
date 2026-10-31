import { useState } from "react";
import { Package, Clock, Link2, ListChecks, Workflow } from "lucide-react";
import { estimatePrepTimeSavings, formatPrepTimeSavings } from "@/lib/prepTimeSavings";
import { toDisplayFraction } from "@/lib/ingredientParser";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BATCH_BADGE_CLASSNAME, BATCH_COMPACT_TEXT_CLASSNAME, compactBatchTime } from "@/lib/batchDisplay";
import PrepPipeline from "./PrepPipeline";
import type { PrepBatch, PrepTip, WeekPlan } from "@/types/mealPlan";

const NEXT_DAY: Record<string, string> = {
  Monday: "Tuesday", Tuesday: "Wednesday", Wednesday: "Thursday",
  Thursday: "Friday", Friday: "Saturday", Saturday: "Sunday", Sunday: "Monday",
};

// Day a night card preps for: the day of the first meal the tip references (nights
// skip fully-skipped days, so "tomorrow" is often wrong), else the next calendar day.
function prepForDay(t: PrepTip, weekPlan: WeekPlan | undefined): string {
  const refDay = weekPlan?.days.find((d) => (d.meals ?? []).some((m) => t.referenced_meal_ids?.includes(m.id)))?.day;
  return refDay ?? NEXT_DAY[t.day] ?? "TOMORROW";
}

// FRAC-02 (D-09): render decimal quantities as kitchen fractions for tsp / Tbsp /
// cup units only, reusing the existing toDisplayFraction helper (no new fraction
// math). The optional-fraction group `(?:\.\d+)?` + trailing `\b` avoid the
// exponential catastrophic backtracking of a `\d*\.\d*` form, but a global scan
// over a single very long unbroken digit run is still ~O(n^2). Since this runs
// on the client main thread, MAX_TIP_LEN bounds the input (real AI prep tips are
// a sentence — far under the cap). Non-target units (lb, oz, g) and bare numbers
// are left untouched; integers are skipped (their display is identical).
// toDisplayFraction snaps within ±0.02 of a standard fraction, else falls back
// to a one-decimal string.
const TIP_FRACTION_RE = /(\d+(?:\.\d+)?)(\s*)(tsp|tbsp|cups?)\b/gi;
const MAX_TIP_LEN = 2000;

function formatTipFractions(tip: string): string {
  if (!tip || tip.length > MAX_TIP_LEN) return tip;
  return tip.replace(TIP_FRACTION_RE, (match, num: string, ws: string, unit: string) => {
    const value = Number.parseFloat(num);
    if (!Number.isFinite(value) || Number.isInteger(value)) return match;
    return `${toDisplayFraction(value)}${ws}${unit}`;
  });
}

// D-02: the list of meals that consume a batch is never AI-emitted or persisted —
// it is always derived client-side by walking every meal in weekPlan.days and
// matching uses.includes(batch.id). Same shape as Planner.tsx's isLeftoverSource
// backlink derivation (.some()/.filter() over displayPlan.weekPlan.days).
function derivedUsedByForBatch(weekPlan: WeekPlan | undefined, batchId: string): string[] {
  if (!weekPlan) return [];
  const pairs: string[] = [];
  for (const day of weekPlan.days) {
    for (const meal of day.meals ?? []) {
      if (meal.uses?.includes(batchId)) {
        pairs.push(`${day.day} ${meal.mealType}`);
      }
    }
  }
  return pairs;
}

interface PrepStrategyContentProps {
  prepTips: PrepTip[];
  batchCookDay?: string;
  weekPlan?: WeekPlan;
}

const PrepStrategyContent = ({ prepTips, batchCookDay, weekPlan }: PrepStrategyContentProps) => {
  // D-16/D-17: Checklist/Pipeline view toggle. Hidden (not disabled) when the
  // plan has no batches — legacy/batch-less plans never leave "checklist", so
  // their render output stays byte-identical to pre-Phase-17 behavior.
  const [view, setView] = useState<"checklist" | "pipeline">("checklist");
  const batches: PrepBatch[] = weekPlan?.batches ?? [];
  const hasBatches = batches.length > 0;

  // batchCookDay prop is now reliably set by normalizeMealPlan (D-05/D-06);
  // the heuristic below is retained only as a last-resort safety net.
  const effectivePrepDay = batchCookDay
    || weekPlan?.batchCookDay          // secondary: from weekPlan when prop absent
    || (() => {
      const counts: Record<string, number> = {};
      for (const t of prepTips) { counts[t.day] = (counts[t.day] || 0) + 1; }
      const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
      return sorted.length > 0 && sorted[0][1] >= 3 ? sorted[0][0] : "Sunday";
    })();

  const prepDayTasks = prepTips.filter((t) => t.day === effectivePrepDay);
  const nightlyRoutine = prepTips.filter((t) => t.day !== effectivePrepDay);
  const savingsEstimate = estimatePrepTimeSavings({
    prepTips,
    prepDay: effectivePrepDay,
    weekPlan,
  });
  const savingsLabel = savingsEstimate ? formatPrepTimeSavings(savingsEstimate.minutes) : null;
  const savingsDetail = savingsEstimate
    ? `from ${savingsEstimate.taskCount} timed prep task${savingsEstimate.taskCount === 1 ? "" : "s"}`
    : "task times not included";

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="bg-primary/10 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="font-heading font-bold text-xl md:text-2xl text-foreground mb-1">
            Kitchen Intelligence
          </h2>
          <p className="text-muted-foreground text-sm md:text-base max-w-md mb-4 md:mb-0">
            Strategic prep creates a stress-free week. Follow the {effectivePrepDay} prep day tasks and nightly cues below.
          </p>

          {/* Mobile Time Saved Indicator */}
          <div className="md:hidden flex items-center gap-3 bg-background/60 p-3 rounded-xl border border-primary/20 mt-4">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-heading font-bold text-sm text-foreground leading-tight">
                {savingsLabel ? `About ${savingsLabel} saved` : "Estimate unavailable"}
              </p>
              <p className="text-xs text-muted-foreground">{savingsDetail}</p>
            </div>
          </div>
        </div>

        {/* Desktop Time Saved Indicator */}
        <div className="hidden md:block text-right flex-shrink-0">
          <span className="text-xs font-semibold text-primary uppercase tracking-wider">Estimated Time Saved</span>
          <p className="font-heading font-bold text-xl text-foreground leading-tight">
            {savingsLabel ? <>About {savingsLabel}<br />active cooking</> : <>Estimate<br />unavailable</>}
          </p>
          <span className="text-xs text-muted-foreground uppercase">{savingsLabel ? "this week" : "no task times"}</span>
        </div>
      </div>

      {/* Checklist/Pipeline toggle (D-16/D-17) — hidden entirely for batch-less
          plans, never disabled: there is nothing to switch to. */}
      {hasBatches && (
        <Tabs value={view} onValueChange={(v) => setView(v === "pipeline" ? "pipeline" : "checklist")}>
          <TabsList>
            <TabsTrigger value="checklist" className="flex items-center gap-1.5">
              <ListChecks className="w-4 h-4" /> Checklist
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="flex items-center gap-1.5">
              <Workflow className="w-4 h-4" /> Pipeline
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {hasBatches && view === "pipeline" && weekPlan ? (
        <PrepPipeline weekPlan={weekPlan} />
      ) : (
        /* Two-column layout (Checklist view) */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Prep Day Tasks */}
          <div className="bg-card rounded-xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Package className="w-4 h-4 text-primary" />
              </div>
              <h3 className="font-heading font-semibold text-lg text-foreground">{effectivePrepDay} Prep Day</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-5">
              Knock out these tasks once and coast through the week.
            </p>
            <div className="space-y-3">
              {hasBatches
                ? batches.map((batch) => {
                    const usedBy = derivedUsedByForBatch(weekPlan, batch.id);
                    return (
                      <div key={batch.id} className="bg-muted/50 rounded-lg p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" className={BATCH_BADGE_CLASSNAME}>{batch.id}</Badge>
                          {batch.time && (
                            <span className="text-[10px] font-semibold text-muted-foreground">
                              {compactBatchTime(batch.time)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-foreground leading-relaxed">{batch.task}</p>
                        {batch.yield && <p className="text-xs text-muted-foreground">{batch.yield}</p>}
                        {(batch.storage || batch.useBy) && (
                          <p className="text-xs text-muted-foreground">
                            {batch.storage}{batch.useBy ? ` Use by ${batch.useBy}.` : ""}
                          </p>
                        )}
                        {usedBy.length > 0 && (
                          <p className={`text-xs flex items-center gap-1 ${BATCH_COMPACT_TEXT_CLASSNAME}`}>
                            <Link2 className="w-3 h-3 flex-shrink-0" />
                            Used by: {usedBy.join(", ")}
                          </p>
                        )}
                      </div>
                    );
                  })
                : prepDayTasks.map((t, i) => (
                    <div key={i} className="bg-muted/50 rounded-lg p-4 flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <p className="text-sm text-foreground leading-relaxed">{formatTipFractions(t.tip)}</p>
                    </div>
                  ))}
            </div>
          </div>

          {/* Night-Before Routine */}
          <div className="bg-card rounded-xl p-6 shadow-card">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Clock className="w-4 h-4 text-primary" />
              </div>
              <h3 className="font-heading font-semibold text-lg text-foreground">The Night-Before Routine</h3>
            </div>

            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

              <div className="space-y-5">
                {nightlyRoutine.map((t, i) => (
                  <div key={i} className="relative pl-7">
                    {/* Timeline dot */}
                    <div className="absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 border-primary bg-background" />

                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <h4 className="font-heading font-semibold text-sm text-foreground">
                        {t.day} Night
                      </h4>
                      <span className="text-[10px] font-semibold tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
                        PREP FOR {prepForDay(t, weekPlan).toUpperCase()}
                      </span>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-3 ml-0">
                      <p className="text-sm text-muted-foreground leading-relaxed">{formatTipFractions(t.tip)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrepStrategyContent;
