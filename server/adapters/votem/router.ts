/**
 * votem Router — hands quorum-scoped items to votem and surfaces its
 * resulting state; never implements voting itself (REQ-14). "votem is the
 * MECHANISM Delphi routes to when policy says quorum" (docs/prior-art.md §2).
 *
 * RISK: no local votem repo/spec exists as of this reconciliation — same
 * adapter-first, schema-pending treatment as Vesta/Auriga.
 */

export interface VotemQuorumState {
  status: string;
  tiebreak?: unknown;
  [key: string]: unknown;
}

export type VotemResult = { ok: true; state: VotemQuorumState } | { ok: false; error: string };

export interface VotemTransport {
  routeToQuorum(itemId: string): Promise<VotemResult>;
}

export type VotemRouteResult =
  | { ok: true; state: VotemQuorumState }
  | { ok: false; reason: "quorum-unavailable"; error: string };

export class VotemRouter {
  constructor(private readonly transport: VotemTransport) {}

  async route(itemId: string): Promise<VotemRouteResult> {
    const result = await this.transport.routeToQuorum(itemId);
    if (!result.ok) {
      // Explicit "quorum unavailable" — never silently fall back to a
      // direct human decision that bypasses the configured Vesta policy.
      return { ok: false, reason: "quorum-unavailable", error: result.error };
    }
    return { ok: true, state: result.state };
  }
}
