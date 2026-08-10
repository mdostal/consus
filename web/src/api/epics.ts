export interface EpicListItem {
  id: string;
  title: string;
  status: string;
  story_count: number;
  last_updated: string;
}

export async function fetchEpics(): Promise<EpicListItem[]> {
  const response = await fetch("/api/epics");
  if (!response.ok) {
    throw new Error(`Failed to load epics: HTTP ${response.status}`);
  }
  return response.json();
}
