/**
 * Pure formatters for the two plan date/meta label strings shown in the
 * Planner sidebar and the Profile "Saved Plans" list. Both pages built these
 * inline with byte-identical logic; this is the single source of truth.
 *
 * NOT a component on purpose — the two call sites wrap line 1 in <p> elements
 * with DIFFERENT classNames (text-xs vs text-sm). Sharing a component would
 * force-merge that styling, which is a behavior change. These return strings;
 * each page keeps its own JSX wrapper.
 */
import { format } from "date-fns";

/** Line 1: "Week of <date>" when the plan has a start_date, else "Created <date>". */
export function formatPlanDateLine(plan: {
  start_date?: string | null;
  created_at: string;
}): string {
  return plan.start_date
    ? `Week of ${format(new Date(plan.start_date + "T00:00:00"), "MMM d, yyyy")}`
    : `Created ${format(new Date(plan.created_at), "MMM d, yyyy")}`;
}

/** Line 2: "<n> meals · created <date> at <time>". */
export function formatPlanMetaLine(plan: {
  mealCount: number;
  created_at: string;
}): string {
  return `${plan.mealCount} meals · created ${format(new Date(plan.created_at), "MMM d, yyyy 'at' h:mmaaa")}`;
}
