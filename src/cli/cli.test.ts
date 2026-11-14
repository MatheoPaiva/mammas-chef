// @vitest-environment node
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { parseCli, run, errorMessage } from "./cli";
import { CliError, canonicalize, planSummary, secondOpinionCheck, NOTICE } from "./commands";
import { fileSessionStorage } from "@/integrations/supabase/fileSessionStorage";
import { ALLERGY_OPTIONS } from "@/constants/preferences";
import type { MealPlanResponse, MealRecipe } from "@/types/mealPlan";

function captureStdout() {
  const out: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return { text: () => out.join(""), spy };
}
afterEach(() => vi.restoreAllMocks());

describe("parseCli", () => {
  it("splits the command, positionals and options", () => {
    expect(parseCli(["swap", "latest", "tue", "dinner", "something", "faster", "--json"])).toEqual({
      command: "swap", args: ["latest", "tue", "dinner", "something", "faster"], opts: { json: true },
    });
    expect(parseCli(["plan", "next week", "--start-date", "2026-11-22", "--skip", "Saturday"]).opts)
      .toEqual({ "start-date": "2026-11-22", skip: "Saturday" });
    expect(parseCli([]).command).toBe("help");
  });

  it("rejects unknown options with a pointer to help", () => {
    expect(() => parseCli(["plans", "--jsn"])).toThrow(/Unknown option '--jsn'.*mammaschef help/);
  });
});

describe("run", () => {
  it("prints errors as JSON on stdout with --json and exits 1", async () => {
    const out = captureStdout();
    expect(await run(["delete", "latest", "--json"])).toBe(1);
    expect(JSON.parse(out.text())).toEqual({ error: "Deleting can't be undone. Add --yes to confirm." });
  });

  it("prints help as text", async () => {
    const out = captureStdout();
    expect(await run(["help"])).toBe(0);
    expect(out.text()).toContain('plan "<request>"');
  });
});

describe("errorMessage", () => {
  it("turns connection failures into a start hint", () => {
    expect(errorMessage(new TypeError("fetch failed"))).toMatch(/mammaschef start/);
    expect(errorMessage(new CliError("Daily limit reached"))).toBe("Daily limit reached");
  });
});

describe("canonicalize", () => {
  it("maps case and common words to the app's allergy names", () => {
    expect(canonicalize(["sesame", "DAIRY", "tree nuts"], ALLERGY_OPTIONS, "allergy", { dairy: "Milk", "tree nuts": "Nuts" }))
      .toEqual(["Sesame", "Milk", "Nuts"]);
  });

  it("rejects unknown names instead of dropping them", () => {
    expect(() => canonicalize(["kiwi"], ALLERGY_OPTIONS, "allergy")).toThrow(/Unknown allergy "kiwi"/);
  });
});

describe("planSummary", () => {
  const meal = (o: Partial<MealRecipe>) => ({
    id: "m", title: "Wrap", mealType: "lunch", prepTime: "", servings: 2, calories: 0, protein: 0, carbs: 0, fats: 0,
    tags: [], ingredients: [], steps: [], ...o,
  }) as MealRecipe;

  it("reports allergy warnings word for word, plus the notice", () => {
    const plan = {
      weekPlan: { title: "Week", days: [{ day: "Monday", meals: [
        meal({ title: "Hummus Wrap", cautionNote: "Allergy warning: may contain Sesame. Check every ingredient before cooking." }),
        meal({ mealType: "dinner", title: "Soup", cautionNote: "High sodium" }),
      ] }] },
      shoppingList: [], prepTips: [], startDate: "2026-11-15",
    } as MealPlanResponse;
    const s = planSummary("plan-1", plan, "Sunday");
    expect(s.allergen_warnings).toEqual([{
      day: "Monday", meal: "lunch", title: "Hummus Wrap",
      note: "Allergy warning: may contain Sesame. Check every ingredient before cooking.",
    }]);
    expect(s.notice).toBe(NOTICE);
    expect(s.start_date).toBe("2026-11-15");
  });

  it("reports the second allergen check as off without a gateway key", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-env-"));
    writeFileSync(join(dir, "on"), "CEREBRAS_API_KEY=x\nAI_GATEWAY_API_KEY=abc\n");
    writeFileSync(join(dir, "off"), "CEREBRAS_API_KEY=x\n# AI_GATEWAY_API_KEY=\n");
    expect(secondOpinionCheck(join(dir, "on"))).toBe("on");
    expect(secondOpinionCheck(join(dir, "off"))).toBe("off");
    expect(secondOpinionCheck(join(dir, "missing"))).toBe("off");
  });
});

describe("fileSessionStorage", () => {
  it("round-trips values in a file only the user can read", async () => {
    const home = mkdtempSync(join(tmpdir(), "mc-home-"));
    vi.stubEnv("HOME", home);
    try {
      expect(await fileSessionStorage.getItem("k")).toBeNull();
      await fileSessionStorage.setItem("k", "v");
      await fileSessionStorage.setItem("other", "w");
      expect(await fileSessionStorage.getItem("k")).toBe("v");
      await fileSessionStorage.removeItem("k");
      expect(await fileSessionStorage.getItem("k")).toBeNull();
      const file = join(home, ".config", "mammaschef", "session.json");
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ other: "w" });
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
