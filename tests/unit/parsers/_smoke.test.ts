import { it, expect } from "vitest";

it("HTMLRewriter is available in this pool", () => {
  expect(typeof HTMLRewriter).toBe("function");
  const instance = new HTMLRewriter().on("div", {});
  expect(instance).toBeDefined();
});
