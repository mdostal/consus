/**
 * Vesta Policy Adapter — read-only client resolving auto-accept vs.
 * human-gate per item (REQ-13). "Vesta owns the SETTING (the knob)...
 * Consus is the SURFACE + ENFORCER" (docs/prior-art.md §2).
 *
 * RISK: no local Vesta repo/spec exists as of this reconciliation — same
 * adapter-first, schema-pending treatment as Auriga. This class exposes no
 * policy-configuration method by design; Consus never owns the setting.
 */

export type VestaFlag = "strategic" | "ambiguous" | "irreversible" | string;

export interface VestaPolicy {
  mode: "auto" | "gate";
  flags?: VestaFlag[];
}

export type VestaPolicyResult = { ok: true; policy: VestaPolicy } | { ok: false; error: string };

export interface VestaTransport {
  getPolicy(scope: PolicyScope): Promise<VestaPolicyResult>;
}

export interface PolicyScope {
  repo: string;
  decisionType: string;
  risk: "low" | "medium" | "high";
}

export interface PolicyResolution {
  humanGateRequired: boolean;
  flags: VestaFlag[];
  source: "vesta" | "standalone-default";
}

export interface VestaPolicyAdapterOptions {
  /** Standalone-mode fallback when Vesta is unreachable (e.g. no Pantheon). */
  standaloneDefault?: "auto" | "bare-gate";
}

export class VestaPolicyAdapter {
  private readonly standaloneDefault: "auto" | "bare-gate";

  constructor(private readonly transport: VestaTransport, options: VestaPolicyAdapterOptions = {}) {
    this.standaloneDefault = options.standaloneDefault ?? "bare-gate";
  }

  async resolve(scope: PolicyScope): Promise<PolicyResolution> {
    const result = await this.transport.getPolicy(scope);

    if (!result.ok) {
      return {
        humanGateRequired: this.standaloneDefault === "bare-gate",
        flags: [],
        source: "standalone-default",
      };
    }

    return {
      humanGateRequired: result.policy.mode === "gate",
      flags: result.policy.flags ?? [],
      source: "vesta",
    };
  }
}
