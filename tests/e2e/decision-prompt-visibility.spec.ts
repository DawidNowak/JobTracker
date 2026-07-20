import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";
import { daysAgo } from "../helpers/board-locators";

test("Interesujące card past the 1-day threshold shows the decision prompt with no prompt on a fresh card", async ({
  page,
  seedApp,
}) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const staleCompany = `E2E Stale Co ${runId}`;
  const freshCompany = `E2E Fresh Co ${runId}`;

  await seedApp({ status: "Interesujące", company: staleCompany, last_action_at: daysAgo(2) });
  await seedApp({ status: "Interesujące", company: freshCompany });

  await page.goto("/dashboard");
  await waitForBoardHydration(page);

  const staleCard = page.locator("article").filter({ has: page.getByText(staleCompany) });
  const freshCard = page.locator("article").filter({ has: page.getByText(freshCompany) });

  await expect(staleCard.getByText("Zdecyduj — aplikujesz?")).toBeVisible();
  await expect(staleCard.getByRole("button", { name: "Aplikuj" })).toBeVisible();
  await expect(staleCard.getByRole("button", { name: "Pomiń" })).toBeVisible();

  await expect(freshCard.getByRole("button", { name: "Aplikuj" })).toHaveCount(0);
});
