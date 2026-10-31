import { useState, useEffect } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
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

const REGEN_PHRASES = ["Reworking the day…", "Re-plating meals…", "Keeping variety fresh…"];

const REGEN_REASON_CHIPS = [
  "Something lighter",
  "More variety",
  "Different cuisine",
  "Missing meals",
  "Start fresh",
] as const;

interface DayRegenerationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayLabel: string;
  activeMealTypes: string[];
  onConfirm: (hint?: string) => void;
  isRegenerating: boolean;
  activity?: number;
}

const DayRegenerationDrawer = ({
  open,
  onOpenChange,
  dayLabel,
  activeMealTypes,
  onConfirm,
  isRegenerating,
  activity,
}: DayRegenerationDrawerProps) => {
  const [hint, setHint] = useState("");
  const [selectedChips, setSelectedChips] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setHint("");
      setSelectedChips([]);
    }
  }, [open, dayLabel]);

  const toggleChip = (chip: string) => {
    setSelectedChips((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip],
    );
  };

  const handleConfirm = () => {
    const parts: string[] = [];
    if (selectedChips.length > 0) parts.push(selectedChips.join(", "));
    if (hint.trim()) parts.push(hint.trim());
    onConfirm(parts.length > 0 ? parts.join(". ") : undefined);
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (!o && isRegenerating) return;
        onOpenChange(o);
      }}
      dismissible={!isRegenerating}
    >
      <DrawerContent className="pb-safe">
        <DrawerHeader className="text-left">
          <DrawerTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            Regenerate Day
          </DrawerTitle>
          <DrawerDescription className="mt-0.5">
            {dayLabel} &middot; {activeMealTypes.length} meal{activeMealTypes.length !== 1 ? "s" : ""}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-4">
          {/* Meal types being regenerated */}
          <div className="rounded-lg bg-muted/50 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Regenerating
            </p>
            <div className="flex flex-wrap gap-1.5">
              {activeMealTypes.map((type) => (
                <span
                  key={type}
                  className="text-xs font-medium text-foreground bg-background px-2 py-0.5 rounded"
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </span>
              ))}
            </div>
          </div>

          {/* Quick-pick chips */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">What would you like?</p>
            <div className="flex flex-wrap gap-2">
              {REGEN_REASON_CHIPS.map((chip) => (
                <Badge
                  key={chip}
                  variant={selectedChips.includes(chip) ? "default" : "outline"}
                  className="cursor-pointer select-none transition-colors py-1.5 px-3 text-sm"
                  onClick={() => !isRegenerating && toggleChip(chip)}
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
              placeholder="e.g. make it all Mexican-inspired, use pantry staples..."
              className="resize-none"
              rows={2}
              disabled={isRegenerating}
              maxLength={200}
            />
          </div>

          {isRegenerating && (
            <div className="py-1">
              <ChefLoader
                mode="stream"
                activity={activity}
                caption="Regenerating the day…"
                phrases={REGEN_PHRASES}
              />
            </div>
          )}
        </div>

        <DrawerFooter className="pt-4">
          <Button
            onClick={handleConfirm}
            disabled={isRegenerating}
            className="w-full gradient-hero text-primary-foreground border-0 rounded-lg py-5 font-semibold hover:opacity-90 transition-opacity"
          >
            {isRegenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating&hellip;
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate {dayLabel}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isRegenerating}
            className="w-full"
          >
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default DayRegenerationDrawer;
