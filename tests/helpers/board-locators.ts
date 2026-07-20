import type { Locator, Page } from "@playwright/test";

// KanbanColumn renders a plain <div> with no region/landmark role — only its <h2> is named.
// Scope assertions to the column containing the matching heading so a card seeded into one
// column can never be mistaken for a match under a sibling column.
export function column(page: Page, name: string): Locator {
  return page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name }) })
    .last();
}

export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}
