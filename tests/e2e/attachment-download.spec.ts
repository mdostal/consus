import { test, expect } from '@playwright/test';

test.describe('Attachment Download and Delete Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Setup: Upload a file first so we have something to download and delete
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('tests/fixtures/sample-files/sample.pdf');
    await expect(page.locator('.attachment-item')).toContainText('sample.pdf', { timeout: 10000 });
  });

  test('should download attachment successfully', async ({ page }) => {
    // Start waiting for the download
    const downloadPromise = page.waitForEvent('download');
    
    // Click the download button on the attachment item
    const downloadButton = page.locator('.attachment-item').filter({ hasText: 'sample.pdf' }).locator('button[aria-label^="Download"]');
    await downloadButton.click();

    const download = await downloadPromise;
    // Wait for the download process to complete
    expect(download.suggestedFilename()).toBe('sample.pdf');
    
    // Verify there are no errors during download
    const failure = await download.failure();
    expect(failure).toBeNull();
  });

  test('should delete attachment successfully', async ({ page }) => {
    // Click the delete button
    const deleteButton = page.locator('.attachment-item').filter({ hasText: 'sample.pdf' }).locator('button[aria-label^="Delete"]');
    await deleteButton.click();

    // Confirm deletion in the modal
    const confirmButton = page.locator('button').filter({ hasText: 'Delete' });
    await confirmButton.click();

    // Wait for the item to disappear
    await expect(page.locator('.attachment-item').filter({ hasText: 'sample.pdf' })).toHaveCount(0, { timeout: 10000 });
  });
});
