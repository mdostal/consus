#!/usr/bin/env node
// bin/handoff.mjs
//
// consus handoff — standalone harness interface for the file transport.
//
// When Consus runs with CONSUS_HARNESS_FILE_DIR set (the FileHarnessTransport),
// each proposal writes a JSON handoff file to that directory. A harness calls
// this script to read pending handoffs and report outcomes back to Consus.
//
// Usage:
//   node bin/handoff.mjs list                             # list pending handoffs
//   node bin/handoff.mjs result <proposalId> applied      # mark applied
//   node bin/handoff.mjs result <proposalId> failed [reason]  # mark failed
//
// Environment:
//   CONSUS_HANDOFF_DIR  — handoff file directory (default: .pHive/handoffs)
//   CONSUS_URL          — Consus server base URL (default: http://localhost:8722)
//   PORT                — used to infer CONSUS_URL when CONSUS_URL is not set

import { readdirSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const HANDOFF_DIR = process.env.CONSUS_HANDOFF_DIR ?? ".pHive/handoffs";
const PORT = process.env.PORT ?? "8722";
const CONSUS_URL = process.env.CONSUS_URL ?? `http://localhost:${PORT}`;

const [, , subcommand, ...rest] = process.argv;

switch (subcommand) {
  case "list":
  case undefined:
    cmdList();
    break;
  case "result":
    await cmdResult(rest);
    break;
  default:
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error("Usage: consus handoff [list|result <proposalId> <applied|failed> [reason]]");
    process.exit(1);
}

function readHandoffs() {
  if (!existsSync(HANDOFF_DIR)) return [];
  return readdirSync(HANDOFF_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const raw = readFileSync(join(HANDOFF_DIR, f), "utf8");
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function cmdList() {
  const handoffs = readHandoffs();
  if (handoffs.length === 0) {
    console.log("No pending handoffs.");
    return;
  }
  console.log(`${handoffs.length} pending handoff(s) in ${HANDOFF_DIR}:\n`);
  for (const h of handoffs) {
    console.log(`  proposalId : ${h.proposalId}`);
    console.log(`  itemId     : ${h.itemId}`);
    console.log(`  targetType : ${h.targetType}`);
    console.log(`  description: ${h.description}`);
    console.log(`  diff:\n${h.diff.split("\n").map((l) => "    " + l).join("\n")}`);
    console.log();
  }
}

async function cmdResult([proposalId, status, ...reasonParts]) {
  if (!proposalId || (status !== "applied" && status !== "failed")) {
    console.error("Usage: consus handoff result <proposalId> <applied|failed> [reason]");
    process.exit(1);
  }

  const reason = reasonParts.join(" ") || undefined;
  const body = { status, ...(reason ? { reason } : {}) };

  const url = `${CONSUS_URL}/api/proposals/${proposalId}/result`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`Failed to reach Consus at ${CONSUS_URL}: ${err.message}`);
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable)");
    console.error(`Consus returned ${res.status}: ${text}`);
    process.exit(1);
  }

  // Remove the handoff file on success.
  const handoffFile = join(HANDOFF_DIR, `${proposalId}.json`);
  if (existsSync(handoffFile)) unlinkSync(handoffFile);

  console.log(`Proposal ${proposalId} marked ${status}.`);
}
