import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { releaseAction, reserveAction } from "./rateLimit.ts";

type Row = { id: string; user_id: string; event_name: string };

/** In-memory stand-in for the app_logs calls rateLimit.ts makes. Counts wait for `gate`. */
function fakeClient(opts: { gate?: Promise<void>; countError?: boolean } = {}) {
  const rows: Row[] = [];
  let nextId = 0;
  const from = () => ({
    insert: (row: Omit<Row, "id">) => ({
      select: () => ({
        single: () => {
          const id = `row-${nextId++}`;
          rows.push({ ...row, id });
          return Promise.resolve({ data: { id }, error: null });
        },
      }),
    }),
    select: () => {
      const filters: Record<string, string> = {};
      const query = {
        eq: (column: string, value: string) => {
          filters[column] = value;
          return query;
        },
        gte: () => query,
        then: (resolve: (result: { count: number | null; error: { message: string } | null }) => void) =>
          Promise.resolve(opts.gate).then(() =>
            resolve(
              opts.countError
                ? { count: null, error: { message: "app_logs is down" } }
                : {
                    count: rows.filter((r) => r.user_id === filters.user_id && r.event_name === filters.event_name).length,
                    error: null,
                  },
            )
          ),
      };
      return query;
    },
    delete: () => ({
      eq: (_column: string, id: string) => {
        const index = rows.findIndex((r) => r.id === id);
        if (index >= 0) rows.splice(index, 1);
        return Promise.resolve({ error: null });
      },
    }),
  });
  return { rows, client: { from } as unknown as Parameters<typeof reserveAction>[2] };
}

const SWAP_MAX = 20;

Deno.test("reserveAction allows at most the daily max when requests overlap", async () => {
  let openGate = () => {};
  const gate = new Promise<void>((resolve) => { openGate = resolve; });
  const { rows, client } = fakeClient({ gate });

  // Every request writes its row, and only then does any count come back.
  const pending = Array.from({ length: SWAP_MAX + 15 }, () => reserveAction("user-1", "swap", client));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(rows.length, SWAP_MAX + 15);
  openGate();

  const allowed = (await Promise.all(pending)).filter((r) => r.allowed);
  assertEquals(allowed.length <= SWAP_MAX, true, `allowed ${allowed.length}`);
  assertEquals(rows.length, allowed.length, "a rejected request must not keep its row");
});

Deno.test("reserveAction stops at the daily max, and a released slot can be used again", async () => {
  const { rows, client } = fakeClient();
  const held = [];
  for (let i = 0; i < SWAP_MAX; i++) held.push(await reserveAction("user-1", "swap", client));
  assertEquals(held.every((r) => r.allowed && r.id !== null), true);

  assertEquals(await reserveAction("user-1", "swap", client), { allowed: false, id: null });
  assertEquals(rows.length, SWAP_MAX);
  // Another user, and another action, have their own count.
  assertEquals((await reserveAction("user-2", "swap", client)).allowed, true);
  assertEquals((await reserveAction("user-1", "generate", client)).allowed, true);

  await releaseAction(held[0].id, client);
  assertEquals((await reserveAction("user-1", "swap", client)).allowed, true);
});

Deno.test("reserveAction still allows the request when the count query fails", async () => {
  const { client } = fakeClient({ countError: true });
  assertEquals((await reserveAction("user-1", "swap", client)).allowed, true);
});
