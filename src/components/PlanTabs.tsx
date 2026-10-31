import { useIsMobile } from "@/hooks/use-mobile";

interface PlanTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { key: "calendar", label: "Calendar" },
  { key: "shopping", label: "Shopping" },
  { key: "prep", label: "Prep Strategy" },
  { key: "export", label: "Export" },
];

const PlanTabs = ({ activeTab, onTabChange }: PlanTabsProps) => {
  const isMobile = useIsMobile();

  // On mobile, tabs are in the bottom nav — hide this component
  if (isMobile) return null;

  return (
    <div className="sticky top-[73px] z-30 bg-background/80 backdrop-blur-lg py-3 -mx-6 px-6 mb-4">
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all whitespace-nowrap tap-highlight-none touch-target ${
              activeTab === tab.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default PlanTabs;
