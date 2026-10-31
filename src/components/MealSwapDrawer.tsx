import { useState, useEffect } from "react";
import { ArrowLeftRight, Loader2, UtensilsCrossed } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import ChefLoader from "@/components/ChefLoader";

const SWAP_PHRASES = ["Simmering a fresh idea…", "Balancing the plate…", "Tasting for balance…"];

const SWAP_REASON_CHIPS = [
  "Too complex",
  "Missing ingredients",
  "Want vegetarian",
  "Something quicker",
  "Don't like it",
  "Try something different",
] as const;

interface MealSwapDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayLabel: string;
  mealType: string;
  currentTitle: string;
  onConfirm: (hint?: string) => void;
  isSwapping: boolean;
  activity?: number;
  /** When provided, offers "Skip this meal instead" below Generate. */
  onSkip?: () => void;
}

const MealSwapDrawer = ({
  open,
  onOpenChange,
  dayLabel,
  mealType,
  currentTitle,
  onConfirm,
  isSwapping,
  activity,
  onSkip,
}: MealSwapDrawerProps) => {
  const [hint, setHint] = useState("");
  const [selectedChips, setSelectedChips] = useState<string[]>([]);

  // Reset state when drawer opens for a new meal
  useEffect(() => {
    if (open) {
      setHint("");
      setSelectedChips([]);
    }
  }, [open, currentTitle]);

  const toggleChip = (chip: string) => {
    setSelectedChips((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]
    );
  };

  const handleConfirm = () => {
    // Combine chips + freetext into a single hint string
    const parts: string[] = [];
    if (selectedChips.length > 0) parts.push(selectedChips.join(", "));
    if (hint.trim()) parts.push(hint.trim());
    onConfirm(parts.length > 0 ? parts.join(". ") : undefined);
  };

  const mealTypeLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1);

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        // Prevent dismissal while swap is in progress
        if (!o && isSwapping) return;
        onOpenChange(o);
      }}
      dismissible={!isSwapping}
    >
      <DrawerContent className="pb-safe">
        <DrawerHeader className="text-left">
          <DrawerTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            Swap Meal
          </DrawerTitle>
          <DrawerDescription className="mt-0.5">
            {dayLabel} &middot; {mealTypeLabel}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-4">
          {/* Current meal label */}
          <div className="rounded-lg bg-muted/50 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
              Replacing
            </p>
            <p className="text-sm font-medium text-foreground leading-snug">
              {currentTitle}
            </p>
          </div>

          {/* Quick-pick chips */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Why are you swapping?</p>
            <div className="flex flex-wrap gap-2">
              {SWAP_REASON_CHIPS.map((chip) => (
                <Badge
                  key={chip}
                  variant={selectedChips.includes(chip) ? "default" : "outline"}
                  className="cursor-pointer select-none transition-colors py-1.5 px-3 text-sm"
                  onClick={() => !isSwapping && toggleChip(chip)}
                >
                  {chip}
                </Badge>
              ))}
            </div>
          </div>

          {/* Optional freetext */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">
              Anything else? <span className="text-muted-foreground font-normal">(optional)</span>
            </p>
            <Textarea
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="e.g. use salmon instead, keep it under 30 minutes..."
              className="resize-none"
              rows={2}
              disabled={isSwapping}
              maxLength={200}
            />
          </div>

          {/* Generating status */}
          {isSwapping && (
            <div className="py-1">
              <ChefLoader
                mode="stream"
                activity={activity}
                caption="Generating your new meal, grocery list & prep tips…"
                phrases={SWAP_PHRASES}
              />
            </div>
          )}
        </div>

        <DrawerFooter className="pt-4">
          <Button
            onClick={handleConfirm}
            disabled={isSwapping}
            className="w-full gradient-hero text-primary-foreground border-0 rounded-lg py-5 font-semibold hover:opacity-90 transition-opacity"
          >
            {isSwapping ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating&hellip;
              </>
            ) : (
              <>
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Generate New Meal
              </>
            )}
          </Button>
          {onSkip && (
            <Button
              variant="ghost"
              onClick={onSkip}
              disabled={isSwapping}
              className="w-full"
            >
              <UtensilsCrossed className="h-4 w-4 mr-2" />
              Skip this meal instead
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSwapping}
            className="w-full"
          >
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default MealSwapDrawer;
