import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPersonalization } from "./personalization.ts";

Deno.env.set("SUPABASE_URL", "http://supabase.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

const request = () => new Request("http://edge.test", { headers: { Authorization: "Bearer not-a-real-token" } });

/** Answer the auth and profiles calls the Supabase client makes, with no network. */
async function withProfileResponse<T>(profile: () => Response, run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input: Request | URL | string) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/auth/v1/user")) return Promise.resolve(Response.json({ id: "user-1", aud: "authenticated" }));
    if (url.includes("/rest/v1/profiles")) return Promise.resolve(profile());
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

// The Supabase auth client keeps a background refresh timer, so the leak checks are off.
const test = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });

test("buildPersonalization refuses to continue when the profile cannot be loaded", async () => {
  await withProfileResponse(
    () => Response.json({ message: "database is down" }, { status: 500 }),
    () => assertRejects(() => buildPersonalization(request()), Error, "allergies cannot be checked"),
  );
});

test("buildPersonalization caps and cleans the profile lists it returns and prompts with", async () => {
  const profile = {
    household_size: 4,
    preferred_cuisines: Array.from({ length: 30 }, (_, i) => `Cuisine ${i} ${"x".repeat(500)}`),
    dietary_preferences: Array.from({ length: 200 }, (_, i) => `Diet ${i}`),
    allergies: [...Array.from({ length: 300 }, () => "Milk"), "Sesame", 7, ...Array.from({ length: 300 }, (_, i) => `Other ${i}`)],
    toddler_friendly: false,
    glucose_friendly: false,
    week_start_day: "Monday",
  };
  const result = await withProfileResponse(() => Response.json(profile), () => buildPersonalization(request()));

  assertEquals(result.preferredCuisines.length, 7);
  assertEquals(result.preferredCuisines.every((c) => c.length <= 80), true);
  assertEquals(result.dietaryPreferences.length, 20);
  assertEquals(result.allergies.length, 50);
  assertEquals(result.allergies.slice(0, 3), ["Milk", "Sesame", "Other 0"]);
  assertEquals(result.prompt.includes("NO Milk, NO Sesame, NO Other 0"), true);
  assertEquals(result.prompt.includes("Other 48"), false);
  assertEquals(result.prompt.includes("Diet 20"), false);
  assertEquals(result.prompt.length < 4000, true, `prompt is ${result.prompt.length} characters`);
});
