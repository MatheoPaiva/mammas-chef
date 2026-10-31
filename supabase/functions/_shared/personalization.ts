import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeInput } from "./sanitize.ts";

const ALL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface PersonalizationResult {
  prompt: string;
  orderedDays: string[];
  batchCookDay: string;
  allergies: string[];
  householdSize: number;
  dietaryPreferences: string[];
  preferredCuisines: string[];
  toddlerFriendly: boolean;
  glucoseFriendly: boolean;
}

/** Compute ordered days and batch-cook day from a week start preference. */
export function computeWeekDays(weekStartDay?: string): { orderedDays: string[]; batchCookDay: string } {
  const startDay = (typeof weekStartDay === "string" && ALL_DAYS.includes(weekStartDay))
    ? weekStartDay
    : "Sunday";
  const startIdx = ALL_DAYS.indexOf(startDay);
  const orderedDays = [...ALL_DAYS.slice(startIdx), ...ALL_DAYS.slice(0, startIdx)];
  const batchCookDay = ALL_DAYS[(startIdx + 6) % 7];
  return { orderedDays, batchCookDay };
}

/**
 * Fetch the authenticated user's profile and build a personalization block
 * to append to the system prompt. Also returns structured day ordering.
 */
export async function buildPersonalization(
  req: Request,
  opts: { includePrepPlan?: boolean } = {},
): Promise<PersonalizationResult> {
  const defaults: PersonalizationResult = {
    prompt: "",
    ...computeWeekDays(),
    allergies: [],
    householdSize: 2,
    dietaryPreferences: [],
    preferredCuisines: [],
    toddlerFriendly: false,
    glucoseFriendly: false,
  };
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return defaults;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn("Could not verify user token for personalization:", userError?.message);
      return defaults;
    }

    const userId = user.id;
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("household_size, preferred_cuisines, dietary_preferences, allergies, toddler_friendly, glucose_friendly, week_start_day")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.warn("No profile found for personalization:", profileError?.message);
      return defaults;
    }

    const lines: string[] = ["\n\nUSER PREFERENCES (adapt the plan to these):"];

    if (profile.household_size) {
      lines.push(`- Household size: ${profile.household_size} (scale all servings to feed ${profile.household_size} people)`);
    }

    const cuisines: string[] = (
      Array.isArray(profile.preferred_cuisines) && profile.preferred_cuisines.length > 0
        ? profile.preferred_cuisines
        : []
    ).slice(0, 7);
    if (cuisines.length > 0) {
      lines.push(
        `- Cuisine profile: Distribute the following cuisines proportionally across the 7-day meal plan: ${cuisines.join(", ")}. ` +
        `Adapt spices, proteins, and techniques authentic to each cuisine while keeping whole-food ingredients and toddler-friendly execution.`
      );
    }

    if (profile.dietary_preferences?.length) {
      const prefs = profile.dietary_preferences.map((p: unknown) => sanitizeInput(p, 80));
      lines.push(`- Dietary preferences: ${prefs.join(", ")}`);
    }

    if (profile.allergies?.length) {
      const allergies = profile.allergies.map((a: unknown) => sanitizeInput(a, 80));
      lines.push(`- Allergies: CRITICAL — absolutely NO ${allergies.join(", NO ")}`);
    }

    if (profile.toddler_friendly) {
      lines.push("- Toddler-friendly: Yes — ensure soft textures, mild flavors, finger-food options");
    }

    if (profile.glucose_friendly) {
      lines.push("- Glucose-friendly: Yes — favor low-glycemic ingredients, avoid sugar spikes");
    }

    // Week start day preference — drives day ordering and batch-cook day
    const { orderedDays, batchCookDay } = computeWeekDays(profile.week_start_day);

    lines.push(`- Week starts on: ${orderedDays[0]}. The "days" array MUST use this exact order: ${orderedDays.join(", ")}`);
    // swap-meal and regenerate-day only add tips for the replaced meal(s), so the whole-week directive below contradicts their prompt.
    if (opts.includePrepPlan !== false) {
      lines.push(`- Prep day: ${batchCookDay}. Generate 5-8 prep day tasks for ${batchCookDay} — analyze all recipes and identify everything that can be prepped ahead, ordered by impact (highest weeknight time saved first). Each task must include a time estimate, which specific meals it feeds, and portioning/freezing instructions if that component will be used on days 4+ of the week. ${batchCookDay} is ALSO a regular meal day — it MUST have 4 meals like every other day. Nightly prep tips cover the other 6 evenings — each references the NEXT day's specific meals. Include thaw reminders the night before any meal using a frozen prep-day component.`);
    }

    const allergies = Array.isArray(profile.allergies)
      ? profile.allergies.map((a: unknown) => (typeof a === "string" ? a : "")).filter(Boolean)
      : [];
    const dietaryPreferences = Array.isArray(profile.dietary_preferences)
      ? profile.dietary_preferences.map((p: unknown) => (typeof p === "string" ? p : "")).filter(Boolean)
      : [];
    const preferredCuisines = Array.isArray(profile.preferred_cuisines)
      ? profile.preferred_cuisines.map((c: unknown) => (typeof c === "string" ? c : "")).filter(Boolean)
      : [];
    const householdSize = typeof profile.household_size === "number" && profile.household_size > 0
      ? profile.household_size
      : 2;
    const toddlerFriendly = !!profile.toddler_friendly;
    const glucoseFriendly = !!profile.glucose_friendly;

    const prompt = lines.length > 1 ? lines.join("\n") : "";
    return {
      prompt,
      orderedDays,
      batchCookDay,
      allergies,
      householdSize,
      dietaryPreferences,
      preferredCuisines,
      toddlerFriendly,
      glucoseFriendly,
    };
  } catch (e) {
    console.warn("Personalization error (falling back to default prompt):", e);
    return defaults;
  }
}
