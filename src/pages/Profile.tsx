import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Trash2, CalendarDays, Loader2, CookingPot, Save, User, Settings, LogOut, X, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { deleteMealPlan } from "@/services/mealPlanDbService";
import { listSavedPlans, type SavedPlanSummary } from "@/services/savedPlansService";
import { useToast } from "@/hooks/use-toast";
import { formatPlanDateLine, formatPlanMetaLine } from "@/lib/planMeta";

type SavedPlan = SavedPlanSummary;

interface ProfileData {
  display_name: string;
  household_size: number;
  preferred_cuisines: string[];
  dietary_preferences: string[];
  allergies: string[];
  toddler_friendly: boolean;
  glucose_friendly: boolean;
  week_start_day: string;
}

import { CUISINE_OPTIONS, DIETARY_OPTIONS, ALLERGY_OPTIONS, WEEK_START_OPTIONS } from "@/constants/preferences";

const Profile = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Plans state
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Profile state
  const [profile, setProfile] = useState<ProfileData>({
    display_name: "",
    household_size: 2,
    preferred_cuisines: [],
    dietary_preferences: [],
    allergies: [],
    toddler_friendly: false,
    glucose_friendly: false,
    week_start_day: "Sunday",
  });
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [resetSending, setResetSending] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Fetch plans
    listSavedPlans(user.id)
      .then((plans) => setPlans(plans))
      .catch(() => toast({ title: "Failed to load plans", variant: "destructive" }))
      .finally(() => setLoadingPlans(false));

    // Fetch profile
    supabase
      .from("profiles")
      .select("display_name, household_size, preferred_cuisines, dietary_preferences, allergies, toddler_friendly, glucose_friendly, week_start_day")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          toast({ title: "Failed to load profile", variant: "destructive" });
        } else if (data) {
          const cuisines = (data as { preferred_cuisines?: string[] }).preferred_cuisines ?? [];
          setProfile({
            display_name: data.display_name ?? "",
            household_size: data.household_size ?? 2,
            preferred_cuisines: cuisines,
            dietary_preferences: data.dietary_preferences ?? [],
            allergies: data.allergies ?? [],
            toddler_friendly: data.toddler_friendly ?? false,
            glucose_friendly: data.glucose_friendly ?? false,
            week_start_day: (data as { week_start_day?: string }).week_start_day ?? "Sunday",
          });
          setProfileLoaded(true);
        }
        setLoadingProfile(false);
      });
  }, [user]);

  const handleDelete = async (planId: string) => {
    setDeleting(planId);
    try {
      await deleteMealPlan(planId, "profile_ui");
      setPlans((prev) => prev.filter((p) => p.id !== planId));
      toast({ title: "Plan deleted" });
    } catch {
      toast({ title: "Failed to delete plan", variant: "destructive" });
    }
    setDeleting(null);
  };

  const toggleChip = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((i) => i !== item) : [...list, item];

  const handleSavePreferences = async () => {
    if (!user || !profileLoaded) return;
    setSavingPrefs(true);
    const { error } = await supabase.from("profiles").update({
      preferred_cuisines: profile.preferred_cuisines,
      dietary_preferences: profile.dietary_preferences,
      allergies: profile.allergies,
      household_size: profile.household_size,
      toddler_friendly: profile.toddler_friendly,
      glucose_friendly: profile.glucose_friendly,
      week_start_day: profile.week_start_day,
    }).eq("id", user.id);
    if (error) {
      console.error("Save preferences error:", error);
      toast({ title: "Failed to save preferences", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Preferences saved!" });
    }
    setSavingPrefs(false);
  };

  const handleSaveAccount = async () => {
    if (!user) return;
    setSavingAccount(true);
    const { error } = await supabase.from("profiles").update({
      display_name: profile.display_name,
    }).eq("id", user.id);
    if (error) {
      toast({ title: "Failed to save", variant: "destructive" });
    } else {
      toast({ title: "Display name updated!" });
    }
    setSavingAccount(false);
  };

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setResetSending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast({ title: "Failed to send reset email", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Reset email sent!", description: "Check your inbox for the password reset link." });
    }
    setResetSending(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <main className="pt-24 pb-16 min-h-screen">
      <div className="container mx-auto px-6 max-w-3xl">
        <h1 className="font-heading font-bold text-3xl text-foreground mb-2">Profile</h1>
        <p className="text-muted-foreground mb-6">Manage your plans, preferences, and account.</p>

        <Tabs defaultValue="plans" className="w-full">
          <TabsList className="w-full grid grid-cols-3 mb-6">
            <TabsTrigger value="plans">My Plans</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
          </TabsList>

          {/* ── My Plans ── */}
          <TabsContent value="plans">
            {loadingPlans ? (
              <div className="flex justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : plans.length === 0 ? (
              <div className="text-center py-20">
                <CookingPot className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground">No saved plans yet. Generate one from the Meal Planner!</p>
                <Button variant="outline" className="mt-4" onClick={() => navigate("/planner")}>
                  Go to Planner
                </Button>
              </div>
            ) : (
              <div className="grid gap-4">
                {plans.map((plan, i) => (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-card rounded-lg p-5 shadow-card flex items-start justify-between gap-4"
                  >
                    <button
                      onClick={() => navigate(`/planner?plan=${plan.id}`)}
                      className="flex-1 text-left flex items-center gap-4 hover:opacity-80 transition-opacity"
                    >
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <CalendarDays className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-heading font-semibold text-foreground">{plan.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatPlanDateLine(plan)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatPlanMetaLine(plan)}
                        </p>
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(plan.id)}
                      disabled={deleting === plan.id}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      {deleting === plan.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </motion.div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Preferences ── */}
          <TabsContent value="preferences">
            {loadingProfile ? (
              <div className="flex justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="bg-card rounded-lg p-6 shadow-card space-y-6">
                {/* Cuisine preferences */}
                <div className="space-y-3">
                  <div>
                    <Label className="text-base font-semibold">Preferred Cuisines</Label>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Select any cuisines you enjoy.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {CUISINE_OPTIONS.map((opt) => {
                      const isSelected = profile.preferred_cuisines.includes(opt);
                      return (
                        <Badge
                          key={opt}
                          variant={isSelected ? "default" : "outline"}
                          className="select-none transition-colors cursor-pointer"
                          onClick={() => {
                            setProfile((p) => ({ ...p, preferred_cuisines: toggleChip(p.preferred_cuisines, opt) }));
                          }}
                        >
                          {opt}
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                {/* Dietary preferences */}
                <div className="space-y-3">
                  <Label className="text-base font-semibold">Dietary Preferences</Label>
                  <div className="flex flex-wrap gap-2">
                    {DIETARY_OPTIONS.map((opt) => (
                      <Badge
                        key={opt}
                        variant={profile.dietary_preferences.includes(opt) ? "default" : "outline"}
                        className="cursor-pointer select-none transition-colors"
                        onClick={() =>
                          setProfile((p) => ({ ...p, dietary_preferences: toggleChip(p.dietary_preferences, opt) }))
                        }
                      >
                        {opt}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Allergies */}
                <div className="space-y-3">
                  <Label className="text-base font-semibold">Allergies</Label>
                  <p className="text-sm text-muted-foreground">AI can make mistakes. Always check ingredients and labels yourself. This app is not medical advice.</p>
                  <div className="flex flex-wrap gap-2">
                    {ALLERGY_OPTIONS.map((opt) => (
                      <Badge
                        key={opt}
                        variant={profile.allergies.includes(opt) ? "destructive" : "outline"}
                        className="cursor-pointer select-none transition-colors"
                        onClick={() =>
                          setProfile((p) => ({ ...p, allergies: toggleChip(p.allergies, opt) }))
                        }
                      >
                        {opt}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Household size */}
                <div className="space-y-2">
                  <Label>Household Size</Label>
                  <div className="flex items-center gap-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 shrink-0 rounded-full"
                      onClick={() => setProfile((p) => ({ ...p, household_size: Math.max(1, p.household_size - 1) }))}
                      disabled={profile.household_size <= 1}
                      aria-label="Decrease household size"
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">
                      {profile.household_size}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 shrink-0 rounded-full"
                      onClick={() => setProfile((p) => ({ ...p, household_size: Math.min(12, p.household_size + 1) }))}
                      disabled={profile.household_size >= 12}
                      aria-label="Increase household size"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">people</span>
                  </div>
                </div>

                {/* Week Start Day */}
                <div className="space-y-2">
                  <Label className="text-base font-semibold">Week Starts On</Label>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Choose which day your meal plan week begins. Batch-cook day adjusts automatically.
                  </p>
                  <div className="flex gap-2">
                    {WEEK_START_OPTIONS.map((day) => (
                      <Badge
                        key={day}
                        variant={profile.week_start_day === day ? "default" : "outline"}
                        className="cursor-pointer select-none transition-colors px-4 py-1.5 text-sm"
                        onClick={() => setProfile((p) => ({ ...p, week_start_day: day }))}
                      >
                        {day}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Toggles */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="toddler" className="cursor-pointer">Toddler-Friendly Meals</Label>
                  <Switch
                    id="toddler"
                    checked={profile.toddler_friendly}
                    onCheckedChange={(v) => setProfile((p) => ({ ...p, toddler_friendly: v }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="glucose" className="cursor-pointer">Glucose-Friendly Meals</Label>
                  <Switch
                    id="glucose"
                    checked={profile.glucose_friendly}
                    onCheckedChange={(v) => setProfile((p) => ({ ...p, glucose_friendly: v }))}
                  />
                </div>

                <Button
                  onClick={handleSavePreferences}
                  disabled={savingPrefs}
                  className="w-full gradient-hero text-primary-foreground border-0 rounded-lg py-5 font-semibold hover:opacity-90 transition-opacity"
                >
                  {savingPrefs && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" />
                  Save Preferences
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ── Account ── */}
          <TabsContent value="account">
            {loadingProfile ? (
              <div className="flex justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="bg-card rounded-lg p-6 shadow-card space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="display-name">Display Name</Label>
                  <div className="flex gap-3">
                    <Input
                      id="display-name"
                      value={profile.display_name}
                      onChange={(e) => setProfile((p) => ({ ...p, display_name: e.target.value }))}
                      placeholder="Your name"
                      className="flex-1"
                    />
                    <Button onClick={handleSaveAccount} disabled={savingAccount} variant="outline">
                      {savingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={user?.email ?? ""} disabled className="opacity-60" />
                </div>

                <div className="border-t border-border pt-6 space-y-3">
                  <Button
                    variant="outline"
                    onClick={handleResetPassword}
                    disabled={resetSending}
                    className="w-full"
                  >
                    {resetSending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Reset Password
                  </Button>

                  <Button
                    variant="destructive"
                    onClick={handleSignOut}
                    className="w-full"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
};

export default Profile;
