import { test, expect } from '@playwright/test';

test.describe('Two-pane Decisions layout', () => {
  test('scrolling the list pane never moves the detail pane, and selection updates the detail pane in place', async ({ page }) => {
    // independent-scroll panes only apply above the ~768px collapse breakpoint
    test.skip(page.viewportSize()!.width < 768, 'single-column layout below 768px has no independent scroll panes');

    await page.goto('/');
    await page.waitForSelector('[data-testid="decision-list"]');

    const listPane = page.locator('[data-testid="decisions-view-list-pane"]');
    const detailPane = page.locator('[data-testid="decisions-view-detail-pane"]');
    await expect(listPane).toBeVisible();
    await expect(detailPane).toBeVisible();
    await expect(page.locator('[data-testid="decision-detail-empty"]')).toBeVisible();

    const rows = page.locator('[data-testid="decision-list"] li');
    const rowCount = await rows.count();
    test.skip(rowCount < 2, 'needs at least 2 decisions to exercise selection + scroll');

    await rows.nth(1).click();
    await expect(page.locator('[data-testid="decision-detail"]')).toBeVisible();

    await listPane.evaluate((el) => {
      el.scrollTop = 300;
    });
    await expect
      .poll(() => detailPane.evaluate((el) => el.scrollTop))
      .toBe(0);
    await expect
      .poll(() => listPane.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);

    // list is unaffected by selection — same row count, still scrolled
    expect(await rows.count()).toBe(rowCount);

    await page.screenshot({ path: 'test-results/decisions-two-pane-desktop.png' });
  });

  test('collapses to a single column below 768px, list first then a pushed detail panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="decision-list"]');

    const gridColumns = await page.locator('.decisions-view').evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(gridColumns.trim().split(/\s+/)).toHaveLength(1);

    const listBox = await page.locator('[data-testid="decisions-view-list-pane"]').boundingBox();
    const detailBox = await page.locator('[data-testid="decisions-view-detail-pane"]').boundingBox();
    expect(listBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    // stacked: detail pane starts below the list pane, same left edge/width
    expect(detailBox!.y).toBeGreaterThan(listBox!.y);
    expect(Math.round(detailBox!.width)).toBe(Math.round(listBox!.width));

    await page.screenshot({ path: 'test-results/decisions-two-pane-mobile.png' });
  });
});
