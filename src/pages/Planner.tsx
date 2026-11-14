import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Save, Calendar, Trash2, Pencil } from "lucide-react";
import ChefLoader from "@/components/ChefLoader";
import { useStreamActivity } from "@/hooks/useStreamActivity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import RecipeDetailModal from "@/components/RecipeDetailModal";
import PlanTabs from "@/components/PlanTabs";
import PlanBottomNav from "@/components/PlanBottomNav";
import SwipeablePlanContent from "@/components/SwipeablePlanContent";
import EditablePlanTitle from "@/components/EditablePlanTitle";
import MealSwapDrawer from "@/components/MealSwapDrawer";
import DayRegenerationDrawer from "@/components/DayRegenerationDrawer";
import * as Sentry from "@sentry/react";
import { captureUnlessRateLimit } from "@/lib/sentryExpected";
import { generateAndValidateMealPlan } from "@/services/mealPlanService";
import { streamMealSwap } from "@/services/mealSwapService";
import { streamDayRegeneration } from "@/services/dayRegenerationService";
import { saveMealPlan, loadMealPlan, deleteMealPlan, updateMealPlanStartDate, updateMealPlanNotes, renameMealPlan } from "@/services/mealPlanDbService";
import { listSavedPlans, type SavedPlanSummary } from "@/services/savedPlansService";
import { generateShoppingList } from "@/services/shoppingListService";
import { supabase } from "@/integrations/supabase/client";
import { parseSwapResponse, parseDayRegenerationResponse, normalizeMealPlan } from "@/lib/mealPlanParser";
import { scaleRecipeServings, skipMealInPlan } from "@/lib/planEdits";
import { format, parseISO } from "date-fns";
import { getNextStartDate, getOrderedDays } from "@/constants/preferences";
import { parse as parsePartialJson, Allow } from "partial-json";
import PlannerV2Setup, { type PlannerV2Job } from "@/components/planner-v2/PlannerV2Setup";
import { checkPlanCompleteness } from "@/lib/planCompleteness";
import { formatPlanDateLine, formatPlanMetaLine } from "@/lib/planMeta";
import {
  buildSingleMealSkipSlots,
  buildWeekSkipSlots,
  countActiveSlots,
  DEFAULT_INCLUDED_MEALS,
  resolveWhenDay,
  type PlannerV2MealType,
} from "@/lib/plannerV2Slots";
import { isSlotSkipped } from "@/types/mealPlan";
import type { MealPlanResponse, MealRecipe, DayPlan } from "@/types/mealPlan";
import {
  sortDays,
  mergePinnedStubs,
  finalizeGeneratedPlan,
  allergenFlaggedMeals,
  countMissingMeals,
  applyPlanEdit,
  buildSwapRequest,
  computeSwapEdit,
  buildDayRegenRequest,
  computeDayRegenEdit,
} from "@/services/planWorkflow";

function blurActiveElement() {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/** Index of the day holding `meal` — object identity first, id as fallback. */
function findMealDayIndex(days: DayPlan[], meal: MealRecipe): number {
  const byIdentity = days.findIndex((d) => d.meals.includes(meal));
  return byIdentity >= 0 ? byIdentity : days.findIndex((d) => d.meals.some((m) => m.id === meal.id));
}

// ChefLoader caption verbs — mirrors mock-spinner-lab.html's VERBS (line
// 315), cycled by meal count so the caption reads like a real kitchen status
// ("Simmering Thursday's lunch · day 4 of 7") rather than a raw percentage.
const GENERATION_CAPTION_VERBS = ["Sketching", "Simmering", "Whisking", "Plating", "Seasoning", "Tasting"];

/** Derive the ChefLoader caption from the in-progress streamed plan. */
function deriveGenerationCaption(streamingPlan: MealPlanResponse | null): string {
  const days = streamingPlan?.weekPlan?.days ?? [];
  const mealsDone = days.reduce((n, d) => n + (d.meals?.length ?? 0), 0);
  const daysDone = days.length;
  if (mealsDone === 0) return "Prepping the counter · usually under a minute";
  const lastDay = days[daysDone - 1];
  const lastMeal = lastDay?.meals?.[lastDay.meals.length - 1];
  if (!lastDay || !lastMeal) return "Prepping the counter · usually under a minute";
  const verb = GENERATION_CAPTION_VERBS[(mealsDone - 1) % GENERATION_CAPTION_VERBS.length];
  return `${verb} ${lastDay.day}'s ${lastMeal.mealType} · day ${daysDone} of 7`;
}

const Planner = () => {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [mealPlan, setMealPlan] = useState<MealPlanResponse | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<MealRecipe | null>(null);
  const [activeTab, setActiveTab] = useState("calendar");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const promptRef = useRef<HTMLDivElement>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const notesSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedNotesRef = useRef("");
  // The saved plan currently in memory: the in-place resave target. Set from the user's
  // own load or save, cleared on new generation / New Plan / the no-?plan reset / deleting
  // the open plan. Never read from the URL.
  const savedPlanIdRef = useRef<string | null>(null);
  // isSaved mirrored for the background shopping-list phase (synced in an effect below).
  const isSavedRef = useRef(false);
  // Bumped by every save; lets a slow shopping-list phase tell it was superseded.
  const saveSeqRef = useRef(0);
  const { toast } = useToast();
  const { user, session } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const currentPlanId = searchParams.get("plan");
  const [savedPlans, setSavedPlans] = useState<SavedPlanSummary[]>([]);
  // Inline-rename state for the saved-plans sidebar.
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [draftPlanTitle, setDraftPlanTitle] = useState("");
  const [pinnedRecipes, setPinnedRecipes] = useState<MealRecipe[]>(() => {
    return location.state?.pinnedRecipes || [];
  });
  const [showOverlay, setShowOverlay] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  // Shared across generation, swap, and day-regen — only one streaming op
  // runs at a time, so a single instance is safe to reuse across all three.
  const streamActivity = useStreamActivity();
  const [swapTarget, setSwapTarget] = useState<{ dayIndex: number; mealType: string } | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [dayRegenTarget, setDayRegenTarget] = useState<{ dayIndex: number; dayLabel?: string } | null>(null);
  const [isRegeneratingDay, setIsRegeneratingDay] = useState(false);
  const [streamingPlan, setStreamingPlan] = useState<MealPlanResponse | null>(null);
  const [weekStartDay, setWeekStartDay] = useState<string | undefined>(undefined);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [job, setJob] = useState<PlannerV2Job>("pick");
  const [includedMeals, setIncludedMeals] = useState<PlannerV2MealType[]>(DEFAULT_INCLUDED_MEALS);
  const [skippedDays, setSkippedDays] = useState<string[]>([]);
  const [oneMealType, setOneMealType] = useState<PlannerV2MealType>("dinner");
  const [oneMealWhen, setOneMealWhen] = useState("today");
  // One gate for every plan edit (swap, regen, skip, servings, save, rename): a plan being
  // generated, saved or reloaded swaps in new row ids, so an edit then is discarded.
  const planBusy = isGenerating || isSwapping || isRegeneratingDay || isSaving || loadingPlan;
  const orderedDays = useMemo(() => getOrderedDays(weekStartDay ?? "Sunday"), [weekStartDay]);
  const skipSlots = useMemo(() => {
    if (job === "one-meal") {
      return buildSingleMealSkipSlots(orderedDays, resolveWhenDay(oneMealWhen), oneMealType);
    }
    return buildWeekSkipSlots(orderedDays, includedMeals, skippedDays);
  }, [job, orderedDays, includedMeals, skippedDays, oneMealType, oneMealWhen]);
  const mealCount = useMemo(() => countActiveSlots(orderedDays, skipSlots), [orderedDays, skipSlots]);
  const [showToddlerTips, setShowToddlerTips] = useState(false);
  const [showGlucoseTips, setShowGlucoseTips] = useState(false);
  const [profileSummary, setProfileSummary] = useState("");
  const streamingPlanRef = useRef<MealPlanResponse | null>(null);
  const lastParseTime = useRef(0);
  // Trailing-edge partner to the 400ms parse throttle: real SSE can deliver
  // the whole plan in one sub-400ms burst, which the leading-edge throttle
  // alone would never parse (260709-tdi follow-up).
  const trailingParseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch saved plans
  useEffect(() => {
    if (!user) return;
    const fetchPlans = async () => {
      const plans = await listSavedPlans(user.id, 6);
      setSavedPlans(plans);
    };
    fetchPlans();
  }, [user, isSaved]);

  // Fetch user profile preferences
  useEffect(() => {
    if (!user) {
      // Logged out: reset gate so a subsequent login re-blocks Generate until the
      // profile resolves again.
      setProfileLoaded(false);
      return;
    }
    supabase
      .from("profiles")
      .select("week_start_day, toddler_friendly, glucose_friendly, household_size, dietary_preferences, allergies")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          const profile = data as {
            week_start_day?: string;
            toddler_friendly?: boolean;
            glucose_friendly?: boolean;
            household_size?: number | null;
            dietary_preferences?: string[] | null;
            allergies?: string[] | null;
          };
          if (profile.week_start_day) setWeekStartDay(profile.week_start_day);
          setShowToddlerTips(!!profile.toddler_friendly);
          setShowGlucoseTips(!!profile.glucose_friendly);
          // F7: one-line readout of the Profile constraints week setup can't edit.
          setProfileSummary([
            ...((profile.household_size ?? 0) > 0 ? [`For ${profile.household_size}`] : []),
            ...(profile.dietary_preferences ?? []),
            ...(profile.allergies ?? []).map((a) => `no ${a}`),
          ].join(" · "));
        }
        // Always flip the gate true after the fetch resolves — success OR
        // empty-row. A failed fetch (network error / table missing) hits the
        // catch below; not stranding the button is preferable to a permanent
        // "Loading..." state. weekStartDay stays undefined and call sites
        // default to Sunday.
        setProfileLoaded(true);
      })
      .catch(() => {
        setProfileLoaded(true);
      });
  }, [user]);

  const resetSetup = useCallback(() => {
    setJob("pick");
    setIncludedMeals(DEFAULT_INCLUDED_MEALS);
    setSkippedDays([]);
    setOneMealType("dinner");
    setOneMealWhen("today");
    setPrompt("");
  }, []);

  // Load plan from URL query param
  useEffect(() => {
    const planId = searchParams.get("plan");
    if (!planId) {
      // "Meal Planner" in the nav with a saved plan open lands here (location.search changed):
      // go back to the job picker instead of leaving a detached plan whose title/notes edits
      // silently stop persisting. useSearchParams is memoised on location.search, so a
      // same-URL click never re-runs this effect and an unsaved plan at /planner survives.
      setMealPlan(null);
      setStreamingPlan(null);
      setStreamedText("");
      setIsSaved(false);
      setNotes("");
      lastSavedNotesRef.current = "";
      savedPlanIdRef.current = null;
      resetSetup();
      setLoadingPlan(false);
      return;
    }
    // A load that resolves after the URL moved on (nav click, another saved plan) must not
    // resurrect the plan the user already left.
    let cancelled = false;
    // Loading a different plan: an in-flight in-place save must not reload or re-point
    // the page at the plan being left (its guard re-checks this ref after its reload).
    if (savedPlanIdRef.current !== planId) savedPlanIdRef.current = null;
    setLoadingPlan(true);
    const load = async () => {
      try {
        const plan = await loadMealPlan(planId);
        if (cancelled) return;
        plan.weekPlan.days = sortDays(plan.weekPlan.days, weekStartDay ?? "Sunday");
        setMealPlan(plan);
        setNotes(plan.notes ?? "");
        lastSavedNotesRef.current = plan.notes ?? "";
        // parseISO: start_date is a local calendar date ("yyyy-MM-dd"); new Date()
        // would read it as UTC midnight and show the previous day west of UTC.
        setStartDate(plan.startDate ? parseISO(plan.startDate) : undefined);
        // Setup skip-slots are derived from week-shape / one-meal, not the loaded grid.
        setIsSaved(true);
        savedPlanIdRef.current = planId;
      } catch (e) {
        if (cancelled) return;
        Sentry.captureException(e, { tags: { feature: "planner", action: "load_plan" } });
        toast({ title: "Failed to load plan", variant: "destructive" });
      } finally {
        if (!cancelled) setLoadingPlan(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [searchParams, toast, resetSetup]);

  // Re-sort days when weekStartDay loads from profile (fixes race with plan load).
  // No-op while weekStartDay is undefined (profile still loading) so we don't
  // re-sort a loaded plan with the wrong default. Once the profile resolves
  // and sets weekStartDay, this effect fires and corrects the ordering.
  useEffect(() => {
    if (!weekStartDay) return;
    setMealPlan((prev) =>
      prev ? { ...prev, weekPlan: { ...prev.weekPlan, days: sortDays(prev.weekPlan.days, weekStartDay) } } : null
    );
  }, [weekStartDay]);

  // The page behind the recipe modal must not take focus or clicks (the e2e run
  // reached Save Plan behind it). lib.dom types HTMLElement.inert but @types/react 18
  // does not type the JSX attribute, so it is set through the ref.
  useEffect(() => {
    if (pageRef.current) pageRef.current.inert = !!selectedRecipe;
  }, [selectedRecipe]);

  useEffect(() => {
    isSavedRef.current = isSaved;
  }, [isSaved]);

  // Update pinned recipes if passed in via navigation state after initial load
  useEffect(() => {
    if (location.state?.pinnedRecipes) {
      setPinnedRecipes(location.state.pinnedRecipes);
    }
  }, [location.state]);

  // Clean up interval timers and abort in-flight streams on unmount
  useEffect(() => {
    return () => {
      if (notesSaveTimeoutRef.current) clearTimeout(notesSaveTimeoutRef.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  const persistNotes = useCallback(async (notesToSave: string) => {
    if (!isSaved || !currentPlanId || notesToSave === lastSavedNotesRef.current) return;

    if (notesSaveTimeoutRef.current) {
      clearTimeout(notesSaveTimeoutRef.current);
      notesSaveTimeoutRef.current = null;
    }

    try {
      await updateMealPlanNotes(currentPlanId, notesToSave);
      lastSavedNotesRef.current = notesToSave;
    } catch (error) {
      Sentry.captureException(error, { tags: { feature: "planner", action: "update_notes" } });
      toast({ title: "Failed to save notes", variant: "destructive" });
    }
  }, [currentPlanId, isSaved, toast]);

  useEffect(() => {
    if (notesSaveTimeoutRef.current) {
      clearTimeout(notesSaveTimeoutRef.current);
      notesSaveTimeoutRef.current = null;
    }

    if (!isSaved || !currentPlanId || notes === lastSavedNotesRef.current) return;

    notesSaveTimeoutRef.current = setTimeout(async () => {
      await persistNotes(notes);
    }, 700);
  }, [currentPlanId, isSaved, notes, persistNotes]);

  const replaceMeal = async (hint?: string) => {
    if (planBusy) return;
    if (!swapTarget || !mealPlan) return;
    if (!session?.access_token) {
      toast({ title: "Please sign in", description: "Your session has expired.", variant: "destructive" });
      return;
    }
    const { dayIndex, mealType } = swapTarget;

    const swapRequest = buildSwapRequest(mealPlan, dayIndex, mealType);
    if (!swapRequest) return;
    const { day, oldMeal, remainingMeals, dependentSource } = swapRequest;

    setIsSwapping(true);
    let fullText = "";

    await streamMealSwap({
      oldMeal,
      dayLabel: day.day,
      mealType,
      remainingMeals,
      currentPrepTips: mealPlan.prepTips ?? [],
      hint,
      dependentSource,
      skipSlots: mealPlan.skipSlots,
      accessToken: session.access_token,
      onDelta: (chunk) => { streamActivity.ping(); fullText += chunk; },
      onDone: () => {
        setIsSwapping(false);
        setSwapTarget(null);
        try {
          // Computed from the closure's snapshot (the one oldMeal came from) so the
          // cascade suffix is available synchronously for the toast below.
          const edit = computeSwapEdit(mealPlan, dayIndex, oldMeal, parseSwapResponse(fullText));
          const cascadeSuffix = edit.cascadeSuffixes[0];
          if (cascadeSuffix) {
            Sentry.addBreadcrumb({
              category: "leftover_cascade",
              message: "Swap re-pointed dependent leftover(s) to the new source",
              level: "info",
              data: { oldMealId: oldMeal.id, newMealTitle: edit.newMeal.title, suffix: cascadeSuffix },
            });
          }

          setMealPlan((prev) => (prev === null ? prev : applyPlanEdit(prev, edit)));
          setIsSaved(false);
          // TOAST_LIMIT=1 (use-toast.ts) — extend THIS description with the
          // cascade's re-point confirmation; never fire a second toast() call.
          toast({
            title: "Meal swapped!",
            description: `Prep tips updated.${cascadeSuffix ? ` ${cascadeSuffix}` : ""} Shopping list updated — tap Save Plan to keep this change.`,
          });
        } catch (e) {
          Sentry.captureException(e, { tags: { feature: "planner", action: "swap_parse" } });
          console.error("Failed to parse swap response:", e);
          toast({ title: "Swap failed", description: "Could not parse AI response. Please try again.", variant: "destructive" });
        }
      },
      onError: (error) => {
        captureUnlessRateLimit(`Meal swap failed: ${error}`, { level: "error", tags: { feature: "planner", action: "swap_stream" } }, { errorText: error });
        setIsSwapping(false);
        toast({ title: "Swap failed", description: error, variant: "destructive" });
      },
    });
  };

  // Completeness check — detect missing days/meals
  const completeness = useMemo(
    () => mealPlan ? checkPlanCompleteness(mealPlan.weekPlan.days, orderedDays, mealPlan.skipSlots) : null,
    [mealPlan, orderedDays],
  );

  const regenerateDay = async (hint?: string) => {
    if (planBusy) return;
    if (!dayRegenTarget || !mealPlan) return;
    if (!session?.access_token) {
      toast({ title: "Please sign in", description: "Your session has expired.", variant: "destructive" });
      return;
    }
    const { dayIndex, dayLabel } = dayRegenTarget;
    const regenRequest = buildDayRegenRequest(mealPlan, dayIndex, dayLabel);
    if (!regenRequest) return;
    const { targetDayLabel, activeMealTypes, remainingMeals, replacedMealIds } = regenRequest;

    setIsRegeneratingDay(true);
    let fullText = "";

    await streamDayRegeneration({
      dayLabel: targetDayLabel,
      activeMealTypes,
      remainingMeals,
      currentPrepTips: mealPlan.prepTips ?? [],
      hint,
      batches: mealPlan.weekPlan.batches?.length ? mealPlan.weekPlan.batches : undefined,
      skipSlots: mealPlan.skipSlots,
      replacedMealIds,
      accessToken: session.access_token,
      onDelta: (chunk) => { streamActivity.ping(); fullText += chunk; },
      onDone: () => {
        setIsRegeneratingDay(false);
        setDayRegenTarget(null);
        try {
          const edit = computeDayRegenEdit(
            mealPlan, dayIndex, targetDayLabel, parseDayRegenerationResponse(fullText), weekStartDay ?? "Sunday",
          );
          const { cascadeSuffixes } = edit;
          if (cascadeSuffixes.length > 0) {
            Sentry.addBreadcrumb({
              category: "leftover_cascade",
              message: "Day regeneration re-pointed dependent leftover(s) to new same-slot meal(s)",
              level: "info",
              data: { dayLabel: targetDayLabel, suffixes: cascadeSuffixes },
            });
          }
          const toastDescriptionSuffix = cascadeSuffixes.length > 0 ? cascadeSuffixes.join(" ") : null;

          setMealPlan((prev) => (prev === null ? prev : applyPlanEdit(prev, edit)));
          setIsSaved(false);
          // TOAST_LIMIT=1 (use-toast.ts) — extend THIS description with the
          // cascade's re-point confirmation; never fire a second toast() call.
          toast({
            title: `${targetDayLabel} regenerated!`,
            description: `Prep tips updated.${toastDescriptionSuffix ? ` ${toastDescriptionSuffix}` : ""} Shopping list updated — tap Save Plan to keep this change.`,
          });
        } catch (e) {
          Sentry.captureException(e, { tags: { feature: "planner", action: "regen_day_parse" } });
          console.error("Failed to parse day regeneration response:", e);
          toast({ title: "Regeneration failed", description: "Could not parse AI response. Please try again.", variant: "destructive" });
        }
      },
      onError: (error) => {
        Sentry.captureMessage(`Day regeneration failed: ${error}`, { level: "error", tags: { feature: "planner", action: "regen_day_stream" } });
        setIsRegeneratingDay(false);
        toast({ title: "Regeneration failed", description: error, variant: "destructive" });
      },
    });
  };

  const savePlanWithShoppingListReview = async (
    planToSave: MealPlanResponse,
    planStartDate: Date | undefined,
    sentryAction: "save_plan" | "auto_save",
    notesToSave = notes,
    // Set only by Save Plan on a plan that is already saved: that row is rewritten in
    // place. The auto-save after generation never passes it, so a fresh plan can never
    // overwrite an older saved one.
    existingPlanId: string | null = null,
  ) => {
    if (!user) throw new Error("User is required to save a meal plan.");

    const planWithNotes = { ...planToSave, notes: notesToSave };
    // F0: be honest when the generated plan came back with gaps.
    const missing = countMissingMeals(planToSave, weekStartDay ?? "Sunday");
    const savedTitle = missing > 0 ? `Plan saved — ${missing} meal${missing === 1 ? "" : "s"} missing` : null;
    const missingPrefix = missing > 0 ? "Regenerate the missing days from the calendar. " : "";

    // Phase A: persist the meal plan. If THIS throws, the caller's catch fires
    // the destructive "Failed to save plan" toast — that's the truthful surface.
    // Bumped before the write: an earlier save's Phase B stops persisting as soon as
    // this save starts, so a slow stale list can never land after the fresh one.
    const seq = ++saveSeqRef.current;
    const planId = await saveMealPlan(user.id, planWithNotes, planStartDate, existingPlanId ?? undefined);
    // The user can leave this plan (another saved plan, New Plan, a new generation, a
    // delete) while the write is in flight. The write stands, but the page state
    // below is no longer ours to touch.
    if (existingPlanId && savedPlanIdRef.current !== existingPlanId) return planId;
    // The DB write has succeeded, so even a failed reload below must leave the next
    // Save pointed at this row.
    savedPlanIdRef.current = planId;
    lastSavedNotesRef.current = notesToSave;

    if (existingPlanId) {
      // The URL does not change on an in-place resave, so the load effect will not
      // re-run: reload explicitly. In-memory meal ids must match the re-inserted rows
      // (Phase B's sources[].mealId and the leftover remaps depend on them). The empty
      // list lets SwipeablePlanContent re-derive it; the save deleted the stored one.
      try {
        const reloaded = await loadMealPlan(planId);
        if (savedPlanIdRef.current !== planId) return planId; // the user left while we reloaded
        reloaded.weekPlan.days = sortDays(reloaded.weekPlan.days, weekStartDay ?? "Sunday");
        setMealPlan({ ...reloaded, shoppingList: [] });
      } catch (e) {
        // The write succeeded, so never report "Failed to save plan". isSaved stays
        // false (Save Plan stays available and resaves this same row) and Phase B is
        // skipped: memory still holds the old ids.
        Sentry.captureException(e, { tags: { feature: "planner", action: `${sentryAction}_reload` } });
        toast({
          title: "Plan saved",
          description: "Your changes are saved, but this page couldn't refresh the plan. Refresh to see the saved version.",
          action: (
            <ToastAction altText="Refresh page" onClick={() => window.location.reload()}>
              Refresh
            </ToastAction>
          ),
        });
        return planId;
      }
    }
    setIsSaved(true);
    navigate(`/planner?plan=${planId}`, { replace: true });

    // Phase B: shopping list humanization + persist, in the BACKGROUND so the callers'
    // setIsSaving(false) fires right after Phase A (a 25 s AI call used to hold Save,
    // Serves, Swap and Skip). Best-effort — the plan is already saved, so any failure
    // here routes to a non-destructive toast and never propagates to the caller as a
    // "save failure".
    // It applies its result and toasts only while this save is still the open,
    // unedited plan, and writes shopping_lists only while it is the newest save (seq
    // only: the DB should hold the list for the latest SAVED content even when the
    // user has unsaved edits on top). An in-place resave keeps the plan id, so id
    // equality alone could not tell save #1's late Phase B from save #2's.
    void (async () => {
      const stillCurrent = () => isSavedRef.current && savedPlanIdRef.current === planId && saveSeqRef.current === seq;
      try {
        const result = await generateShoppingList(planId, { shouldPersist: () => saveSeqRef.current === seq });
        if (stillCurrent()) {
          setMealPlan((current) => (current ? { ...current, shoppingList: result.items } : current));
        }

        if (result.source === "ai") {
          if (stillCurrent()) toast({ title: savedTitle ?? "Plan saved!", description: `${missingPrefix}AI-generated shopping list is ready.` });
        } else if (result.source === "local") {
          Sentry.captureMessage(`Shopping list AI fallback: ${result.aiError ?? "unknown"}`, {
            level: "warning",
            tags: { feature: "planner", action: `${sentryAction}_shopping_list_fallback` },
            extra: { planId, aiError: result.aiError },
          });
          if (stillCurrent()) {
            toast({
              title: savedTitle ?? "Plan saved",
              description: `${missingPrefix}Shopping list uses basic formatting — AI humanization is unavailable right now.`,
            });
          }
        } else {
          // "ai-unsaved" or "local-unsaved" — couldn't persist to shopping_lists.
          Sentry.captureMessage(`Shopping list persist failure: ${result.saveError ?? "unknown"}`, {
            level: "warning",
            tags: { feature: "planner", action: `${sentryAction}_shopping_list_persist_error` },
            extra: { planId, saveError: result.saveError, aiError: result.aiError, source: result.source },
          });
          if (stillCurrent()) {
            toast({
              title: savedTitle ?? "Plan saved",
              description: `${missingPrefix}Shopping list is ready here but couldn't sync to your account — refresh to retry.`,
            });
          }
        }
      } catch (e) {
        // Last-ditch: even generateShoppingList's narrow throw ("no ingredients")
        // shouldn't kill the save — the plan is already persisted.
        Sentry.captureException(e, {
          tags: { feature: "planner", action: `${sentryAction}_shopping_list_error` },
        });
        if (stillCurrent()) {
          toast({
            title: savedTitle ?? "Plan saved",
            description: `${missingPrefix}Couldn't build a shopping list for this plan — open it and try again from the sidebar.`,
          });
        }
      }
    })();

    return planId;
  };

  const handleSave = async () => {
    if (!user || !mealPlan || planBusy) return;
    setIsSaving(true);
    try {
      await savePlanWithShoppingListReview(mealPlan, startDate, "save_plan", notes, savedPlanIdRef.current);
    } catch (e) {
      Sentry.captureException(e, { tags: { feature: "planner", action: "save_plan" } });
      toast({
        title: "Failed to save plan",
        description: "Something went wrong while saving. Please try again.",
        variant: "destructive",
      });
    }
    setIsSaving(false);
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (job === "pick") return;
    if (job === "week" && mealCount === 0) return;
    if (!session?.access_token) {
      toast({ title: "Please sign in", description: "Your session has expired.", variant: "destructive" });
      return;
    }
    if (!profileLoaded) {
      // Race guard: block Generate until the profile fetch resolves so the
      // request can't ship with the stale "Sunday" default (MAMMASCHEF-1Z).
      toast({
        title: "Loading your preferences...",
        description: "One moment — applying your week-start preference.",
      });
      return;
    }
    // Abort any previous in-flight stream
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    lastParseTime.current = 0;
    if (trailingParseRef.current) clearTimeout(trailingParseRef.current);
    setIsGenerating(true);
    setStreamedText("");
    setMealPlan(null);
    savedPlanIdRef.current = null;
    setNotes("");
    lastSavedNotesRef.current = "";
    setIsSaved(false);
    setActiveTab("calendar");

    // Cover the "no days yet" window until the first streamed day arrives.
    setShowOverlay(true);

    // Pins from Recipes apply to week plans only; a one-meal idea ignores them.
    const usePins = job === "week" && pinnedRecipes.length > 0;

    let fullText = "";

    // Forward the plan's first-day date (yyyy-mm-dd) so the edge function can
    // inject "Week of MMM d" context into its AI title instruction. Prefer the
    // user's explicit selection; otherwise compute the next occurrence of their
    // configured week-start day.
    const startDateForPrompt = startDate ?? (weekStartDay ? getNextStartDate(weekStartDay) : undefined);
    const whenDay = resolveWhenDay(oneMealWhen);
    const defaultPrompt = job === "one-meal"
      ? `Generate a single ${oneMealType} for ${whenDay}. Do not plan other meals.`
      : "Generate a meal plan for the selected meal slots.";
    const promptForRequest = (prompt.trim() || defaultPrompt)
      + (usePins ? " Incorporate my pinned recipes." : "");

    // Encapsulated overlay teardown — runs on every terminal path (success,
    // validation block, transport error) so the user never sees a stuck
    // overlay. In the success path the overlay is typically already
    // dismissed by the first streamed day (see onDelta below).
    const tearDownOverlay = () => {
      if (trailingParseRef.current) clearTimeout(trailingParseRef.current);
      setIsGenerating(false);
      setShowOverlay(false);
    };

    await generateAndValidateMealPlan({
      prompt: promptForRequest,
      pinnedRecipes: usePins ? pinnedRecipes : undefined,
      skipSlots: Object.keys(skipSlots).length > 0 ? skipSlots : undefined,
      startDate: startDateForPrompt ? format(startDateForPrompt, "yyyy-MM-dd") : undefined,
      accessToken: session.access_token,
      signal: controller.signal,
      onDelta: (chunk) => {
        streamActivity.ping();
        fullText += chunk;
        setStreamedText(fullText);

        const parseStreamingText = () => {
          try {
            const partial = parsePartialJson(fullText, Allow.ALL);
            if (partial?.weekPlan?.days?.length) {
              const plan = normalizeMealPlan({
                weekPlan: {
                  title: partial.weekPlan.title || "Generating your plan...",
                  days: sortDays(mergePinnedStubs(partial.weekPlan.days, usePins ? pinnedRecipes : undefined), weekStartDay ?? "Sunday"),
                },
                shoppingList: [],
                prepTips: partial.prepTips || [],
              });
              streamingPlanRef.current = plan;
              setStreamingPlan(plan);
              // NOTE (260709-tdi): the overlay used to dismiss here on the
              // first streamed day, handing off to the progressive streaming
              // calendar. It now persists through the whole generation so the
              // ChefLoader caption can evolve ("day N of 7") — see the
              // objective note in 260709-tdi-PLAN.md. Teardown now happens
              // only on terminal paths (tearDownOverlay / onValidationFailed
              // / onError).
            }
          } catch { /* partial parse not ready yet */ }
        };

        // Progressive parse — leading edge throttled to 400ms, plus a
        // trailing call: real SSE often flushes the entire plan in one
        // sub-400ms burst, which a leading-only throttle never parses.
        if (trailingParseRef.current) clearTimeout(trailingParseRef.current);
        const now = Date.now();
        if (now - lastParseTime.current < 400) {
          trailingParseRef.current = setTimeout(() => {
            lastParseTime.current = Date.now();
            parseStreamingText();
          }, 150);
          return;
        }
        lastParseTime.current = now;
        parseStreamingText();
      },
      onRetryStart: () => {
        // Reset the streaming-UI buffer so the second attempt's partial parse
        // doesn't collide with the (now-discarded) first attempt's stream.
        fullText = "";
        setStreamedText("");
        streamingPlanRef.current = null;
        setStreamingPlan(null);
        // Re-cover the "no days yet" gap during the retry attempt so the
        // prompt form doesn't flash between attempts (onDelta dismisses
        // again once attempt 2 streams its first day).
        setShowOverlay(true);
        toast({
          title: "Regenerating to fix dependency issues...",
          description: "Reviewing leftover and prep tip references.",
        });
      },
      onSuccess: async (parsed) => {
        tearDownOverlay();
        try {
          // The locally seeded shopping list shows in the same paint as the calendar;
          // the auto-save below replaces it with the AI-humanized list.
          const cleanedPlan = await finalizeGeneratedPlan(parsed, {
            prompt,
            weekStart: weekStartDay ?? "Sunday",
            skipSlots: Object.keys(skipSlots).length > 0 ? skipSlots : undefined,
            pinnedRecipes: usePins ? pinnedRecipes : undefined,
          });

          setMealPlan(cleanedPlan);
          const allergyFlagged = allergenFlaggedMeals(cleanedPlan).map((f) => f.meal);
          if (allergyFlagged.length > 0) {
            toast({
              title: "Check this plan for allergens",
              description: `Possible allergens found in: ${allergyFlagged.map((m) => m.title).join(", ")}. Swap these meals or review their ingredients.`,
              variant: "destructive",
              duration: Infinity,
            });
          }
          // Auto-set start date to the next occurrence of the plan's first day
          const firstDay = cleanedPlan.weekPlan.days[0]?.day;
          if (firstDay) {
            setStartDate(getNextStartDate(firstDay));
          }
          streamingPlanRef.current = null;
          setStreamingPlan(null);
          setStreamedText("");

          // Auto-save the freshly generated plan
          if (user) {
            const computedStartDate = firstDay ? getNextStartDate(firstDay) : undefined;
            try {
              setIsSaving(true);
              await savePlanWithShoppingListReview(cleanedPlan, computedStartDate, "auto_save", "");
            } catch (e) {
              Sentry.captureException(e, { tags: { feature: "planner", action: "auto_save" } });
              toast({ title: "Auto-save failed", description: "You can save manually.", variant: "destructive" });
            } finally {
              setIsSaving(false);
            }
          }
        } catch (e) {
          // Post-parse hydration / save error — orchestrator already produced
          // a valid parsed plan, so this is a downstream failure (DB, library
          // hydration, etc.). Keep the streaming plan visible if available.
          Sentry.captureException(e, {
            tags: { feature: "planner", action: "post_success_enrichment" },
          });
          console.error("Failed to enrich/save meal plan:", e);
          if (streamingPlanRef.current) {
            setMealPlan(streamingPlanRef.current);
            streamingPlanRef.current = null;
            setStreamingPlan(null);
            toast({
              title: "Plan loaded but save may have failed",
              description: "You can save manually.",
            });
          } else {
            toast({
              title: "Post-generation error",
              description: "The plan generated but could not be finalized. Please try again.",
              variant: "destructive",
            });
          }
        }
      },
      onValidationFailed: ({ errors }) => {
        // Two attempts failed dependency validation — do NOT setMealPlan, do
        // NOT save. Sentry telemetry is fired inside the orchestrator.
        tearDownOverlay();
        streamingPlanRef.current = null;
        setStreamingPlan(null);
        setStreamedText("");
        console.warn("[MealPlan] Validation failed after retry:", errors);
        toast({
          title: "Plan has unresolved references — try generating again.",
          description: "We tried to fix it once but the issue persists.",
          variant: "destructive",
        });
      },
      onError: (error) => {
        captureUnlessRateLimit(`Meal plan generation failed: ${error}`, { level: "error", tags: { feature: "planner", action: "generation_stream" } }, { errorText: error });
        setIsGenerating(false);
        setShowOverlay(false);
        streamingPlanRef.current = null;
        setStreamingPlan(null);
        toast({ title: "Generation failed", description: error, variant: "destructive" });
      },
    });
  };

  // Auto-save start date to DB when changed on a saved plan
  const handleStartDateChange = useCallback(async (date: Date | undefined) => {
    setStartDate(date);
    if (!date || !isSaved) return;
    const planId = searchParams.get("plan");
    if (!planId) return;
    try {
      await updateMealPlanStartDate(planId, date);
      toast({ title: "Start date updated" });
    } catch (e) {
      Sentry.captureException(e, { tags: { feature: "planner", action: "update_start_date" } });
      toast({ title: "Failed to update start date", variant: "destructive" });
    }
  }, [isSaved, searchParams, toast]);

  const handleNotesChange = useCallback((nextNotes: string) => {
    setNotes(nextNotes);
    setMealPlan((current) => current ? { ...current, notes: nextNotes } : current);
  }, []);

  // Use streaming partial plan while generating, final plan when done
  const displayPlan = mealPlan || streamingPlan;
  const showPrompt = !mealPlan && !streamingPlan && !loadingPlan;

  // ChefLoader caption for the generation overlay — evolves with the
  // streamed plan ("Simmering Thursday's lunch · day 4 of 7").
  const generationCaption = useMemo(() => deriveGenerationCaption(streamingPlan), [streamingPlan]);

  // True when another meal in the plan links to selectedRecipe via source_meal_id —
  // drives the modal-only CREATES LEFTOVER badge (D-01).
  const isLeftoverSource = useMemo(() => {
    if (!displayPlan || !selectedRecipe) return false;
    return displayPlan.weekPlan.days.some((day) =>
      (day.meals ?? []).some((meal) => meal.source_meal_id === selectedRecipe.id)
    );
  }, [displayPlan, selectedRecipe]);

  // F4: servings floor for a leftover source — it must still cover its dependents.
  const dependentServingsSum = useMemo(() => (
    selectedRecipe && displayPlan
      ? displayPlan.weekPlan.days
          .flatMap((d) => d.meals)
          .filter((m) => m.status === "leftover" && m.source_meal_id === selectedRecipe.id)
          .reduce((s, m) => s + (m.servings ?? 0), 0)
      : 0
  ), [displayPlan, selectedRecipe]);

  // Slot of the recipe open in the detail modal — drives its Swap / Skip
  // actions; null while there is no saved plan or the recipe isn't in it.
  const selectedSlot = useMemo(() => {
    if (!mealPlan || !selectedRecipe) return null;
    const dayIndex = findMealDayIndex(mealPlan.weekPlan.days, selectedRecipe);
    return dayIndex >= 0 ? { dayIndex, mealType: selectedRecipe.mealType } : null;
  }, [mealPlan, selectedRecipe]);
  // planBusy covers Phase A of a save and the reload after it (the auto-save
  // navigates to ?plan=, an in-place resave reloads explicitly): both swap in the
  // DB's row ids, so an edit made in that window would be silently discarded.
  const canEditPlan = !!mealPlan && !planBusy;

  const handleServingsChange = (target: number) => {
    if (!mealPlan || !selectedRecipe) return;
    const updated = scaleRecipeServings(selectedRecipe, target);
    if (updated === selectedRecipe) return;
    const dayLabel = mealPlan.weekPlan.days[findMealDayIndex(mealPlan.weekPlan.days, selectedRecipe)]?.day;
    setMealPlan((prev) => prev && {
      ...prev,
      weekPlan: {
        ...prev.weekPlan,
        days: prev.weekPlan.days.map((d) => ({
          ...d,
          meals: d.meals.map((m) => (m === selectedRecipe || m.id === selectedRecipe.id) ? updated : m),
        })),
      },
      // Cleared so SwipeablePlanContent re-derives the list from the scaled recipes (F3).
      shoppingList: [],
    });
    setSelectedRecipe(updated);
    setIsSaved(false);
    toast({
      title: `${dayLabel ? `${dayLabel} ` : ""}${selectedRecipe.mealType} now serves ${target}`,
      description: "Shopping list updated — tap Save Plan to keep this change.",
    });
  };

  // F2: post-generation per-meal skip with a whole-plan-snapshot Undo.
  const skipMeal = (dayIndex: number, mealType: string) => {
    if (!mealPlan || planBusy) return;
    const before = mealPlan;
    const { plan: next, removedDependents } = skipMealInPlan(mealPlan, dayIndex, mealType);
    if (next === mealPlan) return;
    const dayLabel = mealPlan.weekPlan.days[dayIndex]?.day ?? "";
    setMealPlan(next);
    setIsSaved(false);
    setSwapTarget(null);
    setSelectedRecipe(null);
    toast({
      title: `${dayLabel} ${mealType} skipped`,
      description:
        (removedDependents.length
          ? `${removedDependents.map((d) => `${d.day} ${d.mealType}`).join(", ")} depended on it — regenerate or swap those. `
          : "") + "Tap Save Plan to keep this change.",
      action: (
        <ToastAction altText="Undo skip" onClick={() => { setMealPlan(before); setIsSaved(false); }}>
          Undo
        </ToastAction>
      ),
    });
  };

  const toggleMeal = (meal: PlannerV2MealType) => {
    setIncludedMeals((prev) =>
      prev.includes(meal) ? prev.filter((item) => item !== meal) : [...prev, meal],
    );
  };
  const toggleDay = (day: string) => {
    setSkippedDays((prev) =>
      prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day],
    );
  };

  return (
    <main className="pt-24 pb-24 min-h-screen">
      <div ref={pageRef} className="container mx-auto px-6" aria-hidden={showOverlay || undefined}>
        {/* Loading state when fetching a saved plan */}
        {loadingPlan && (
          <div className="flex flex-col items-center justify-center py-32">
            <ChefLoader mode="indeterminate" phrases={["Plating your saved plan…"]} />
          </div>
        )}

        {showPrompt && (
          <div ref={promptRef} className="mb-10">
            {pinnedRecipes.length > 0 && job !== "one-meal" && (
              <p className="max-w-lg mx-auto mb-3 text-xs text-muted-foreground">
                {pinnedRecipes.length} pinned from Recipes ·{" "}
                <button
                  type="button"
                  onClick={() => setPinnedRecipes([])}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  clear
                </button>
              </p>
            )}
            <PlannerV2Setup
              job={job}
              onJobChange={setJob}
              includedMeals={includedMeals}
              onToggleMeal={toggleMeal}
              orderedDays={orderedDays}
              skippedDays={skippedDays}
              onToggleDay={toggleDay}
              oneMealType={oneMealType}
              onOneMealTypeChange={setOneMealType}
              oneMealWhen={oneMealWhen}
              onOneMealWhenChange={setOneMealWhen}
              prompt={prompt}
              onPromptChange={setPrompt}
              mealCount={mealCount}
              onGenerate={handleGenerate}
              isGenerating={isGenerating}
              profileLoaded={profileLoaded}
              profileSummary={profileSummary}
            />
          </div>
        )}

        {/* Saved plans — only on the job picker so they don't compete with week-shape */}
        {showPrompt && job === "pick" && savedPlans.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="max-w-lg mx-auto mb-12"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading font-semibold text-lg text-foreground">Saved Plans</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate("/profile")} className="text-muted-foreground hover:text-foreground text-xs">
                View all
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {savedPlans.map((plan) => {
                const isEditingThisPlan = editingPlanId === plan.id;
                const commitRename = async () => {
                  const trimmed = draftPlanTitle.trim();
                  if (!trimmed || trimmed === plan.title.trim()) {
                    setEditingPlanId(null);
                    return;
                  }
                  try {
                    await renameMealPlan(plan.id, trimmed);
                    setSavedPlans((prev) =>
                      prev.map((p) => (p.id === plan.id ? { ...p, title: trimmed } : p)),
                    );
                    // If the currently-loaded plan is the one being renamed,
                    // keep the in-memory copy in sync too.
                    if (currentPlanId === plan.id) {
                      setMealPlan((prev) =>
                        prev ? { ...prev, weekPlan: { ...prev.weekPlan, title: trimmed } } : prev,
                      );
                    }
                    toast({ title: "Plan renamed" });
                    setEditingPlanId(null);
                  } catch (err) {
                    Sentry.captureException(err, { tags: { feature: "planner", action: "rename_plan" } });
                    const description = err instanceof Error ? err.message : undefined;
                    toast({ title: "Failed to rename", description, variant: "destructive" });
                    setEditingPlanId(null);
                  }
                };
                return (
                  <div
                    key={plan.id}
                    className="bg-card rounded-lg p-4 shadow-card hover:shadow-elevated transition-shadow group relative"
                    onClick={() => {
                      if (isEditingThisPlan) return;
                      navigate(`/planner?plan=${plan.id}`);
                    }}
                    role={isEditingThisPlan ? undefined : "button"}
                    style={{ cursor: isEditingThisPlan ? "default" : "pointer" }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Calendar className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {isEditingThisPlan ? (
                          <Input
                            autoFocus
                            value={draftPlanTitle}
                            onChange={(e) => setDraftPlanTitle(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void commitRename();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingPlanId(null);
                              }
                            }}
                            onBlur={() => { void commitRename(); }}
                            aria-label="Plan title"
                            className="h-8 text-sm font-medium"
                          />
                        ) : (
                          <>
                            <p className="font-medium text-sm text-foreground truncate">{plan.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatPlanDateLine(plan)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatPlanMetaLine(plan)}
                            </p>
                          </>
                        )}
                      </div>
                      {!isEditingThisPlan && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDraftPlanTitle(plan.title);
                              setEditingPlanId(plan.id);
                            }}
                            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-2 rounded hover:bg-muted touch-target tap-highlight-none"
                            aria-label="Rename plan"
                          >
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await deleteMealPlan(plan.id, "planner_ui");
                                // The open plan stays on screen after its delete; without this its
                                // next Save would target the deleted row and fail on every retry.
                                if (savedPlanIdRef.current === plan.id) savedPlanIdRef.current = null;
                                setSavedPlans((prev) => prev.filter((p) => p.id !== plan.id));
                                toast({ title: "Plan deleted" });
                              } catch (e) {
                                Sentry.captureException(e, { tags: { feature: "planner", action: "delete_plan" } });
                                toast({ title: "Failed to delete", variant: "destructive" });
                              }
                            }}
                            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-2 rounded hover:bg-destructive/10 touch-target tap-highlight-none"
                            aria-label="Delete plan"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Generated plan — show progressively during streaming, or final plan */}
        {displayPlan && (
          <motion.div
            ref={planRef}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-4xl mx-auto"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <EditablePlanTitle
                title={displayPlan.weekPlan.title || "Meal Plan"}
                onRename={user && !planBusy ? async (newTitle) => {
                // 1) Update in-memory mealPlan title immediately.
                setMealPlan((prev) =>
                  prev ? { ...prev, weekPlan: { ...prev.weekPlan, title: newTitle } } : prev,
                );
                // 2) If this plan is saved, persist + sync sidebar.
                if (isSaved && currentPlanId) {
                  try {
                    await renameMealPlan(currentPlanId, newTitle);
                    setSavedPlans((prev) =>
                      prev.map((p) => (p.id === currentPlanId ? { ...p, title: newTitle } : p)),
                    );
                    toast({ title: "Plan renamed" });
                  } catch (err) {
                    Sentry.captureException(err, { tags: { feature: "planner", action: "rename_plan" } });
                    const description = err instanceof Error ? err.message : undefined;
                    toast({ title: "Failed to rename", description, variant: "destructive" });
                    // Re-throw so EditablePlanTitle can surface the error inline
                    // and keep the input mounted for correction.
                    throw err;
                  }
                }
              } : undefined}
              />
            </div>
            {job === "one-meal" && (
              <p className="text-sm text-muted-foreground mb-4">
                Single {oneMealType} idea — swap it, or start a week from the menu.
              </p>
            )}
            {/* Desktop tabs + save button */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <PlanTabs activeTab={activeTab} onTabChange={setActiveTab} />
              {!isSaved && !isGenerating && mealPlan && (
                <Button onClick={handleSave} disabled={planBusy} className="gradient-hero text-primary-foreground border-0 rounded-lg px-5 font-semibold hover:opacity-90 transition-opacity w-full sm:w-auto touch-target active-scale">
                  {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  {isSaving ? "Saving..." : "Save Plan"}
                </Button>
              )}
            </div>

            {/* Swipeable content (mobile) / static content (desktop) */}
            <SwipeablePlanContent
              activeTab={activeTab}
              onTabChange={setActiveTab}
              mealPlan={displayPlan}
              onSelectRecipe={setSelectedRecipe}
              onSwapMeal={planBusy ? undefined : (dayIndex, mealType) => {
                blurActiveElement();
                setSwapTarget({ dayIndex, mealType });
              }}
              onRegenerateDay={planBusy ? undefined : (dayIndex, dayLabel) => {
                blurActiveElement();
                setDayRegenTarget({ dayIndex, dayLabel });
              }}
              isSwapping={isSwapping}
              isRegeneratingDay={isRegeneratingDay}
              regeneratingDayIndex={dayRegenTarget?.dayIndex ?? null}
              isStreaming={isGenerating}
              completeness={completeness}
              streamedDayCount={streamingPlan?.weekPlan.days.length ?? 0}
              startDate={startDate}
              onStartDateChange={handleStartDateChange}
              notes={notes}
              onNotesChange={handleNotesChange}
              onNotesBlur={() => { void persistNotes(notes); }}
              weekStartDay={weekStartDay ?? "Sunday"}
              showToddlerTips={showToddlerTips}
              showGlucoseTips={showGlucoseTips}
              planId={currentPlanId ?? undefined}
            />
          </motion.div>
        )}
      </div>

      {/* Bottom nav when plan is active */}
      {displayPlan && (
        <PlanBottomNav
          onNew={() => {
            setMealPlan(null);
            savedPlanIdRef.current = null;
            setStreamingPlan(null);
            setStreamedText("");
            setNotes("");
            lastSavedNotesRef.current = "";
            setIsSaved(false);
            setPinnedRecipes([]);
            resetSetup();
            navigate("/planner", { replace: true });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          hasPlan={!!displayPlan}
        />
      )}

      <RecipeDetailModal
        recipe={selectedRecipe}
        onClose={() => setSelectedRecipe(null)}
        showToddlerTips={showToddlerTips}
        showGlucoseTips={showGlucoseTips}
        isLeftoverSource={isLeftoverSource}
        onServingsChange={canEditPlan && selectedSlot ? handleServingsChange : undefined}
        minServings={isLeftoverSource ? dependentServingsSum + 1 : 1}
        onSwap={canEditPlan && selectedSlot ? () => {
          setSelectedRecipe(null);
          blurActiveElement();
          setSwapTarget(selectedSlot);
        } : undefined}
        onSkip={canEditPlan && selectedSlot ? () => skipMeal(selectedSlot.dayIndex, selectedSlot.mealType) : undefined}
      />
      {mealPlan && (
        <>
          <MealSwapDrawer
            open={!!swapTarget}
            onOpenChange={(open) => { if (!open && !isSwapping) setSwapTarget(null); }}
            dayLabel={swapTarget ? (mealPlan.weekPlan.days[swapTarget.dayIndex]?.day ?? "") : ""}
            mealType={swapTarget?.mealType ?? ""}
            currentTitle={
              swapTarget
                ? (mealPlan.weekPlan.days[swapTarget.dayIndex]?.meals.find(
                    (m) => m.mealType === swapTarget.mealType
                  )?.title ?? "")
                : ""
            }
            onConfirm={replaceMeal}
            onSkip={swapTarget ? () => skipMeal(swapTarget.dayIndex, swapTarget.mealType) : undefined}
            isSwapping={isSwapping}
            activity={streamActivity.activity}
          />
          <DayRegenerationDrawer
            open={!!dayRegenTarget}
            onOpenChange={(open) => { if (!open && !isRegeneratingDay) setDayRegenTarget(null); }}
            dayLabel={dayRegenTarget ? (mealPlan.weekPlan.days[dayRegenTarget.dayIndex]?.day ?? dayRegenTarget.dayLabel ?? "") : ""}
            activeMealTypes={
              dayRegenTarget && (mealPlan.weekPlan.days[dayRegenTarget.dayIndex]?.day ?? dayRegenTarget.dayLabel)
                ? ["breakfast", "lunch", "dinner", "snack"].filter(
                    (t) => !isSlotSkipped(mealPlan.skipSlots, mealPlan.weekPlan.days[dayRegenTarget.dayIndex]?.day ?? dayRegenTarget.dayLabel ?? "", t),
                  )
                : []
            }
            onConfirm={regenerateDay}
            isRegenerating={isRegeneratingDay}
            activity={streamActivity.activity}
          />
        </>
      )}

      <AnimatePresence>
        {showOverlay && (
          <ChefLoader mode="stream" fullScreen activity={streamActivity.activity} caption={generationCaption} />
        )}
      </AnimatePresence>
    </main>
  );
};

export default Planner;
