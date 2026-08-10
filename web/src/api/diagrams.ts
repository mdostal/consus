import { API_BASE_URL } from "../config";

export interface RepoDiagram {
  topLevel: string;
  fullComponent: string;
  cached_at?: string;
  stale?: boolean;
}

export interface CascadeDiagram {
  mermaid: string;
  cached_at?: string;
  stale?: boolean;
}

async function readDiagramJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(`Failed to load diagram: ${detail}`);
  }

  return response.json();
}

export async function fetchRepoDiagram(repo: string): Promise<RepoDiagram> {
  const normalizedRepo = repo.trim();
  if (!normalizedRepo) {
    throw new Error("A repo is required to load a diagram");
  }

  return readDiagramJson<RepoDiagram>(`/api/diagrams/${encodeURIComponent(normalizedRepo)}`);
}

export async function fetchCascadeDiagram(): Promise<CascadeDiagram> {
  return readDiagramJson<CascadeDiagram>("/api/diagrams/cascade");
}
