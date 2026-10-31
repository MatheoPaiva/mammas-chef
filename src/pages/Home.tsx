import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, endOfWeek, format, isWithinInterval, parseISO, startOfWeek } from "date-fns";
import { CalendarRange, CookingPot, ShoppingCart, AlertTriangle, ArrowRight, Loader2, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import ChefLoader from "@/components/ChefLoader";
import { getWeeklyPlanSummaries, type WeeklyPlanSummary } from "@/services/dashboardService";
import { loadMealPlan } from "@/services/mealPlanDbService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { MealRecipe, PrepTip } from "@/types/mealPlan";

interface DailyMeals {
  breakfast?: MealRecipe;
  lunch?: MealRecipe;
  dinner?: MealRecipe;
  snack?: MealRecipe;
}

const Home = () => {
  const { user } = useAuth();
  const [plans, setPlans] = useState<WeeklyPlanSummary[]>([]);
  const [todayMeals, setTodayMeals] = useState<DailyMeals | null>(null);
  const [tonightPrep, setTonightPrep] = useState<PrepTip | null>(null);
  const [loadingTodayMeals, setLoadingTodayMeals] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const summaries = await getWeeklyPlanSummaries(user.id);
        setPlans(summaries);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user]);

  const sortedByWeek = useMemo(
    () => [...plans].sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    [plans],
  );

  const thisWeekPlan = useMemo(() => {
    const today = new Date();
    // Try to match plans starting on either Sunday (0) or Monday (1)
    for (const startOn of [0, 1] as const) {
      const weekStart = startOfWeek(today, { weekStartsOn: startOn });
      const weekEnd = endOfWeek(today, { weekStartsOn: startOn });
      const match = sortedByWeek.find((plan) => {
        const planDate = parseISO(plan.weekStart);
        return isWithinInterval(planDate, { start: weekStart, end: weekEnd });
      });
      if (match) return match;
    }
    return undefined;
  }, [sortedByWeek]);

  const upcomingPlans = useMemo(() => {
    const today = new Date();
    const sixWeeksOut = addDays(today, 42);
    return sortedByWeek.filter((plan) => {
      const planDate = parseISO(plan.weekStart);
      return planDate > today && planDate <= sixWeeksOut;
    });
  }, [sortedByWeek]);

  const totals = useMemo(() => {
    const weeksCovered = new Set(plans.map((p) => p.weekStart)).size;
    const totalMeals = plans.reduce((sum, p) => sum + p.mealCount, 0);
    const totalShoppingItems = plans.reduce((sum, p) => sum + p.shoppingItemCount, 0);
    const plansWithGaps = plans.filter((p) => p.hasGaps).length;
    return { weeksCovered, totalMeals, totalShoppingItems, plansWithGaps };
  }, [plans]);

  const todayDateLabel = useMemo(() => format(new Date(), "EEEE, MMMM d, yyyy"), []);

  useEffect(() => {
    if (!thisWeekPlan) {
      setTodayMeals(null);
      setTonightPrep(null);
      return;
    }

    const loadTodayMeals = async () => {
      setLoadingTodayMeals(true);
      try {
        const detailedPlan = await loadMealPlan(thisWeekPlan.id);
        const todayName = format(new Date(), "EEEE");
        const todayPlan = detailedPlan.weekPlan.days.find(
          (day) => day.day.toLowerCase() === todayName.toLowerCase(),
        );

        if (!todayPlan) {
          setTodayMeals({});
          setTonightPrep(null);
          return;
        }

        const getMeal = (mealType: MealRecipe["mealType"]) =>
          todayPlan.meals.find((meal) => meal.mealType === mealType);

        setTodayMeals({
          breakfast: getMeal("breakfast"),
          lunch: getMeal("lunch"),
          dinner: getMeal("dinner"),
          snack: getMeal("snack"),
        });

        // Find tonight's prep tip — exclude the canonical prep day. Read the one
        // source of truth (weekPlan.batchCookDay, now populated by loadMealPlan's
        // normalization, WR-05/D-06) so the dashboard agrees with the planner.
        // The dominant-cluster heuristic stays ONLY as the fallback when the
        // canonical value is absent.
        const prepTips = detailedPlan.prepTips ?? [];
        const tipCounts: Record<string, number> = {};
        for (const t of prepTips) { tipCounts[t.day] = (tipCounts[t.day] || 0) + 1; }
        const sorted = Object.entries(tipCounts).sort(([, a], [, b]) => b - a);
        const batchDay =
          detailedPlan.weekPlan.batchCookDay ??
          (sorted.length > 0 && sorted[0][1] >= 3 ? sorted[0][0] : "");
        const tonightTip = prepTips.find(
          (t) => t.day.toLowerCase() === todayName.toLowerCase() && t.day !== batchDay,
        );
        setTonightPrep(tonightTip ?? null);
      } catch {
        setTodayMeals({});
        setTonightPrep(null);
      } finally {
        setLoadingTodayMeals(false);
      }
    };

    loadTodayMeals();
  }, [thisWeekPlan]);

  if (loading) {
    return (
      <main className="pt-24 pb-16 min-h-screen flex items-center justify-center">
        <ChefLoader mode="indeterminate" phrases={["Setting the table…"]} />
      </main>
    );
  }

  return (
    <main className="pt-24 pb-16 min-h-screen">
      <div className="container mx-auto px-6 max-w-6xl">
        <section className="mb-8">
          <h1 className="font-heading font-bold text-3xl md:text-4xl text-foreground mb-2">Your Meal Hub</h1>
          <p className="text-muted-foreground">
            A high-level overview of your weekly plans, upcoming weeks, and where to take action.
          </p>
        </section>

        {error && (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-8">
          <Card>
            <CardHeader className="p-3 pb-2 md:p-6 md:pb-2">
              <CardDescription>Weeks Covered</CardDescription>
              <CardTitle className="text-2xl">{totals.weeksCovered}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-2 md:p-6 md:pb-2">
              <CardDescription>Total Meals Planned</CardDescription>
              <CardTitle className="text-2xl">{totals.totalMeals}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-2 md:p-6 md:pb-2">
              <CardDescription>Shopping Items</CardDescription>
              <CardTitle className="text-2xl">{totals.totalShoppingItems}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-2 md:p-6 md:pb-2">
              <CardDescription>Weeks With Gaps</CardDescription>
              <CardTitle className="text-2xl">{totals.plansWithGaps}</CardTitle>
            </CardHeader>
          </Card>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarRange className="w-5 h-5 text-primary" />
                  This Week
                </CardTitle>
              </CardHeader>
              <CardContent>
                {thisWeekPlan ? (
                  <div className="space-y-3">
                    <p className="font-semibold text-foreground">{thisWeekPlan.title}</p>
                    <p className="text-sm text-muted-foreground">
                      Week of {format(parseISO(thisWeekPlan.weekStart), "MMM d, yyyy")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {thisWeekPlan.mealCount} meals · created {format(parseISO(thisWeekPlan.createdAt), "MMM d, yyyy 'at' h:mmaaa")}
                    </p>
                    {thisWeekPlan.hasGaps && (
                      <p className="text-sm text-amber-700 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        This week has missing meal slots.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button asChild>
                        <Link to={`/planner?plan=${thisWeekPlan.id}`}>Open Plan</Link>
                      </Button>
                      <Button asChild variant="outline">
                        <Link to="/shopping">View Shopping List</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      No plan starts this week yet. Generate one to get your dashboard rolling.
                    </p>
                    <Button asChild>
                      <Link to="/planner">Create This Week's Plan</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {tonightPrep && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="flex items-start gap-4 pt-6">
                  <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">
                      Tonight&apos;s Prep
                    </p>
                    <p className="text-sm text-foreground leading-relaxed">{tonightPrep.tip}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Today&apos;s Meals</CardTitle>
                <CardDescription>{todayDateLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                {!thisWeekPlan ? (
                  <p className="text-sm text-muted-foreground">
                    Add a plan for this week to see your daily meal lineup here.
                  </p>
                ) : loadingTodayMeals ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading today&apos;s meals...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    <MealSlot label="Breakfast" meal={todayMeals?.breakfast} />
                    <MealSlot label="Lunch" meal={todayMeals?.lunch} />
                    <MealSlot label="Dinner" meal={todayMeals?.dinner} />
                    <MealSlot label="Snack" meal={todayMeals?.snack} />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CookingPot className="w-5 h-5 text-primary" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button asChild className="w-full justify-between">
                  <Link to="/planner">
                    Generate New Plan
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full justify-between">
                  <Link to="/recipes">
                    Browse Recipes
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full justify-between">
                  <Link to="/shopping">
                    Open Shopping List
                    <ShoppingCart className="w-4 h-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Upcoming Weeks</CardTitle>
                <CardDescription>Next 6 weeks of plans</CardDescription>
              </CardHeader>
              <CardContent>
                {upcomingPlans.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No upcoming weeks planned yet.</p>
                ) : (
                  <div className="space-y-3">
                    {upcomingPlans.map((plan) => (
                      <Link
                        key={plan.id}
                        to={`/planner?plan=${plan.id}`}
                        className="block rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium text-foreground">{plan.title}</p>
                            <p className="text-sm text-muted-foreground">
                              Week of {format(parseISO(plan.weekStart), "MMM d, yyyy")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {plan.mealCount} meals · created {format(parseISO(plan.createdAt), "MMM d, yyyy 'at' h:mmaaa")}
                            </p>
                          </div>
                          {plan.hasGaps && (
                            <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded">
                              Needs attention
                            </span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
};

const MealSlot = ({ label, meal }: { label: string; meal?: MealRecipe }) => (
  <div className="rounded-lg border border-border p-4">
    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{label}</p>
    {meal ? (
      <div className="space-y-1">
        <p className="font-medium text-foreground">{meal.title}</p>
        <p className="text-xs text-muted-foreground">
          {meal.prepTime || "Prep time not set"} - Serves {meal.servings}
        </p>
        {meal.flavorNotes && (
          <p className="text-xs italic text-muted-foreground/80 leading-snug pt-0.5">
            {meal.flavorNotes}
          </p>
        )}
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">No meal planned yet.</p>
    )}
  </div>
);

export default Home;
