import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";
import { column } from "../helpers/board-locators";

// Reference exemplar: authenticated board render with seeded cards in the correct columns.
// Copy this shape (fixtures import, column-scoping locator) for new specs.
test("renders seeded applications under their status column", async ({ page, seedApp }) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const companyInteresting = `E2E Interesting Co ${runId}`;
  const companyApplied = `E2E Applied Co ${runId}`;

  await seedApp({ status: "Interesujące", company: companyInteresting });
  await seedApp({ status: "Zaaplikowano", company: companyApplied });

  await page.goto("/dashboard");
  await waitForBoardHydration(page);

  await expect(page.getByRole("heading", { name: "Interesujące" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Zaaplikowano" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rozmowa" })).toBeVisible();

  await expect(column(page, "Interesujące").getByText(companyInteresting)).toBeVisible();
  await expect(column(page, "Zaaplikowano").getByText(companyApplied)).toBeVisible();
});
