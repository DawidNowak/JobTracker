import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";
import { column, daysAgo } from "../helpers/board-locators";

test("Aplikuj moves a stale card to Zaaplikowano", async ({ page, seedApp, admin }) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const company = `E2E Aplikuj Co ${runId}`;

  const application = await seedApp({ status: "Interesujące", company, last_action_at: daysAgo(2) });

  await page.goto("/dashboard");
  await waitForBoardHydration(page);

  const card = page.locator("article").filter({ has: page.getByText(company) });

  // Aplikuj is optimistic — the card moves (and this button disappears) synchronously on
  // click, before the PATCH resolves (KanbanBoard.tsx's onApply). So the click must not be
  // retried: a second click here would target a button that no longer exists. Register the
  // response wait before the single click, with a timeout generous enough for the shared
  // dev server under parallel e2e workers (see waitForBoardHydration for the hydration gate
  // that makes a single click safe in the first place).
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes(`/api/applications/${application.id}`) && res.request().method() === "PATCH",
      { timeout: 10_000 },
    ),
    card.getByRole("button", { name: "Aplikuj" }).click(),
  ]);
  expect(response.ok()).toBe(true);

  await expect(column(page, "Zaaplikowano").getByText(company)).toBeVisible();
  await expect(column(page, "Interesujące").getByText(company)).toHaveCount(0);

  const { data, error } = await admin.from("applications").select("status").eq("id", application.id).single();
  if (error) throw error;
  expect(data.status).toBe("Zaaplikowano");
});
