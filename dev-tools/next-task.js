#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const QUEUE_PATH = path.resolve(process.cwd(), "dev-tools/review_queue.json");
const LAST_ID_PATH = path.resolve(process.cwd(), "dev-tools/.last_task_id");
const VALID_STATUS = new Set(["open", "in_progress", "fixed", "blocked"]);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    copy: false,
    lock: true,
    pr: null,
    severity: null,
    source: null,
    since: null,
    until: null,
    id: null,
    statuses: null,
    count: 1,
    target: process.env.TARGET_NAME || "ASSISTANT",
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--copy") opts.copy = true;
    else if (arg === "--no-lock") opts.lock = false;
    else if (arg === "--pr" && args[i + 1]) opts.pr = args[++i];
    else if (arg === "--severity" && args[i + 1]) opts.severity = args[++i].toLowerCase();
    else if (arg === "--source" && args[i + 1]) opts.source = args[++i].toLowerCase();
    else if (arg === "--since" && args[i + 1]) opts.since = args[++i];
    else if (arg === "--until" && args[i + 1]) opts.until = args[++i];
    else if (arg === "--id" && args[i + 1]) opts.id = args[++i];
    else if (arg === "--status" && args[i + 1]) {
      const raw = args[++i].split(",").map((s) => s.trim().toLowerCase());
      const filtered = raw.filter((s) => VALID_STATUS.has(s));
      if (filtered.length === 0) {
        console.error(`No valid statuses from --status. Allowed: ${Array.from(VALID_STATUS).join(", ")}`);
        process.exit(1);
      }
      opts.statuses = filtered;
    } else if (arg === "--count" && args[i + 1]) {
      const count = Number(args[++i]);
      if (!Number.isInteger(count) || count < 1) {
        console.error("--count must be a positive integer.");
        process.exit(1);
      }
      opts.count = count;    } else if (arg === "--target" && args[i + 1]) {
      opts.target = args[++i].toUpperCase();    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

function readQueue() {
  if (!fs.existsSync(QUEUE_PATH)) {
    console.error(`Queue file missing at ${QUEUE_PATH}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(QUEUE_PATH, "utf8");
  return JSON.parse(raw);
}

function writeQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function withinDateRange(item, sinceStr, untilStr) {
  if (!sinceStr && !untilStr) return true;
  const created = new Date(item.created_at || item.updated_at || 0);
  if (Number.isNaN(created.getTime())) return false;
  if (sinceStr) {
    const since = new Date(sinceStr);
    if (!Number.isNaN(since.getTime()) && created < since) return false;
  }
  if (untilStr) {
    const until = new Date(untilStr);
    if (!Number.isNaN(until.getTime()) && created > until) return false;
  }
  return true;
}

function pickItems(queue, filters) {
  const statuses = filters.statuses || ["open", "in_progress"];

  let candidates = queue.items.filter((i) => statuses.includes(i.status));

  if (filters.id) {
    candidates = candidates.filter((i) => i.id === filters.id);
  }
  if (filters.pr) {
    candidates = candidates.filter(
      (i) => i.origin_ref?.pr && String(i.origin_ref.pr) === String(filters.pr),
    );
  }
  if (filters.severity) {
    candidates = candidates.filter(
      (i) => (i.severity || "").toLowerCase() === filters.severity,
    );
  }
  if (filters.source) {
    candidates = candidates.filter(
      (i) => (i.source || "").toLowerCase() === filters.source,
    );
  }
  if (filters.since || filters.until) {
    candidates = candidates.filter((i) => withinDateRange(i, filters.since, filters.until));
  }

  const statusPriority = { open: 0, in_progress: 1 };
  const sorted = candidates
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const aRank = statusPriority[a.item.status] ?? 2;
      const bRank = statusPriority[b.item.status] ?? 2;
      if (aRank !== bRank) return aRank - bRank;
      return a.idx - b.idx; // preserve original order within the same status bucket
    })
    .map(({ item }) => item);

  return sorted.slice(0, filters.count);
}

function describeOrigin(originRef = {}) {
  const parts = [];
  if (originRef.file) parts.push(`file: ${originRef.file}`);
  if (originRef.line) parts.push(`line: ${originRef.line}`);
  if (originRef.pr) parts.push(`pr: ${originRef.pr}`);
  if (originRef.comment_id) parts.push(`comment: ${originRef.comment_id}`);
  if (originRef.sonar_key) parts.push(`sonar: ${originRef.sonar_key}`);
  return parts.length ? parts.join(", ") : "unspecified";
}

function buildPrompt(items, targetName = "ASSISTANT") {
  const lines = [
    `=== SEND TO ${targetName} ===`,
    `Batch count: ${items.length}`,
    "Task: Implement fixes for the queued items below. Keep changes minimal, aligned with context, and avoid unrelated edits.",
    "",
  ];

  items.forEach((item, idx) => {
    const tests =
      Array.isArray(item.tests_to_run) && item.tests_to_run.length
        ? item.tests_to_run
        : ["npm run lint", "npm test"];

    const notes =
      Array.isArray(item.notes) && item.notes.length
        ? item.notes.join(" | ")
        : "";

    lines.push(
      `[#${idx + 1}] ID: ${item.id}`,
      `Source: ${item.source || "unknown"}`,
      `Severity: ${item.severity || "unspecified"}`,
      `Location: ${describeOrigin(item.origin_ref)}`,
      `Title: ${item.title || "No title"}`,
    );
    if (item.body) lines.push(`Details: ${item.body}`);
    if (notes) lines.push(`Notes: ${notes}`);
    lines.push(
      `Tests: ${tests.join(" ; ")}`,
      `Mark complete when done: node dev-tools/mark-task.js --id ${item.id} --status fixed --note \"tests pass\"`,
      "",
    );
  });

  lines.push(
    "After coding each item:",
    "- Add or update tests to cover the new/changed code (unit, e2e, and SQL as appropriate; include simple e2e flows when they expose regressions) Test coverage must be 85% or higher for any file we touch.",
    "- Run the listed tests (plus any new ones you added) and report results.",
    "- Mark each item individually using the provided commands.",
    "- If the chat thread grows long, use /compact to summarize and free context.",
    "======================",
  );

  return lines.filter(Boolean).join("\n");
}

function copyToClipboard(text) {
  try {
    if (process.platform === "darwin") {
      execSync("pbcopy", { input: text });
      return true;
    }
    if (process.platform === "win32") {
      execSync("clip", { input: text });
      return true;
    }
    execSync("xclip -selection clipboard", { input: text });
    return true;
  } catch (err) {
    return false;
  }
}

function main() {
  const filters = parseArgs();
  const queue = readQueue();
  const items = pickItems(queue, filters);

  if (!items.length) {
    console.error("No matching items in the queue for the given filters.");
    process.exit(1);
  }

  if (filters.lock) {
    const now = new Date().toISOString();
    let updated = false;
    items.forEach((item) => {
      if (item.status === "open") {
        item.status = "in_progress";
        item.updated_at = now;
        updated = true;
      }
    });
    if (updated) writeQueue(queue);
  }

  // Save last dispatched ID for convenience scripts.
  try {
    fs.writeFileSync(LAST_ID_PATH, items[0].id, "utf8");
  } catch (err) {
    // Non-fatal if we cannot write.
  }

  const prompt = buildPrompt(items, filters.target);
  process.stdout.write(prompt);

  if (filters.copy) {
    const ok = copyToClipboard(prompt);
    if (ok) {
      console.error("\nPrompt copied to clipboard.");
    } else {
      console.error("\nClipboard copy failed; prompt printed above.");
    }
  }
}

main();
