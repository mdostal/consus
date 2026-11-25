import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * PANT-960: switching the header client changes which projects are listed,
 * the choice survives a reload, and the inbox shows every client's items.
 * Works for any registered project list: projects alternate between two
 * clients, and the last one stays ungrouped.
 */

const DECISION_PAYLOAD = {
  version: "dostal:decision-request/v1",
  title: "Pick a direction",
  context: "",
  options: [
    { id: "A", title: "Yes", tradeoffs: "" },
    { id: "B", title: "No", tradeoffs: "" },
  ],
  recommended: "A",
};

async function assignClients(request: APIRequestContext) {
  const { projects } = (await (await request.get("/api/projects")).json()) as { projects: string[] };
  expect(projects.length).toBeGreaterThanOrEqual(3);
  const alpha: string[] = [];
  const beta: string[] = [];
  const grouped = projects.slice(0, -1);
  for (const [i, project] of grouped.entries()) {
    const client = i % 2 === 0 ? "Alpha" : "Beta";
    (client === "Alpha" ? alpha : beta).push(project);
    const res = await request.patch(`/api/projects/${project}`, { data: { client } });
    expect(res.ok()).toBeTruthy();
  }
  return { projects, alpha, beta, ungrouped: projects.at(-1)! };
}

async function listedProjects(page: Page): Promise<string[]> {
  const buttons = page.getByTestId("project-nav").getByRole("button");
  const labels = await buttons.allTextContents();
  return labels.filter((l) => l !== "All projects");
}

test("switching clients changes the listed projects", async ({ page, request }) => {
  const { projects, alpha, beta } = await assignClients(request);
  // One open question so the app opens on its main view, not first-run onboarding.
  const seeded = await request.post("/api/decisions", {
    data: { id: `e2e-${Date.now()}`, title: "Pick a direction", source_repo: alpha[0], decision_payload: DECISION_PAYLOAD },
  });
  expect(seeded.status()).toBe(201);

  await page.goto("/");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const switcher = page.getByLabel("Select client");

  await expect(switcher).toHaveValue("");
  await expect.poll(() => listedProjects(page)).toEqual(projects);

  await switcher.selectOption("Alpha");
  await expect.poll(() => listedProjects(page)).toEqual(alpha);

  await switcher.selectOption("Beta");
  await expect.poll(() => listedProjects(page)).toEqual(beta);

  // Remembered per browser.
  await page.reload();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByLabel("Select client")).toHaveValue("Beta");
  await expect.poll(() => listedProjects(page)).toEqual(beta);

  await page.getByLabel("Select client").selectOption("");
  await expect.poll(() => listedProjects(page)).toEqual(projects);

  // The inbox spans clients and labels each entry; opening it switches client.
  await page.getByLabel("Select client").selectOption("Beta");
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  const entry = page.getByRole("list", { name: "Inbox" }).getByRole("button", { name: /Pick a direction/ }).first();
  await expect(entry).toContainText(`Alpha · ${alpha[0]}`);
  await entry.click();
  await expect(page.getByLabel("Select client")).toHaveValue("Alpha");
  await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();
});
