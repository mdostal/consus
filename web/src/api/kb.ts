import { API_BASE_URL } from "../config";

export interface KbVersion {
  id: number;
  kb_entry_id: string;
  content: string;
  author: string;
  state: "published" | "draft";
  created_at: string;
}

export async function fetchKbDrafts(id: string): Promise<KbVersion[]> {
  const url = `${API_BASE_URL}/api/kb-entries/${id}/drafts`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load drafts: HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchKbVersions(id: string): Promise<KbVersion[]> {
  const url = `${API_BASE_URL}/api/kb-entries/${id}/versions`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load versions: HTTP ${response.status}`);
  }
  return response.json();
}

export async function saveKbDraft(id: string, author: string, content: string): Promise<void> {
  const url = `${API_BASE_URL}/api/kb-entries/${id}/draft`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ author, content })
  });
  if (!response.ok) {
    throw new Error(`Failed to save draft: HTTP ${response.status}`);
  }
}

export async function submitKbEntry(id: string, author: string, content: string): Promise<void> {
  const url = `${API_BASE_URL}/api/kb-entries/${id}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ author, content })
  });
  if (!response.ok) {
    throw new Error(`Failed to submit entry: HTTP ${response.status}`);
  }
}
