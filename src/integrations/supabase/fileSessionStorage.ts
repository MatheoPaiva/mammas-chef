// Auth session store for running outside a browser (CLI, MCP). Keeps the Supabase
// session in ~/.config/mammaschef/session.json, readable only by the user (mode 600).
// node: modules are imported lazily so the browser bundle never evaluates them.

type Store = Record<string, string>;

async function sessionPath() {
  const [{ homedir }, { join }] = await Promise.all([import("node:os"), import("node:path")]);
  return join(homedir(), ".config", "mammaschef", "session.json");
}

async function readStore(): Promise<Store> {
  const { readFile } = await import("node:fs/promises");
  try {
    return JSON.parse(await readFile(await sessionPath(), "utf8")) as Store;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

async function writeStore(store: Store) {
  const [{ mkdir, writeFile, chmod }, { dirname }] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const file = await sessionPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(store), { mode: 0o600 });
  await chmod(file, 0o600); // writeFile's mode only applies when it creates the file
}

export const fileSessionStorage = {
  async getItem(key: string) {
    return (await readStore())[key] ?? null;
  },
  async setItem(key: string, value: string) {
    const store = await readStore();
    store[key] = value;
    await writeStore(store);
  },
  async removeItem(key: string) {
    const store = await readStore();
    delete store[key];
    await writeStore(store);
  },
};
