import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseAIJson, ParseFailureError } from "./jsonResponsePrompt.ts";

Deno.test("parseAIJson: clean JSON parses directly", () => {
  const result = parseAIJson('{"a":1}');
  assertEquals(result, { a: 1 });
});

Deno.test("parseAIJson: strips markdown fences (case-insensitive)", () => {
  const result = parseAIJson('```json\n{"a":1}\n```');
  assertEquals(result, { a: 1 });
});

Deno.test("parseAIJson: extracts the balanced object when trailing junk follows", () => {
  const result = parseAIJson('{"a":1} trailing junk');
  assertEquals(result, { a: 1 });
});

Deno.test("parseAIJson: throws ParseFailureError when no braces are found", () => {
  let thrown: unknown;
  try {
    parseAIJson("no braces here");
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof ParseFailureError);
  assertEquals((thrown as ParseFailureError).message, "No JSON object found in AI response");
});

Deno.test("parseAIJson: unbalanced braces throw a ParseFailureError mentioning truncation by default", () => {
  let thrown: unknown;
  try {
    parseAIJson('{"a":');
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof ParseFailureError);
  assert((thrown as ParseFailureError).message.includes("truncated"));
});

Deno.test("parseAIJson: opts.onUnbalanced hook throws the caller's own error instance", () => {
  class Trunc extends Error {
    constructor(message: string, public snippet?: string) {
      super(message);
      this.name = "Trunc";
    }
  }

  let thrown: unknown;
  try {
    parseAIJson('{"a":', { onUnbalanced: (snippet) => new Trunc("Unable to extract JSON from AI response (unbalanced braces — likely truncated)", snippet) });
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof Trunc);
});

Deno.test("parseAIJson: balanced but token-invalid JSON throws ParseFailureError on reparse", () => {
  let thrown: unknown;
  try {
    parseAIJson('{"a": thirty}');
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof ParseFailureError);
  assertEquals((thrown as ParseFailureError).message, "Unable to parse extracted JSON object from AI response");
});
