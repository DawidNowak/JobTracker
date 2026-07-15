import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";

// Risk test: reject must move the card off the board while its row survives archived, not deleted.
test("rejects a Zaaplikowano card off the board and preserves its row archived", async ({ page, seedApp, admin }) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const company = `E2E Reject Co ${runId}`;

  const application = await seedApp({ status: "Zaaplikowano", company });

  await page.goto("/dashboard");
  await waitForBoardHydration(page);

  const card = page.locator("article").filter({ has: page.getByText(company) });
  const menuTrigger = card.getByRole("button", { name: "Opcje aplikacji" });
  const rejectMenuItem = page.getByRole("menuitem", { name: "Odrzuć" });

  await menuTrigger.click();
  await expect(rejectMenuItem).toBeVisible();

  await rejectMenuItem.click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Odrzuć aplikację" })).toBeVisible();
  await expect(dialog.getByText("Aplikacja zostanie przeniesiona do archiwum i zniknie z tablicy.")).toBeVisible();

  // Confirm triggers a full window.location.reload() on success, so wait for the reload's
  // load event alongside the click rather than asserting synchronously right after it.
  await Promise.all([page.waitForEvent("load"), dialog.getByRole("button", { name: "Odrzuć" }).click()]);

  await expect(page.getByText(company)).toHaveCount(0);

  const { data, error } = await admin.from("applications").select("id, archived_at").eq("id", application.id).single();
  if (error) throw error;
  expect(data.archived_at).not.toBeNull();
});

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
