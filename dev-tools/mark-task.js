#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const QUEUE_PATH = path.resolve(process.cwd(), "dev-tools/review_queue.json");
const VALID_STATUS = new Set(["open", "in_progress", "fixed", "blocked"]);

function usage() {
  console.error(
    "Usage: node dev-tools/mark-task.js --id <id> --status <open|in_progress|fixed|blocked> [--note \"...\"]",
  );
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { notes: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--id" && args[i + 1]) out.id = args[++i];
    else if (arg === "--status" && args[i + 1]) out.status = args[++i];
    else if (arg === "--note" && args[i + 1]) out.notes.push(args[++i]);
    else usage();
  }
  if (!out.id || !out.status) usage();
  if (!VALID_STATUS.has(out.status)) {
    console.error(`Invalid status: ${out.status}`);
    usage();
  }
  return out;
}

function loadQueue() {
  if (!fs.existsSync(QUEUE_PATH)) {
    throw new Error(`Queue file not found at ${QUEUE_PATH}`);
  }
  return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function main() {
  const { id, status, notes } = parseArgs();
  const queue = loadQueue();
  const item = queue.items.find((i) => i.id === id);
  if (!item) {
    console.error(`Item with id ${id} not found.`);
    process.exit(1);
  }

  item.status = status;
  if (Array.isArray(notes) && notes.length) {
    item.notes = Array.isArray(item.notes) ? item.notes : [];
    item.notes.push(...notes);
  }
  item.updated_at = new Date().toISOString();

  saveQueue(queue);
  console.log(`Updated ${id} -> ${status}${notes.length ? " (notes added)" : ""}`);
}

main();
