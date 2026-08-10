export interface FiredTicket {
  id: string;
  multica_issue_id: string;
  target_repo: string;
  fired_by: string;
  fired_at: string;
  repo: string;
  file_path: string;
}

export async function fetchFiredTickets(): Promise<FiredTicket[]> {
  const response = await fetch("/api/fired");
  if (!response.ok) {
    throw new Error(`Failed to load fired tickets: HTTP ${response.status}`);
  }
  return response.json();
}
