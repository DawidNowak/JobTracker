import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "url";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    passWithNoTests: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/integration/**/*.test.ts",
      "tests/http/**/*.test.ts",
      "tests/unit/**/*.test.ts",
    ],
    exclude: [
      "tests/unit/parsers/linkedin.test.ts",
      "tests/unit/parsers/justjoinit.test.ts",
    ],
    testTimeout: 30_000,
  },
});
