import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingCart, Check, Copy, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { GroceryItem } from "@/types/mealPlan";
import { formatGroceryLine, getGroceryParts } from "@/lib/groceryDisplay";
import { loadCheckedNames, saveCheckedNames } from "@/lib/shoppingCheckStorage";

interface ShoppingListContentProps {
  groceries?: GroceryItem[];
  planId?: string;
}

interface CheckableItem extends GroceryItem {
  id: string;
  checked: boolean;
}

/** Meal-type text for the shopping-trace "Feeds:" line (17-UI-SPEC.md §E /
 * Copywriting Contract: "Feeds: Tuesday dinner" — only the day name
 * capitalizes, mealType is rendered as stored). No shared mealType-label
 * helper existed in this file to reuse, so this is a minimal passthrough. */
function mealTypeLabel(mealType: string): string {
  return mealType;
}

/** Aisles ordered to match a typical grocery store walk-through. */
const AISLE_ORDER = [
  "Produce",
  "Meat & Seafood",
  "Dairy & Eggs",
  "Bakery & Bread",
  "Grains & Pasta",
  "Canned & Jarred",
  "Oils & Condiments",
  "Spices & Seasonings",
  "Nuts & Seeds",
  "Frozen",
  "Snacks & Dry Goods",
  "Other",
];

const ShoppingListContent = ({ groceries, planId }: ShoppingListContentProps) => {
  const [items, setItems] = useState<CheckableItem[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (groceries) {
      const checkedSet = planId ? loadCheckedNames(planId) : new Set<string>();
      setItems(
        groceries.map((g, i) => ({ ...g, id: String(i), checked: checkedSet.has(g.name) }))
      );
      setCollapsedSections(new Set());
      setExpandedItems(new Set());
    }
  }, [groceries, planId]);

  // Auto-collapse sections when all needed items are checked
  useEffect(() => {
    setCollapsedSections((prev) => {
      let changed = false;
      const next = new Set(prev);
      const aislesInItems = [...new Set(items.map((i) => i.aisle))];
      for (const aisle of aislesInItems) {
        const sectionNeeded = items.filter((i) => i.aisle === aisle && i.status === "needed");
        if (sectionNeeded.length > 0 && sectionNeeded.every((i) => i.checked) && !prev.has(aisle)) {
          next.add(aisle);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items]);

  const toggleItem = (id: string) => {
    setItems((prev) => {
      const next = prev.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      );
      if (planId) {
        saveCheckedNames(planId, next.filter((i) => i.checked).map((i) => i.name));
      }
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSection = (aisle: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(aisle)) next.delete(aisle);
      else next.add(aisle);
      return next;
    });
  };

  if (!items.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No shopping list available yet.</p>
      </div>
    );
  }

  const aisleSet = new Set(items.map((i) => i.aisle));
  const aisles = AISLE_ORDER.filter((a) => aisleSet.has(a));
  for (const a of aisleSet) {
    if (!aisles.includes(a)) aisles.push(a);
  }
  const neededItems = items.filter((i) => i.status === "needed");
  const checkedCount = neededItems.filter((i) => i.checked).length;
  const progressTarget = neededItems.length;
  const onHandCount = items.length - progressTarget;

  const copyList = () => {
    const text = neededItems
      .map((i) => formatGroceryLine(i))
      .join("\n");

    if (!text) {
      toast.success("Everything on this plan is already on hand.");
      return;
    }

    navigator.clipboard.writeText(text).then(() => {
      toast.success("Shopping list copied to clipboard!");
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-muted-foreground text-sm">
          {progressTarget > 0 ? `${checkedCount} of ${progressTarget} needed items checked` : "No items left to buy"}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={copyList}
            className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center hover:bg-secondary/20 transition-colors"
            title="Copy shopping list"
            aria-label="Copy shopping list"
          >
            <Copy className="w-5 h-5 text-secondary" />
          </button>
          <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center">
            <ShoppingCart className="w-5 h-5 text-secondary" />
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-muted rounded-full mb-8 overflow-hidden">
        <motion.div
          className="h-full gradient-hero rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progressTarget === 0 ? 100 : (checkedCount / progressTarget) * 100}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {onHandCount > 0 && (
        <p className="text-xs text-muted-foreground mb-4">
          {onHandCount} item{onHandCount === 1 ? "" : "s"} marked as already on hand.
        </p>
      )}

      {aisles.map((aisle) => {
        const sectionItems = items.filter((i) => i.aisle === aisle);
        const sectionNeeded = sectionItems.filter((i) => i.status === "needed");
        const sectionChecked = sectionNeeded.filter((i) => i.checked).length;
        const sectionDone = sectionNeeded.length > 0 && sectionChecked === sectionNeeded.length;
        const isCollapsed = collapsedSections.has(aisle);

        return (
          <div key={aisle} className="mb-5">
            <button
              onClick={() => toggleSection(aisle)}
              className="w-full flex items-center gap-2 mb-2 group"
            >
              {isCollapsed
                ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
                : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
              }
              <h3 className="font-heading font-semibold text-xs uppercase tracking-wider text-muted-foreground flex-1 text-left">
                {aisle}
              </h3>
              {sectionNeeded.length > 0 && (
                <span className={`text-[10px] font-semibold tabular-nums ${sectionDone ? "text-emerald-600" : "text-muted-foreground"}`}>
                  {sectionChecked}/{sectionNeeded.length}
                </span>
              )}
              {sectionDone && (
                <span className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                </span>
              )}
            </button>
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  key="section-items"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1.5">
                    {sectionItems.map((item) => {
                      const parts = getGroceryParts(item);
                      const hasSources = (item.sources?.length ?? 0) > 0;
                      const isExpanded = expandedItems.has(item.id);
                      return (
                      <div key={item.id} className="relative">
                        <button
                          onClick={() => toggleItem(item.id)}
                          className={`w-full flex items-center gap-3 px-4 py-3 pr-10 rounded-lg transition-all text-left ${
                            item.checked
                              ? "bg-muted/50 opacity-60"
                              : item.status === "on_hand"
                                ? "bg-emerald-50 border border-emerald-200"
                              : "bg-card shadow-card hover:shadow-elevated"
                          }`}
                        >
                          <div
                            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                              item.checked
                                ? "bg-primary border-primary"
                                : "border-border"
                            }`}
                          >
                            {item.checked && (
                              <Check className="w-3 h-3 text-primary-foreground" />
                            )}
                          </div>
                          <span
                            className={`flex-1 font-medium text-sm ${
                              item.checked
                                ? "line-through text-muted-foreground"
                                : "text-foreground"
                            }`}
                          >
                            {parts.quantity && (
                              <span className="text-muted-foreground font-normal mr-1.5">{parts.quantity + " "}</span>
                            )}{parts.name}
                            {item.status === "on_hand" && !item.checked && (
                              <span className="ml-2 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                On hand
                              </span>
                            )}
                            {parts.showPantryBadge && item.status !== "on_hand" && !item.checked && (
                              <span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Check pantry
                              </span>
                            )}
                          </span>
                        </button>
                        {hasSources && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}
                            className="absolute top-1/2 -translate-y-1/2 right-2 p-1.5 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/70 transition-colors touch-target"
                            aria-label={isExpanded ? "Hide recipes" : `Show recipes using ${item.name}`}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="pl-8 pr-4 pb-3 pt-1 space-y-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Used in</p>
                                {(item.sources ?? []).map((s) => (
                                  <p key={`${item.id}-${s.mealId}`} className="text-sm text-muted-foreground">
                                    Feeds: <span className="text-foreground font-medium">{s.day} {mealTypeLabel(s.mealType)}</span> — {s.title}
                                  </p>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};

export default ShoppingListContent;
