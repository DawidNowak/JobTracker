import { test, expect } from "./fixtures";

// KanbanColumn renders a plain <div> with no region/landmark role — only its <h2> is named.
// Scope assertions to the column containing the matching heading (pattern from board-load.spec.ts).
function column(page: import("@playwright/test").Page, name: string) {
  return page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name }) })
    .last();
}

const twoDaysAgo = () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

test("Interesujące card past the 1-day threshold shows the decision prompt with no prompt on a fresh card", async ({
  page,
  seedApp,
}) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const staleCompany = `E2E Stale Co ${runId}`;
  const freshCompany = `E2E Fresh Co ${runId}`;

  await seedApp({ status: "Interesujące", company: staleCompany, last_action_at: twoDaysAgo() });
  await seedApp({ status: "Interesujące", company: freshCompany });

  await page.goto("/dashboard");

  const staleCard = page.locator("article").filter({ has: page.getByText(staleCompany) });
  const freshCard = page.locator("article").filter({ has: page.getByText(freshCompany) });

  await expect(staleCard.getByText("Zdecyduj — aplikujesz?")).toBeVisible();
  await expect(staleCard.getByRole("button", { name: "Aplikuj" })).toBeVisible();
  await expect(staleCard.getByRole("button", { name: "Pomiń" })).toBeVisible();

  await expect(freshCard.getByRole("button", { name: "Aplikuj" })).toHaveCount(0);
});

test("Aplikuj moves a stale card to Zaaplikowano", async ({ page, seedApp, admin }) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const company = `E2E Aplikuj Co ${runId}`;

  const application = await seedApp({ status: "Interesujące", company, last_action_at: twoDaysAgo() });

  await page.goto("/dashboard");

  const card = page.locator("article").filter({ has: page.getByText(company) });

  // The board is a client:load island; on a cold dev server the button can be visible
  // before React attaches its click handler. Retry until the app actually reacts.
  // Aplikuj is optimistic (no page reload like delete) — wait for the PATCH response itself
  // so the later DB assertion doesn't race the in-flight request.
  await expect(async () => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes(`/api/applications/${application.id}`) && res.request().method() === "PATCH",
        { timeout: 1000 },
      ),
      card.getByRole("button", { name: "Aplikuj" }).click(),
    ]);
    expect(response.ok()).toBe(true);
  }).toPass({ timeout: 10_000 });

  await expect(column(page, "Zaaplikowano").getByText(company)).toBeVisible();
  await expect(column(page, "Interesujące").getByText(company)).toHaveCount(0);

  const { data, error } = await admin.from("applications").select("status").eq("id", application.id).single();
  if (error) throw error;
  expect(data.status).toBe("Zaaplikowano");
});

test("Pomiń opens the delete dialog and permanently removes the card", async ({ page, seedApp, admin }) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const company = `E2E Pomin Co ${runId}`;

  const application = await seedApp({ status: "Interesujące", company, last_action_at: twoDaysAgo() });

  await page.goto("/dashboard");

  const card = page.locator("article").filter({ has: page.getByText(company) });

  await expect(async () => {
    await card.getByRole("button", { name: "Pomiń" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  // Menu-trigger vs dialog-confirm both read "Usuń" — scope the confirm to the alertdialog.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Usuń aplikację" })).toBeVisible();
  await expect(dialog.getByText("Usunąć tę aplikację? Tej akcji nie można cofnąć.")).toBeVisible();

  // Confirm triggers a full window.location.reload() on success, so wait for the reload's
  // load event alongside the click rather than asserting synchronously right after it.
  await Promise.all([page.waitForEvent("load"), dialog.getByRole("button", { name: "Usuń" }).click()]);

  await expect(page.getByText(company)).toHaveCount(0);

  const { data, error } = await admin.from("applications").select("id").eq("id", application.id);
  if (error) throw error;
  expect(data).toHaveLength(0);
});
