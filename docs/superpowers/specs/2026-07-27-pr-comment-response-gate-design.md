# PR Comment Response Gate — Design

**Date:** 2026-07-27
**Branch:** `feature/pr-comment-response-gate`
**Status:** Approved

## Problem

Review findings on our PRs routinely go unanswered in the place they were
raised. PR #657 — the most recently merged PR — carries five unresolved
review threads from `chatgpt-codex-connector`, `Copilot`, and
`coderabbitai[bot]`, none of which has a single reply.

The `/dev` workflow already has a Phase 9d triage gate, and that gate
already produces a classification of every finding. But it writes the
result to `dev-tools/9d-triage-<branch>.md`, which is **gitignored**. The
reasoning never reaches the PR. Anyone reading the PR later — a human
reviewer, a future maintainer, the bot itself on a re-review — sees an
open finding and no response, and cannot tell whether it was fixed,
rejected on purpose, or simply missed.

`memory/lessons.md` records this same failure mode five separate times
(PRs #479, #500, #511, #545, #590). Each correction so far has been
*prose in a skill file* telling the agent to try harder. Prose has now
failed five times. This design replaces exhortation with a mechanical
gate.

## Goal

Every finding raised on a PR — by an AI reviewer or a human — carries a
visible reply in the PR itself stating one of three verdicts, with a
rationale:

- **✅ Agreed** — we accepted the finding and fixed it (reply names the commit).
- **↩️ Pushed back** — we disagree (reply says why).
- **⏭️ Ignored** — acknowledged, deliberately not actioned (reply says why).

Merging is impossible while any finding lacks such a reply.

## Non-goals

- Auto-generating replies. A bot writing "we've addressed this" without
  knowing what was done produces plausible noise, which is worse than
  silence because it *looks* like triage. Replies are authored by the
  `/dev` session (or a human) that actually did the work; CI only audits.
- Demanding a verdict on conversational comments (CodeRabbit walkthrough
  summaries, "LGTM", rate-limit notices). Those are conversation, not
  findings.
- Replacing the existing review queue (`dev-tools/review_queue.json`) or
  the SonarCloud gate. This is an additional, orthogonal gate.

## Architecture

Three components. The auditor and the responder share one module so the
definition of "answered" cannot drift between what CI enforces and what
the `/dev` session posts.

```
  /dev Phase 9d                     GitHub Actions
       |                                  |
       v                                  v
  pr-triage.js reply  --> PR thread <-- pr-triage.js audit
       (writes)                       (reads, never writes)
             \                            /
              \--- classifyThreads() ----/
                   (single shared rule)
```

### 1. `dev-tools/pr-triage.js`

One ESM module, following the established `dev-tools/feedback-log.js`
precedent: named exports for pure logic, a `runCli(argv, io)` entry point,
and all GitHub I/O funnelled through a single thin `gh` shell-out so the
logic is unit-testable without network access.

| Export | Responsibility |
|---|---|
| `VERDICTS` | The three verdict keys and their display forms. |
| `composeReply({verdict, rationale, commit})` | Build a reply body. Throws when the verdict is unknown, the rationale is empty, or `agreed` is missing a commit SHA. |
| `parseVerdict(body)` | Extract a verdict from a reply body; `null` if the body carries none. |
| `classifyThreads({threads, reviews, prAuthor, knownShas})` | Partition findings into answered / unanswered. The single source of truth for "answered". Pure — `knownShas` is passed in, never fetched here. |
| `renderSummary(result)` | Markdown table for the check-run output. |
| `runCli(argv, io)` | Verbs: `audit`, `list`, `reply`. |

**Why one module and not two scripts:** if the auditor and the responder
each carried their own idea of what a valid reply looks like, a reply the
responder considers well-formed could fail the audit — the gate would
fire on our own correct output. Sharing `parseVerdict` makes that class
of bug impossible.

#### Reply format

```
<!-- pr-triage: agreed -->
**✅ Agreed** — coerced capacity via Number.isFinite before use. Fixed in `abc1234`.
```

The HTML comment is invisible when rendered and is what `parseVerdict`
keys on primarily. `parseVerdict` **also** accepts a plain-text reply
whose first line begins with a verdict keyword and a separator —
`Agreed:`, `Agreed —`, `Pushed back:`, `Ignored -`, `Declined:` — so a
human replying by hand in the GitHub web UI is never blocked by needing
to remember a marker. Either form must be followed by a non-trivial
rationale; a bare `Agreed` with nothing after it does not count as a
response, because it does not tell a future reader anything.

#### CLI verbs

```bash
# List every unanswered finding with the thread/comment id needed to reply.
node dev-tools/pr-triage.js list --pr 657

# Post a threaded reply and resolve the thread.
node dev-tools/pr-triage.js reply --pr 657 --comment 3649239869 \
  --verdict agreed --commit abc1234 \
  --rationale "Retained failed writes until the import path checks them."

# Audit. Prints the summary table; exits 1 if any finding is unanswered.
node dev-tools/pr-triage.js audit --pr 657
```

`reply` posts via `POST /repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies`
and then resolves the thread with the GraphQL `resolveReviewThread`
mutation. Resolution is a courtesy to keep the PR readable; it is
explicitly **not** what the audit keys on (see below).

### 2. `.github/workflows/pr-comment-response.yml`

The auditor. It reads the PR and publishes a check run. It never writes
to a thread.

**Triggers**

| Event | Why |
|---|---|
| `pull_request_review_comment: [created]` | A new inline finding appeared — the check must go red immediately. Also fires when we post a reply, which flips it green. |
| `pull_request_review: [submitted]` | Catches `CHANGES_REQUESTED` reviews. |
| `issue_comment: [created]` | PR conversation activity; guarded on `github.event.issue.pull_request`. |
| `pull_request_target: [opened, synchronize, reopened, ready_for_review]` | Re-audits on every push so the gate cannot go stale. |

**Why `pull_request_target` and not `pull_request`:** a `pull_request`
event from a fork receives a read-only `GITHUB_TOKEN`, which cannot
create a check run — the gate would silently never report on fork PRs.
`pull_request_target` runs in the base-repo context with a writable
token. The usual danger of `pull_request_target` is executing untrusted
PR code with elevated permissions; this job **never checks out the
repository and never runs PR code**. It reads the GitHub API and writes a
check run. That is the whole job.

**Resolving the PR number across four event shapes:** the triggers do not
agree on where the number lives — `pull_request_target`,
`pull_request_review` and `pull_request_review_comment` carry
`github.event.pull_request.number`, while `issue_comment` carries
`github.event.issue.number`. The job derives it once as
`${{ github.event.pull_request.number || github.event.issue.number }}`
and fails fast if the result is empty, rather than silently auditing the
wrong PR or no-opping.

**Check run, not job status:** workflows triggered by
`pull_request_review_comment` / `issue_comment` do not appear in a PR's
status-check list. So the job explicitly resolves the PR head SHA
(`gh api repos/{o}/{r}/pulls/{n} --jq .head.sha` — always current,
regardless of trigger) and publishes a check run named
`pr-comment-response` against it. GitHub uses the latest check run of a
given name for a SHA, so repeated runs update the gate in place.

**Permissions:** `pull-requests: read`, `checks: write`, `contents: read`.

**Fork limitation (accepted):** for a PR from a fork, the comment and
review events run from the PR merge commit with a read-only token, so the
check-run POST fails. The job reports that explicitly rather than passing
silently, and fork PRs are still audited on every push through
`pull_request_target: synchronize`, which does carry a writable token.
Covering fork comment events properly would need a trusted executor (a
GitHub App or webhook service) — disproportionate for a repo whose PRs
come from same-repo branches.

**Bot-trigger approval (observed, not theoretical):** on this repo, a run
triggered by `Copilot` submitting a review came back `action_required`
— GitHub held it for maintainer approval rather than running it. While
that holds, a finding posted after the last push will not turn the check
red on its own. Three things blunt it: `pull_request_target: synchronize`
re-audits on every push (a human actor, never gated), `workflow_dispatch`
allows a manual re-run, and the `/dev` workflow runs `pr-triage.js audit`
locally at Phase 9d, which no Actions setting can gate. The repository
setting under Settings → Actions → General controls the approval
requirement if it should be relaxed.

**No concurrency group.** Even with `cancel-in-progress: false`, GitHub
cancels a *previously pending* run when a newer one joins the group, and
a burst of bot comments produces exactly that. Each cancelled run then
surfaces as a failed check — red for a reason unrelated to unanswered
findings. The audit takes seconds, so running every event is cheaper than
explaining the noise.

**Failing closed:** every path that cannot see the whole PR — a GraphQL
error, a missing `pullRequest` node, a commits fetch that fails, a thread
whose replies exceed one page — exits non-zero and publishes a *failed*
check. A gate that reports success on data it could not read is worse
than no gate, because it manufactures confidence.

**Output:** the check summary is `renderSummary()` — a table of every
unanswered finding as `author · file:line · first line of the finding`,
so the reason for the red is legible without opening the log.

### 3. Wiring into `/dev`

- `.claude/skills/development-workflow.md`, Phase 9d: the current
  contract is "fix it **or** reply declining." That "or" is what lets a
  fix land with no visible reasoning on the PR. It becomes: every inline
  finding gets a threaded verdict reply — a fix is an `agreed` reply
  naming the commit, not a substitute for replying. 9e's done criteria
  gain `node dev-tools/pr-triage.js audit --pr N` exiting 0.
- `.claude/workflows/dev-build-and-ship.js`: the Phase 9d agent prompt
  and the Phase 9e done-gate prompt gain the same requirement, so the
  autonomous path enforces it too.
- `dev-tools/README.md`: document the three verbs.

## What blocks, and what is only reported

**Blocking** — a finding requires a verdict reply when:

- It is an inline review thread whose root comment author is not the PR
  author, or
- It is a PR review with state `CHANGES_REQUESTED`.

**Out of scope** — neither blocking nor listed:

- PR conversation (issue-level) comments.
- Reviews with state `COMMENTED` or `APPROVED`.

An earlier draft promised to list these in the check summary "so nothing
is invisible." That promise is withdrawn: the gate never fetches
issue-level comments, so claiming to report them would have been a lie in
the doc, and listing every CodeRabbit walkthrough and "LGTM" would bury
the findings that actually need action. Conversation is conversation; the
gate covers findings.

This line is drawn where it is because bot summary comments — CodeRabbit
walkthroughs, "review in progress", rate-limit notices — arrive at the
issue level and are not findings. Requiring a verdict on each would
generate ritual noise, and a gate that produces noise gets routed around.
Inline threads and `CHANGES_REQUESTED` are, without exception, actual
findings.

### What counts as an answer

A thread is answered when it contains a reply that:

1. Carries a parseable verdict with a rationale, **and**
2. Is authored by a non-bot whose `authorAssociation` is `OWNER`,
   `MEMBER`, or `COLLABORATOR`, **and**
3. If the verdict is `agreed`, cites a commit SHA that actually exists on
   the PR.

Consequences of that rule, each deliberate:

- **Resolving a thread does not answer it.** Silent resolution is the
  precise failure mode this gate exists to catch; accepting it as an
  answer would reopen the hole.
- **An `agreed` reply must name a real commit.** `composeReply` refuses
  to build an `agreed` body without a SHA, but that only constrains
  replies posted through our own CLI — a hand-typed or mistyped SHA would
  otherwise sail through. The `audit` verb fetches the PR's commit list
  (`gh api repos/{o}/{r}/pulls/{n}/commits`) once and passes the SHAs to
  `classifyThreads` as `knownShas`; an `agreed` reply citing a SHA not in
  that set is treated as unanswered. Matching is on any SHA prefix of
  7 or more characters, so `abc1234` matches the full hash. This closes
  the one remaining path by which a confident-sounding but unverifiable
  response could satisfy the gate — which is the exact class of thing the
  gate exists to prevent.
- **A reply from another bot does not count.** Bot identity is decided
  primarily by the GraphQL actor type (`author.__typename === 'Bot'`),
  which is authoritative for GitHub Apps and requires no maintenance —
  `Copilot` and `chatgpt-codex-connector` both carry no `[bot]` login
  suffix, so suffix-matching alone would let a Copilot reply satisfy a
  Codex finding. A `[bot]` suffix check and a small explicit login list
  remain as backstops for actors GraphQL reports as `User`. The list is a
  known maintenance trap and is commented as such at its definition:
  a future reviewer bot that is neither typed `Bot` nor suffixed would
  need to be added.
- **A thread the PR author started does not need an answer.** It is a
  note to reviewers, not a finding.
- **A `CHANGES_REQUESTED` review is answered per reviewer, not in bulk.**
  Inline threads correlate structurally — a reply is nested inside the
  thread it answers. GitHub's `PullRequest.reviews` is a flat list with no
  such nesting, so review-level findings need an explicit correlation
  rule, or one reply would silently satisfy every reviewer who requested
  changes at the same time. The rule is: reviews are first collapsed to
  each author's **latest** review (mirroring how GitHub itself decides
  whether a reviewer currently blocks — a bot that re-reviews and drops
  its request stops blocking). A review still in `CHANGES_REQUESTED` is
  answered only by a later review that carries a verdict from a non-bot
  maintainer **and names that reviewer's login**, with or without a
  leading `@`. Ordering matters too: a verdict written before the finding
  existed cannot pre-answer it.
- **Outdated threads still need an answer.** GitHub marks a thread
  outdated when its line changes, which usually means we fixed it — so
  the correct response is an `agreed` reply naming the commit, not
  silence. Treating outdated as self-answering would let every fixed
  finding vanish unexplained, losing exactly the record we want.

## Testing

`tests/unit/prTriage.test.ts` (vitest, importing the module directly, in
the manner of the existing `tests/unit/feedbackLog.test.ts`):

- `parseVerdict` — HTML-marker form for all three verdicts; human-typed
  `Agreed:` / `Pushed back —` / `Ignored -` forms; rejects a bare verdict
  word with no rationale; rejects unrelated prose; case-insensitive.
- `composeReply` — embeds marker and display form; `agreed` without a
  commit throws; empty rationale throws; unknown verdict throws.
- `classifyThreads` — bot thread with no reply blocks; bot thread with a
  maintainer verdict reply passes; a reply from an actor typed `Bot` does
  not count; a reply from a `User`-typed bot on the login list does not
  count; a reply from a non-member does not count; a thread rooted by the
  PR author is skipped; a resolved-but-silent thread blocks; an outdated
  thread still blocks; an `agreed` reply citing a SHA absent from
  `knownShas` blocks; the same reply with a 7-char prefix of a real SHA
  passes; `CHANGES_REQUESTED` without a reply blocks; `COMMENTED` /
  `APPROVED` never block.
- `renderSummary` — renders counts and one row per unanswered finding;
  handles the empty case without crashing.

Fixtures are literal GraphQL response shapes captured from a real PR, so
the tests fail if the assumed payload shape is wrong.

No coverage-gate exposure: `sonar-project.properties` sets
`sonar.sources=src`, and `vitest.config.ts` `coverage.include` lists only
`src/**` and `supabase/functions/_shared/**`. `dev-tools/` is in neither,
matching how `dev-tools/feedback-log.js` is already treated.

**E2E:** justified exception. This change adds CI tooling and developer
scripts; it touches no route, page, dialog, edge function, or RPC, and
has no user-facing surface a Playwright spec could drive.

## Decided trade-offs

- **CI audits, never writes.** Considered having a Claude action reply
  automatically. Rejected: the replier would lack the build context, so
  it would produce confident replies that may not match what was actually
  done — noise that reads as triage. The gate's value is that a reply
  means someone with context decided something.
- **`pull_request_target` accepted** for the push-triggered re-audit,
  mitigated by never checking out or executing PR code.
- **Review-level correlation is by reviewer login, not by content.** A
  Phase 7 reviewer flagged that the first implementation let any single
  maintainer verdict answer every open `CHANGES_REQUESTED` at once.
  Measured against the last five PRs (#657, #658, #650, #654, #641),
  `CHANGES_REQUESTED` never actually occurs — every bot posts
  `COMMENTED` — so this is a latent path rather than a live hole, and the
  cheapest correct rule was preferred over machinery that tries to match
  a reply to a finding's *content*. Naming the reviewer is a weak
  correlation, but it is structural, testable, and cannot be satisfied by
  accident.
- **Issue-level comments do not block.** Accepts that a human question
  asked in the PR conversation can go unanswered without failing CI. The
  alternative — blocking on all conversation — makes the gate noisy
  enough to be disabled, which costs more than it gains.

## Follow-up required from a human

`pr-comment-response` must be added as a **required status check** in the
repository's branch-protection settings for `main`. Until that is done,
the check reports but does not block merging. This cannot be done from
the PR.
