import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";
import { column } from "../helpers/board-locators";

// Risk test (roadmap S-03 "edit-and-delete-application"): editing any field on an existing card
// is the other core write path (alongside add) with no prior browser-level coverage. This proves
// a field change made through EditApplicationDialog actually persists after the page reload the
// dialog triggers on save — not just that the PATCH request returns 200.
test("editing a card's company persists on the board after save", async ({ page, seedApp }) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const originalCompany = `E2E Edit Before Co ${runId}`;
  const updatedCompany = `E2E Edit After Co ${runId}`;

  await seedApp({ status: "Zaaplikowano", company: originalCompany });

  await page.goto("/dashboard");
  await waitForBoardHydration(page);

  const card = column(page, "Zaaplikowano")
    .locator("article")
    .filter({ has: page.getByText(originalCompany) });
  await card.getByRole("button", { name: "Opcje aplikacji" }).click();
  await page.getByRole("menuitem", { name: "Edytuj" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const companyField = dialog.getByLabel("Firma");
  await companyField.fill("");
  await companyField.fill(updatedCompany);

  // Save triggers window.location.reload() on success, so wait for the reload's load event
  // alongside the click rather than asserting synchronously after it (mirrors
  // tests/e2e/reject-application.spec.ts).
  const [saveResponse] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/applications/") && res.request().method() === "PATCH"),
    page.waitForEvent("load"),
    dialog.getByRole("button", { name: "Zapisz" }).click(),
  ]);
  expect(saveResponse.status()).toBe(200);

  await waitForBoardHydration(page);

  const updatedCard = column(page, "Zaaplikowano")
    .locator("article")
    .filter({ has: page.getByText(updatedCompany) });
  await expect(updatedCard).toBeVisible();
  await expect(column(page, "Zaaplikowano").getByText(originalCompany)).toHaveCount(0);
});
