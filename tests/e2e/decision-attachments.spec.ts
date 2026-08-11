import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

const decision = {
  id: "ticket-1",
  type: "multica_issue",
  title: "Choose the layout",
  status: "in_review",
  decision_payload: null,
  decision_type: "choose",
  triage_bucket: "open_question",
};

async function stubDecisionAttachments(page: Page, initialAttachments: any[] = []) {
  const attachments = [...initialAttachments];

  await page.route("**/api/decisions", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([decision]) });
  });

  await page.route("**/api/tickets/ticket-1/attachments", async (route) => {
    if (route.request().method() === "POST") {
      const uploaded = {
        id: `attachment-${attachments.length + 1}`,
        item_id: "ticket-1",
        file_name: "sample.pdf",
        mime_type: "application/pdf",
        size: 1024,
        created_at: "2026-08-11T00:00:00.000Z",
      };
      attachments.unshift(uploaded);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(uploaded) });
      return;
    }

    await route.fulfill({ contentType: "application/json", body: JSON.stringify(attachments) });
  });

  await page.route("**/api/attachments/*", async (route) => {
    if (route.request().method() === "DELETE") {
      const id = route.request().url().split("/").pop();
      const index = attachments.findIndex((attachment) => attachment.id === id);
      if (index !== -1) attachments.splice(index, 1);
      await route.fulfill({ status: 204 });
      return;
    }

    await route.fulfill({ status: 200, body: "attachment content" });
  });
}

test.describe("Decision detail attachments", () => {
  test("uploads a valid file into the selected decision detail panel", async ({ page }) => {
    await stubDecisionAttachments(page);

    await page.goto("/");
    await page.getByText("Choose the layout").click();
    await expect(page.getByTestId("decision-attachments")).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles("tests/fixtures/sample-files/sample.pdf");

    await expect(page.locator(".attachment-item")).toContainText("sample.pdf");
  });

  test("shows client-side validation for disallowed file types", async ({ page }) => {
    await stubDecisionAttachments(page);

    await page.goto("/");
    await page.getByText("Choose the layout").click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "malware.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("content"),
    });

    await expect(page.locator('[role="alert"]').filter({ hasText: "File type not allowed" })).toBeVisible();
  });

  test("deletes an attachment from the selected decision detail panel", async ({ page }) => {
    await stubDecisionAttachments(page, [
      {
        id: "attachment-1",
        item_id: "ticket-1",
        file_name: "context.pdf",
        mime_type: "application/pdf",
        size: 1024,
        created_at: "2026-08-11T00:00:00.000Z",
      },
    ]);

    await page.goto("/");
    await page.getByText("Choose the layout").click();
    await expect(page.locator(".attachment-item")).toContainText("context.pdf");

    await page.getByTitle("Delete").click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.locator(".attachment-item")).toHaveCount(0);
  });
});
