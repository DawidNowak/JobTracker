import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";

const twoDaysAgo = () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

test("Pomiń opens the delete dialog and permanently removes the card", async ({ page, seedApp, admin }) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const company = `E2E Pomin Co ${runId}`;

  const application = await seedApp({ status: "Interesujące", company, last_action_at: twoDaysAgo() });

  await page.goto("/dashboard");
  await waitForBoardHydration(page);

  const card = page.locator("article").filter({ has: page.getByText(company) });

  await card.getByRole("button", { name: "Pomiń" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();

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
