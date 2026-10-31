import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Coffee,
  Cookie,
  Loader2,
  Sparkles,
  Sun,
  UtensilsCrossed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Switch } from "@/components/ui/switch";
import SpeechToTextButton from "@/components/SpeechToTextButton";
import { cn } from "@/lib/utils";
import {
  PLANNER_V2_MEAL_TYPES,
  summarizeWeekShape,
  type PlannerV2MealType,
} from "@/lib/plannerV2Slots";

export type PlannerV2Job = "pick" | "week" | "one-meal";

const MEAL_COPY: Record<PlannerV2MealType, { label: string; icon: typeof Coffee }> = {
  breakfast: { label: "Breakfast", icon: Coffee },
  lunch: { label: "Lunch", icon: Sun },
  dinner: { label: "Dinner", icon: UtensilsCrossed },
  snack: { label: "Snack", icon: Cookie },
};

interface PlannerV2SetupProps {
  job: PlannerV2Job;
  onJobChange: (job: PlannerV2Job) => void;
  includedMeals: PlannerV2MealType[];
  onToggleMeal: (meal: PlannerV2MealType) => void;
  orderedDays: string[];
  skippedDays: string[];
  onToggleDay: (day: string) => void;
  oneMealType: PlannerV2MealType;
  onOneMealTypeChange: (meal: PlannerV2MealType) => void;
  oneMealWhen: string;
  onOneMealWhenChange: (when: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  mealCount: number;
  onGenerate: () => void;
  isGenerating: boolean;
  profileLoaded: boolean;
  profileSummary?: string;
}

const PlannerV2Setup = ({
  job,
  onJobChange,
  includedMeals,
  onToggleMeal,
  orderedDays,
  skippedDays,
  onToggleDay,
  oneMealType,
  onOneMealTypeChange,
  oneMealWhen,
  onOneMealWhenChange,
  prompt,
  onPromptChange,
  mealCount,
  onGenerate,
  isGenerating,
  profileLoaded,
  profileSummary,
}: PlannerV2SetupProps) => {
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [showMoreMeals, setShowMoreMeals] = useState(false);
  const [showDayPicker, setShowDayPicker] = useState(false);
  const canGenerateWeek = includedMeals.length > 0 && mealCount > 0 && profileLoaded && !isGenerating;
  const canGenerateOne = !!oneMealType && !!oneMealWhen && profileLoaded && !isGenerating;
  const weekSummary = summarizeWeekShape(includedMeals, skippedDays, mealCount);
  const oneMealLabel = MEAL_COPY[oneMealType].label.toLowerCase();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="max-w-lg mx-auto"
    >
      {job === "pick" && (
        <div className="space-y-5">
          <div>
            <h1 className="font-heading font-bold text-3xl text-foreground">Meal Planner</h1>
            <p className="text-muted-foreground mt-1">What do you need?</p>
          </div>

          <button
            type="button"
            onClick={() => onJobChange("week")}
            className="w-full text-left rounded-2xl border border-border bg-card p-5 shadow-card tap-highlight-none active-scale touch-target"
          >
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <CalendarDays className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="font-heading font-semibold text-lg text-foreground">Plan this week</p>
                <p className="text-sm text-muted-foreground mt-0.5">Shape the meals, then generate.</p>
              </div>
            </div>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                onOneMealTypeChange("dinner");
                onOneMealWhenChange("today");
                onJobChange("one-meal");
              }}
              className="min-h-[104px] text-left rounded-2xl border border-border bg-card p-4 shadow-card tap-highlight-none active-scale"
            >
              <UtensilsCrossed className="w-5 h-5 text-primary mb-3" />
              <p className="font-heading font-semibold text-foreground">Tonight's dinner</p>
              <p className="text-xs text-muted-foreground mt-1">One idea, right now.</p>
            </button>
            <button
              type="button"
              onClick={() => {
                onOneMealTypeChange("lunch");
                onOneMealWhenChange("today");
                onJobChange("one-meal");
              }}
              className="min-h-[104px] text-left rounded-2xl border border-border bg-card p-4 shadow-card tap-highlight-none active-scale"
            >
              <Sun className="w-5 h-5 text-primary mb-3" />
              <p className="font-heading font-semibold text-foreground">Lunch idea</p>
              <p className="text-xs text-muted-foreground mt-1">A single plate.</p>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowMoreMeals((open) => !open)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {showMoreMeals ? "Hide breakfast and snack" : "Need breakfast or a snack?"}
          </button>

          {showMoreMeals && (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  onOneMealTypeChange("breakfast");
                  onOneMealWhenChange("today");
                  onJobChange("one-meal");
                }}
                className="min-h-[72px] text-left rounded-2xl border border-dashed border-border bg-card p-4 tap-highlight-none active-scale"
              >
                <p className="font-medium text-sm text-foreground">Breakfast idea</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  onOneMealTypeChange("snack");
                  onOneMealWhenChange("today");
                  onJobChange("one-meal");
                }}
                className="min-h-[72px] text-left rounded-2xl border border-dashed border-border bg-card p-4 tap-highlight-none active-scale"
              >
                <p className="font-medium text-sm text-foreground">Snack idea</p>
              </button>
            </div>
          )}
        </div>
      )}

      {job === "week" && (
        <div className="pb-28">
          <button
            type="button"
            onClick={() => onJobChange("pick")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 tap-highlight-none"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="font-heading font-bold text-3xl text-foreground">Plan this week</h1>
          <p className="text-muted-foreground mt-1 mb-6">Tap the meals we should cook.</p>

          <div className="grid grid-cols-2 gap-3 mb-4">
            {PLANNER_V2_MEAL_TYPES.map((meal) => {
              const included = includedMeals.includes(meal);
              const Icon = MEAL_COPY[meal].icon;
              return (
                <button
                  key={meal}
                  type="button"
                  onClick={() => onToggleMeal(meal)}
                  aria-pressed={included}
                  className={cn(
                    "min-h-[88px] rounded-2xl border p-4 text-left tap-highlight-none active-scale transition-colors",
                    included
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <Icon className="w-5 h-5" />
                    {included && <Check className="w-4 h-4" aria-hidden="true" />}
                  </div>
                  <p className="font-heading font-semibold mt-3">{MEAL_COPY[meal].label}</p>
                </button>
              );
            })}
          </div>

          <p className="text-sm font-medium text-foreground bg-muted/60 rounded-xl px-4 py-3 mb-3">
            {weekSummary}
          </p>

          {profileSummary && (
            <p className="text-xs text-muted-foreground mb-3">
              {profileSummary} ·{" "}
              <Link to="/profile" className="underline underline-offset-2 hover:text-foreground">
                Edit in Profile
              </Link>
            </p>
          )}

          <button
            type="button"
            onClick={() => setExceptionsOpen(true)}
            className="text-sm text-primary font-medium mb-6"
          >
            This week is different
          </button>

          <PromptBlock
            id="planner-v2-week-prompt"
            label="What are you working with?"
            placeholder="e.g. chicken thighs, lemons, toddler at the table..."
            prompt={prompt}
            onPromptChange={onPromptChange}
            disabled={isGenerating}
          />
        </div>
      )}

      {job === "one-meal" && (
        <div className="pb-28">
          <button
            type="button"
            onClick={() => onJobChange("pick")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 tap-highlight-none"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="font-heading font-bold text-3xl text-foreground">
            {oneMealType === "dinner" ? "Tonight's dinner" : `${MEAL_COPY[oneMealType].label} idea`}
          </h1>
          <p className="text-muted-foreground mt-1 mb-6">One recipe. No week to shape.</p>

          <p className="text-sm font-medium text-foreground mb-2">When?</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {[
              { value: "today", label: oneMealType === "dinner" ? "Tonight" : "Today" },
              { value: "tomorrow", label: "Tomorrow" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setShowDayPicker(false);
                  onOneMealWhenChange(option.value);
                }}
                className={cn(
                  "h-12 px-5 rounded-full border text-sm font-medium tap-highlight-none active-scale",
                  oneMealWhen === option.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowDayPicker((open) => !open)}
              className={cn(
                "h-12 px-5 rounded-full border text-sm font-medium tap-highlight-none active-scale",
                showDayPicker || orderedDays.includes(oneMealWhen)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground",
              )}
            >
              {orderedDays.includes(oneMealWhen) ? oneMealWhen : "Another day"}
            </button>
          </div>
          {showDayPicker && (
            <div className="flex flex-wrap gap-2 mb-6">
              {orderedDays.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => onOneMealWhenChange(day)}
                  className={cn(
                    "h-11 px-4 rounded-full border text-sm font-medium tap-highlight-none active-scale",
                    oneMealWhen === day
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          )}
          {!showDayPicker && <div className="mb-6" />}

          <PromptBlock
            id="planner-v2-one-prompt"
            label="Anything we should work with?"
            placeholder="e.g. leftover chicken, 30 minutes, keep it mild..."
            prompt={prompt}
            onPromptChange={onPromptChange}
            disabled={isGenerating}
          />
        </div>
      )}

      {(job === "week" || job === "one-meal") && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur-md safe-area-bottom">
          <div className="max-w-lg mx-auto px-6 py-3">
            <Button
              onClick={onGenerate}
              disabled={job === "week" ? !canGenerateWeek : !canGenerateOne}
              className="w-full gradient-hero text-primary-foreground border-0 rounded-xl h-14 text-lg font-semibold shadow-lg shadow-primary/25 hover:opacity-90 disabled:opacity-50 touch-target tap-highlight-none active-scale"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cooking...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  {job === "week" ? `Generate ${mealCount} meals` : `Get a ${oneMealLabel} idea`}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      <Drawer open={exceptionsOpen} onOpenChange={setExceptionsOpen}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>This week is different</DrawerTitle>
            <DrawerDescription>Turn off days you are not cooking.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2 space-y-1">
            {orderedDays.map((day) => {
              const cooking = !skippedDays.includes(day);
              return (
                <label
                  key={day}
                  className="flex items-center justify-between min-h-[56px] px-2 rounded-xl"
                >
                  <span className="font-medium text-foreground">{day}</span>
                  <Switch
                    checked={cooking}
                    onCheckedChange={() => onToggleDay(day)}
                    aria-label={`Cook on ${day}`}
                  />
                </label>
              );
            })}
          </div>
          <DrawerFooter>
            <Button onClick={() => setExceptionsOpen(false)} className="h-12 rounded-xl">
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </motion.div>
  );
};

function PromptBlock({
  id,
  label,
  placeholder,
  prompt,
  onPromptChange,
  disabled,
}: {
  id: string;
  label: string;
  placeholder: string;
  prompt: string;
  onPromptChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground mb-2">
        {label}
      </label>
      <div className="relative">
        <Textarea
          id={id}
          placeholder={placeholder}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          className="min-h-[120px] bg-card border-input rounded-2xl text-foreground placeholder:text-muted-foreground resize-none pr-4 pb-14"
          disabled={disabled}
        />
        <div className="absolute bottom-3 left-3">
          <SpeechToTextButton
            onTranscript={(text) => onPromptChange(prompt ? `${prompt} ${text}` : text)}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

export default PlannerV2Setup;
