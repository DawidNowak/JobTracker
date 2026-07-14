import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";

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

  // KanbanColumn renders a plain <div> with no region/landmark role — only its <h2> is named.
  // Scope assertions to the column containing the matching heading so a card seeded into one
  // column can never be mistaken for a match under a sibling column.
  const column = (name: string) =>
    page
      .locator("div")
      .filter({ has: page.getByRole("heading", { name }) })
      .last();

  await expect(column("Interesujące").getByText(companyInteresting)).toBeVisible();
  await expect(column("Zaaplikowano").getByText(companyApplied)).toBeVisible();
});
