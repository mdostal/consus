import { useState } from "react";

export interface Comment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface CommentThreadProps {
  comments: Comment[];
  onSubmit: (body: string) => void;
}

/**
 * REQ-04: item-type-agnostic comment/chat thread, attached to any item view
 * (docs, decisions, KB entries) — just reads author/body/createdAt.
 */
export function CommentThread({ comments, onSubmit }: CommentThreadProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setDraft("");
  }

  return (
    <section className="comment-thread">
      <ul className="comment-thread__list">
        {comments.map((comment) => (
          <li key={comment.id} className="comment-thread__item">
            <span className="comment-thread__author">{comment.author}</span>
            <time className="comment-thread__time" dateTime={comment.createdAt}>
              {comment.createdAt}
            </time>
            <p className="comment-thread__body">{comment.body}</p>
          </li>
        ))}
      </ul>

      <div className="comment-thread__compose">
        <textarea
          aria-label="Add a comment"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="button" onClick={handleSubmit}>
          Send
        </button>
      </div>
    </section>
  );
}
