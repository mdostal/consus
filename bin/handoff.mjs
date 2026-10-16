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
//   node bin/handoff.mjs threads                          # list thread messages awaiting a reply
//   node bin/handoff.mjs reply <threadId> [--proposal <id>] <body...>  # answer a thread
//
// Thread messages (PANT-962) land under <CONSUS_HANDOFF_DIR>/threads/ as
// <threadId>.<messageId>.json; `reply` posts to the thread's replyUrl and
// removes that thread's pending files. Contract: docs/agent-integration/threads.md.
//
// Environment:
//   CONSUS_HANDOFF_DIR  — handoff file directory (default: .pHive/handoffs)
//   CONSUS_URL          — Consus server base URL (default: http://localhost:8722)
//   PORT                — used to infer CONSUS_URL when CONSUS_URL is not set

import { readdirSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const HANDOFF_DIR = process.env.CONSUS_HANDOFF_DIR ?? ".pHive/handoffs";
const THREADS_DIR = join(HANDOFF_DIR, "threads");
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
  case "threads":
    cmdThreads();
    break;
  case "reply":
    await cmdReply(rest);
    break;
  default:
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error(
      "Usage: consus handoff [list|result <proposalId> <applied|failed> [reason]|threads|reply <threadId> [--proposal <id>] <body...>]",
    );
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


function readThreadEvents() {
  if (!existsSync(THREADS_DIR)) return [];
  return readdirSync(THREADS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return { file: join(THREADS_DIR, f), event: JSON.parse(readFileSync(join(THREADS_DIR, f), "utf8")) };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.event.message.id - b.event.message.id);
}

function cmdThreads() {
  const pending = readThreadEvents();
  if (pending.length === 0) {
    console.log("No thread messages awaiting a reply.");
    return;
  }
  console.log(`${pending.length} thread message(s) awaiting a reply in ${THREADS_DIR}:\n`);
  for (const { event } of pending) {
    console.log(`  threadId : ${event.threadId}`);
    console.log(`  item     : ${event.item.type} ${event.item.id}`);
    if (event.anchor) console.log(`  anchor   : ${JSON.stringify(event.anchor)}`);
    for (const m of event.context) console.log(`    [${m.role}] ${m.author}: ${m.body}`);
    console.log(`  > ${event.message.author}: ${event.message.body}`);
    console.log(`  replyUrl : ${event.replyUrl}`);
    console.log();
  }
}

async function cmdReply(args) {
  const [threadId, ...restArgs] = args;
  let proposalId;
  const bodyParts = [];
  for (let i = 0; i < restArgs.length; i++) {
    if (restArgs[i] === "--proposal") proposalId = restArgs[++i];
    else bodyParts.push(restArgs[i]);
  }
  const body = bodyParts.join(" ").trim();
  if (!threadId || !body) {
    console.error("Usage: consus handoff reply <threadId> [--proposal <id>] <body...>");
    process.exit(1);
  }
  const author = process.env.CONSUS_AGENT_NAME ?? "agent";
  const files = readThreadEvents().filter(({ event }) => event.threadId === threadId);
  const url = files.length > 0 ? files[files.length - 1].event.replyUrl : `${CONSUS_URL}/api/threads/${threadId}/replies`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author, body, ...(proposalId ? { proposalId } : {}) }),
    });
  } catch (err) {
    console.error(`Failed to reach Consus at ${url}: ${err.message}`);
    process.exit(1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable)");
    console.error(`Consus returned ${res.status}: ${text}`);
    process.exit(1);
  }
  for (const { file } of files) unlinkSync(file);
  console.log(`Replied to thread ${threadId}.`);
}
