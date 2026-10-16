import type { Thread } from "./store.js";

type Listener = (thread: Thread) => void;

/**
 * In-process fan-out of thread changes to open SSE streams
 * (GET /api/threads/stream). Push only — a write publishes the fresh
 * thread, nothing ever polls.
 */
export class ThreadBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(thread: Thread): void {
    for (const listener of this.listeners) {
      try {
        listener(thread);
      } catch {
        // One broken stream must not stop the others.
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
