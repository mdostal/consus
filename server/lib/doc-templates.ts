/**
 * Starter content for "New doc" / "New diagram" (PANT-965). A template only
 * seeds the new-file proposal's content — the operator can edit it before
 * firing — so these stay short and generic, with no repo-specific text.
 */

export type DocTemplateKind = "doc" | "diagram";

export interface DocTemplate {
  id: string;
  label: string;
  kind: DocTemplateKind;
  /** The file extension a path using this template must end with. */
  extension: ".md" | ".mmd";
  content: string;
}

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    id: "blank",
    label: "Blank doc",
    kind: "doc",
    extension: ".md",
    content: "# Title\n",
  },
  {
    id: "adr",
    label: "ADR (architecture decision record)",
    kind: "doc",
    extension: ".md",
    content: [
      "# ADR: Title",
      "",
      "- Status: proposed",
      "- Date: YYYY-MM-DD",
      "",
      "## Context",
      "",
      "What is the issue that motivates this decision?",
      "",
      "## Decision",
      "",
      "What is the change being proposed or made?",
      "",
      "## Consequences",
      "",
      "What becomes easier or harder because of this change?",
      "",
    ].join("\n"),
  },
  {
    id: "architecture-overview",
    label: "Architecture overview",
    kind: "doc",
    extension: ".md",
    content: [
      "# Architecture overview",
      "",
      "## Purpose",
      "",
      "What the system does and who uses it.",
      "",
      "## Components",
      "",
      "```mermaid",
      "flowchart LR",
      "  client[Client] --> api[API]",
      "  api --> db[(Database)]",
      "```",
      "",
      "## Data flow",
      "",
      "How a request moves through the components above.",
      "",
      "## Boundaries and dependencies",
      "",
      "What this system talks to, and what it owns.",
      "",
    ].join("\n"),
  },
  {
    id: "mmd-flowchart",
    label: "Flowchart diagram (.mmd)",
    kind: "diagram",
    extension: ".mmd",
    content: ["flowchart TD", "  start([Start]) --> step[Step]", "  step --> done([Done])", ""].join("\n"),
  },
  {
    id: "mmd-sequence",
    label: "Sequence diagram (.mmd)",
    kind: "diagram",
    extension: ".mmd",
    content: [
      "sequenceDiagram",
      "  participant Client",
      "  participant Server",
      "  Client->>Server: Request",
      "  Server-->>Client: Response",
      "",
    ].join("\n"),
  },
];

export function findDocTemplate(id: string): DocTemplate | undefined {
  return DOC_TEMPLATES.find((t) => t.id === id);
}

/**
 * The proposal diff for a file that doesn't exist yet: a `/dev/null` header
 * naming the new path, then every line as an addition — the same `+ ` line
 * prefix computeLineDiff (web/src/features/docs/textDiff.ts) emits for edits,
 * so the harness and the VisualDiff preview read both the same way.
 */
export function newFileDiff(path: string, content: string): string {
  const body = content.endsWith("\n") ? content.slice(0, -1) : content;
  return ["--- /dev/null", `+++ b/${path}`, ...body.split("\n").map((line) => `+ ${line}`)].join("\n");
}
