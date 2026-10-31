/**
 * exportUtils.ts — ICS / CSV / PDF exporters for meal plans.
 *
 * NOTE (Phase 04-shopping-list-quality, Plan 03): This module does NOT render
 * the aggregated shopping list today — it only emits per-meal ingredient lines
 * via `ingredientToString` (recipe-level, not shopping-list-level). If a future
 * export path renders `GroceryItem[]` (e.g., a shopping-list PDF or CSV), it
 * MUST go through `formatGroceryLine` from `@/lib/groceryDisplay` so spacing
 * and the "(check pantry)" suffix stay consistent with the in-app DOM render
 * and copy-to-clipboard output.
 */
import * as Sentry from "@sentry/react";
import type { MealPlanResponse, PrepTip } from "@/types/mealPlan";
import { isSlotSkipped } from "@/types/mealPlan";
import { ingredientToString } from "@/lib/ingredientParser";
import { addDays, format, startOfWeek } from "date-fns";
import html2pdf from "html2pdf.js";

const DAY_MAP: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

const MEAL_TIMES: Record<string, { hour: number; min: number }> = {
  breakfast: { hour: 8, min: 0 },
  lunch: { hour: 12, min: 0 },
  dinner: { hour: 18, min: 0 },
  snack: { hour: 15, min: 0 },
};

function icsDate(d: Date): string {
  return format(d, "yyyyMMdd'T'HHmmss");
}

function escapeICS(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}@mealplan`;
}

export function generateICS(
  mealPlan: MealPlanResponse,
  startDate?: Date,
  prepTips?: PrepTip[]
): string {
  // Derive the plan's start day from the first day in the plan
  const planStartDay = mealPlan.weekPlan.days[0]?.day ?? "Sunday";
  const planStartDayIndex = DAY_MAP[planStartDay] ?? 0;

  // Anchor to the start of the plan's week
  const anchor = startDate
    ? startOfWeek(startDate, { weekStartsOn: planStartDayIndex as 0 | 1 | 2 | 3 | 4 | 5 | 6 })
    : startOfWeek(addDays(new Date(), 7), { weekStartsOn: planStartDayIndex as 0 | 1 | 2 | 3 | 4 | 5 | 6 });

  const events: string[] = [];

  // Canonical prep day from the plan (edge-authoritative after Phase 11, D-06).
  // Fallback: first day of the plan (same behavior as before for legacy plans
  // without batchCookDay — the normalizer populates it on read, so this is defensive).
  const prepDay = mealPlan.weekPlan.batchCookDay ?? planStartDay;
  const prepDayOffset = ((DAY_MAP[prepDay] ?? 0) - planStartDayIndex + 7) % 7;

  // 1. Prep Day event
  const prepStart = addDays(anchor, prepDayOffset);
  prepStart.setHours(14, 0, 0, 0);
  const prepEnd = addDays(anchor, prepDayOffset);
  prepEnd.setHours(16, 0, 0, 0);

  const prepDesc = prepTips?.length
    ? `Weekly Prep\n\n${prepTips.map((t, i) => `${i + 1}. ${t.day}: ${t.tip}`).join("\n")}`
    : "Prep session for the week ahead.";

  events.push(
    `BEGIN:VEVENT\r\nUID:${uid()}\r\nDTSTART:${icsDate(prepStart)}\r\nDTEND:${icsDate(prepEnd)}\r\nSUMMARY:${escapeICS(`${prepDay} Meal Prep`)}\r\nDESCRIPTION:${escapeICS(prepDesc)}\r\nEND:VEVENT`
  );

  // 2. Daily Meal Events
  for (const day of mealPlan.weekPlan.days) {
    const dayOffset = ((DAY_MAP[day.day] ?? 0) - planStartDayIndex + 7) % 7;
    const dayDate = addDays(anchor, dayOffset);

    for (const meal of day.meals) {
      const time = MEAL_TIMES[meal.mealType] ?? { hour: 12, min: 0 };
      const mealStart = new Date(dayDate);
      mealStart.setHours(time.hour, time.min, 0, 0);
      const mealEnd = new Date(mealStart);
      mealEnd.setMinutes(mealEnd.getMinutes() + 45);

      const desc = [
        `Prep: ${meal.prepTime}`,
        `Servings: ${meal.servings}`,
        `Calories: ${meal.calories} | P: ${meal.protein}g | C: ${meal.carbs}g | F: ${meal.fats}g`,
        "",
        "Ingredients:",
        ...meal.ingredients.map((ing) => `• ${ingredientToString(ing)}`),
      ].join("\n");

      events.push(
        `BEGIN:VEVENT\r\nUID:${uid()}\r\nDTSTART:${icsDate(mealStart)}\r\nDTEND:${icsDate(mealEnd)}\r\nSUMMARY:${escapeICS(meal.title)}\r\nDESCRIPTION:${escapeICS(desc)}\r\nEND:VEVENT`
      );
    }

    // 3. Nightly Chef Routine (prep for the next day)
    const nextDayAbsIndex = (DAY_MAP[day.day]! + 1) % 7;
    const nextDay = mealPlan.weekPlan.days.find(
      (d) => DAY_MAP[d.day] === nextDayAbsIndex
    );
    if (nextDay) {
      const nightStart = new Date(dayDate);
      nightStart.setHours(20, 0, 0, 0);
      const nightEnd = new Date(dayDate);
      nightEnd.setHours(20, 30, 0, 0);

      const tasks = nextDay.meals.map(
        (m) => `• Prep for ${m.mealType}: ${m.title} (${m.prepTime})`
      );
      const nightDesc = `Prep for ${nextDay.day}\n\n${tasks.join("\n")}`;

      events.push(
        `BEGIN:VEVENT\r\nUID:${uid()}\r\nDTSTART:${icsDate(nightStart)}\r\nDTEND:${icsDate(nightEnd)}\r\nSUMMARY:${escapeICS(`Chef Routine – Prep for ${nextDay.day}`)}\r\nDESCRIPTION:${escapeICS(nightDesc)}\r\nEND:VEVENT`
      );
    }
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MealPlan//EN",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function generateCSV(
  mealPlan: MealPlanResponse,
  options?: { showToddlerTips?: boolean; showGlucoseTips?: boolean }
): string {
  const showToddler = options?.showToddlerTips ?? true;
  const showGlucose = options?.showGlucoseTips ?? true;

  const headers = [
    "Day", "Meal Type", "Title", "Prep Time", "Calories",
    "Protein (g)", "Carbs (g)", "Fats (g)", "Ingredients",
    ...(showToddler ? ["Toddler Tip"] : []),
    ...(showGlucose ? ["Glucose Tip"] : []),
  ];

  const rows = mealPlan.weekPlan.days.flatMap((day) =>
    day.meals.map((meal) => [
      day.day,
      meal.mealType,
      meal.title,
      meal.prepTime,
      String(meal.calories),
      String(meal.protein),
      String(meal.carbs),
      String(meal.fats),
      meal.ingredients.map(ingredientToString).join("; "),
      ...(showToddler ? [meal.toddlerTip ?? ""] : []),
      ...(showGlucose ? [meal.glucoseTip ?? ""] : []),
    ])
  );

  return [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ].join("\n");
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPdfHtml(
  mealPlan: MealPlanResponse,
  startDate?: Date,
  options?: { showToddlerTips?: boolean; showGlucoseTips?: boolean }
): string {
  const showToddler = options?.showToddlerTips ?? true;
  const showGlucose = options?.showGlucoseTips ?? true;
  const { weekPlan, prepTips, skipSlots } = mealPlan;
  const formattedDate = startDate ? format(startDate, "MM/dd/yyyy") : undefined;
  const MEAL_TYPES_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const;

  const mealBlocks = weekPlan.days
    .map((day) => {
      // Render skipped slots as light placeholders
      const mealsByType = new Map(day.meals.map((m) => [m.mealType, m]));
      const skippedHtml = MEAL_TYPES_ORDER
        .filter((mt) => !mealsByType.has(mt) && isSlotSkipped(skipSlots, day.day, mt))
        .map((mt) => `<div class="meal" style="opacity:0.4;"><h3>${escapeHtml(mt.toUpperCase())}: Skipped</h3></div>`)
        .join("");

      const meals = day.meals
        .map((m) => {
          const ingredientsList = m.ingredients
            .map((i) => `<li>${escapeHtml(ingredientToString(i))}</li>`)
            .join("");
          const stepsList = m.steps
            .map((s, idx) => `<li><strong>Step ${idx + 1}:</strong> ${escapeHtml(s)}</li>`)
            .join("");
          const flavorNote = m.flavorNotes
            ? `<p class="tip" style="font-style:italic;color:#5C4A2F;">🌿 ${escapeHtml(m.flavorNotes)}</p>`
            : "";
          const tips = [
            showToddler && m.toddlerTip ? `<p class="tip">🍼 <strong>Toddler Tip:</strong> ${escapeHtml(m.toddlerTip)}</p>` : "",
            showGlucose && m.glucoseTip ? `<p class="tip">🩸 <strong>Glucose Tip:</strong> ${escapeHtml(m.glucoseTip)}</p>` : "",
          ].join("");
          const tags = m.tags.length
            ? `<p class="tags">${m.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ")}</p>`
            : "";

          return `
            <div class="meal">
              <h3>${escapeHtml(m.mealType.toUpperCase())}: ${escapeHtml(m.title)}</h3>
              <p class="meta">Prep: ${escapeHtml(m.prepTime)} · Servings: ${m.servings} · ${m.calories} cal · P: ${m.protein}g · C: ${m.carbs}g · F: ${m.fats}g</p>
              ${tags}
              <div class="two-col">
                <div>
                  <h4>Ingredients</h4>
                  <ul>${ingredientsList}</ul>
                </div>
                <div>
                  <h4>Method</h4>
                  <ol>${stepsList}</ol>
                </div>
              </div>
              ${flavorNote}
              ${tips}
            </div>`;
        })
        .join("");

      return `
        <div class="day-section">
          <h2>${escapeHtml(day.day)}</h2>
          <hr/>
          ${meals}${skippedHtml}
        </div>`;
    })
    .join("");

  const prepSection =
    prepTips.length > 0
      ? `<div class="prep-section">
           <h2>Prep Strategy</h2>
           <hr/>
           <ol>${prepTips.map((t) => {
             const text = `${t.day}: ${t.tip}`;
             return `<li>${escapeHtml(text)}</li>`;
           }).join("")}</ol>
         </div>`
      : "";

  return `
<div style="font-family: 'Source Sans 3', 'Segoe UI', sans-serif; color: #2c2c2c; font-size: 11pt; line-height: 1.5; padding: 0.3in;">
  <style>
    .header { text-align: center; margin-bottom: 28px; padding-bottom: 16px; border-bottom: 3px double #8B7355; }
    .header h1 { font-family: Georgia, serif; font-size: 26pt; color: #5C4A2F; margin-bottom: 4px; }
    .header .subtitle { font-size: 10pt; color: #888; }
    .day-section { margin-bottom: 20px; }
    .day-section h2 { font-family: Georgia, serif; font-size: 16pt; color: #5C4A2F; margin-bottom: 4px; }
    .day-section hr { border: none; border-top: 1.5px solid #ccc; margin-bottom: 14px; }
    .meal { margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px dashed #ddd; page-break-inside: avoid; break-inside: avoid; }
    .meal:last-child { border-bottom: none; }
    .meal h3 { font-size: 12pt; font-weight: 700; color: #3a3a3a; margin-bottom: 2px; }
    .meal .meta { font-size: 9pt; color: #777; margin-bottom: 6px; }
    .meal .tags { margin-bottom: 6px; }
    .meal .tag { display: inline-block; background: #f0ebe3; color: #7a6744; font-size: 8pt; padding: 1px 8px; border-radius: 10px; margin-right: 4px; }
    .two-col { display: flex; gap: 24px; margin-top: 6px; }
    .two-col > div { flex: 1; }
    .two-col h4 { font-size: 10pt; font-weight: 700; margin-bottom: 4px; color: #5C4A2F; }
    .two-col ul, .two-col ol { padding-left: 18px; font-size: 10pt; }
    .two-col li { margin-bottom: 2px; }
    .tip { font-size: 9.5pt; font-style: italic; color: #666; margin-top: 6px; }
    .prep-section { margin-top: 20px; }
    .prep-section h2 { font-family: Georgia, serif; font-size: 16pt; color: #5C4A2F; margin-bottom: 4px; }
    .prep-section hr { border: none; border-top: 1.5px solid #ccc; margin-bottom: 14px; }
    .prep-section ol { padding-left: 20px; font-size: 10.5pt; }
    .prep-section li { margin-bottom: 6px; }
  </style>
  <div class="header">
    <h1>${escapeHtml(weekPlan.title)}</h1>
    <p class="subtitle">${weekPlan.days.length} days${formattedDate ? ` · Starting ${escapeHtml(formattedDate)}` : ""}</p>
  </div>
  ${mealBlocks}
  ${prepSection}
</div>`;
}

export async function generatePDF(
  mealPlan: MealPlanResponse,
  startDate?: Date,
  options?: { showToddlerTips?: boolean; showGlucoseTips?: boolean },
): Promise<void> {
  // Validate meal plan has content before attempting PDF generation
  const dayCount = mealPlan.weekPlan?.days?.length ?? 0;
  const mealCount = mealPlan.weekPlan?.days?.reduce((sum, d) => sum + (d.meals?.length ?? 0), 0) ?? 0;
  if (dayCount === 0 || mealCount === 0) {
    Sentry.captureMessage("PDF export attempted with empty meal plan", {
      level: "warning",
      tags: { feature: "export", action: "pdf_empty_plan" },
      extra: { dayCount, mealCount, title: mealPlan.weekPlan?.title },
    });
  }

  const htmlContent = buildPdfHtml(mealPlan, startDate, options);

  // Validate HTML content is not empty
  if (!htmlContent || htmlContent.trim().length < 100) {
    Sentry.captureMessage("PDF HTML content is empty or too short", {
      level: "error",
      tags: { feature: "export", action: "pdf_empty_html" },
      extra: { htmlLength: htmlContent?.length ?? 0, dayCount, mealCount },
    });
  }

  await html2pdf()
    .set({
      margin: [0.3, 0.3, 0.3, 0.3],
      filename: "meal-plan.pdf",
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, width: 816 },
      jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"], avoid: [".meal", ".day-section"] },
    })
    .from(htmlContent, "string")
    .save();
}
