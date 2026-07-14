import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Waits for the KanbanBoard client:load island to finish hydrating (KanbanBoard.tsx
 * sets data-board-hydrated="true" in a useEffect once React has committed the tree
 * and attached every descendant handler). Call this right after navigating to
 * /dashboard and before the first interaction, so tests never click a button
 * before React has attached its handler.
 */
export async function waitForBoardHydration(page: Page): Promise<void> {
  await expect(page.locator('[data-board-hydrated="true"]')).toBeAttached({ timeout: 10_000 });
}
