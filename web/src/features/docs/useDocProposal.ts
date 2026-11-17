import { useCallback, useEffect, useState } from "react";
import type { AuditTrailEntry } from "../audit/AuditPanel";
import type { ProposeChangeInput } from "./DocRenderer";

export interface DocProposalState {
  proposeChange: (input: ProposeChangeInput) => void;
  pendingProposal: boolean;
  proposalFailureReason: string | null;
  auditEntries: AuditTrailEntry[];
}

/**
 * PANT-965: propose-a-change wiring for one open doc item (`doc:<repo>:<path>`)
 * — POST /api/proposals with targetType "doc", then the item's audit trail
 * for the history panel. The same flow App.tsx's DocsSection runs inline,
 * as a hook so the per-project docs view can use it too. `itemId` null
 * means no doc is open.
 */
export function useDocProposal(itemId: string | null): DocProposalState {
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [proposalFailureReason, setProposalFailureReason] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditTrailEntry[]>([]);

  const loadAuditTrail = useCallback((id: string) => {
    fetch(`/api/items/${encodeURIComponent(id)}/audit-trail`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setAuditEntries)
      .catch(() => {
        /* history is best-effort */
      });
  }, []);

  useEffect(() => {
    setPendingProposalId(null);
    setProposalFailureReason(null);
    setAuditEntries([]);
    if (itemId) loadAuditTrail(itemId);
  }, [itemId, loadAuditTrail]);

  const proposeChange = useCallback(
    ({ diff, description }: ProposeChangeInput) => {
      if (!itemId) return;
      fetch("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, targetType: "doc", diff, description, requestedBy: "Mathew" }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((proposal) => {
          if (proposal.status === "pending") {
            setPendingProposalId(proposal.id);
            setProposalFailureReason(null);
          } else {
            setPendingProposalId(null);
            setProposalFailureReason(proposal.failure_reason ?? null);
          }
          loadAuditTrail(itemId);
        })
        .catch((e) => setProposalFailureReason(e.message));
    },
    [itemId, loadAuditTrail],
  );

  return { proposeChange, pendingProposal: pendingProposalId !== null, proposalFailureReason, auditEntries };
}
