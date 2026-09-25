import { useCallback, useEffect, useState } from "react";
import { CommentThread, type Comment } from "./CommentThread";

// Consus has no auth layer (standalone, local-first) — every other write
// path (postVerdict, DecisionView's own submitComment) hardcodes the same
// "Mathew" actor rather than pretending there's a real login. Matches that
// exact convention instead of inventing a new one.
const ACTOR = "Mathew";

export interface CommentsPanelProps {
  itemId: string;
}

/**
 * Owns fetch/submit state for an item's comment thread, extracted from
 * DecisionView's own inline loadComments/submitComment (App.tsx) so
 * SurveyView can mount a real, independently-scoped thread per member —
 * same "component fetches its own data" pattern AttachmentsPanel and
 * ArtifactLinksPanel already use.
 */
export function CommentsPanel({ itemId }: CommentsPanelProps) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/comments`);
      if (res.ok) setComments(await res.json());
      else setComments((prev) => prev ?? []);
    } catch {
      // Matches DecisionView's own convention: comments are best-effort.
      setComments((prev) => prev ?? []);
    }
  }, [itemId]);

  useEffect(() => {
    setComments(null);
    loadComments();
  }, [loadComments]);

  async function submitComment(body: string) {
    setError(null);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author: ACTOR, body }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadComments();
    } catch {
      setError("Could not post comment.");
    }
  }

  if (comments === null) {
    return <p className="state">Loading comments…</p>;
  }

  return (
    <div className="comments-panel">
      <CommentThread comments={comments} onSubmit={submitComment} />
      {error ? <p className="state state--err">{error}</p> : null}
    </div>
  );
}
