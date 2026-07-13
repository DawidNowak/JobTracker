import { test, expect } from "./fixtures";

// Risk test: irreversible delete must remove the card from the board AND the row from the DB.
test("deletes a Zaaplikowano card from board and database", async ({ page, seedApp, admin }) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const company = `E2E Delete Co ${runId}`;

  const application = await seedApp({ status: "Zaaplikowano", company });

  await page.goto("/dashboard");

  const card = page.locator("article").filter({ has: page.getByText(company) });
  const menuTrigger = card.getByRole("button", { name: "Opcje aplikacji" });
  const deleteMenuItem = page.getByRole("menuitem", { name: "Usuń" });

  // The board is a client:load island; on a cold dev server the trigger can be visible
  // before React attaches its click handler. Retry the click until the menu actually opens
  // (a web-first retry, not a fixed sleep) rather than assuming the first click lands.
  await expect(async () => {
    await menuTrigger.click();
    await expect(deleteMenuItem).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  await deleteMenuItem.click();

  // Menu-trigger vs dialog-confirm both read "Usuń" — scope the confirm to the alertdialog.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Usuń aplikację" })).toBeVisible();
  await expect(dialog.getByText("Rekord nie zostanie zachowany w archiwum. Tej akcji nie można cofnąć.")).toBeVisible();

  // Confirm triggers a full window.location.reload() on success, so wait for the reload's
  // load event alongside the click rather than asserting synchronously right after it.
  await Promise.all([page.waitForEvent("load"), dialog.getByRole("button", { name: "Usuń" }).click()]);

  await expect(page.getByText(company)).toHaveCount(0);

  const { data, error } = await admin.from("applications").select("id").eq("id", application.id);
  if (error) throw error;
  expect(data).toHaveLength(0);
});
