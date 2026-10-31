import type { PrepTip, WeekPlan } from "@/types/mealPlan";

interface PrepTimeSavingsInput {
  prepTips: PrepTip[];
  prepDay: string;
  weekPlan?: WeekPlan;
}

interface PrepTimeSavingsEstimate {
  minutes: number;
  taskCount: number;
  capped: boolean;
  basis: "task-times";
}

const DURATION_PATTERN = /(?:~|about|around|approx\.?\s*)?(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m)\b/gi;

function unitToMinutes(unit: string, value: number): number {
  return /^h/i.test(unit) ? value * 60 : value;
}

export function parseDurationMinutes(text: string): number | undefined {
  let total = 0;

  for (const match of text.matchAll(DURATION_PATTERN)) {
    const low = Number.parseFloat(match[1]);
    const high = match[2] ? Number.parseFloat(match[2]) : undefined;
    if (!Number.isFinite(low)) continue;

    const value = high && Number.isFinite(high)
      ? (low + high) / 2
      : low;
    total += unitToMinutes(match[3], value);
  }

  return total > 0 ? Math.round(total) : undefined;
}

function parseActiveMealMinutes(prepTime: string): number | undefined {
  const activeMatch = prepTime.match(/(\d+(?:\.\d+)?)\s*min(?:ute)?s?\s*active/i);
  if (activeMatch) return Math.round(Number.parseFloat(activeMatch[1]));

  const totalMatch = prepTime.match(/(\d+(?:\.\d+)?)\s*min(?:ute)?s?\s*total/i);
  if (totalMatch) return Math.round(Number.parseFloat(totalMatch[1]));

  return parseDurationMinutes(prepTime);
}

function weeklyActiveMinutes(weekPlan: WeekPlan | undefined): number | undefined {
  const minutes = weekPlan?.days
    .flatMap((day) => day.meals)
    .map((meal) => parseActiveMealMinutes(meal.prepTime))
    .filter((value): value is number => typeof value === "number" && value > 0)
    .reduce((sum, value) => sum + value, 0);

  return minutes && minutes > 0 ? minutes : undefined;
}

function roundEstimate(minutes: number): number {
  const increment = minutes >= 60 ? 15 : 5;
  return Math.max(increment, Math.floor(minutes / increment) * increment);
}

export function estimatePrepTimeSavings({
  prepTips,
  prepDay,
  weekPlan,
}: PrepTimeSavingsInput): PrepTimeSavingsEstimate | null {
  const prepDayTasks = prepTips.filter((tip) => tip.day === prepDay);
  const timedPrepTasks = prepDayTasks
    .map((tip) => parseDurationMinutes(tip.tip))
    .filter((minutes): minutes is number => typeof minutes === "number" && minutes > 0);

  const activeMinutes = weeklyActiveMinutes(weekPlan);

  // PREP-06 (D-05): trust ONLY real AI-written per-task durations. With no real
  // task times there is nothing honest to report → estimate is unavailable.
  if (timedPrepTasks.length === 0) return null;

  const rawMinutes = timedPrepTasks.reduce((sum, minutes) => sum + minutes, 0);
  const cappedMinutes = activeMinutes
    ? Math.min(rawMinutes, Math.round(activeMinutes * 0.6))
    : rawMinutes;
  const minutes = roundEstimate(cappedMinutes);

  // PREP-06 (D-06): a sub-30-min/week headline undercuts the trust goal — show
  // "unavailable" instead of a misleadingly trivial figure.
  if (minutes < 30) return null;

  return {
    minutes,
    taskCount: timedPrepTasks.length,
    capped: cappedMinutes < rawMinutes,
    basis: "task-times",
  };
}

export function formatPrepTimeSavings(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourLabel = `${hours} hr`;

  return remainder > 0 ? `${hourLabel} ${remainder} min` : hourLabel;
}
