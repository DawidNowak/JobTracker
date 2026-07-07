import { spawn, execSync, type ChildProcess } from "child_process";
import { createServer, type AddressInfo } from "net";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

config({ path: ".env.test" });

const DEV_VARS_PATH = ".dev.vars";
const ASTRO_BIN = resolve(process.cwd(), "node_modules/astro/bin/astro.mjs");

let devServer: ChildProcess | null = null;
let devVarsOriginal: string | undefined;

// Safety net: restore .dev.vars even if teardown() is skipped (e.g. Vitest force-exit on setup failure).
process.on("exit", () => {
  if (devVarsOriginal !== undefined) {
    try {
      writeFileSync(DEV_VARS_PATH, devVarsOriginal);
    } catch {
      // ignore — best-effort in exit handler
    }
  }
});

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => {
        resolve(port);
      });
    });
    srv.on("error", reject);
  });
}

async function pollUntilReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (including redirects) means the dev server is accepting requests.
      await fetch(url, { signal: AbortSignal.timeout(2_000), redirect: "manual" });
      return;
    } catch {
      // server not yet ready — retry after brief wait
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`astro dev at ${url} did not become ready within ${timeoutMs}ms`);
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

export default async function setup(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be set in .env.test — required for HTTP smoke tests");
  }

  // Temporarily point .dev.vars at the local Supabase stack so astro dev picks up the test database.
  // @astrojs/cloudflare reads astro:env/server vars from .dev.vars via getPlatformProxy(),
  // so the swap is necessary — process.env alone is not sufficient with the Cloudflare adapter.
  devVarsOriginal = existsSync(DEV_VARS_PATH) ? readFileSync(DEV_VARS_PATH, "utf-8") : undefined;
  writeFileSync(DEV_VARS_PATH, `SUPABASE_URL=${supabaseUrl}\nSUPABASE_KEY=${supabaseKey}\n`);

  const port = await getFreePort();

  // Use stdio:'ignore' — no pipe handles — so Vitest can close its Vite server cleanly.
  // --host 127.0.0.1 forces IPv4 binding; pollUntilReady polls the same address.
  const server = spawn(process.execPath, [ASTRO_BIN, "dev", "--port", String(port), "--host", "127.0.0.1"], {
    stdio: "ignore",
    env: { ...process.env },
  });

  // Unref immediately: Node.js should not keep the process alive just because astro dev is running.
  server.unref();
  devServer = server;

  try {
    // 120s: astro dev's first cold compile on Windows can exceed 60s and flake the whole suite.
    await pollUntilReady(`http://127.0.0.1:${port}/`, 120_000);
  } catch (err) {
    await teardown();
    throw err;
  }

  process.env.TEST_BASE_URL = `http://127.0.0.1:${port}`;
}

export async function teardown(): Promise<void> {
  // Restore .dev.vars synchronously at the very start — before any server kill or async waits —
  // so it completes even if Vitest's force-exit timer fires during the async wait below.
  if (devVarsOriginal !== undefined) {
    writeFileSync(DEV_VARS_PATH, devVarsOriginal);
    devVarsOriginal = undefined;
  }

  const server = devServer;
  devServer = null;

  if (server) {
    killDevServer(server);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      server.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
