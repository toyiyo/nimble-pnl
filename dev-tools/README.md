# Review queue helper

Lightweight tooling to collect feedback (PR comments, Sonar, lint/test failures) into `dev-tools/review_queue.json`, then dispatch items to Codex/Copilot and mark them done.

## Files
- `dev-tools/review_queue.json` — the queue store.
- `dev-tools/refresh-queue.sh` — fetch PR comments, Sonar issues, lint “problems”, and test failures into the queue.
- `dev-tools/next-task.js` — pick the next item (with filters) and build a prompt.
- `dev-tools/send-to-codex.sh` — run `next-task.js`, copy the prompt, and send to Codex CLI.
- `dev-tools/send-to-copilot.sh` — run `next-task.js`, copy the prompt, and send to GitHub Copilot CLI.
- `dev-tools/mark-task.js` — update item status/notes.
- `dev-tools/ingest-feedback.js` — lower-level ingestion used by `refresh-queue.sh`.

## Populate the queue
```bash
# Basic: PR 281, default lint JSON, default tests/lint commands to attach
dev-tools/refresh-queue.sh --pr 281 \
  --tests "npm run lint" \
  --tests "npm test"
```

Options:
- `--skip-gh` / `--skip-sonar` / `--skip-problems` / `--skip-tests` to omit sources.
- `--lint-cmd "<cmd>"` to change problems command (default `npm run lint -- --format json`).
- `--test-cmd "<cmd>"` to run a test command that emits JSON; use `{out}` placeholder for output file, e.g. `--test-cmd "npm test -- --reporter=json --outputFile {out}"`.
- Env for Sonar (optional): `SONAR_HOST`, `SONAR_TOKEN`, `SONAR_PROJECT_KEY` (or `SONAR_PROJECT`).
- Sonar PR tagging: when you pass `--pr 123`, Sonar issues ingested in that run get `origin_ref.pr` set to `123`, so you can filter by PR later (`--pr 123`).
- Sonar scoping: when `--pr` is passed, the Sonar query uses `pullRequest=<pr>` so only that PR’s issues are ingested. You can override with `--sonar-branch <branch>` or append params via `--sonar-extra "createdAfter=2025-02-01"`.
- Local env file: create `.env.local` in repo root (ignored by git) with:
  ```bash
  SONAR_HOST="https://sonarcloud.io"
  SONAR_TOKEN="..."
  SONAR_PROJECT_KEY="owner_project"
  ```
  You can start from `dev-tools/.env.local.example` and copy to `.env.local`.
- Noise filtering: GitHub ingest skips known Vercel auto-comments (pattern: `[vc]:` or “Vercel for GitHub”). If another bot shows up, we can add patterns in `dev-tools/ingest-feedback.js` (IGNORE_GH_PATTERNS).
  - Also ignored: Netlify deploy preview summaries, Supabase “ignored” branch notices, and CodeRabbit auto-generated summary/in-progress comments (actionable CodeRabbit feedback is still ingested).
  - SonarCloud “Quality Gate passed” status comments are ignored as non-actionable.

## Dispatch work
- Next prompt (copy only): `node dev-tools/next-task.js --copy`
- Send to Codex CLI (plus copy): `dev-tools/send-to-codex.sh`
- Send to GitHub Copilot CLI (plus copy): `dev-tools/send-to-copilot.sh`
- Loop through items:
  ```bash
  while dev-tools/send-to-codex.sh; do
    read -r -p "Press enter after fixing + marking the item (or 'q' to stop): " ans
    [[ $ans == q ]] && break
  done
  ```
  Swap in `send-to-copilot.sh` if you prefer the Copilot CLI.
  Use `--count 5` (or any positive integer) with the send/next commands to batch multiple queue items into a single Codex/Copilot prompt; items are ordered with open first, then in_progress. Note: `.last_task_id` will contain only the first dispatched ID—mark the others manually.

## Filtering/prioritization
Use filters with `next-task.js` and `send-to-codex.sh`:
- `--pr 281` only that PR/MR.
- `--severity major` (or `minor`, `info`).
- `--source github-comment|sonarqube|problems|tests`.
- `--since 2025-01-01` / `--until 2025-01-31` filter by created date (ISO preferred).
- `--status open,in_progress` (default) or `--status open` to avoid in-progress.
- `--count 5` to dispatch a batch of items in one prompt (open items are prioritized, then in-progress, preserving queue order within a status).
- `--id <sha>` to fetch a specific item.
  - Allowed statuses: open, in_progress, fixed, blocked. Invalid statuses will exit with an error.

Examples:
```bash
# High severity only for PR 281
dev-tools/send-to-codex.sh --pr 281 --severity major

# Open items created after Feb 1st
node dev-tools/next-task.js --copy --since 2025-02-01
```

## Mark items done
```bash
# Mark fixed with a note
node dev-tools/mark-task.js --id <itemId> --status fixed --note "tests pass"

# Mark the last dispatched item (tracked automatically by next-task/send-to-codex)
dev-tools/mark-last-task.sh --status fixed --note "tests pass"

# Block an item
node dev-tools/mark-task.js --id <itemId> --status blocked --note "needs backend"
```

Statuses: `open`, `in_progress`, `fixed`, `blocked`.

## Tips
- If the Codex chat thread grows long, use `/compact` to summarize and free context before continuing the loop.

## GitHub CLI setup (for PR ingest)
- Install: `brew install gh`
- Login: `gh auth login` → GitHub.com → HTTPS → browser/PAT (repo scope). Verify with `gh auth status`.

## Additional notes
- If lint/tests fail, `refresh-queue.sh` will still ingest any JSON output produced.
- IDs are stable hashes; duplicates are skipped automatically.
- Keep `review_queue.json` checked into git if you want history; otherwise add to `.gitignore` to keep local-only.
