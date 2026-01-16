#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

const ROOT = process.cwd();
const QUEUE_PATH = path.resolve(ROOT, "dev-tools/review_queue.json");

/**
 * Normalize file paths to be relative to the repository root
 * @param {string} filePath - Absolute or relative file path
 * @returns {string} Repository-relative file path
 */
function normalizeFilePath(filePath) {
  if (!filePath) return filePath;
  
  // If it's an absolute path, make it relative to ROOT
  if (path.isAbsolute(filePath)) {
    return path.relative(ROOT, filePath);
  }
  
  // Already relative, return as-is
  return filePath;
}

const args = process.argv.slice(2);
const inputs = { gh: [], sonar: [], problems: [], testsJson: [] };
const defaultTests = [];
let prNumber = null;

const IGNORE_GH_PATTERNS = [
  /\bVercel for GitHub\b/i,
  /^\[vc\]:/i,
  /Deploy Preview for .* ready!/i, // Netlify deploy preview spam
  /^\[supa\]:/i, // Supabase “ignored” preview notices
  /auto-generated comment:\s*(summarize|review in progress) by coderabbit\.ai/i, // Ignore CodeRabbit summaries, keep other feedback
  /Quality Gate passed/i, // SonarCloud pass notifications
];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--gh" && args[i + 1]) inputs.gh.push(args[++i]);
  else if (arg === "--sonar" && args[i + 1]) inputs.sonar.push(args[++i]);
  else if (arg === "--problems" && args[i + 1]) inputs.problems.push(args[++i]);
  else if (arg === "--tests-json" && args[i + 1])
    inputs.testsJson.push(args[++i]);
  else if (arg === "--pr" && args[i + 1]) prNumber = args[++i];
  else if (arg === "--tests" && args[i + 1]) defaultTests.push(args[++i]);
}

function ensureQueue() {
  if (!fs.existsSync(QUEUE_PATH)) {
    fs.mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
    fs.writeFileSync(QUEUE_PATH, JSON.stringify({ items: [] }, null, 2));
  }
}

function loadQueue() {
  ensureQueue();
  return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function shaId(source, file, line, title, body) {
  return crypto
    .createHash("sha1")
    .update([source, file || "", line || "", title || "", body || ""].join("|"))
    .digest("hex");
}

function addItem(queue, item, stats) {
  const id = shaId(
    item.source,
    item.origin_ref?.file,
    item.origin_ref?.line,
    item.title,
    item.body
  );
  if (queue.items.some((i) => i.id === id)) {
    stats.duplicates += 1;
    return;
  }
  const now = new Date().toISOString();
  const tests =
    Array.isArray(item.tests_to_run) && item.tests_to_run.length
      ? item.tests_to_run
      : defaultTests;
  queue.items.push({
    ...item,
    id,
    status: "open",
    created_at: now,
    updated_at: now,
    tests_to_run: tests,
  });
  stats.added += 1;
}

function parseGhComments(filePath) {
  const rawString = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(rawString);
  } catch (err) {
    // Gracefully handle concatenated arrays (e.g., "][") or newline-delimited JSON.
    const fixed = rawString
      .trim()
      .replace(/]\s*\[/g, ",") // merge adjacent arrays
      .replace(/}\s*{/g, "},{"); // merge adjacent objects
    try {
      parsed = JSON.parse(
        fixed.startsWith("[") ? fixed : `[${fixed}]`,
      );
    } catch (innerErr) {
      throw new Error(
        `Failed to parse GitHub comments JSON from ${filePath}: ${innerErr.message}`,
      );
    }
  }
  const arr = Array.isArray(parsed) ? parsed : parsed.comments || [];
  return arr
    .filter((c) => {
      const body = c.body || "";
      const titleLine =
        body.split("\n").find((line) => line.trim().length > 0) || "";
      return !IGNORE_GH_PATTERNS.some(
        (pat) => pat.test(body) || pat.test(titleLine),
      );
    })
    .map((c) => {
      const title =
        (c.body || "").split("\n").find((line) => line.trim().length > 0) ||
        "PR comment";
      return {
        source: "github-comment",
      origin_ref: {
        pr: prNumber || c.pull_request_url?.split("/").pop(),
        comment_id: c.id,
        file: normalizeFilePath(c.path || c.position || c.original_position ? c.path : undefined),
        line:
          c.line ||
          c.original_line ||
          c.position ||
          c.original_position ||
          undefined,
      },
      title: title.slice(0, 160),
      body: c.body || "",
      severity: "info",
    };
    });
}

function parseSonar(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const issues = Array.isArray(raw) ? raw : raw.issues || [];
  return issues.map((issue) => {
    const component = issue.component || "";
    const file = component.includes(":")
      ? component.split(":").slice(1).join(":")
      : component;
    return {
      source: "sonarqube",
      origin_ref: {
        sonar_key: issue.key,
        pr: prNumber || undefined,
        file: normalizeFilePath(file || undefined),
        line: issue.line || undefined,
      },
      title: (issue.message || issue.rule || "Sonar issue").slice(0, 160),
      body: issue.message || "",
      severity: (issue.severity || "").toLowerCase() || "major",
      tests_to_run: ["npm run lint"],
    };
  });
}

function parseProblems(filePath) {
  const rawString = fs.readFileSync(filePath, "utf8").trim();
  if (!rawString) return [];

  // Strip leading noise (npm banners, "> vite_react..." etc.) before JSON.
  const firstJsonIndex = Math.min(
    ...["[", "{"]
      .map((ch) => rawString.indexOf(ch))
      .filter((idx) => idx !== -1),
  );
  const jsonCandidate =
    firstJsonIndex >= 0 ? rawString.slice(firstJsonIndex) : rawString;

  let raw;
  try {
    raw = JSON.parse(jsonCandidate);
  } catch (err) {
    // Best effort: merge adjacent arrays/objects, then retry.
    const fixed = jsonCandidate
      .replace(/]\s*\[/g, ",")
      .replace(/}\s*{/g, "},{");
    try {
      raw = JSON.parse(fixed.startsWith("[") ? fixed : `[${fixed}]`);
    } catch (innerErr) {
      throw new Error(
        `Failed to parse Problems JSON from ${filePath}: ${innerErr.message}`,
      );
    }
  }

  const files = Array.isArray(raw) ? raw : raw.files || [];
  const items = [];
  for (const fileEntry of files) {
    const filePath = fileEntry.filePath || fileEntry.file || "";
    const messages = Array.isArray(fileEntry.messages)
      ? fileEntry.messages
      : [];
    for (const msg of messages) {
      const severity =
        msg.severity === 2
          ? "major"
          : msg.severity === 1
            ? "minor"
            : "info";
      items.push({
        source: "problems",
        origin_ref: { file: normalizeFilePath(filePath), line: msg.line || msg.startLine },
        title:
          (msg.ruleId
            ? `${msg.ruleId} in ${path.basename(filePath)}`
            : "Problem") || "Problem",
        body: msg.message || "",
        severity,
        tests_to_run: [
          filePath
            ? `npm run lint -- ${filePath}`
            : "npm run lint",
        ],
      });
    }
  }
  return items;
}

function parseTestsJson(filePath) {
  const rawString = fs.readFileSync(filePath, "utf8").trim();
  if (!rawString) return [];

  const firstJsonIndex = Math.min(
    ...["[", "{"].map((ch) => {
      const idx = rawString.indexOf(ch);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    }),
  );
  const jsonCandidate =
    firstJsonIndex !== Number.MAX_SAFE_INTEGER
      ? rawString.slice(firstJsonIndex)
      : rawString;

  let raw;
  try {
    raw = JSON.parse(jsonCandidate);
  } catch (err) {
    const fixed = jsonCandidate
      .replace(/]\s*\[/g, ",")
      .replace(/}\s*{/g, "},{");
    try {
      raw = JSON.parse(fixed.startsWith("[") ? fixed : `[${fixed}]`);
    } catch (innerErr) {
      throw new Error(
        `Failed to parse Tests JSON from ${filePath}: ${innerErr.message}`,
      );
    }
  }

  const results = Array.isArray(raw)
    ? raw
    : raw.testResults || raw.results || [];

  const items = [];
  for (const res of results) {
    const testFile = res.name || res.testFilePath || res.file || "";
    const resolvedTestFile = testFile ? path.relative(process.cwd(), testFile) : "";
    const assertions = Array.isArray(res.assertionResults)
      ? res.assertionResults
      : Array.isArray(res.tests)
        ? res.tests
        : [];
    for (const a of assertions) {
      const status = (a.status || "").toLowerCase();
      if (status === "passed" || status === "success") continue;
      const title =
        a.fullName || a.title || a.name || "Test failure";
      const messages = Array.isArray(a.failureMessages)
        ? a.failureMessages
        : a.errors || [];
      const body = messages.join("\n\n") || "Test failed.";
      items.push({
        source: "tests",
        origin_ref: { file: normalizeFilePath(resolvedTestFile || testFile || undefined) },
        title: `Test failure: ${title}`.slice(0, 160),
        body,
        severity: "major",
        tests_to_run: [
          resolvedTestFile ? `npm test -- "${resolvedTestFile}"` : "npm test",
        ],
      });
    }
  }
  return items;
}

function main() {
if (
  inputs.gh.length === 0 &&
  inputs.sonar.length === 0 &&
  inputs.problems.length === 0 &&
  inputs.testsJson.length === 0
) {
  console.error(
    "Usage: node dev-tools/ingest-feedback.js [--gh file] [--sonar file] [--problems file] [--tests-json file] [--pr 123] [--tests \"npm test\"]"
  );
  process.exit(1);
}

  const queue = loadQueue();
  const stats = { added: 0, duplicates: 0 };

  for (const ghFile of inputs.gh) {
    parseGhComments(ghFile).forEach((item) => addItem(queue, item, stats));
  }

  for (const sonarFile of inputs.sonar) {
    parseSonar(sonarFile).forEach((item) => addItem(queue, item, stats));
  }

  for (const probFile of inputs.problems) {
    parseProblems(probFile).forEach((item) => addItem(queue, item, stats));
  }

  for (const testFile of inputs.testsJson) {
    parseTestsJson(testFile).forEach((item) => addItem(queue, item, stats));
  }

  saveQueue(queue);
  console.log(
    `Ingest complete. Added: ${stats.added}, skipped duplicates: ${stats.duplicates}.`
  );
}

main();
