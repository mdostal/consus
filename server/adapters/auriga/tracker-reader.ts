/**
 * Auriga Tracker Reader — read-only client against Auriga's tracker/
 * observability surface (EventContract + ConsumerContract + LockContract +
 * TrackerAdapter, Multica-backed).
 *
 * RISK (architecture.md's single largest flagged risk, carried forward):
 * no local Auriga repo/spec exists to verify the exact wire schema against
 * as of this epic's planning. This reader is built against REQ-06's
 * BEHAVIORAL contract only — read current dispatch/close/error/retry
 * state, never call dispatch/claim/close — so the real transport can be
 * wired in later without changing this class's public surface. The
 * transport interface intentionally exposes only a state-read method;
 * there is no dispatch/claim/close method to accidentally call.
 */

export type AurigaEventState = "dispatched" | "closed" | "error" | "retry" | string;

export type AurigaStateResult =
  | { ok: true; state: AurigaEventState }
  | { ok: false; error: string };

/**
 * Deliberately read-only transport surface. Real implementation (once
 * docs/contracts/pantheon-contract-levels.md lands) will query Auriga's
 * TrackerAdapter/Multica-backed observability surface; it must never gain
 * a dispatch/claim/close method, or AurigaTrackerReader's read-only
 * guarantee is compromised at the transport layer.
 */
export interface AurigaTrackerTransport {
  getEventState(eventId: string): Promise<AurigaStateResult>;
}

export class AurigaTrackerReader {
  constructor(private readonly transport: AurigaTrackerTransport) {}

  /** Read-only: current dispatch/close/error/retry state for a tracked event. */
  async getState(eventId: string): Promise<AurigaStateResult> {
    return this.transport.getEventState(eventId);
  }
}
