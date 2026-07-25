import { DecisionCard } from "../decisions/DecisionCard";
import type { DecisionPayload, Verdict } from "../decisions/answer-shapes/types";
import { VersionHistory, type KbVersion } from "./VersionHistory";

export interface KbItem {
  id: string;
  title: string;
  status: string;
  decisionPayload: DecisionPayload;
}

export interface AuditLogEntry {
  id: number;
  item_id: string;
  actor: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
}

export interface KBBrowserProps {
  item: KbItem;
  versions: KbVersion[];
  auditLog: AuditLogEntry[];
  onDecide: (itemId: string, verdict: Verdict) => void;
}

/**
 * REQ-08 frontend: view + decide on an item via the shared DecisionCard,
 * with version history and the audit trail visible — single-operator, no
 * multi-user/voting UI (that's REQ-09/P2).
 */
export function KBBrowser({ item, versions, auditLog, onDecide }: KBBrowserProps) {
  return (
    <div className="kb-browser">
      <DecisionCard
        question={item.title}
        status={item.status}
        payload={item.decisionPayload}
        onVerdict={(verdict) => onDecide(item.id, verdict)}
      />

      <VersionHistory versions={versions} />

      {auditLog.length > 0 ? (
        <ul className="kb-browser__audit-log">
          {auditLog.map((entry) => (
            <li key={entry.id}>
              {entry.actor} changed {entry.field}: {entry.old_value} → {entry.new_value}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
