import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2, Users, Leaf, ShieldAlert, Baby, UtensilsCrossed, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { DIETARY_OPTIONS, ALLERGY_OPTIONS, CUISINE_OPTIONS } from "@/constants/preferences";
import { logAction, logError } from "@/services/activityLogger";

const TOTAL_STEPS = 5;

const Onboarding = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [householdSize, setHouseholdSize] = useState(2);
  const [dietaryPreferences, setDietaryPreferences] = useState<string[]>([]);
  const [preferredCuisines, setPreferredCuisines] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [toddlerFriendly, setToddlerFriendly] = useState(false);
  const [glucoseFriendly, setGlucoseFriendly] = useState(false);

  const toggleChip = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((i) => i !== item) : [...list, item];

  const handleFinish = async (skipAll = false) => {
    if (!user) return;
    setSaving(true);
    const updates: Record<string, unknown> = { onboarding_complete: true };
    if (!skipAll) {
      updates.household_size = householdSize;
      updates.dietary_preferences = dietaryPreferences;
      updates.preferred_cuisines = preferredCuisines;
      updates.allergies = allergies;
      updates.toddler_friendly = toddlerFriendly;
      updates.glucose_friendly = glucoseFriendly;
    }
    const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
    if (error) {
      logError("onboarding_save_error", { error: error.message, skipped: skipAll });
      toast({ title: "Failed to save preferences", variant: "destructive" });
      setSaving(false);
      return;
    }
    logAction("onboarding_complete", {
      skipped: skipAll,
      household_size: householdSize,
      dietary_count: dietaryPreferences.length,
      cuisine_count: preferredCuisines.length,
      allergy_count: allergies.length,
      toddler_friendly: toddlerFriendly,
      glucose_friendly: glucoseFriendly,
    });
    navigate("/home");
  };

  const handleSkipStep = () => {
    logAction("onboarding_step_skip", { step });
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      handleFinish(false);
    }
  };

  const handleNext = () => {
    logAction("onboarding_step_next", { step });
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      handleFinish(false);
    }
  };

  const stepVariants = {
    enter: { opacity: 0, x: 40 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -40 },
  };

  return (
    <main className="pt-16 sm:pt-24 pb-16 min-h-screen">
      <div className="container mx-auto px-6 max-w-lg">
        <div className="text-center mb-8">
          <h1 className="font-heading font-bold text-2xl text-foreground mb-1">Welcome! Let's personalize your experience</h1>
          <p className="text-muted-foreground text-sm">This helps us tailor your meal plans. You can change these anytime in your profile.</p>
        </div>

        <Progress value={(step / TOTAL_STEPS) * 100} className="mb-6 h-2" />
        <p className="text-xs text-muted-foreground text-center mb-6">Step {step} of {TOTAL_STEPS}</p>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="s1" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              <Card>
                <CardHeader className="items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                  <CardTitle className="text-xl">Household Size</CardTitle>
                  <CardDescription>How many people are you cooking for?</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                  <div className="flex items-center gap-5">
                    <button
                      type="button"
                      onClick={() => setHouseholdSize(Math.max(1, householdSize - 1))}
                      disabled={householdSize <= 1}
                      className="w-14 h-14 rounded-full bg-muted flex items-center justify-center active:scale-95 transition-transform disabled:opacity-30"
                    >
                      <Minus className="w-6 h-6" />
                    </button>
                    <span className="text-4xl font-bold w-12 text-center tabular-nums">{householdSize}</span>
                    <button
                      type="button"
                      onClick={() => setHouseholdSize(Math.min(12, householdSize + 1))}
                      disabled={householdSize >= 12}
                      className="w-14 h-14 rounded-full bg-muted flex items-center justify-center active:scale-95 transition-transform disabled:opacity-30"
                    >
                      <Plus className="w-6 h-6" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="s2" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              <Card>
                <CardHeader className="items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                    <Leaf className="w-6 h-6 text-primary" />
                  </div>
                  <CardTitle className="text-xl">Dietary Preferences</CardTitle>
                  <CardDescription>Select any that apply to your household.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {DIETARY_OPTIONS.map((opt) => (
                      <Badge
                        key={opt}
                        variant={dietaryPreferences.includes(opt) ? "default" : "outline"}
                        className="cursor-pointer select-none transition-colors text-sm py-2.5 px-4 min-h-[44px] flex items-center"
                        onClick={() => setDietaryPreferences(toggleChip(dietaryPreferences, opt))}
                      >
                        {opt}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="s3" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              <Card>
                <CardHeader className="items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                    <UtensilsCrossed className="w-6 h-6 text-primary" />
                  </div>
                  <CardTitle className="text-xl">Preferred Cuisines</CardTitle>
                  <CardDescription>Pick the cuisines you enjoy most. We'll lean toward these in your meal plans.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {CUISINE_OPTIONS.map((opt) => (
                      <Badge
                        key={opt}
                        variant={preferredCuisines.includes(opt) ? "default" : "outline"}
                        className="cursor-pointer select-none transition-colors text-sm py-2.5 px-4 min-h-[44px] flex items-center"
                        onClick={() => setPreferredCuisines(toggleChip(preferredCuisines, opt))}
                      >
                        {opt}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="s4" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              <Card>
                <CardHeader className="items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
                    <ShieldAlert className="w-6 h-6 text-destructive" />
                  </div>
                  <CardTitle className="text-xl">Allergies</CardTitle>
                  <CardDescription>Select any food allergies. These will be treated as strict exclusions. AI can make mistakes. Always check ingredients and labels yourself. This app is not medical advice.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {ALLERGY_OPTIONS.map((opt) => (
                      <Badge
                        key={opt}
                        variant={allergies.includes(opt) ? "destructive" : "outline"}
                        className="cursor-pointer select-none transition-colors text-sm py-2.5 px-4 min-h-[44px] flex items-center"
                        onClick={() => setAllergies(toggleChip(allergies, opt))}
                      >
                        {opt}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div key="s5" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              <Card>
                <CardHeader className="items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                    <Baby className="w-6 h-6 text-primary" />
                  </div>
                  <CardTitle className="text-xl">Special Options</CardTitle>
                  <CardDescription>Enable any special meal planning considerations.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="toddler-onboard" className="cursor-pointer">Toddler-Friendly Meals</Label>
                    <Switch id="toddler-onboard" checked={toddlerFriendly} onCheckedChange={setToddlerFriendly} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="glucose-onboard" className="cursor-pointer">Glucose-Friendly Meals</Label>
                    <Switch id="glucose-onboard" checked={glucoseFriendly} onCheckedChange={setGlucoseFriendly} />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex justify-between items-center mt-6">
          {step > 1 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={saving}>
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => handleFinish(true)} disabled={saving}>
              Skip All
            </Button>
          )}
          <Button variant="ghost" onClick={handleSkipStep} disabled={saving} className="text-muted-foreground">
            Skip
          </Button>
          <Button onClick={handleNext} disabled={saving} className="min-w-[100px]">
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {step === TOTAL_STEPS ? "Finish" : "Next"}
            {step < TOTAL_STEPS && <ChevronRight className="w-4 h-4 ml-1" />}
          </Button>
        </div>
      </div>
    </main>
  );
};

export default Onboarding;
