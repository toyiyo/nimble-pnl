# Repository Expectations

- Use the repository `$dev` skill for every code-producing feature or bug fix.
- Create an isolated `codex/<topic>` worktree before new design or code work.
- Preserve unrelated tracked and untracked user changes.
- Require an approved design and implementation plan before coding.
- Use RED, GREEN, and REFACTOR for each implementation task.
- Stage explicit paths. Never use `git add -A`, `git add .`, or `git commit -a`.
- Stop when implementation requires a change to the approved design.
- Run `npm run test`, `npm run test:db`, `npm run test:e2e`,
  `npm run typecheck`, `npm run lint`, and `npm run build` before shipping.
- Do not call green CI complete before direct review-comment triage passes.
- Do not claim a workflow task complete until its `$dev` done gate passes.
