import { test, expect, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// PANT-965: mermaid rendering, the diagram editor, and new-file proposals,
// in a real browser with the real mermaid library. The fixture repo and the
// file-transport handoff directory come from e2e/server.mjs.
const FIXTURE_DIR = join(process.cwd(), "e2e", ".fixture");
const REPO_DIR = join(FIXTURE_DIR, "demo-repo");
const HANDOFFS_DIR = join(FIXTURE_DIR, "handoffs");

interface Handoff {
  itemId: string;
  targetType: string;
  diff: string;
  description: string;
}

function handoffs(): Handoff[] {
  if (!existsSync(HANDOFFS_DIR)) return [];
  return readdirSync(HANDOFFS_DIR).map((f) => JSON.parse(readFileSync(join(HANDOFFS_DIR, f), "utf8")) as Handoff);
}

async function openProjectDocs(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Diagrams" })).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  const res = await request.post("/api/projects/demo/ingest");
  expect(res.ok()).toBeTruthy();
});

test("renders mermaid fences in a markdown doc, and shows the error for a broken one", async ({ page }) => {
  await openProjectDocs(page);
  await page.getByRole("button", { name: "docs/architecture.md" }).click();

  const first = page.getByTestId("doc-mermaid-0");
  await expect(first.locator("svg")).toBeVisible();
  await expect(first.locator("svg")).toContainText("Web app");

  const broken = page.getByTestId("doc-mermaid-1");
  await expect(broken.getByRole("alert")).toContainText("Mermaid syntax error");
  await expect(broken.locator("svg")).toHaveCount(0);
});

test("edits a .mmd diagram, sees the preview update, and saves it as a proposal", async ({ page }) => {
  await openProjectDocs(page);
  await page.getByRole("button", { name: "docs/diagrams/system.mmd" }).click();

  const view = page.getByTestId("mmd-diagram-view");
  await expect(view.locator("svg")).toContainText("Database");

  await view.getByRole("button", { name: "Edit diagram" }).click();
  const source = page.getByLabel("Diagram source", { exact: true });
  const preview = page.getByTestId("mermaid-editor-preview");
  await expect(preview.locator("svg")).toContainText("Client");
  await expect(preview.locator("svg")).not.toContainText("Cache");

  // A typo shows the error in the preview...
  await source.fill("flowchart TD\n  client[Client] --> ((");
  await expect(preview.getByRole("alert")).toContainText("Mermaid syntax error");

  // ...and fixing it brings the diagram back with the new node.
  const edited = "flowchart TD\n  client[Client] --> api[API]\n  api --> cache[Cache]\n  cache --> db[(Database)]\n";
  await source.fill(edited);
  await expect(preview.locator("svg")).toContainText("Cache");
  await expect(preview.getByRole("alert")).toHaveCount(0);

  const editor = page.getByTestId("mermaid-editor");
  await editor.getByLabel("Description", { exact: true }).fill("put a cache in front of the database");
  await editor.getByRole("button", { name: "Save as proposal" }).click();
  await expect(page.getByText("change proposed…")).toBeVisible();

  const proposal = handoffs().find((h) => h.itemId === "doc:demo:docs/diagrams/system.mmd");
  expect(proposal).toBeDefined();
  expect(proposal!.targetType).toBe("doc");
  expect(proposal!.description).toBe("put a cache in front of the database");
  expect(proposal!.diff).toContain("+   api --> cache[Cache]");
  expect(proposal!.diff).toContain("-   api --> db[(Database)]");

  // Consus never writes the repo.
  expect(readFileSync(join(REPO_DIR, "docs", "diagrams", "system.mmd"), "utf8")).not.toContain("Cache");
});

test("creates a new diagram as a new-file proposal", async ({ page }) => {
  await openProjectDocs(page);
  await page.getByRole("button", { name: "New diagram" }).click();

  const form = page.getByRole("form", { name: "New diagram" });
  await form.getByLabel("File path").fill("docs/diagrams/login");
  await form.getByLabel("Template").selectOption({ label: "Sequence diagram (.mmd)" });
  await expect(form.getByTestId("new-doc-preview").locator("svg")).toContainText("Client");

  await form.getByRole("button", { name: "Propose new file" }).click();
  await expect(page.getByTestId("new-doc-created")).toContainText("Proposed new file docs/diagrams/login.mmd");

  const proposal = handoffs().find((h) => h.itemId === "doc:demo:docs/diagrams/login.mmd");
  expect(proposal).toBeDefined();
  expect(proposal!.diff.split("\n").slice(0, 3)).toEqual(["--- /dev/null", "+++ b/docs/diagrams/login.mmd", "+ sequenceDiagram"]);
  expect(existsSync(join(REPO_DIR, "docs", "diagrams", "login.mmd"))).toBe(false);
});
