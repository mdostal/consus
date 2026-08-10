export interface EpicListItem {
  id: string;
  title: string;
  status: string;
  story_count: number;
  last_updated: string;
}

export type EpicDocKind = "design-discussion" | "research-brief" | "outline";

export interface EpicDoc {
  kind: EpicDocKind;
  title: string;
  content: string;
  source?: string;
  updated_at?: string;
}

export interface EpicStory {
  id: string;
  title: string;
  status: string;
  dependencies: string[];
  tracker_url?: string;
}

export interface EpicDetail {
  id: string;
  title: string;
  status: string;
  repo_id?: string;
  last_updated: string;
  docs: EpicDoc[];
  stories: EpicStory[];
}

export interface ApproveEpicResult {
  ok: true;
  status: string;
  comment_id?: string;
}

export async function fetchEpics(): Promise<EpicListItem[]> {
  const response = await fetch("/api/epics");
  if (!response.ok) {
    throw new Error(`Failed to load epics: HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchEpicDetail(epicId: string): Promise<EpicDetail> {
  const response = await fetch(`/api/epics/${encodeURIComponent(epicId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load epic: HTTP ${response.status}`);
  }
  return response.json();
}

export async function approveEpic(epicId: string): Promise<ApproveEpicResult> {
  const response = await fetch(`/api/epics/${encodeURIComponent(epicId)}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "consus" }),
  });
  if (!response.ok) {
    throw new Error(`Failed to approve epic: HTTP ${response.status}`);
  }
  return response.json();
}
