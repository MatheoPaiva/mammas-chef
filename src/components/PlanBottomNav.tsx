import { useState } from "react";
import { CalendarDays, ShoppingCart, CookingPot, Download, Plus } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";

interface PlanBottomNavProps {
  onNew: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  hasPlan: boolean;
}

const ACTIONS = [
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "shopping", label: "Shopping", icon: ShoppingCart },
  { key: "prep", label: "Prep", icon: CookingPot },
  { key: "export", label: "Export", icon: Download },
  { key: "new", label: "New Plan", icon: Plus },
] as const;

const PlanBottomNav = ({ onNew, activeTab, onTabChange, hasPlan }: PlanBottomNavProps) => {
  const [open, setOpen] = useState(false);

  const handleAction = (key: string) => {
    if (key === "new") {
      onNew();
    } else {
      onTabChange(key);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    setOpen(false);
  };

  const visibleActions = hasPlan ? ACTIONS : ACTIONS.filter((a) => a.key === "new");

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border safe-area-bottom">
        <div className="mx-auto flex items-end justify-center px-6 py-2">
          <button
            onClick={() => setOpen(true)}
            className="flex flex-col items-center -mt-5 tap-highlight-none"
          >
            <div className="w-11 h-11 rounded-full gradient-hero flex items-center justify-center text-primary-foreground shadow-elevated active:scale-95 transition-all">
              <Plus className="w-5 h-5" />
            </div>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mt-0.5">
              Menu
            </span>
          </button>
        </div>
      </div>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerTitle className="sr-only">Plan Actions</DrawerTitle>
          {/* max-w-lg keeps the last action ("New Plan") out from under the
              bottom-right Sentry feedback widget at desktop widths. */}
          <div className="flex items-start justify-around px-4 py-6 pb-8 w-full max-w-lg mx-auto">
            {visibleActions.map(({ key, label, icon: Icon }) => {
              const isActive = key !== "new" && activeTab === key;
              return (
                <button
                  key={key}
                  onClick={() => handleAction(key)}
                  className="flex flex-col items-center gap-1.5 tap-highlight-none min-w-[56px] touch-target active:scale-95 transition-transform"
                >
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-wider font-semibold transition-colors ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
};

export default PlanBottomNav;
