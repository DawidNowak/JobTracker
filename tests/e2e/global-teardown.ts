import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { DEV_VARS_BACKUP } from "./config";

const DEV_VARS_PATH = ".dev.vars";

// Authoritative restore: covers a hard-killed scripts/e2e-webserver.ts (e.g. Windows taskkill
// of the whole webServer tree), which never gets to run its own restore-on-exit handler.
export default function globalTeardown(): void {
  try {
    if (!existsSync(DEV_VARS_BACKUP)) return;
    const backup = readFileSync(DEV_VARS_BACKUP, "utf-8");
    if (backup === "__ABSENT__") {
      if (existsSync(DEV_VARS_PATH)) unlinkSync(DEV_VARS_PATH);
    } else {
      writeFileSync(DEV_VARS_PATH, backup);
    }
    unlinkSync(DEV_VARS_BACKUP);
  } catch {
    // best-effort — the wrapper's own restore is the primary path
  }
}
