-- ============================================================================
-- review_pages / review_responses / review_response_contacts were created in
-- 20260804100100 with grants for `anon` (revoked) and `authenticated`, but
-- none for `service_role`. PostgreSQL checks the table ACL before it ever
-- evaluates RLS, so `service_role`'s `rolbypassrls` does nothing here — with
-- no table grant, the service-role client every one of review-public's
-- handlers runs under (handlePage's SELECT, handleRate's INSERT, and
-- handleComment's SELECT/UPDATE + the contacts INSERT) fails outright with
-- "permission denied for table review_pages" before RLS is ever consulted.
-- This is the same requirement bank_reauth_notices already documents:
-- "Without this GRANT the SELECT above fails" (20260723130100).
--
-- Caught by exercising the deployed review-public function directly against
-- a local Postgres instance during Phase 7b re-verification — the pgTAP
-- suites never exposed it because they run as `postgres`/`authenticated`,
-- never as `service_role`.
-- ============================================================================

GRANT ALL ON public.review_pages TO service_role;
GRANT ALL ON public.review_responses TO service_role;
GRANT ALL ON public.review_response_contacts TO service_role;
