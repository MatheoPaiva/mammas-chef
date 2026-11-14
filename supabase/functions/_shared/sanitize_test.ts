import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sanitizeInput } from "./sanitize.ts";

Deno.test("sanitizeInput strips control characters, trims and truncates", () => {
  assertEquals(sanitizeInput("  chicken\u0000 thighs\u007f\n", 100), "chicken thighs");
  assertEquals(sanitizeInput("tab\tand\nnewline stay", 100), "tab\tand\nnewline stay");
  assertEquals(sanitizeInput("abcdefghij", 4), "abcd");
  assertEquals(sanitizeInput("\u0001\u0002abcdef", 4), "abcd");
  assertEquals(sanitizeInput(42, 10), "");
});

Deno.test("sanitizeInput caps a huge string at maxLength", () => {
  assertEquals(sanitizeInput("x".repeat(5_000_000), 50), "x".repeat(50));
});
