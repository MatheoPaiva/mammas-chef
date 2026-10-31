/**
 * Second-opinion allergen judge — a purely ADDITIVE safety layer on top of the
 * keyword-based `checkAllergens()`. It NEVER replaces that check; it only
 * augments the same `AllergenViolation[]` array the existing retry path
 * already consumes (see generate-meal-plan/index.ts Step 3).
 *
 * Contract: this module FAILS OPEN on every failure mode. A missing key, a
 * non-2xx response, a timeout, an abort, a malformed body, or any thrown
 * error must never propagate — every path returns `[]` and, at most, warns.
 * A generation must never fail because this layer failed.
 *
 * Design notes:
 * - `matchedKeyword` reuses the EXISTING `AllergenViolation` shape rather than
 *   inventing a parallel type. Since JEV judges a whole recipe against an
 *   allergen (not a single ingredient string), there is no real "matched
 *   keyword" — the marker `jev:p=<probability>` (e.g. `jev:p=0.93`) is used
 *   instead, both to make the source of the violation traceable in logs/the
 *   retry prompt, and to give `isJudgeViolation()` something to key off of.
 * - `ingredient` similarly has no natural single value for a whole-recipe
 *   judgment. It is filled with a truncated, comma-joined summary of the
 *   recipe's own ingredient names, so the existing retry prompt line
 *   (`Recipe "X" contains "<ingredient>" which matches allergen "Y"
 *   (keyword: "<matchedKeyword>")`) still reads as something actionable.
 */

import type { AllergenViolation } from "./allergens.ts";

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const JEV_EVALUATE_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
const JEV_MODEL = "typesafe-ai/jev";

export const JEV_MARKER_PREFIX = "jev:";

// Enforcement cutoff, measured — not guessed. Sampling the same judgments 6x
// against live jev showed confident answers are near-deterministic (za'atar ->
// Sesame 0.89-0.90, labneh -> Milk 0.97-0.98, a clean chickpea salad 0.19-0.20,
// all +/-0.01) while a genuinely ambiguous one swings widely: tarator -> Nuts
// ranged 0.60-0.68 across runs. At 0.65 that REAL nut violation was missed in
// 4 of 18 samples; at 0.60 it was missed in 0, at the cost of one false flag
// (tarator -> Milk, ~0.58-0.61). A false flag costs one regeneration the retry
// budget already accounts for; a miss puts an allergen in front of a child, so
// this layer is deliberately tuned for recall over precision.
const DEFAULT_THRESHOLD = 0.60;
const MID_BAND_FLOOR = 0.4;
const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_CHUNK_TOKENS = 24_000;
const CHARS_PER_TOKEN = 4;
const STATE_NOTE = "Judge each recipe only from its own listed ingredients.";

const MID_BAND_LOG_CAP = 20;
const INGREDIENT_SUMMARY_MAX_CHARS = 120;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Is this violation one the JEV second opinion produced (vs. the original
 * keyword matcher)? A one-liner over the marker prefix.
 */
export function isJudgeViolation(v: AllergenViolation): boolean {
  return v.matchedKeyword.startsWith(JEV_MARKER_PREFIX);
}

/**
 * Run the batched JEV second-opinion allergen check over a generated plan's
 * recipes. Fails open on every error path — never throws.
 */
export async function judgeAllergens(
  recipes: Array<{ title: string; ingredients: Array<{ name: string }> }>,
  userAllergens: string[],
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<AllergenViolation[]> {
  // Zero declared allergens or zero recipes => zero cost. Checked before any
  // env read or fetch so this is a true early-exit, not just an empty result.
  if (!recipes || recipes.length === 0 || !userAllergens || userAllergens.length === 0) {
    return [];
  }

  // ponytail: resolve the key inline rather than calling aiGatewayConfig() —
  // that helper THROWS when the key is missing (violates this module's
  // fail-open contract) and it also resolves a chat model this evaluate-only
  // path never uses.
  // Only a Vercel AI Gateway key: this endpoint is Vercel's, so another provider's key must never reach it.
  const apiKey = Deno.env.get("AI_GATEWAY_API_KEY");
  if (!apiKey) {
    console.warn("[allergen-judge] no AI_GATEWAY_API_KEY configured — skipping second opinion");
    return [];
  }

  // Read at CALL time (not module load) so the env override is redeploy-free
  // and testable — mirrors the RETRY_TIME_BUDGET_MS pattern at
  // generate-meal-plan/index.ts:2046.
  const threshold = resolveThreshold();

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const startedAt = Date.now();
  const chunks = buildChunks(recipes, userAllergens);

  const chunkResults = await Promise.all(
    chunks.map((chunk) => runChunk(chunk, { apiKey, threshold, timeoutMs, fetchImpl })),
  );

  const violations = chunkResults.flatMap((r) => r.violations);
  const costs = chunkResults.map((r) => r.cost).filter((c): c is string => typeof c === "string");
  const elapsedMs = Date.now() - startedAt;

  console.log(
    `[allergen-judge] violations=${violations.length} threshold=${threshold} elapsedMs=${elapsedMs} chunks=${chunks.length}` +
      (costs.length > 0 ? ` cost=${costs.join("+")}` : ""),
  );

  return violations;
}

/**
 * Resolve the enforcement threshold from `JEV_ALLERGEN_THRESHOLD`.
 *
 * Range-checked to (0, 1] rather than the usual bare parse-or-default, because
 * this number gates a SAFETY layer. A plausible typo — `65` meaning "65%" —
 * would otherwise be accepted as a valid threshold that no probability can
 * ever reach, silently disabling every judgment while the layer still appears
 * to run. NaN, empty, 0, negatives, and anything above 1 all fall back to the
 * default and warn loudly.
 */
function resolveThreshold(): number {
  const raw = Deno.env.get("JEV_ALLERGEN_THRESHOLD");
  if (raw === undefined || raw.trim() === "") return DEFAULT_THRESHOLD;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    console.warn(
      `[allergen-judge] JEV_ALLERGEN_THRESHOLD="${raw}" is not a probability in (0, 1] — ` +
        `ignoring it and using ${DEFAULT_THRESHOLD}. Enforcement is NOT disabled.`,
    );
    return DEFAULT_THRESHOLD;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Question construction + chunking
// ---------------------------------------------------------------------------

interface QuestionMeta {
  id: string;
  recipeTitle: string;
  allergen: string;
  ingredientSummary: string;
  instructions: string;
  estimatedChars: number;
}

function truncateSummary(s: string, max = INGREDIENT_SUMMARY_MAX_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

/** Coerce a recipe's ingredient names into a clean string array — defensive
 * against a malformed meal object reaching this far (e.g. a null/undefined
 * `name`, or a non-string value). */
function coerceIngredientNames(recipe: { ingredients: Array<{ name: string }> }): string[] {
  const raw = recipe?.ingredients ?? [];
  return raw
    .map((ing) => {
      const name = (ing as { name?: unknown } | null | undefined)?.name;
      return typeof name === "string" ? name : String(name ?? "");
    })
    .filter((name) => name.length > 0);
}

function buildChunks(
  recipes: Array<{ title: string; ingredients: Array<{ name: string }> }>,
  userAllergens: string[],
): QuestionMeta[][] {
  const perRecipeQuestions: QuestionMeta[][] = recipes.map((recipe, recipeIndex) => {
    const ingredientNames = coerceIngredientNames(recipe);
    const ingredientSummary = truncateSummary(ingredientNames.join(", "));

    return userAllergens.map((allergen, allergenIndex) => {
      const instructions =
        `Recipe "${recipe.title}" with ingredients ${JSON.stringify(ingredientNames)}. ` +
        `Could any ingredient contain or be derived from ${allergen}?`;
      return {
        id: `r${recipeIndex}a${allergenIndex}`,
        recipeTitle: recipe.title,
        allergen,
        ingredientSummary,
        instructions,
        estimatedChars: instructions.length,
      };
    });
  });

  const chunks: QuestionMeta[][] = [];
  let currentChunk: QuestionMeta[] = [];
  let currentChars = 0;

  for (const recipeQuestions of perRecipeQuestions) {
    const recipeChars = recipeQuestions.reduce((sum, q) => sum + q.estimatedChars, 0);
    // ponytail: chars/4 is a rough token estimate, not a real tokenizer — no
    // new dependency, and comfortably conservative under the model's real
    // limits for this purpose (a chunk-sizing heuristic, not a hard cap).
    const recipeTokens = recipeChars / CHARS_PER_TOKEN;
    const currentTokens = currentChars / CHARS_PER_TOKEN;

    if (currentChunk.length > 0 && currentTokens + recipeTokens > MAX_CHUNK_TOKENS) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 0;
    }

    // ponytail: a single recipe whose own question block alone exceeds the
    // chunk cap still gets its own chunk here — we never drop a recipe. Such
    // an oversized lone chunk may 400 upstream, which fails open for that
    // chunk only (see runChunk's catch-all below).
    currentChunk.push(...recipeQuestions);
    currentChars += recipeChars;
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  return chunks;
}

// ---------------------------------------------------------------------------
// Per-chunk request + fail-open handling
// ---------------------------------------------------------------------------

interface ChunkContext {
  apiKey: string;
  threshold: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

interface ChunkResult {
  violations: AllergenViolation[];
  cost?: string;
}

async function runChunk(questions: QuestionMeta[], ctx: ChunkContext): Promise<ChunkResult> {
  const idMap = new Map(questions.map((q) => [q.id, q]));
  const questionsBody: Record<string, { type: "boolean"; instructions: string }> = {};
  for (const q of questions) {
    questionsBody[q.id] = { type: "boolean", instructions: q.instructions };
  }

  const body = {
    model: JEV_MODEL,
    state: { note: STATE_NOTE },
    questions: questionsBody,
  };

  try {
    const response = await ctx.fetchImpl(JEV_EVALUATE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ctx.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn(`[allergen-judge] non-2xx response (${response.status}): ${text.slice(0, 200)}`);
      return { violations: [] };
    }

    const data = await response.json();

    const answers = (data as { answers?: unknown } | null)?.answers;
    if (!answers || typeof answers !== "object") {
      console.warn(`[allergen-judge] malformed response — missing or non-object "answers"`);
      return { violations: [] };
    }

    const violations: AllergenViolation[] = [];
    const midBand: Array<{ title: string; allergen: string; p: number }> = [];
    let anomalies = 0;

    for (const [id, rawAnswer] of Object.entries(answers as Record<string, unknown>)) {
      const q = idMap.get(id);
      if (!q) {
        anomalies++;
        continue; // unknown id — not one of ours
      }

      const probability = (rawAnswer as { probability?: unknown } | null)?.probability;
      if (typeof probability !== "number" || !Number.isFinite(probability)) {
        anomalies++;
        continue;
      }

      if (probability >= ctx.threshold) {
        violations.push({
          allergen: q.allergen,
          recipeTitle: q.recipeTitle,
          ingredient: q.ingredientSummary,
          matchedKeyword: `${JEV_MARKER_PREFIX}p=${probability.toFixed(2)}`,
        });
      } else if (probability >= MID_BAND_FLOOR) {
        midBand.push({ title: q.recipeTitle, allergen: q.allergen, p: probability });
      }
    }

    // Aggregated mid-band telemetry — ONE warn per chunk, never one line per
    // judgment (56 judgments must not produce 56 log lines). Calibration-only:
    // this tier never alters the returned violations.
    if (midBand.length > 0) {
      const capped = midBand.slice(0, MID_BAND_LOG_CAP);
      const more = midBand.length > MID_BAND_LOG_CAP ? ` (+${midBand.length - MID_BAND_LOG_CAP} more)` : "";
      const entries = capped.map((m) => `${m.title}|${m.allergen}|${m.p}`).join(", ");
      console.warn(
        `[allergen-judge] mid-band (calibration-only, NOT enforced) threshold=${ctx.threshold}: ${entries}${more}`,
      );
    }

    if (anomalies > 0) {
      console.warn(`[allergen-judge] skipped ${anomalies} unusable answer(s) (unknown id or non-finite probability)`);
    }

    const cost = (data as { providerMetadata?: { gateway?: { cost?: unknown } } } | null)?.providerMetadata?.gateway
      ?.cost;

    return { violations, cost: typeof cost === "string" ? cost : undefined };
  } catch (err) {
    // Single try/catch over fetch + .json() + the answer walk — never log
    // the API key.
    console.warn(`[allergen-judge] chunk request failed: ${err instanceof Error ? err.message : String(err)}`);
    return { violations: [] };
  }
}
