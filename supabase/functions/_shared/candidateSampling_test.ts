import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSampleOffsets } from "./candidateSampling.ts";

Deno.test("buildSampleOffsets spreads windows across the available result set", () => {
  const offsets = buildSampleOffsets(120, 12, 36, "planner-seed");

  assertEquals(offsets.length, 3);
  assertEquals(offsets.every((offset) => offset >= 0 && offset <= 108), true);
  assertEquals(offsets[0] < 40, true);
  assertEquals(offsets[1] >= 40 && offsets[1] < 80, true);
  assertEquals(offsets[2] >= 80, true);
});

Deno.test("buildSampleOffsets is deterministic per seed and varies across seeds", () => {
  assertEquals(
    buildSampleOffsets(200, 10, 30, "seed-a"),
    buildSampleOffsets(200, 10, 30, "seed-a"),
  );
  assertNotEquals(
    buildSampleOffsets(200, 10, 30, "seed-a"),
    buildSampleOffsets(200, 10, 30, "seed-b"),
  );
});

Deno.test("buildSampleOffsets fetches from the start when the desired rows cover the set", () => {
  assertEquals(buildSampleOffsets(20, 12, 24, "seed"), [0]);
  assertEquals(buildSampleOffsets(0, 12, 24, "seed"), []);
});
