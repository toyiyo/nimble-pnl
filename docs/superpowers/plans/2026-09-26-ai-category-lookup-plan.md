# Plan: category lookup for the AI tools

Design: `docs/superpowers/specs/2026-09-26-ai-category-lookup-design.md`

Each task is TDD: write the failing test, make it pass, commit.

1. **`categoryLookup.ts` filter.** Add `filterCategories(rows, search, cap)`
   in `supabase/functions/_shared/categoryLookup.ts`. It matches `search` on
   code or name with no case, and returns `{ categories, count, truncated }`.
   Test: `tests/unit/categoryLookup.test.ts`.
2. **`resolveCategoryRef`.** Add it to the same module, with a small client
   interface so a fake client can test it. Cover the rules in the design:
   trim, case kept, UUID then code, `restaurant_id` in every query,
   `.maybeSingle()`, not found, database error, inactive account.
3. **Registry.** In `supabase/functions/_shared/tools-registry.ts`: add the
   `list_categories` definition to the manager/owner block, add it to
   `managerOwnerTools`, and change the three `category_id` descriptions.
   Tests: `tests/unit/tools-registry.test.ts`.
4. **Handlers.** In `supabase/functions/ai-execute-tool/index.ts`: add
   `executeListCategories` and its `case`, and use `resolveCategoryRef` in the
   three write handlers. Test the error text and the not-found result through
   the helper tests; the handler file has Deno imports.
5. **Connector.** Add `list_categories: 'List categories'` to
   `MCP_TOOL_TITLES`. Test: `tests/unit/mcpHandler.test.ts` (manager sees it,
   read-only hint, title).
6. **Prompt and docs.** Add the `list_categories` line to section 6 of the
   `ai-chat-stream` prompt. Add the tool to `docs/CLAUDE_INTEGRATION.md` and
   `docs/AI_CHAT.md`.
7. **Verify.** `npm run test`, `npm run typecheck`, `npm run lint`,
   `npm run build`. Local Supabase is not available in this container, so
   pgTAP, E2E, and browser QA cannot run here. CI runs pgTAP and E2E.
8. **Ship.** Push, open the PR, watch CI, and triage every review comment.
