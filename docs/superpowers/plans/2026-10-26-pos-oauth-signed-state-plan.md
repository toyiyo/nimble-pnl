# Plan: sign the POS OAuth state

Design: `docs/superpowers/specs/2026-10-26-pos-oauth-signed-state-design.md`
Branch: `claude/lucid-gauss-ztcvg0`

## Tasks

1. **State token.** Write `tests/unit/oauthState.test.ts` for
   `signOAuthState` and `verifyOAuthState` (good, changed, expired, wrong
   provider, wrong secret, malformed, changed restaurant, bad region). Then
   write `supabase/functions/_shared/oauthState.ts`. Commit.
2. **Origin allowlist.** Add tests for `parseAllowedOrigins` and
   `resolveAppOrigin`. Add the functions. Commit.
3. **Callback check.** Add tests for `checkOAuthCallback` and
   `isOwnerOrManager` (all reject paths, the good path, the order of the
   checks). Add the functions. Commit.
4. **square-oauth.** Use the shared module in authorize and callback.
   Delete the log lines with the URL and the client id. Commit.
5. **clover-oauth.** Same as task 4. Add the region check. Commit.
6. **toast-oauth.** Same as task 4. Commit.
7. **Frontend message.** Write `tests/unit/oauthCallbackError.test.ts`, then
   `src/lib/oauthCallbackError.ts`. Use it in the three callback pages.
   Delete the console logs of `code` and `state`. Commit.
8. **Verify.** Run `npm run test`, `npm run typecheck`, `npm run lint`,
   `npm run build`. Run `deno check` on the three functions if Deno is
   available.

## Dependencies

Tasks 1 to 3 come before tasks 4 to 6. Task 7 has no dependency.
