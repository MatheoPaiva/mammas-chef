/**
 * Prep-tip merge for swap-meal and regenerate-day (261007-slz P1).
 *
 * The model used to rewrite the whole week's prep tips blind to skipped slots:
 * id-less tips that invented skipped lunches, misdated meals and deleted valid
 * prep. Now the model writes 0-2 tips about the NEW meal(s) only (newPrepTips),
 * the edge keeps the rest of the week's plan verbatim, and an empty delta means
 * "no new tips" — never a wipe. Pure module, no imports.
 */

export interface PrepTip {
  id?: string;
  day: string;
  tip: string;
  referenced_meal_ids?: string[];
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];

const isString = (v: unknown): v is string => typeof v === "string";

/**
 * Echo back the client's current tips minus the ones that are ONLY about the
 * replaced meal(s). A mixed-ref tip stays (it still serves other meals) and so
 * does a ref-less legacy tip. Known fields are rebuilt so nothing else the
 * client sent round-trips; tip text is never truncated or sanitized (it is the
 * user's own plan).
 */
export function keepUnrelatedPrepTips(current: unknown, replacedIds: string[]): PrepTip[] {
  if (!Array.isArray(current)) return [];
  const replaced = new Set(replacedIds);
  const kept: PrepTip[] = [];
  for (const raw of current) {
    if (!raw || typeof raw !== "object") continue;
    const { id, day, tip, referenced_meal_ids: rawRefs } = raw as Record<string, unknown>;
    if (!isString(day) || !isString(tip)) continue;
    const refs = Array.isArray(rawRefs) ? rawRefs.filter(isString) : undefined;
    // ponytail: ref-less legacy tips are kept verbatim; add a title-match prune if pre-Phase-12 plans matter
    if (refs && refs.length > 0 && refs.every((r) => replaced.has(r))) continue;
    kept.push({
      ...(isString(id) ? { id } : {}),
      day,
      tip,
      ...(refs ? { referenced_meal_ids: refs } : {}),
    });
  }
  return kept;
}

/**
 * The night a new meal's night-before tip belongs on: the previous active cook
 * night (mirror of generate-meal-plan D-08, where nightlyDays = orderedDays
 * minus the prep day minus fully-skipped days, and the tip on nightlyDays[i]
 * preps nightlyDays[i+1]). The week's first day is prepped on the prep day.
 * Without skipSlots (older clients) this degrades to calendar adjacency.
 */
export function nightBeforeDay(
  day: string,
  orderedDays: string[],
  prepDay: string,
  skipSlots?: unknown,
): string {
  const skips = skipSlots && typeof skipSlots === "object" && !Array.isArray(skipSlots)
    ? skipSlots as Record<string, unknown>
    : {};
  const fullySkipped = (d: string) => MEAL_TYPES.every((t) => skips[`${d}:${t}`] === true);
  const nights = orderedDays.filter((d) => d === day || (d !== prepDay && !fullySkipped(d)));
  const i = nights.indexOf(day);
  return i > 0 ? nights[i - 1] : prepDay;
}

/**
 * Append the model's delta (at most one prep-day task and one night-before tip)
 * to the kept tips. The SERVER assigns the days (that is what stops misdating)
 * and tags the tips with the new meal ids. Anything that is not a non-blank
 * string under prepDayTask / nightBeforeTip is ignored, so a missing or
 * malformed delta returns the kept tips. The result is stably sorted into week
 * order (prep day first) so the Night-Before timeline stays chronological.
 */
export function mergePrepTipDelta(
  kept: PrepTip[],
  delta: unknown,
  ctx: { prepDay: string; nightDay: string; orderedDays: string[]; tagIds: string[]; idPrefix: string },
): PrepTip[] {
  const d = delta && typeof delta === "object" && !Array.isArray(delta)
    ? delta as Record<string, unknown>
    : {};
  const added: PrepTip[] = [];
  const add = (day: string, text: unknown) => {
    if (!isString(text) || !text.trim()) return;
    added.push({
      id: `${ctx.idPrefix}-${added.length + 1}`,
      day,
      tip: text.trim(),
      ...(ctx.tagIds.length > 0 ? { referenced_meal_ids: [...ctx.tagIds] } : {}),
    });
  };
  add(ctx.prepDay, d.prepDayTask);
  add(ctx.nightDay, d.nightBeforeTip);

  const rank = (t: PrepTip) => {
    if (t.day === ctx.prepDay) return 0;
    const i = ctx.orderedDays.indexOf(t.day);
    return i < 0 ? ctx.orderedDays.length + 1 : i + 1;
  };
  return [...kept, ...added].sort((a, b) => rank(a) - rank(b));
}
