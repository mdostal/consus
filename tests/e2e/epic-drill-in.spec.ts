import { test, expect } from '@playwright/test';
import epicWithDocs from './fixtures/epic-with-docs.json' assert { type: 'json' };

test.describe('Epic Drill-in Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the epic list API
    await page.route('**/api/epics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'mock-epic-123',
            title: '[slice-2] Test Epic with Docs',
            status: 'pending',
            story_count: 2,
            last_updated: '2026-08-10T00:00:00Z',
          }
        ]),
      });
    });

    // Mock the specific epic detail API
    await page.route(`**/api/epics/mock-epic-123`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(epicWithDocs),
      });
    });

    // Mock the approve API
    await page.route(`**/api/epics/mock-epic-123/approve`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 'todo', comment_id: 'mock-comment-id' }),
      });
    });

    // Mock diagrams API to prevent mermaid rendering layout shifts
    await page.route('**/api/diagrams/**', async (route) => {
      if (route.request().url().includes('cascade')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mermaid: 'graph TD\nA-->B' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ topLevel: 'graph TD\nC-->D', fullComponent: 'graph TD\nE-->F' }),
        });
      }
    });
  });

  test('should navigate from list to detail, view tabs, and approve', async ({ page }) => {
    page.on('console', msg => console.log(msg.type(), msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    // 1. Load epic list view
    await page.goto('/epics');

    // Wait for the epic list to load
    const list = page.getByTestId('epic-list');
    await expect(list).toBeVisible();

    // 2. Click on the epic card to view details
    // Assuming EpicCard renders the title
    const epicCard = list.getByText('[slice-2] Test Epic with Docs');
    await expect(epicCard).toBeVisible();
    await epicCard.click();

    // Verify navigation to details
    await expect(page).toHaveURL(/\/epics\/mock-epic-123/);
    
    // Debug: log the page content if we fail to find the view
    try {
      const detailView = page.getByTestId('epic-detail-view');
      await expect(detailView).toBeVisible({ timeout: 2000 });
    } catch (e) {
      console.log('Failed to find epic-detail-view. Page content:');
      console.log(await page.content());
      throw e;
    }

    // 3. Navigate through all tabs
    // Diagrams tab (default active tab)
    const diagramsTab = page.getByRole('tab', { name: 'Diagrams' });
    await expect(diagramsTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('epic-diagrams-tab')).toBeVisible();

    // Docs tab
    const docsTab = page.getByRole('tab', { name: 'Docs' });
    await docsTab.click();
    await expect(docsTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Design Discussion', { exact: true })).toBeVisible();
    await expect(page.getByText('This is a mock design discussion for testing.')).toBeVisible();

    // Stories tab
    const storiesTab = page.getByRole('tab', { name: 'Stories' });
    await storiesTab.click();
    await expect(storiesTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Story 1: Test Component')).toBeVisible();

    // Decisions tab
    const decisionsTab = page.getByRole('tab', { name: 'Decisions' });
    await decisionsTab.click();
    await expect(decisionsTab).toHaveAttribute('aria-selected', 'true');
    const decisionsPanel = page.getByTestId('epic-decisions-tab');
    await expect(decisionsPanel).toBeVisible();

    // 4. Click "Approve" button
    // The "Approve" button is inside the DecisionActions component
    // We can target the approve button in the Decisions tab
    const approveButton = decisionsPanel.getByRole('button', { name: /approve/i });
    await expect(approveButton).toBeVisible();
    
    // Check initial status
    const statusText = page.getByTestId('epic-detail-status');
    await expect(statusText).toHaveText('pending');

    // Setup network listener to assert the request is sent
    const approveRequestPromise = page.waitForRequest(request => 
      request.url().includes('/api/epics/mock-epic-123/approve') && request.method() === 'POST'
    );

    // Click the button
    await approveButton.click();

    // Verify KB write (Network request sent)
    const approveRequest = await approveRequestPromise;
    expect(approveRequest).toBeTruthy();

    // 5. Verify UI state update
    // Assuming the DecisionActions sets status to "todo" (based on our mock response)
    // Wait for status text to update
    await expect(statusText).toHaveText('todo');
  });
});
