import { API_BASE_URL } from "../config";

export interface FireDocResult {
  docId: number;
  issueId: string;
  issueUrl: string;
  firedAt: string;
}

export interface DocDetails {
  id: number;
  repo: string;
  path: string;
  format: "md" | "html";
  content: string;
  source: "disk" | "edit";
  fired_at: string | null;
  multica_issue_id: string | null;
  multica_issue_url: string | null;
  epic: string | null;
  last_scanned_at: string;
}

export async function fetchDocById(id: string | number): Promise<DocDetails> {
  const response = await fetch(`${API_BASE_URL}/api/docs/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to load doc: HTTP ${response.status}`);
  }
  return response.json();
}

export async function updateDoc(id: string | number, content: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/docs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update doc: ${response.status}`);
  }
}

export async function fireDoc(id: string | number): Promise<FireDocResult> {
  const response = await fetch(`${API_BASE_URL}/api/docs/${id}/fire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fire doc: ${response.status}`);
  }
  return response.json();
}
