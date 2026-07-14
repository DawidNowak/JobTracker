import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";

// KanbanColumn renders a plain <div> with no region/landmark role — only its <h2> is named.
// Scope assertions to the column containing the matching heading (pattern from board-load.spec.ts).
function column(page: import("@playwright/test").Page, name: string) {
  return page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name }) })
    .last();
}

const eightDaysAgo = () => new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

test("Zaaplikowano card stale 7+ days shows the follow-up flag; saving a note clears it without changing status", async ({
  page,
  seedApp,
}) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const staleCompany = `E2E FollowUp Stale Co ${runId}`;
  const freshCompany = `E2E FollowUp Fresh Co ${runId}`;

  const staleApp = await seedApp({
    status: "Zaaplikowano",
    company: staleCompany,
    last_action_at: eightDaysAgo(),
  });
  await seedApp({ status: "Zaaplikowano", company: freshCompany });

  await page.goto("/dashboard");
  await waitForBoardHydration(page);

  const staleCard = page.locator("article").filter({ has: page.getByText(staleCompany) });
  const freshCard = page.locator("article").filter({ has: page.getByText(freshCompany) });

  await expect(staleCard.getByText("Czas na follow-up z rekruterem")).toBeVisible();
  await expect(staleCard.getByRole("button", { name: "Napisz follow-up" })).toBeVisible();

  await expect(freshCard.getByText("Czas na follow-up z rekruterem")).toHaveCount(0);
  await expect(freshCard.getByRole("button", { name: "Napisz follow-up" })).toHaveCount(0);

  const dialog = page.getByRole("dialog");

  await staleCard.getByRole("button", { name: "Napisz follow-up" }).click();
  await expect(dialog).toBeVisible();

  const noteBody = `E2E follow-up note ${runId}`;
  await dialog.getByPlaceholder("Dodaj notatkę…").fill(noteBody);

  const [notePostResponse] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes(`/api/applications/${staleApp.id}/notes`) && res.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: "Dodaj notatkę" }).click(),
  ]);
  expect(notePostResponse.ok()).toBe(true);

  // CardDetailDialog.handleOpenChange fires window.location.reload() on close, so wait for the
  // reload's load event alongside the close click rather than asserting synchronously after it
  // (mirrors tests/e2e/decision-prompt.spec.ts:92).
  await Promise.all([page.waitForEvent("load"), dialog.getByRole("button", { name: "Close" }).click()]);

  const reloadedStaleCard = page.locator("article").filter({ has: page.getByText(staleCompany) });
  await expect(reloadedStaleCard.getByText("Czas na follow-up z rekruterem")).toHaveCount(0);
  await expect(reloadedStaleCard.getByRole("button", { name: "Napisz follow-up" })).toHaveCount(0);
  await expect(column(page, "Zaaplikowano").getByText(staleCompany)).toBeVisible();
});
