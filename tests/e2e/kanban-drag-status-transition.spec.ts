import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { waitForBoardHydration } from "../helpers/hydration";
import { column } from "../helpers/board-locators";

// Risk test (roadmap S-05 "kanban-status-transitions"): status changes happen exclusively via
// @dnd-kit pointer drag (KanbanBoard's DndContext/onDragEnd), not just the decision-prompt
// buttons other specs already cover. The named risk is regressing to a forward-only board —
// this proves the drag gesture itself works in BOTH directions.
async function dragCardToColumn(page: Page, cardText: string, columnName: string) {
  const card = page.getByText(cardText, { exact: true });
  const target = column(page, columnName);

  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) throw new Error("Setup: could not resolve drag source/target bounding box");

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + Math.min(targetBox.height / 2, 40);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // PointerSensor has a 5px activation distance — small intermediate step lets dnd-kit register
  // drag start before the long move toward the target column.
  await page.mouse.move(startX + 10, startY + 10, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

test("drags a card forward into Zaaplikowano and back into Interesujące via pointer drag", async ({
  page,
  seedApp,
}) => {
  const runId = crypto.randomUUID().slice(0, 8);
  const company = `E2E Drag Co ${runId}`;

  await seedApp({ status: "Interesujące", company });

  await page.goto("/dashboard");
  await waitForBoardHydration(page);

  await expect(column(page, "Interesujące").getByText(company)).toBeVisible();

  const [forwardPatch] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/applications/") && res.request().method() === "PATCH"),
    dragCardToColumn(page, company, "Zaaplikowano"),
  ]);
  expect(forwardPatch.ok()).toBe(true);

  await expect(column(page, "Zaaplikowano").getByText(company)).toBeVisible();
  await expect(column(page, "Interesujące").getByText(company)).toHaveCount(0);

  // onDragEnd only updates optimistic client state — it never reloads. Reload here so the
  // assertion reads the SSR-rendered board (real DB state), not the same optimistic state the
  // app already trusts; otherwise a PATCH that returns 200 without actually persisting the new
  // status would go uncaught.
  await page.reload();
  await waitForBoardHydration(page);
  await expect(column(page, "Zaaplikowano").getByText(company)).toBeVisible();
  await expect(column(page, "Interesujące").getByText(company)).toHaveCount(0);

  const [backwardPatch] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/applications/") && res.request().method() === "PATCH"),
    dragCardToColumn(page, company, "Interesujące"),
  ]);
  expect(backwardPatch.ok()).toBe(true);

  await expect(column(page, "Interesujące").getByText(company)).toBeVisible();
  await expect(column(page, "Zaaplikowano").getByText(company)).toHaveCount(0);

  await page.reload();
  await waitForBoardHydration(page);
  await expect(column(page, "Interesujące").getByText(company)).toBeVisible();
  await expect(column(page, "Zaaplikowano").getByText(company)).toHaveCount(0);
});
