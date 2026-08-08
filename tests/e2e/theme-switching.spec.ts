import { test, expect } from '@playwright/test';

// Test across standard themes: light, dark (and high-contrast if supported)
const themes = ['light', 'dark'] as const;

for (const theme of themes) {
  test.describe(`Attachment UI - ${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test.beforeEach(async ({ page }) => {
      await page.goto('/');
    });

    test(`should render attachment list correctly in ${theme} mode`, async ({ page }) => {
      // Assuming the file input exists in the DOM
      const fileInput = page.locator('input[type="file"]');
      
      await fileInput.setInputFiles('tests/fixtures/sample-files/sample.pdf');
      
      const attachmentItem = page.locator('.attachment-item');
      await expect(attachmentItem).toContainText('sample.pdf', { timeout: 10000 });
      
      // Take a screenshot to verify theme visually if needed
      // await expect(page).toHaveScreenshot(`attachment-ui-${theme}.png`);
    });
  });
}

// Test responsive layout (Mobile)
test.describe('Responsive Layout', () => {
  // Mobile Chrome viewport size is configured in playwright.config.ts
  // This block assumes we are running with that configuration
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12/13/14 size

  test('should render properly on mobile viewport', async ({ page }) => {
    await page.goto('/');
    
    // In a real environment, we'd test the mobile styling and layout specifically
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('tests/fixtures/sample-files/sample.pdf');
    
    const attachmentItem = page.locator('.attachment-item');
    await expect(attachmentItem).toBeVisible({ timeout: 10000 });
    
    // Verify buttons are still accessible on small screens
    const downloadButton = page.locator('.attachment-item button[aria-label^="Download"]');
    await expect(downloadButton).toBeVisible();
  });
});
