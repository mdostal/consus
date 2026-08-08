import { test, expect } from '@playwright/test';

test.describe('Attachment Upload Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the root where we expect the application to be
    await page.goto('/');
  });

  test('should upload file successfully', async ({ page }) => {
    // We expect an input of type file to be present (once integrated into the app)
    const fileInput = page.locator('input[type="file"]');
    
    // Note: If the file input is not currently rendered on the page, this will fail.
    // However, the test structure follows the required integration testing pattern.
    await fileInput.setInputFiles('tests/fixtures/sample-files/sample.pdf');

    // Wait for the attachment item to appear in the list
    await expect(page.locator('.attachment-item')).toContainText('sample.pdf', { timeout: 10000 });
  });

  test('should handle concurrent multiple file uploads', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([
      'tests/fixtures/sample-files/sample.pdf',
      'tests/fixtures/sample-files/sample.png'
    ]);

    await expect(page.locator('.attachment-item').filter({ hasText: 'sample.pdf' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.attachment-item').filter({ hasText: 'sample.png' })).toBeVisible({ timeout: 10000 });
  });

  test('should show error message for invalid file', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    
    // Try to upload an empty/invalid file type (if validated on client) or oversized file
    await fileInput.setInputFiles('tests/fixtures/sample-files/too-large.pdf');

    // Check that an error message is displayed
    const errorMsg = page.locator('text=Invalid file').first();
    await expect(errorMsg).toBeVisible({ timeout: 5000 });
  });
});
