import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";

test("shows no reject affordance on an Interesujące card", async ({ page, seedApp }) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const company = `E2E No-Reject Co ${runId}`;

  await seedApp({ status: "Interesujące", company });

  await page.goto("/dashboard");
  await waitForBoardHydration(page);

  const card = page.locator("article").filter({ has: page.getByText(company) });
  const menuTrigger = card.getByRole("button", { name: "Opcje aplikacji" });

  await menuTrigger.click();
  await expect(page.getByRole("menuitem", { name: "Odrzuć" })).toHaveCount(0);
});
