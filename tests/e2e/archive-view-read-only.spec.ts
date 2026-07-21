import { test, expect } from "./fixtures";

// Risk test (test-plan.md risk map; S-11 FR-017 durability guardrail): the archive detail page
// renders every field and the full note history read-only. CardNotes (the active-board detail
// surface) exposes "Dodaj notatkę" / "Edytuj" / "Usuń" controls for the same data — this test
// proves the archive page never leaks any of them, since a regression here would let a user
// mutate a record the product promises is permanently frozen.
test("archived application renders full detail and notes with no editing controls present", async ({
  page,
  seedApp,
  admin,
  account,
}) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const company = `E2E Archive Co ${runId}`;
  const position = `E2E Archive Rola ${runId}`;
  const noteBody = `E2E archive note ${runId}`;

  const application = await seedApp({
    status: "Zaaplikowano",
    company,
    position,
    description: "Opis oferty do testu archiwum.",
    salary: "18000-22000 PLN",
    work_mode: "Zdalna",
    recruiter_contact: "rekruter@example.com",
    archived_at: new Date().toISOString(),
  });

  const { error: noteError } = await admin
    .from("application_notes")
    .insert({ application_id: application.id, user_id: account.userId, body: noteBody });
  if (noteError) throw noteError;

  await page.goto("/archive");
  await expect(page.getByRole("link", { name: company })).toBeVisible();

  await page.getByRole("link", { name: company }).click();
  await page.waitForURL(`**/archive/${application.id}`);

  // Full detail renders, including the note history.
  await expect(page.getByRole("heading", { name: company })).toBeVisible();
  await expect(page.getByText("Opis oferty do testu archiwum.")).toBeVisible();
  await expect(page.getByText("18000-22000 PLN")).toBeVisible();
  await expect(page.getByText("Zdalna")).toBeVisible();
  await expect(page.getByText("rekruter@example.com")).toBeVisible();
  await expect(page.getByText(noteBody)).toBeVisible();

  // No editing affordance anywhere on the page — the read-only guardrail under test.
  await expect(page.getByPlaceholder("Dodaj notatkę…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dodaj notatkę" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edytuj" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Usuń" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Opcje aplikacji" })).toHaveCount(0);
});
