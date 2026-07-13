import { spawn, execSync, type ChildProcess } from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";
import { E2E_PORT, DEV_VARS_BACKUP } from "../tests/e2e/config";

config({ path: ".env.test" });

const DEV_VARS_PATH = ".dev.vars";
const ASTRO_BIN = resolve(process.cwd(), "node_modules/astro/bin/astro.mjs");

const ALLOWED_PREFIXES = ["http://127.0.0.1:54321", "http://localhost:54321"] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing or empty env var "${name}" in .env.test`);
  return value;
}

const supabaseUrl = requireEnv("SUPABASE_URL");
if (!ALLOWED_PREFIXES.some((prefix) => supabaseUrl.startsWith(prefix))) {
  throw new Error(
    `SUPABASE_URL must point at the local Supabase stack (http://127.0.0.1:54321 or http://localhost:54321). Refusing to run against: ${supabaseUrl}`,
  );
}
const supabaseKey = requireEnv("SUPABASE_KEY");

let devServer: ChildProcess | null = null;
let restored = false;

// Safety net: restore .dev.vars even if this process is killed hard enough to skip the signal
// handlers below (mirrors tests/global-setup.ts's process.on("exit") belt-and-suspenders).
process.on("exit", () => {
  restoreDevVars();
});

function restoreDevVars(): void {
  if (restored) return;
  restored = true;
  try {
    if (existsSync(DEV_VARS_BACKUP)) {
      const backup = readFileSync(DEV_VARS_BACKUP, "utf-8");
      if (backup === "__ABSENT__") {
        if (existsSync(DEV_VARS_PATH)) unlinkSync(DEV_VARS_PATH);
      } else {
        writeFileSync(DEV_VARS_PATH, backup);
      }
      unlinkSync(DEV_VARS_BACKUP);
    }
  } catch {
    // best-effort in an exit/signal handler
  }
}

function killDevServer(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    try {
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
    } catch {
      child.kill();
    }
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown(): void {
  restoreDevVars();
  const server = devServer;
  devServer = null;
  if (server) killDevServer(server);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function main(): void {
  // Recover from a backup orphaned by a previous hard-killed run BEFORE reading .dev.vars —
  // otherwise we'd capture that run's test creds as the "original" and lose the real content.
  if (existsSync(DEV_VARS_BACKUP)) {
    restoreDevVars();
    restored = false;
  }

  // Back up .dev.vars (or record its absence) before swapping, so restoreDevVars() and
  // globalTeardown can put things back exactly as found — even across a hard kill.
  const original = existsSync(DEV_VARS_PATH) ? readFileSync(DEV_VARS_PATH, "utf-8") : "__ABSENT__";
  writeFileSync(DEV_VARS_BACKUP, original);
  writeFileSync(DEV_VARS_PATH, `SUPABASE_URL=${supabaseUrl}\nSUPABASE_KEY=${supabaseKey}\n`);

  const server = spawn(process.execPath, [ASTRO_BIN, "dev", "--port", String(E2E_PORT), "--host", "127.0.0.1"], {
    stdio: "inherit",
    env: { ...process.env },
  });
  devServer = server;

  server.on("exit", (code) => {
    restoreDevVars();
    process.exit(code ?? 0);
  });
}

try {
  main();
} catch (err) {
  restoreDevVars();
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
