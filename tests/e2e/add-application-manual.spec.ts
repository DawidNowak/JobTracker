import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";
import { column } from "../helpers/board-locators";

// Risk test (roadmap S-02 "manual-add-application"): the plain fill-and-submit path through
// AddApplicationDialog — no parser involved — is the write path every later dialog (edit,
// parser-driven add) reuses. It has no existing browser-level coverage: this proves a manually
// filled card actually lands on the board, in the right column, after a real dialog submit.
test("manually filled application appears in its target column after submit", async ({ page }) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const company = `E2E Manual Add Co ${runId}`;
  const position = `E2E Manual Add Rola ${runId}`;

  await page.goto("/dashboard");
  await waitForBoardHydration(page);

  await page.getByRole("button", { name: "Dodaj do Interesujące" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Źródło *").fill(`https://example.com/careers/${runId}`);
  await dialog.getByLabel("Stanowisko").fill(position);
  await dialog.getByLabel("Firma").fill(company);
  await dialog.getByLabel("Widełki wynagrodzenia").fill("15000-19000 PLN");

  // Submit triggers window.location.reload() on success, so wait for the reload's load event
  // alongside the click rather than asserting synchronously after it (mirrors
  // tests/e2e/reject-application.spec.ts).
  const [createResponse] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/applications") && res.request().method() === "POST"),
    page.waitForEvent("load"),
    dialog.getByRole("button", { name: "Dodaj" }).click(),
  ]);
  expect(createResponse.status()).toBe(201);

  await waitForBoardHydration(page);

  const card = column(page, "Interesujące")
    .locator("article")
    .filter({ has: page.getByText(company) });
  await expect(card).toBeVisible();
  await expect(card.getByText(position)).toBeVisible();
});
