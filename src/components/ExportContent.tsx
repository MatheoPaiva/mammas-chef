import { useState } from "react";
import * as Sentry from "@sentry/react";
import { Printer, CalendarPlus, FileSpreadsheet, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateICS, generateCSV, downloadFile, generatePDF } from "@/lib/exportUtils";
import { useToast } from "@/hooks/use-toast";
import type { MealPlanResponse, PrepTip } from "@/types/mealPlan";
import PrintContent from "@/components/PrintContent";

interface ExportContentProps {
  mealPlan: MealPlanResponse;
  startDate?: Date;
  prepTips?: PrepTip[];
  showToddlerTips?: boolean;
  showGlucoseTips?: boolean;
}

const exportOptions = [
  {
    key: "pdf",
    icon: Printer,
    title: "Print / Save PDF",
    description: "Download a beautifully formatted PDF — print it or save it locally",
  },
  {
    key: "ics",
    icon: CalendarPlus,
    title: "Calendar (.ics)",
    description: "Add meals to Apple Calendar, Google Calendar, or Outlook",
  },
  {
    key: "csv",
    icon: FileSpreadsheet,
    title: "Spreadsheet (.csv)",
    description: "Open in Excel or Google Sheets with full macros and details",
  },
] as const;

const ExportContent = ({ mealPlan, startDate, prepTips, showToddlerTips = true, showGlucoseTips = true }: ExportContentProps) => {
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const { toast } = useToast();

  const handleExport = async (key: string) => {
    if (key === "pdf") {
      setGeneratingPdf(true);
      try {
        await generatePDF(mealPlan, startDate, { showToddlerTips, showGlucoseTips });
        toast({ title: "PDF downloaded!" });
      } catch (err: unknown) {
        Sentry.captureException(err, { tags: { feature: "export", action: "pdf_generation" } });
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("PDF error:", err);
        toast({ title: "PDF generation failed", description: message, variant: "destructive" });
      } finally {
        setGeneratingPdf(false);
      }
    } else if (key === "ics") {
      const ics = generateICS(mealPlan, startDate, prepTips);
      downloadFile(ics, "meal-plan.ics", "text/calendar");
    } else if (key === "csv") {
      const csv = generateCSV(mealPlan, { showToddlerTips, showGlucoseTips });
      downloadFile(csv, "meal-plan.csv", "text/csv");
    }
  };

  const allMeals = mealPlan.weekPlan.days.flatMap((d) => d.meals);

  return (
    <>
      <PrintContent mealPlan={mealPlan} startDate={startDate} showToddlerTips={showToddlerTips} showGlucoseTips={showGlucoseTips} />
      <div className="space-y-6 print:hidden">
        {/* Header */}
        <div className="text-center">
          <h2 className="font-heading font-bold text-lg text-foreground mb-0.5">
            {mealPlan.weekPlan.title}
          </h2>
          <p className="text-xs text-muted-foreground">
            {mealPlan.weekPlan.days.length} days · {allMeals.length} meals ready to export
          </p>
        </div>

        {/* Export cards */}
        <div className="grid gap-3">
          {exportOptions.map((opt) => {
            const isPdf = opt.key === "pdf";
            return (
              <button
                key={opt.key}
                onClick={() => handleExport(opt.key)}
                disabled={isPdf && generatingPdf}
                className="group flex items-center gap-4 bg-card rounded-2xl p-4 shadow-card border border-border hover:border-primary/30 hover:shadow-elevated transition-all text-left disabled:opacity-60"
              >
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                  {isPdf && generatingPdf ? (
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  ) : (
                    <opt.icon className="w-5 h-5 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-heading font-semibold text-sm text-foreground">
                    {isPdf && generatingPdf ? "Generating PDF..." : opt.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {opt.description}
                  </p>
                </div>
                <Download className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default ExportContent;
