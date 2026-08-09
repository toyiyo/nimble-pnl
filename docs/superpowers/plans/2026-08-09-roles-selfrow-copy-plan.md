# RoleEditor self-row copy fix — Implementation Plan

> **For agentic workers:** This is a copy-only change with one test. Follow the
> TDD steps in order.

**Goal:** Fix one inaccurate sentence in the RoleEditor sensitive-data copy so
it names the self-row read case.

**Architecture:** Change text inside one `<p>` and one code comment in
`src/components/roles/RoleEditor.tsx`. Add one assertion in the existing copy
test.

**Tech Stack:** React, TypeScript, Vitest, Testing Library.

## Global Constraints

- ASD-STE100 for all prose, copy, comments, and commit messages.
- No SQL, no gating logic, no masked-view change. Copy-only.
- Stage explicit paths. Never `git add -A`. Never stage `progress.md`.
- Approved copy (exact): "Pay rates and contact details now gate real reads. A
  role without the switch cannot see other employees' pay rates or contact
  details. Each person still sees their own. Item costs follow area access. The
  costs switch has no effect yet."

---

### Task 1: Update the copy test (RED), then the copy (GREEN)

**Files:**
- Test: `tests/unit/RoleEditor.test.tsx:298-309` (extend the existing block)
- Modify: `src/components/roles/RoleEditor.tsx:656-666` (comment + paragraph)

**Interfaces:**
- Consumes: the existing `RoleEditor` render helper and `editorProps` in the test.
- Produces: no new exports. Copy text only.

- [ ] **Step 1: Write the failing assertions**

Add to the test block at `tests/unit/RoleEditor.test.tsx:298`:

```tsx
// The guarantee is qualified to OTHER employees — the SQL self-row
// exception keeps own-row pay and PII visible without the flag.
expect(
  screen.getByText(/cannot see other employees' pay rates or contact details/i),
).toBeInTheDocument();
expect(screen.getByText(/each person still sees their own/i)).toBeInTheDocument();
// The stale absolute claim is gone.
expect(screen.queryByText(/cannot see those fields/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test -- tests/unit/RoleEditor.test.tsx`
Expected: FAIL. The current copy says "cannot see those fields".

- [ ] **Step 3: Change the paragraph and the comment**

In `src/components/roles/RoleEditor.tsx`, replace the paragraph text
(`:662-666`) with the approved copy. Fix the comment (`:656-661`) so it names
the self-row case too.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test -- tests/unit/RoleEditor.test.tsx`
Expected: PASS. All copy assertions pass, including the two existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/components/roles/RoleEditor.tsx tests/unit/RoleEditor.test.tsx
git commit -m "fix(roles): qualify the sensitive-data copy for the self-row read"
```

## Self-Review

- Spec coverage: the one change (reword paragraph + comment) is Task 1.
- No placeholders.
- Type consistency: no types touched.
