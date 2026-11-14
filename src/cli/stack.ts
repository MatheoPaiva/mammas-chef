// Local stack and account commands: init, start, stop, doctor. Run from the repo root.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { supabase } from "@/integrations/supabase/client";
import { CliError, secondOpinionCheck } from "./commands";

const FUNCTIONS_ENV = "supabase/functions/.env";
const STATE_DIR = ".mammaschef"; // gitignored: PID and log of the detached functions server
const PROJECT_ID = "mammas-chef"; // project_id in supabase/config.toml; its containers are named supabase_*_<id>
const PID_FILE = `${STATE_DIR}/functions.pid`;
// Absolute, so an agent reading the message knows where it is.
export const FUNCTIONS_LOG = `${process.cwd()}/${STATE_DIR}/functions.log`;
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();

const hasAiKey = () => existsSync(FUNCTIONS_ENV) && /^(AI_API_KEY|CEREBRAS_API_KEY)=.+/m.test(readFileSync(FUNCTIONS_ENV, "utf8"));

async function reachable(path: string) {
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method: path.startsWith("/functions") ? "OPTIONS" : "GET",
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "" },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
export const databaseUp = () => reachable("/rest/v1/");
export const functionsUp = () => reachable("/functions/v1/generate-meal-plan");

/** Runs a setup command with its output on stderr, so --json stdout stays clean. */
function runVisible(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", 2, 2] });
  if (r.status !== 0) throw new CliError(`\`${cmd} ${args.join(" ")}\` failed. See the output above.`);
}

export async function start() {
  if (!hasAiKey()) throw new CliError(`No AI key found. Add CEREBRAS_API_KEY (or AI_API_KEY) to ${FUNCTIONS_ENV}. Run \`npm run setup\` first if that file is missing.`);
  if (!(await databaseUp())) runVisible("npx", ["supabase", "start"]);
  if (!(await functionsUp())) {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const log = openSync(FUNCTIONS_LOG, "a", 0o600); // the log can name the household's allergens
    // The modes above only apply on creation; this repairs a directory and log made before they were set.
    chmodSync(STATE_DIR, 0o700);
    chmodSync(FUNCTIONS_LOG, 0o600);
    const child = spawn("npx", ["supabase", "functions", "serve", "--env-file", FUNCTIONS_ENV], {
      detached: true, // own process group, so `stop` can end it and its children together
      stdio: ["ignore", log, log],
    });
    child.unref();
    writeFileSync(PID_FILE, String(child.pid));
    for (let i = 0; i < 60 && !(await functionsUp()); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await functionsUp())) throw new CliError(`The AI functions didn't start. Check ${FUNCTIONS_LOG}.`);
  }
  return { database: "running", functions: "running", functions_log: FUNCTIONS_LOG };
}

export async function stop() {
  if (existsSync(PID_FILE)) {
    try {
      process.kill(-Number(readFileSync(PID_FILE, "utf8")), "SIGTERM");
    } catch {
      // already gone
    }
    rmSync(PID_FILE);
  }
  runVisible("npx", ["supabase", "stop"]);
  return { database: "stopped", functions: "stopped" };
}

/** Host ports that `docker ps --format {{.Ports}}` output shows published on anything but this computer's loopback address. */
export function exposedPorts(dockerPorts: string) {
  const published = [...dockerPorts.matchAll(/(\S+?):(\d+(?:-\d+)?)->/g)];
  return [...new Set(published.filter((m) => !/^(127\.|\[::1\]$)/.test(m[1])).map((m) => m[2]))];
}

export async function doctor() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const dockerOk = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
  // No output (Docker missing or stopped) means nothing is published; the docker check reports that.
  const exposed = exposedPorts(spawnSync("docker", ["ps", "--filter", `name=_${PROJECT_ID}`, "--format", "{{.Ports}}"], { encoding: "utf8" }).stdout ?? "");
  const dbOk = await databaseUp();
  const fnOk = dbOk && (await functionsUp());
  let loginOk = false;
  let email: string | null = null;
  if (dbOk) {
    const { data } = await supabase.auth.getUser();
    loginOk = !!data.user;
    email = data.user?.email ?? null;
  }
  const checks = [
    { check: "node", ok: nodeMajor >= 20, detail: `Node ${process.versions.node}`, fix: "Install Node 20 or newer." },
    { check: "docker", ok: dockerOk, detail: dockerOk ? "running" : "not running", fix: "Start Docker Desktop." },
    {
      check: "network",
      ok: exposed.length === 0,
      detail: exposed.length ? `ports ${exposed.join(", ")} are open to other devices on your network` : "local ports aren't open to other devices",
      fix: "Other devices on the same network can reach the database, which uses Supabase's well-known default local password and keys. " +
        "Set Docker to publish ports on localhost only (Docker Desktop: network settings; " +
        "Linux Docker Engine: set \"ip\": \"127.0.0.1\" in /etc/docker/daemon.json and restart Docker), then run `npx supabase stop` and start again. " +
        "Don't run the stack on shared or public Wi-Fi until this is fixed. Turning on a firewall is usually not enough (Docker's ports tend to be let through), " +
        "and this check reads Docker's port list, so it stays red if you block the ports some other way.",
    },
    { check: "config", ok: existsSync(".env.local") && existsSync(FUNCTIONS_ENV), detail: ".env.local and supabase/functions/.env", fix: "Run `npm run setup`." },
    { check: "ai_key", ok: hasAiKey(), detail: "CEREBRAS_API_KEY or AI_API_KEY", fix: `Add a key to ${FUNCTIONS_ENV}.` },
    { check: "database", ok: dbOk, detail: SUPABASE_URL || "no URL in .env.local", fix: "Run `mammaschef start`." },
    { check: "functions", ok: fnOk, detail: "AI functions", fix: `Run \`mammaschef start\`. Logs: ${FUNCTIONS_LOG}.` },
    // Login can only be checked against a running database; don't send people to init for that.
    dbOk
      ? { check: "login", ok: loginOk, detail: email ?? "not signed in", fix: "Run `mammaschef init`." }
      : { check: "login", ok: false, detail: "not checked: the database isn't running", fix: "Run `mammaschef start` first." },
  ];
  // Optional, so it never fails the check, but it is always reported.
  const secondOpinion = secondOpinionCheck();
  return {
    ok: checks.every((c) => c.ok),
    checks: checks.map((c) => (c.ok ? { check: c.check, ok: true, detail: c.detail } : c)),
    second_opinion_check: secondOpinion,
    second_opinion_fix: secondOpinion === "off" ? `Optional: add AI_GATEWAY_API_KEY to ${FUNCTIONS_ENV} for a second allergen check.` : null,
  };
}

// ---------- init ----------

function ask(question: string): Promise<string> {
  return readInput(question, false);
}

/** Reads one line from the terminal; hidden input echoes nothing (for passwords). */
function readInput(question: string, hidden: boolean): Promise<string> {
  if (!process.stdin.isTTY) throw new CliError("`mammaschef init` needs a terminal; run it yourself, not through an agent.");
  return new Promise((resolve, reject) => {
    process.stderr.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") { done(); resolve(value.trim()); return; }
        if (c === "\u0003") { done(); reject(new CliError("Cancelled.")); return; }
        if (c === "\u007f") {
          if (value) { value = value.slice(0, -1); if (!hidden) process.stderr.write("\b \b"); }
        } else {
          value += c;
          if (!hidden) process.stderr.write(c);
        }
      }
    };
    stdin.on("data", onData);
  });
}

export async function init(emailFlag?: string) {
  if (!existsSync(".env.local") || !existsSync(FUNCTIONS_ENV)) {
    throw new CliError("Run `npm run setup` first. It installs the database and writes the config files.");
  }
  if (!(await databaseUp())) throw new CliError("The database isn't running. Run `mammaschef start`, then `mammaschef init` again.");

  const email = emailFlag ?? (await ask("Email: "));
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new CliError(`"${email}" doesn't look like an email address.`);
  const password = await readInput("Password: ", true);

  let created = false;
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    if (!/invalid login credentials/i.test(signIn.error.message)) throw new CliError(`Sign-in failed: ${signIn.error.message}`);
    if (password.length < 6) throw new CliError("Passwords need at least 6 characters.");
    if ((await readInput("Confirm password to create the account: ", true)) !== password) throw new CliError("Passwords didn't match.");
    const signUp = await supabase.auth.signUp({ email, password });
    if (signUp.error || !signUp.data.session) {
      throw new CliError(`Couldn't sign in or create the account: ${signUp.error?.message ?? "no session returned"}. If the account exists, check the password.`);
    }
    created = true;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (user) await supabase.from("profiles").update({ onboarding_complete: true }).eq("id", user.id);
  return {
    email,
    created,
    next: "Set your household with `mammaschef profile set --household 3 --allergies sesame`, then try `mammaschef plan \"plan next week\"`.",
  };
}
