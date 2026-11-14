// Entry point for bin/mammaschef. The app's services log freely; keep that off stdout
// (it carries --json results and, in MCP mode, the protocol) unless debugging.
const debug = process.env.MAMMASCHEF_DEBUG === "1";
for (const level of ["log", "info", "warn", "debug", "error"] as const) {
  console[level] = debug ? (...a: unknown[]) => process.stderr.write(`${a.map(String).join(" ")}\n`) : () => {};
}

const argv = process.argv.slice(2);
if (argv[0] === "mcp") {
  // Runs until the agent closes stdin.
  const { serve } = await import("./mcp");
  process.stdin.on("end", () => process.exit(0));
  await serve();
} else {
  const { run } = await import("./cli");
  // exit explicitly: the Supabase client's token-refresh timer would keep the process alive
  process.exit(await run(argv));
}
