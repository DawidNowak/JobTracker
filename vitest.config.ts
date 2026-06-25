import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "url";
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          setupFiles: ["./tests/setup.ts", "./tests/setup-html-rewriter.ts"],
          include: ["tests/integration/**/*.test.ts", "tests/http/**/*.test.ts", "tests/unit/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
      defineWorkersProject({
        resolve: { alias },
        test: {
          name: "workers",
          include: ["tests/unit/parsers/linkedin.test.ts", "tests/unit/parsers/justjoinit.test.ts"],
          poolOptions: {
            workers: {
              wrangler: { configPath: "./wrangler.test.jsonc" },
            },
          },
        },
      }),
    ],
  },
});
