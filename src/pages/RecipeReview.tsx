import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCheck, ChefHat, ClipboardList, ExternalLink, FlaskConical, Loader2, PackageX, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { filterRecipeReviewItems, summarizeRecipeReviewCounts } from "@/lib/recipeReview";
import { getRecipeReviewAdminStatus, listRecipesForReview, updateRecipeStatuses, type RecipeReviewRecord } from "@/services/recipeReviewService";
import type { RecipeMachineReviewDecision, RecipeMealType, RecipeStatus } from "@/types/recipeLibrary";

const STATUS_FILTERS: Array<RecipeStatus | "all"> = ["all", "draft", "reviewed", "tested", "archived"];
const MEAL_TYPE_FILTERS: Array<RecipeMealType | "all"> = ["all", "breakfast", "lunch", "dinner", "snack"];
const MACHINE_REVIEW_FILTERS: Array<RecipeMachineReviewDecision | "all" | "unreviewed"> = ["all", "approve", "review", "reject", "unreviewed"];
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const statusBadgeClassName: Record<RecipeStatus, string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-900",
  reviewed: "border-emerald-200 bg-emerald-50 text-emerald-900",
  tested: "border-teal-200 bg-teal-50 text-teal-900",
  archived: "border-stone-200 bg-stone-100 text-stone-700",
};

const statusActionMeta: Record<RecipeStatus, { label: string; icon: typeof CheckCheck }> = {
  reviewed: { label: "Mark reviewed", icon: CheckCheck },
  tested: { label: "Mark tested", icon: FlaskConical },
  draft: { label: "Return to draft", icon: ClipboardList },
  archived: { label: "Archive", icon: PackageX },
};

const machineDecisionBadgeClassName: Record<RecipeMachineReviewDecision, string> = {
  approve: "border-emerald-200 bg-emerald-50 text-emerald-900",
  review: "border-amber-200 bg-amber-50 text-amber-950",
  reject: "border-rose-200 bg-rose-50 text-rose-900",
};

function formatMinutes(active: number | null, total: number | null): string {
  if (active && total && active !== total) return `${active} min active / ${total} min total`;
  if (total) return `${total} min`;
  if (active) return `${active} min active`;
  return "Time varies";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function getRecipeReviewWarnings(recipe: RecipeReviewRecord): string[] {
  return [
    recipe.sourceUrl || recipe.sourceAttribution ? null : "No source",
    recipe.ingredients.length > 0 ? null : "No ingredients",
    recipe.steps.length > 0 ? null : "No method",
    recipe.calories || recipe.protein ? null : "No nutrition",
    recipe.toddlerTip ? null : "No toddler tip",
    recipe.glucoseTip ? null : "No glucose tip",
  ].filter((warning): warning is string => warning !== null);
}

function formatMachineReviewFilterLabel(value: RecipeMachineReviewDecision | "all" | "unreviewed"): string {
  if (value === "all") return "All machine decisions";
  if (value === "unreviewed") return "No machine review";
  return `Machine ${value}`;
}

const RecipeReview = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<RecipeStatus | null>(null);
  const [recipes, setRecipes] = useState<RecipeReviewRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipeStatus | "all">("draft");
  const [mealTypeFilter, setMealTypeFilter] = useState<RecipeMealType | "all">("all");
  const [machineReviewFilter, setMachineReviewFilter] = useState<RecipeMachineReviewDecision | "all" | "unreviewed">("all");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const admin = await getRecipeReviewAdminStatus(user.id);
        if (!active) return;
        setIsAdmin(admin);
        if (!admin) {
          setRecipes([]);
          setActiveRecipeId(null);
          return;
        }

        const rows = await listRecipesForReview();
        if (!active) return;
        setRecipes(rows);
        setActiveRecipeId(rows[0]?.id ?? null);
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Failed to load review queue.";
        toast({ title: "Could not load recipe review queue", description: message, variant: "destructive" });
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [toast, user]);

  const counts = useMemo(() => summarizeRecipeReviewCounts(recipes), [recipes]);

  const filteredRecipes = useMemo(() => filterRecipeReviewItems(recipes, {
    query: deferredQuery,
    mealType: mealTypeFilter,
    status: statusFilter,
    machineReviewDecision: machineReviewFilter,
  }), [deferredQuery, machineReviewFilter, mealTypeFilter, recipes, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRecipes.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const visibleRecipes = filteredRecipes.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredQuery, machineReviewFilter, mealTypeFilter, pageSize, statusFilter]);

  useEffect(() => {
    if (!activeRecipeId || filteredRecipes.some((recipe) => recipe.id === activeRecipeId)) return;
    setActiveRecipeId(filteredRecipes[0]?.id ?? null);
  }, [activeRecipeId, filteredRecipes]);

  useEffect(() => {
    if (!activeRecipeId) return;
    const activeIndex = filteredRecipes.findIndex((recipe) => recipe.id === activeRecipeId);
    if (activeIndex === -1) return;
    const activePage = Math.floor(activeIndex / pageSize) + 1;
    if (activePage !== safeCurrentPage) setCurrentPage(activePage);
  }, [activeRecipeId, filteredRecipes, pageSize, safeCurrentPage]);

  const activeRecipe = filteredRecipes.find((recipe) => recipe.id === activeRecipeId) ?? filteredRecipes[0] ?? null;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = visibleRecipes.length > 0 && visibleRecipes.every((recipe) => selectedSet.has(recipe.id));
  const activeRecipeWarnings = activeRecipe ? getRecipeReviewWarnings(activeRecipe) : [];
  const machineReviewCounts = useMemo(() => ({
    approve: recipes.filter((recipe) => recipe.machineReview?.decision === "approve").length,
    review: recipes.filter((recipe) => recipe.machineReview?.decision === "review").length,
    reject: recipes.filter((recipe) => recipe.machineReview?.decision === "reject").length,
    unreviewed: recipes.filter((recipe) => !recipe.machineReview).length,
  }), [recipes]);

  const toggleSelected = useCallback((recipeId: string) => {
    setSelectedIds((current) => current.includes(recipeId)
      ? current.filter((id) => id !== recipeId)
      : [...current, recipeId]);
  }, []);

  const toggleAllFiltered = () => {
    setSelectedIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleRecipes.some((recipe) => recipe.id === id));
      return Array.from(new Set([...current, ...visibleRecipes.map((recipe) => recipe.id)]));
    });
  };

  const selectVisibleByMachineDecision = useCallback((decision: RecipeMachineReviewDecision) => {
    const matchingIds = visibleRecipes
      .filter((recipe) => recipe.machineReview?.decision === decision)
      .map((recipe) => recipe.id);
    setSelectedIds((current) => Array.from(new Set([...current, ...matchingIds])));
  }, [visibleRecipes]);

  const applyStatus = useCallback(async (status: RecipeStatus, ids = selectedIds) => {
    if (ids.length === 0) return;
    setSubmitting(status);
    try {
      await updateRecipeStatuses(ids, status);
      setRecipes((current) => current.map((recipe) => (
        ids.includes(recipe.id)
          ? { ...recipe, status }
          : recipe
      )));
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      toast({ title: `Updated ${ids.length} recipe${ids.length === 1 ? "" : "s"}`, description: `Status set to ${status}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update recipe status.";
      toast({ title: "Status update failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(null);
    }
  }, [selectedIds, toast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!activeRecipe || submitting !== null) return;

      const key = event.key.toLowerCase();
      const activeIndex = filteredRecipes.findIndex((recipe) => recipe.id === activeRecipe.id);
      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = filteredRecipes[Math.min(activeIndex + 1, filteredRecipes.length - 1)];
        if (next) setActiveRecipeId(next.id);
      }
      if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const previous = filteredRecipes[Math.max(activeIndex - 1, 0)];
        if (previous) setActiveRecipeId(previous.id);
      }
      if (key === "x") {
        event.preventDefault();
        toggleSelected(activeRecipe.id);
      }
      if (key === "r") void applyStatus("reviewed", [activeRecipe.id]);
      if (key === "t") void applyStatus("tested", [activeRecipe.id]);
      if (key === "d") void applyStatus("draft", [activeRecipe.id]);
      if (key === "a") void applyStatus("archived", [activeRecipe.id]);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeRecipe, applyStatus, filteredRecipes, submitting, toggleSelected]);

  if (loading) {
    return (
      <main className="min-h-screen pt-24 pb-12">
        <div className="container mx-auto max-w-6xl px-6">
          <div className="flex min-h-[50vh] items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen pt-24 pb-12">
        <div className="container mx-auto max-w-4xl px-6">
          <div className="rounded-xl border border-border bg-card p-8">
            <p className="text-sm text-muted-foreground">Recipe review is limited to admin accounts.</p>
            <div className="mt-6">
              <Button asChild variant="outline">
                <Link to="/recipes">Back to recipes</Link>
              </Button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pt-24 pb-12">
      <div className="container mx-auto max-w-7xl px-6">
        <div className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <Link to="/recipes" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to recipes
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Recipe review</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Review generated drafts, promote the good ones to planning-safe statuses, and keep the queue consistent.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryBox label="Draft" value={counts.draft} tone="draft" />
            <SummaryBox label="Reviewed" value={counts.reviewed} tone="reviewed" />
            <SummaryBox label="Tested" value={counts.tested} tone="tested" />
            <SummaryBox label="Archived" value={counts.archived} tone="archived" />
          </div>
        </div>

        <div className="sticky top-16 z-20 -mx-6 mt-0 border-b border-border bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{filteredRecipes.length} in queue</span>
              <span>{selectedIds.length} selected</span>
              <span>Page {safeCurrentPage} of {totalPages}</span>
              <span className="hidden md:inline">Shortcuts: J/K move • X select • R reviewed • T tested • A archive</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={safeCurrentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={safeCurrentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>Next</Button>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Recipes per page"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option} per page</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,0.9fr)]">
          <section className="min-w-0 rounded-xl border border-border bg-card">
            <div className="flex flex-col gap-4 border-b border-border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full lg:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search titles, tags, or ingredients"
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {STATUS_FILTERS.map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatusFilter(status)}
                      className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        statusFilter === status
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {status === "all" ? "All statuses" : status}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {MEAL_TYPE_FILTERS.map((mealType) => (
                    <button
                      key={mealType}
                      type="button"
                      onClick={() => setMealTypeFilter(mealType)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        mealTypeFilter === mealType
                          ? "border-foreground text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {mealType === "all" ? "All meals" : mealType}
                    </button>
                  ))}
                </div>
                <div className="text-sm text-muted-foreground">
                  Showing {visibleRecipes.length} of {filteredRecipes.length}
                  {selectedIds.length > 0 ? ` • ${selectedIds.length} selected` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {MACHINE_REVIEW_FILTERS.map((decision) => (
                    <button
                      key={decision}
                      type="button"
                      onClick={() => setMachineReviewFilter(decision)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        machineReviewFilter === decision
                          ? "border-foreground text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {formatMachineReviewFilterLabel(decision)}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{machineReviewCounts.approve} machine approve</span>
                  <span>{machineReviewCounts.review} machine review</span>
                  <span>{machineReviewCounts.reject} machine reject</span>
                  <span>{machineReviewCounts.unreviewed} unreviewed</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllFiltered} aria-label="Select all recipes on this page" />
                <span className="mr-4 text-sm text-muted-foreground">Select page</span>
                <Button variant="outline" size="sm" disabled={!visibleRecipes.some((recipe) => recipe.machineReview?.decision === "approve")} onClick={() => selectVisibleByMachineDecision("approve")}>
                  Select machine approve
                </Button>
                <Button variant="outline" size="sm" disabled={!visibleRecipes.some((recipe) => recipe.machineReview?.decision === "reject")} onClick={() => selectVisibleByMachineDecision("reject")}>
                  Select machine reject
                </Button>
                {(["reviewed", "tested", "archived", "draft"] as RecipeStatus[]).map((status) => {
                  const meta = statusActionMeta[status];
                  const Icon = meta.icon;
                  return (
                    <Button
                      key={status}
                      variant="outline"
                      size="sm"
                      disabled={selectedIds.length === 0 || submitting !== null}
                      onClick={() => void applyStatus(status)}
                    >
                      {submitting === status ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
                      {meta.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <ScrollArea className="h-[70vh]">
              <div className="divide-y divide-border">
                {visibleRecipes.map((recipe, index) => {
                  const isActive = recipe.id === activeRecipe?.id;
                  const warnings = getRecipeReviewWarnings(recipe);
                  return (
                    <button
                      key={recipe.id}
                      type="button"
                      onClick={() => setActiveRecipeId(recipe.id)}
                      className={`flex w-full items-start gap-4 px-4 py-4 text-left transition-colors ${isActive ? "bg-muted/60" : "hover:bg-muted/40"}`}
                    >
                      <div className="pt-1" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedSet.has(recipe.id)}
                          onCheckedChange={() => toggleSelected(recipe.id)}
                          aria-label={`Select ${recipe.title}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-base font-medium text-foreground">{pageStart + index + 1}. {recipe.title}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {recipe.mealTypes.join(", ")}{recipe.region ? ` • ${recipe.region}` : ""}{recipe.sourceAttribution ? ` • ${recipe.sourceAttribution}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            {recipe.machineReview ? (
                              <Badge variant="outline" className={machineDecisionBadgeClassName[recipe.machineReview.decision]}>
                                machine {recipe.machineReview.decision}
                              </Badge>
                            ) : (
                              <Badge variant="outline">no machine review</Badge>
                            )}
                            {warnings.length > 0 ? <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-900">{warnings.length} flags</Badge> : null}
                            <Badge variant="outline" className={statusBadgeClassName[recipe.status]}>
                              {recipe.status}
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            <MetaPill label={formatMinutes(recipe.activeTimeMinutes, recipe.totalTimeMinutes)} />
                            {recipe.servings ? <MetaPill label={`${recipe.servings} servings`} /> : null}
                            {recipe.calories ? <MetaPill label={`${recipe.calories} cal`} /> : null}
                            {recipe.ingredients.length ? <MetaPill label={`${recipe.ingredients.length} ingredients`} /> : null}
                            {recipe.steps.length ? <MetaPill label={`${recipe.steps.length} steps`} /> : null}
                          </div>
                          <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
                            <Button variant="ghost" size="sm" disabled={submitting !== null} onClick={() => void applyStatus("reviewed", [recipe.id])}>Reviewed</Button>
                            <Button variant="ghost" size="sm" disabled={submitting !== null} onClick={() => void applyStatus("archived", [recipe.id])}>Archive</Button>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {filteredRecipes.length === 0 ? (
                  <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No recipes match the current filters.
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </section>

          <aside className="min-w-0 rounded-xl border border-border bg-card">
            {activeRecipe ? (
              <div className="flex h-full flex-col">
                <div className="border-b border-border p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={statusBadgeClassName[activeRecipe.status]}>
                          {activeRecipe.status}
                        </Badge>
                        {activeRecipe.machineReview ? (
                          <Badge variant="outline" className={machineDecisionBadgeClassName[activeRecipe.machineReview.decision]}>
                            machine {activeRecipe.machineReview.decision}
                          </Badge>
                        ) : (
                          <Badge variant="outline">no machine review</Badge>
                        )}
                        <span className="text-sm text-muted-foreground">Created {formatDate(activeRecipe.createdAt)}</span>
                      </div>
                      <h2 className="mt-3 text-2xl font-semibold text-foreground">{activeRecipe.title}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {activeRecipe.sourceAttribution ?? "No source attribution"}{activeRecipe.sourceUrl ? " • external source link available" : ""}
                      </p>
                    </div>
                    {activeRecipe.sourceUrl ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={activeRecipe.sourceUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Source
                        </a>
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(["reviewed", "tested", "draft", "archived"] as RecipeStatus[]).map((status) => {
                      const meta = statusActionMeta[status];
                      const Icon = meta.icon;
                      return (
                        <Button
                          key={status}
                          variant={activeRecipe.status === status ? "default" : "outline"}
                          size="sm"
                          disabled={submitting !== null}
                          onClick={() => void applyStatus(status, [activeRecipe.id])}
                        >
                          {submitting === status ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
                          {meta.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <ScrollArea className="h-[70vh]">
                  <div className="space-y-6 p-5">
                    {activeRecipeWarnings.length > 0 ? (
                      <section className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
                        <h3 className="font-medium">Review flags</h3>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {activeRecipeWarnings.map((warning) => (
                            <span key={warning} className="rounded-md bg-white/70 px-2 py-1 text-xs">{warning}</span>
                          ))}
                        </div>
                      </section>
                    ) : null}

                    {activeRecipe.machineReview ? (
                      <section className="rounded-lg border border-border bg-muted/30 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-medium text-foreground">Machine review</h3>
                            <p className="mt-1 text-sm text-muted-foreground">{activeRecipe.machineReview.summary}</p>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <div>Score {activeRecipe.machineReview.score}</div>
                            <div>Confidence {Math.round(activeRecipe.machineReview.confidence * 100)}%</div>
                          </div>
                        </div>
                        {activeRecipe.machineReview.tags.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {activeRecipe.machineReview.tags.map((tag) => (
                              <Badge key={tag} variant="secondary" className="rounded-md">{tag}</Badge>
                            ))}
                          </div>
                        ) : null}
                        {activeRecipe.machineReview.issues.length > 0 ? (
                          <div className="mt-4 space-y-2">
                            {activeRecipe.machineReview.issues.map((issue) => (
                              <div key={`${issue.code}-${issue.message}`} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                                <span className="font-medium text-foreground">{issue.severity}</span>
                                <span className="text-muted-foreground"> • {issue.message}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {activeRecipe.machineReview.suggestedFixes.length > 0 ? (
                          <div className="mt-4">
                            <h4 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Suggested fixes</h4>
                            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                              {activeRecipe.machineReview.suggestedFixes.map((fix) => (
                                <li key={fix}>{fix}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </section>
                    ) : null}

                    <section className="grid gap-3 sm:grid-cols-2">
                      <InfoBlock label="Meal types" value={activeRecipe.mealTypes.join(", ")} />
                      <InfoBlock label="Prep time" value={formatMinutes(activeRecipe.activeTimeMinutes, activeRecipe.totalTimeMinutes)} />
                      <InfoBlock label="Cuisine" value={activeRecipe.cuisine ?? "Not set"} />
                      <InfoBlock label="Region" value={activeRecipe.region ?? "Not set"} />
                      <InfoBlock label="Servings" value={activeRecipe.servings ? String(activeRecipe.servings) : "Not set"} />
                      <InfoBlock label="Nutrition" value={[
                        activeRecipe.calories ? `${activeRecipe.calories} cal` : null,
                        activeRecipe.protein ? `${activeRecipe.protein}g protein` : null,
                      ].filter(Boolean).join(" • ") || "Not set"} />
                    </section>

                    <TagSection title="Diet tags" values={activeRecipe.dietTags} />
                    <TagSection title="Flavor tags" values={activeRecipe.flavorTags} />

                    <section>
                      <h3 className="text-sm font-medium text-foreground">Ingredients</h3>
                      <ul className="mt-3 space-y-2 text-sm text-foreground">
                        {activeRecipe.ingredients.map((ingredient, index) => (
                          <li key={`${ingredient.name}-${index}`} className="flex items-start justify-between gap-4 border-b border-border/70 pb-2 last:border-b-0">
                            <span>{ingredient.name}{ingredient.prep ? `, ${ingredient.prep}` : ""}</span>
                            <span className="shrink-0 text-muted-foreground">
                              {ingredient.quantity} {ingredient.unit}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>

                    <section>
                      <h3 className="text-sm font-medium text-foreground">Method</h3>
                      <ol className="mt-3 space-y-3 text-sm text-foreground">
                        {activeRecipe.steps.map((step) => (
                          <li key={`${step.order}-${step.text.slice(0, 12)}`} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-xs text-muted-foreground">{step.order}</span>
                            <span className="leading-6">{step.text}</span>
                          </li>
                        ))}
                      </ol>
                    </section>

                    <Separator />

                    <NotesSection title="Prep ahead" value={activeRecipe.prepAheadNotes} />
                    <NotesSection title="Storage" value={activeRecipe.storageNotes} />
                    <NotesSection title="Reheat" value={activeRecipe.reheatNotes} />
                    <NotesSection title="Toddler tip" value={activeRecipe.toddlerTip} />
                    <NotesSection title="Glucose tip" value={activeRecipe.glucoseTip} />
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="flex h-full min-h-[50vh] items-center justify-center p-8 text-sm text-muted-foreground">
                Select a recipe to review.
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
};

function SummaryBox({ label, value, tone }: { label: string; value: number; tone: RecipeStatus }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusBadgeClassName[tone]}`}>
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function MetaPill({ label }: { label: string }) {
  return <span className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">{label}</span>;
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm text-foreground">{value}</p>
    </div>
  );
}

function TagSection({ title, values }: { title: string; values: string[] }) {
  return (
    <section>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {values.length > 0 ? values.map((value) => (
          <Badge key={value} variant="secondary" className="rounded-md">
            {value}
          </Badge>
        )) : <p className="text-sm text-muted-foreground">No tags set.</p>}
      </div>
    </section>
  );
}

function NotesSection({ title, value }: { title: string; value: string | null }) {
  return (
    <section>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{value ?? "Not provided."}</p>
    </section>
  );
}

export default RecipeReview;
