// Argument parsing, dispatch and output for `mammaschef`. Results go to stdout
// (JSON with --json); progress and errors go to stderr.
import { parseArgs } from "node:util";
import * as cmd from "./commands";
import * as stack from "./stack";
import { CliError } from "./commands";

export const HELP = `mammaschef — plan meals from the terminal or your AI agent

Setup (run these yourself):
  init [--email you@example.com]   Sign in or create your account (asks for a password)
  start | stop                     Start or stop the database and AI functions
  doctor                           Check setup and say how to fix each problem
  profile                          Show household, allergies and preferences
  profile set [--household N] [--allergies a,b] [--diet a,b] [--cuisines a,b]
              [--toddler yes|no] [--glucose yes|no] [--week-start Sunday|Monday]

Plans (<plan> is an id, the first 8+ characters of one, or "latest"):
  plan "<request>" [--start-date YYYY-MM-DD] [--meals breakfast,lunch,dinner] [--skip Saturday,Sunday]
  plans                            List saved plans
  show <plan> [--full]             Show a plan (--full adds ingredients and steps)
  swap <plan> <day> <meal> [hint]  Replace one meal and save
  regen <plan> <day> [hint]        Replace a day's meals and save
  shopping <plan>                  Print the shopping list
  recipes search <query>           Search the recipe library
  recipes add <plan> <day> <meal> <recipe-id>
  favorite <plan> <day> <meal>     Save a meal to favorites
  delete <plan> --yes              Delete a plan (CLI only)

  mcp                              Run as a local MCP server for AI agents (stdio)

Every command takes --json. Edits save immediately.`;

const OPTIONS = {
  json: { type: "boolean" },
  yes: { type: "boolean" },
  full: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  email: { type: "string" },
  "start-date": { type: "string" },
  meals: { type: "string" },
  skip: { type: "string" },
  household: { type: "string" },
  allergies: { type: "string" },
  diet: { type: "string" },
  cuisines: { type: "string" },
  toddler: { type: "string" },
  glucose: { type: "string" },
  "week-start": { type: "string" },
} as const;

export function parseCli(argv: string[]) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    throw new CliError(`${(e as Error).message}. Run \`mammaschef help\`.`);
  }
  const [command = "help", ...args] = parsed.positionals;
  return { command, args, opts: parsed.values };
}

type Opts = ReturnType<typeof parseCli>["opts"];

const list = (v?: string) => (v === undefined ? undefined : v.split(",").map((s) => s.trim()).filter(Boolean));
function yesNo(v: string | undefined, name: string) {
  if (v === undefined) return undefined;
  if (/^(yes|y|true|on)$/i.test(v)) return true;
  if (/^(no|n|false|off)$/i.test(v)) return false;
  throw new CliError(`--${name} takes yes or no.`);
}
function need(args: string[], count: number, usage: string) {
  if (args.length < count) throw new CliError(`Usage: mammaschef ${usage}`);
  return args;
}

export async function dispatch(command: string, args: string[], opts: Opts): Promise<unknown> {
  switch (command) {
    case "help": return { help: HELP };
    case "init": return stack.init(opts.email);
    case "start": return stack.start();
    case "stop": return stack.stop();
    case "doctor": return stack.doctor();
    case "profile":
      if (args[0] !== "set") return cmd.getProfile();
      return cmd.updateProfile({
        household: opts.household === undefined ? undefined : Number(opts.household),
        allergies: list(opts.allergies),
        diet: list(opts.diet),
        cuisines: list(opts.cuisines),
        toddler: yesNo(opts.toddler, "toddler"),
        glucose: yesNo(opts.glucose, "glucose"),
        weekStart: opts["week-start"],
      });
    case "plan": {
      process.stderr.write("Writing your plan. This takes about a minute...\n");
      return cmd.makePlan({ request: args.join(" "), startDate: opts["start-date"], meals: list(opts.meals), skipDays: list(opts.skip) });
    }
    case "plans": return cmd.listPlans();
    case "show": return cmd.showPlan(need(args, 1, "show <plan>")[0], !!opts.full);
    case "swap": {
      const [plan, day, meal, ...hint] = need(args, 3, "swap <plan> <day> <meal> [hint]");
      return cmd.swap(plan, day, meal, hint.join(" ") || undefined);
    }
    case "regen": {
      const [plan, day, ...hint] = need(args, 2, "regen <plan> <day> [hint]");
      return cmd.regen(plan, day, hint.join(" ") || undefined);
    }
    case "shopping": return cmd.shopping(need(args, 1, "shopping <plan>")[0]);
    case "recipes":
      if (args[0] === "search") return cmd.searchRecipes(need(args, 2, "recipes search <query>").slice(1).join(" "));
      if (args[0] === "add") {
        const [, plan, day, meal, recipeId] = need(args, 5, "recipes add <plan> <day> <meal> <recipe-id>");
        return cmd.addRecipe(plan, day, meal, recipeId);
      }
      throw new CliError("Usage: mammaschef recipes search <query> | recipes add <plan> <day> <meal> <recipe-id>");
    case "favorite": {
      const [plan, day, meal] = need(args, 3, "favorite <plan> <day> <meal>");
      return cmd.favorite(plan, day, meal);
    }
    case "delete": {
      const [plan] = need(args, 1, "delete <plan> --yes");
      if (!opts.yes) throw new CliError("Deleting can't be undone. Add --yes to confirm.");
      return cmd.deletePlan(plan);
    }
    default:
      throw new CliError(`Unknown command "${command}". Run \`mammaschef help\`.`);
  }
}

/** Connection failures mean the local stack is down; say what to run instead of a raw error. */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof CliError) return msg;
  if (/fetch failed|ECONNREFUSED|Failed to fetch|NetworkError/i.test(msg)) {
    return "Can't reach the local database or AI functions. Run `mammaschef start` (and check `mammaschef doctor`).";
  }
  return msg;
}

// ---------- Human-readable output ----------

type Warning = { day: string; meal: string; title: string; note: string };

function warningsText(r: { allergen_warnings?: Warning[]; second_opinion_check?: string; notice?: string }) {
  const lines: string[] = [];
  for (const w of r.allergen_warnings ?? []) lines.push(`!! ${w.day} ${w.meal} — ${w.title}: ${w.note}`);
  if (r.second_opinion_check === "off") lines.push("Second allergen check is off (no AI_GATEWAY_API_KEY).");
  if (r.notice) lines.push(r.notice);
  return lines;
}

type Result<F extends (...a: never[]) => unknown> = Awaited<ReturnType<F>>;
type PlanResult = Result<typeof cmd.makePlan> & Partial<Result<typeof cmd.showPlan>> & {
  changed?: { day: string; meal?: string; to: string | string[] };
  leftovers_updated?: string[];
};

function planText(r: PlanResult) {
  const lines = [`${r.title} (plan ${r.plan_id.slice(0, 8)}${r.start_date ? `, week of ${r.start_date}` : ""})`];
  if (r.changed) lines.push(`Changed ${r.changed.day}${r.changed.meal ? ` ${r.changed.meal}` : ""}: ${[r.changed.to].flat().join(", ")}`);
  lines.push(...(r.leftovers_updated ?? []));
  for (const d of r.days ?? []) {
    lines.push(`\n${d.day}`);
    for (const m of d.meals) lines.push(`  ${m.meal.padEnd(9)} ${m.title}${m.status === "leftover" ? " (leftover)" : ""}${m.caution ? `  — ${m.caution}` : ""}`);
  }
  if (r.missing_meals) lines.push(`${r.missing_meals} meal(s) missing — regenerate those days.`);
  return [...lines, "", ...warningsText(r)].join("\n");
}

export function toText(command: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (typeof r.help === "string") return r.help;
  if (command === "doctor") {
    const d = result as Result<typeof stack.doctor>;
    const lines = d.checks.map((c) => `${c.ok ? "ok " : "FIX"} ${c.check.padEnd(10)} ${c.detail}${"fix" in c ? ` — ${c.fix}` : ""}`);
    lines.push(`    second opinion: ${d.second_opinion_check}${d.second_opinion_fix ? ` — ${d.second_opinion_fix}` : ""}`);
    return lines.join("\n");
  }
  if (r.plans) {
    const { plans } = result as Result<typeof cmd.listPlans>;
    return plans.map((p) => `${p.plan_id.slice(0, 8)}  ${p.start_date ?? "no date   "}  ${p.meals} meals  ${p.title}`).join("\n") || "No saved plans.";
  }
  if (r.recipes) {
    const { recipes } = result as Result<typeof cmd.searchRecipes>;
    return recipes.map((x) => `${x.recipe_id}  ${x.title} (${x.meal_types.join("/")}${x.total_minutes ? `, ${x.total_minutes} min` : ""})${x.allergen_warning ? `  !! ${x.allergen_warning}` : ""}`).join("\n") || "No matches.";
  }
  if (r.aisles) {
    const s = result as Result<typeof cmd.shopping>;
    const body = s.aisles.flatMap((a) => [`\n${a.aisle}`, ...a.items.map((i) => `  ${i.on_hand ? "(have) " : ""}${i.quantity ? `${i.quantity} ` : ""}${i.item}`)]);
    return [`Shopping list — ${s.title}`, ...body, "", ...warningsText(s)].join("\n");
  }
  if (r.plan_id && r.notice) return planText(result as PlanResult);
  if (r.deleted) return `Deleted plan ${r.deleted}.`;
  if (r.saved) return `Saved ${r.day} ${r.meal} (${r.title}) to favorites.`;
  if (r.next) return `Signed in as ${r.email}${r.created ? " (new account)" : ""}.\n${r.next}`;
  return JSON.stringify(result, null, 2);
}

export async function run(argv: string[]): Promise<number> {
  let json = argv.includes("--json");
  try {
    const { command, args, opts } = parseCli(argv);
    json = !!opts.json;
    const result = await dispatch(opts.help ? "help" : command, args, opts);
    process.stdout.write(`${json ? JSON.stringify(result, null, 2) : toText(command, result)}\n`);
    return command === "doctor" && !(result as { ok: boolean }).ok ? 1 : 0;
  } catch (e) {
    const message = errorMessage(e);
    if (json) process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else process.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}
