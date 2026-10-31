/**
 * Deno tests for the JEV second-opinion allergen judge — stubbed `fetch`,
 * NO `--allow-net` permission granted. Run with:
 *   deno test --allow-env supabase/functions/_shared/allergenJudge_test.ts
 *
 * If any test tried to make a live network call, the missing --allow-net
 * permission would produce a hard Deno permission error, not a silent pass.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isJudgeViolation, JEV_MARKER_PREFIX, judgeAllergens } from "./allergenJudge.ts";
import type { AllergenViolation } from "./allergens.ts";

// ---------------------------------------------------------------------------
// Console capture helper
// ---------------------------------------------------------------------------

function captureConsole(method: "log" | "warn" | "error") {
  const original = console[method];
  const lines: string[] = [];
  // deno-lint-ignore no-explicit-any
  console[method] = (...args: any[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  return {
    lines,
    restore: () => {
      console[method] = original;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures — verbatim from the plan's <test_fixtures> block
// ---------------------------------------------------------------------------

const ALLERGENS = ["Nuts", "Sesame", "Milk", "Fish"];

const TRUE_POSITIVE_RECIPES: Array<{ title: string; ingredients: string[]; expect: string[] }> = [
  { title: "Za'atar Flatbread", ingredients: ["za'atar", "sumac", "olive oil", "flatbread"], expect: ["Sesame"] },
  { title: "Muhammara Dip", ingredients: ["muhammara", "pita chips", "flat-leaf parsley"], expect: ["Nuts", "Sesame"] },
  { title: "Labneh Bowl", ingredients: ["labneh", "olive oil", "cucumber", "mint"], expect: ["Milk"] },
  { title: "Halloumi Skewers", ingredients: ["halloumi", "zucchini", "oregano", "lemon"], expect: ["Milk"] },
  { title: "Tarator Sauce Bowl", ingredients: ["tarator", "garlic", "lemon juice"], expect: ["Nuts"] },
  {
    title: "Worcestershire Braised Greens",
    ingredients: ["worcestershire sauce", "collard greens", "shallots"],
    expect: ["Fish"],
  },
  { title: "Dukkah Roasted Carrots", ingredients: ["dukkah", "carrots", "olive oil"], expect: ["Nuts", "Sesame"] },
  { title: "Taramasalata Platter", ingredients: ["taramasalata", "crudites", "lemon"], expect: ["Fish"] },
];

// NOTE (deviation, documented in SUMMARY.md): the plan's prose says "8 recipes,
// 11 expected violations", but the fixture table above — which is the only
// enumerable ground truth — sums to exactly 10 recipe×allergen pairs (1 + 2 + 1
// + 1 + 1 + 1 + 2 + 1 = 10). Using the table as ground truth since it is the
// actual verifiable data; inventing an 11th pair not present in the table would
// be arbitrary.
const GROUND_TRUTH_PAIRS: Array<{ title: string; allergen: string }> = TRUE_POSITIVE_RECIPES.flatMap((r) =>
  r.expect.map((allergen) => ({ title: r.title, allergen }))
);

const CLEAN_RECIPES: Array<{ title: string; ingredients: string[] }> = [
  { title: "Chickpea Salad", ingredients: ["chickpeas", "cucumber", "red onion", "parsley", "olive oil"] },
  { title: "Lemon Herb Quinoa", ingredients: ["quinoa", "lemon zest", "dill", "olive oil"] },
  { title: "Roasted Root Vegetables", ingredients: ["carrots", "parsnips", "beets", "thyme", "olive oil"] },
  { title: "Shakshuka", ingredients: ["eggs", "tomatoes", "bell pepper", "cumin", "paprika"] },
  { title: "Lentil Soup", ingredients: ["brown lentils", "onion", "carrot", "cumin", "vegetable broth"] },
  { title: "Grilled Chicken Souvlaki", ingredients: ["chicken thighs", "oregano", "lemon", "garlic", "olive oil"] },
];

function toRecipe(fixture: { title: string; ingredients: string[] }) {
  return { title: fixture.title, ingredients: fixture.ingredients.map((name) => ({ name })) };
}

const FIXTURE_RECIPES = [...TRUE_POSITIVE_RECIPES, ...CLEAN_RECIPES].map(toRecipe);

function idFor(recipeTitle: string, allergen: string): string {
  const recipeIndex = FIXTURE_RECIPES.findIndex((r) => r.title === recipeTitle);
  const allergenIndex = ALLERGENS.indexOf(allergen);
  return `r${recipeIndex}a${allergenIndex}`;
}

// ---------------------------------------------------------------------------
// Stub fetch factory
// ---------------------------------------------------------------------------

interface CapturedCall {
  url: string;
  init: RequestInit;
  body: {
    model: string;
    state: { note: string };
    questions: Record<string, { type: string; instructions: string }>;
  };
}

function makeStubFetch(opts: {
  answerFor?: (id: string) => number | undefined;
  defaultProbability?: number;
}) {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    calls.push({ url: String(url), init: init as RequestInit, body });
    const answers: Record<string, { type: string; probability: number }> = {};
    for (const id of Object.keys(body.questions)) {
      const p = opts.answerFor?.(id) ?? opts.defaultProbability ?? 0.2;
      answers[id] = { type: "boolean", probability: p };
    }
    return new Response(
      JSON.stringify({ answers, model: "typesafe-ai/jev", providerMetadata: { gateway: { cost: "0.000132" } } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const gtIds = new Set(GROUND_TRUTH_PAIRS.map((p) => idFor(p.title, p.allergen)));

// Most tests exercise the request/answer path, not the missing-key fail-open
// path (that's covered explicitly by fail-open matrix step (a)). Ensure a key
// is present by default so those tests actually reach the stubbed fetch;
// tests that need to exercise key-absence save/delete/restore around it.
if (!Deno.env.get("AI_GATEWAY_API_KEY")) {
  Deno.env.set("AI_GATEWAY_API_KEY", "test-fixture-key-for-allergen-judge-tests");
}

// ---------------------------------------------------------------------------
// 1. Request shape
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: request shape — one batched call for the 14-recipe fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { fetchImpl, calls } = makeStubFetch({ defaultProbability: 0.2 });
    const result = await judgeAllergens(FIXTURE_RECIPES, ALLERGENS, { fetchImpl });

    assertEquals(calls.length, 1);
    const body = calls[0].body;
    assertEquals(body.model, "typesafe-ai/jev");
    assertEquals(Object.keys(body.questions).length, 56);
    for (const q of Object.values(body.questions)) {
      assertEquals(Object.keys(q).sort(), ["instructions", "type"]);
      assertEquals(q.type, "boolean");
      assertEquals(typeof q.instructions, "string");
    }
    assertEquals(body.state.note, "Judge each recipe only from its own listed ingredients.");
    assertEquals("stream" in body, false);
    assertEquals(JSON.stringify(body).includes("criteria"), false);
    assertEquals(calls[0].url.endsWith("/v1/evaluate"), true);
    assertEquals(result.length, 0);
  },
});

// ---------------------------------------------------------------------------
// 2. Exact wording
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: exact question wording for Za'atar Flatbread / Sesame",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { fetchImpl, calls } = makeStubFetch({ defaultProbability: 0.2 });
    await judgeAllergens(FIXTURE_RECIPES, ALLERGENS, { fetchImpl });

    const id = idFor("Za'atar Flatbread", "Sesame");
    const body = calls[0].body;
    assertEquals(
      body.questions[id].instructions,
      `Recipe "Za'atar Flatbread" with ingredients ["za'atar","sumac","olive oil","flatbread"]. Could any ingredient contain or be derived from Sesame?`,
    );
  },
});

// ---------------------------------------------------------------------------
// 3. Auth header + key never logged
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: auth header present, key never appears in console output",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const TEST_KEY = "test-secret-key-abc123";
    const saved = Deno.env.get("AI_GATEWAY_API_KEY");
    Deno.env.set("AI_GATEWAY_API_KEY", TEST_KEY);
    const logCap = captureConsole("log");
    const warnCap = captureConsole("warn");
    const errCap = captureConsole("error");
    try {
      const { fetchImpl, calls } = makeStubFetch({ defaultProbability: 0.2 });
      await judgeAllergens([FIXTURE_RECIPES[0]], ["Sesame"], { fetchImpl });

      const init = calls[0].init;
      const headers = init.headers as Record<string, string>;
      assertEquals(headers["Authorization"], `Bearer ${TEST_KEY}`);
      assertEquals(headers["Content-Type"], "application/json");

      const allOutput = [...logCap.lines, ...warnCap.lines, ...errCap.lines].join("\n");
      assertEquals(allOutput.includes(TEST_KEY), false);
    } finally {
      logCap.restore();
      warnCap.restore();
      errCap.restore();
      if (saved !== undefined) Deno.env.set("AI_GATEWAY_API_KEY", saved);
      else Deno.env.delete("AI_GATEWAY_API_KEY");
    }
  },
});

// ---------------------------------------------------------------------------
// 4. True positives
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: true positives — exactly the ground-truth pairs, no misses no extras",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { fetchImpl } = makeStubFetch({
      answerFor: (id) => (gtIds.has(id) ? 0.9 : 0.2),
    });
    const result = await judgeAllergens(FIXTURE_RECIPES, ALLERGENS, { fetchImpl });

    assertEquals(result.length, GROUND_TRUTH_PAIRS.length);
    const resultPairs = result.map((v: AllergenViolation) => `${v.recipeTitle}|${v.allergen}`).sort();
    const expectedPairs = GROUND_TRUTH_PAIRS.map((p) => `${p.title}|${p.allergen}`).sort();
    assertEquals(resultPairs, expectedPairs);
  },
});

// ---------------------------------------------------------------------------
// 5. Clean controls
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: clean controls never appear in the result",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { fetchImpl } = makeStubFetch({
      answerFor: (id) => (gtIds.has(id) ? 0.9 : 0.2),
    });
    const result = await judgeAllergens(FIXTURE_RECIPES, ALLERGENS, { fetchImpl });

    const cleanTitles = new Set(CLEAN_RECIPES.map((r) => r.title));
    for (const v of result) {
      assertEquals(cleanTitles.has(v.recipeTitle), false);
    }
  },
});

// ---------------------------------------------------------------------------
// 6. Violation shape + isJudgeViolation
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: violation shape for Muhammara/Nuts, and isJudgeViolation()",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const targetId = idFor("Muhammara Dip", "Nuts");
    const { fetchImpl } = makeStubFetch({
      answerFor: (id) => (id === targetId ? 0.9 : 0.2),
    });
    const result = await judgeAllergens(FIXTURE_RECIPES, ALLERGENS, { fetchImpl });

    const v = result.find((r: AllergenViolation) => r.recipeTitle === "Muhammara Dip" && r.allergen === "Nuts");
    assert(v !== undefined, "expected a Muhammara Dip / Nuts violation");
    assertEquals(v!.allergen, "Nuts");
    assertEquals(v!.recipeTitle, "Muhammara Dip");
    assert(v!.matchedKeyword.startsWith(JEV_MARKER_PREFIX));
    assertEquals(v!.matchedKeyword, "jev:p=0.90");
    assert(v!.ingredient.length > 0);
    assert(v!.ingredient.includes("muhammara"));
    assertEquals(isJudgeViolation(v!), true);

    assertEquals(
      isJudgeViolation({ allergen: "Nuts", recipeTitle: "X", ingredient: "almond", matchedKeyword: "almond" }),
      false,
    );
  },
});

// ---------------------------------------------------------------------------
// 7. Threshold boundary (inclusive >=)
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: threshold boundary is inclusive at >=",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const recipe = { title: "Solo Recipe", ingredients: [{ name: "za'atar" }] };

    {
      const { fetchImpl } = makeStubFetch({ defaultProbability: 0.59 });
      const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
      assertEquals(result, []);
    }
    {
      const { fetchImpl } = makeStubFetch({ defaultProbability: 0.60 });
      const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
      assertEquals(result.length, 1);
    }
  },
});

// ---------------------------------------------------------------------------
// 8. Mid-band warn-only
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: mid-band tier warns but never alters the result",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const recipe = { title: "Midband Recipe", ingredients: [{ name: "muhammara" }] };

    {
      const warnCap = captureConsole("warn");
      const { fetchImpl } = makeStubFetch({ defaultProbability: 0.5 });
      const result = await judgeAllergens([recipe], ["Nuts"], { fetchImpl });
      warnCap.restore();
      assertEquals(result, []);
      assert(
        warnCap.lines.some((l) => l.includes("Midband Recipe") && l.includes("Nuts") && l.includes("0.5")),
        `expected a mid-band warn mentioning the recipe, allergen, and 0.5; got: ${JSON.stringify(warnCap.lines)}`,
      );
    }
    {
      const warnCap = captureConsole("warn");
      const { fetchImpl } = makeStubFetch({ defaultProbability: 0.39 });
      const result = await judgeAllergens([recipe], ["Nuts"], { fetchImpl });
      warnCap.restore();
      assertEquals(result, []);
      assertEquals(
        warnCap.lines.some((l) => l.includes("Midband Recipe")),
        false,
        `expected no warn mentioning the recipe below the mid-band floor; got: ${JSON.stringify(warnCap.lines)}`,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// 9. Env override (JEV_ALLERGEN_THRESHOLD)
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: JEV_ALLERGEN_THRESHOLD env override, garbage/empty fall back to 0.60",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const saved = Deno.env.get("JEV_ALLERGEN_THRESHOLD");
    const recipe = { title: "Env Recipe", ingredients: [{ name: "labneh" }] };
    try {
      Deno.env.set("JEV_ALLERGEN_THRESHOLD", "0.95");
      {
        const { fetchImpl } = makeStubFetch({ defaultProbability: 0.9 });
        const result = await judgeAllergens([recipe], ["Milk"], { fetchImpl });
        assertEquals(result, []);
      }

      Deno.env.set("JEV_ALLERGEN_THRESHOLD", "garbage");
      {
        const { fetchImpl } = makeStubFetch({ defaultProbability: 0.9 });
        const result = await judgeAllergens([recipe], ["Milk"], { fetchImpl });
        assertEquals(result.length, 1);
      }

      Deno.env.set("JEV_ALLERGEN_THRESHOLD", "");
      {
        const { fetchImpl } = makeStubFetch({ defaultProbability: 0.9 });
        const result = await judgeAllergens([recipe], ["Milk"], { fetchImpl });
        assertEquals(result.length, 1);
      }
    } finally {
      if (saved !== undefined) Deno.env.set("JEV_ALLERGEN_THRESHOLD", saved);
      else Deno.env.delete("JEV_ALLERGEN_THRESHOLD");
    }
  },
});

// ---------------------------------------------------------------------------
// 9b. Threshold range guard — an out-of-range value must NOT disable enforcement
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: out-of-range JEV_ALLERGEN_THRESHOLD never silently disables enforcement",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const saved = Deno.env.get("JEV_ALLERGEN_THRESHOLD");
    const recipe = { title: "Range Recipe", ingredients: [{ name: "labneh" }] };

    // "65" is the dangerous one: a human meaning "65%". Parsed naively it is a
    // finite number that no probability can ever reach, so the layer would
    // appear to run while enforcing nothing. 0 and negatives would flag
    // everything; >1 flags nothing. All must fall back to the 0.60 default.
    const outOfRange = ["65", "0", "-1", "1.5", "100", "Infinity"];
    try {
      for (const value of outOfRange) {
        Deno.env.set("JEV_ALLERGEN_THRESHOLD", value);
        const { fetchImpl } = makeStubFetch({ defaultProbability: 0.9 });
        const result = await judgeAllergens([recipe], ["Milk"], { fetchImpl });
        assertEquals(
          result.length,
          1,
          `threshold="${value}" must fall back to 0.60 and still flag p=0.9, got ${result.length} violation(s)`,
        );
      }

      // A valid in-range value is still honored, so the guard did not simply
      // pin the threshold to its default.
      Deno.env.set("JEV_ALLERGEN_THRESHOLD", "0.95");
      {
        const { fetchImpl } = makeStubFetch({ defaultProbability: 0.9 });
        assertEquals(await judgeAllergens([recipe], ["Milk"], { fetchImpl }), []);
      }
      // Upper boundary 1 is in range and enforceable.
      Deno.env.set("JEV_ALLERGEN_THRESHOLD", "1");
      {
        const { fetchImpl } = makeStubFetch({ defaultProbability: 1 });
        assertEquals((await judgeAllergens([recipe], ["Milk"], { fetchImpl })).length, 1);
      }
    } finally {
      if (saved !== undefined) Deno.env.set("JEV_ALLERGEN_THRESHOLD", saved);
      else Deno.env.delete("JEV_ALLERGEN_THRESHOLD");
    }
  },
});

// ---------------------------------------------------------------------------
// 10. Fail-open matrix
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: fail-open matrix — every failure mode returns [] and warns, never throws",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const recipe = { title: "Fail Recipe", ingredients: [{ name: "za'atar" }] };

    await t.step("(a) missing key — stub fetch never called", async () => {
      const savedG = Deno.env.get("AI_GATEWAY_API_KEY");
      const savedO = Deno.env.get("OPENAI_API_KEY");
      Deno.env.delete("AI_GATEWAY_API_KEY");
      // Another provider's key must not be sent to Vercel's evaluate endpoint.
      Deno.env.set("OPENAI_API_KEY", "sk-must-not-reach-vercel");
      const warnCap = captureConsole("warn");
      try {
        let called = false;
        const fetchImpl = (() => {
          called = true;
          return Promise.resolve(new Response("{}"));
        }) as typeof fetch;
        const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
        assertEquals(result, []);
        assertEquals(called, false);
        assert(warnCap.lines.length > 0);
      } finally {
        warnCap.restore();
        if (savedG !== undefined) Deno.env.set("AI_GATEWAY_API_KEY", savedG);
        if (savedO !== undefined) Deno.env.set("OPENAI_API_KEY", savedO);
        else Deno.env.delete("OPENAI_API_KEY");
      }
    });

    await t.step("(b) 500 with a text body", async () => {
      const warnCap = captureConsole("warn");
      try {
        const fetchImpl = (() => Promise.resolve(new Response("internal error", { status: 500 }))) as typeof fetch;
        const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
        assertEquals(result, []);
        assert(warnCap.lines.length > 0);
      } finally {
        warnCap.restore();
      }
    });

    await t.step("(c) 429", async () => {
      const warnCap = captureConsole("warn");
      try {
        const fetchImpl = (() => Promise.resolve(new Response("too many requests", { status: 429 }))) as typeof fetch;
        const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
        assertEquals(result, []);
        assert(warnCap.lines.length > 0);
      } finally {
        warnCap.restore();
      }
    });

    await t.step("(d) fetch rejects with DOMException TimeoutError", async () => {
      const warnCap = captureConsole("warn");
      try {
        const fetchImpl = (() => Promise.reject(new DOMException("timed out", "TimeoutError"))) as typeof fetch;
        const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
        assertEquals(result, []);
        assert(warnCap.lines.length > 0);
      } finally {
        warnCap.restore();
      }
    });

    await t.step("(e) stub never resolves until init.signal fires abort", async () => {
      const warnCap = captureConsole("warn");
      try {
        const fetchImpl = ((_url: string, init?: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          });
        }) as typeof fetch;
        const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl, timeoutMs: 10 });
        assertEquals(result, []);
        assert(warnCap.lines.length > 0);
      } finally {
        warnCap.restore();
      }
    });

    await t.step("(f) 200 with {}", async () => {
      const warnCap = captureConsole("warn");
      try {
        const fetchImpl = (() =>
          Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))) as typeof fetch;
        const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
        assertEquals(result, []);
        assert(warnCap.lines.length > 0);
      } finally {
        warnCap.restore();
      }
    });

    await t.step('(g) { answers: "nope" }', async () => {
      const warnCap = captureConsole("warn");
      try {
        const fetchImpl = (() =>
          Promise.resolve(new Response(JSON.stringify({ answers: "nope" }), { status: 200 }))) as typeof fetch;
        const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
        assertEquals(result, []);
        assert(warnCap.lines.length > 0);
      } finally {
        warnCap.restore();
      }
    });

    await t.step("(h) non-numeric probability", async () => {
      const warnCap = captureConsole("warn");
      try {
        const fetchImpl = (async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(init!.body as string);
          const id = Object.keys(body.questions)[0];
          return new Response(JSON.stringify({ answers: { [id]: { probability: "high" } } }), { status: 200 });
        }) as typeof fetch;
        const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
        assertEquals(result, []);
        assert(warnCap.lines.length > 0);
      } finally {
        warnCap.restore();
      }
    });

    await t.step("(i) answer id maps to no question", async () => {
      const warnCap = captureConsole("warn");
      try {
        const fetchImpl = (() =>
          Promise.resolve(
            new Response(JSON.stringify({ answers: { "unknown-id": { probability: 0.9 } } }), { status: 200 }),
          )) as typeof fetch;
        const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
        assertEquals(result, []);
        assert(warnCap.lines.length > 0);
      } finally {
        warnCap.restore();
      }
    });

    await t.step("(j) 200 with a non-JSON body", async () => {
      const warnCap = captureConsole("warn");
      try {
        const fetchImpl = (() => Promise.resolve(new Response("not json{{{", { status: 200 }))) as typeof fetch;
        const result = await judgeAllergens([recipe], ["Sesame"], { fetchImpl });
        assertEquals(result, []);
        assert(warnCap.lines.length > 0);
      } finally {
        warnCap.restore();
      }
    });
  },
});

// ---------------------------------------------------------------------------
// 11. Early return, no network
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: zero allergens or zero recipes means zero fetches and zero warns",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const warnCap = captureConsole("warn");
    try {
      let called = false;
      const fetchImpl = (() => {
        called = true;
        return Promise.resolve(new Response("{}"));
      }) as typeof fetch;

      const r1 = await judgeAllergens([{ title: "X", ingredients: [{ name: "y" }] }], [], { fetchImpl });
      assertEquals(r1, []);
      assertEquals(called, false);

      const r2 = await judgeAllergens([], ["Nuts"], { fetchImpl });
      assertEquals(r2, []);
      assertEquals(called, false);

      assertEquals(warnCap.lines.length, 0);
    } finally {
      warnCap.restore();
    }
  },
});

// ---------------------------------------------------------------------------
// 12. Chunking
// ---------------------------------------------------------------------------

Deno.test({
  name: "judgeAllergens: chunking — ids cover every pair exactly once; per-chunk fail-open",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // Ingredient list large enough that a single recipe's question block alone
    // exceeds the chunk token budget, forcing one recipe per chunk.
    const bigIngredient = "a".repeat(150_000);
    const recipes = [
      { title: "Big Recipe 0", ingredients: [{ name: bigIngredient }] },
      { title: "Big Recipe 1", ingredients: [{ name: bigIngredient }] },
    ];

    // deno-lint-ignore no-explicit-any
    const calls: any[] = [];
    let callIndex = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      calls.push(body);
      const idx = callIndex++;
      if (idx === 0) {
        return new Response("boom", { status: 500 });
      }
      const firstId = Object.keys(body.questions)[0];
      return new Response(JSON.stringify({ answers: { [firstId]: { probability: 0.9 } } }), { status: 200 });
    }) as typeof fetch;

    const result = await judgeAllergens(recipes, ALLERGENS, { fetchImpl });

    assert(calls.length > 1, `expected more than one chunk/fetch call, got ${calls.length}`);

    const allIds = calls.flatMap((b) => Object.keys(b.questions));
    assertEquals(allIds.length, new Set(allIds).size, "no duplicate question ids across chunks");

    const expectedIds: string[] = [];
    for (let r = 0; r < recipes.length; r++) {
      for (let a = 0; a < ALLERGENS.length; a++) expectedIds.push(`r${r}a${a}`);
    }
    assertEquals([...new Set(allIds)].sort(), expectedIds.sort());

    // The first chunk 500'd (fail-open, contributes nothing); the second
    // chunk's single answered question clears the threshold.
    assertEquals(result.length, 1);
  },
});
