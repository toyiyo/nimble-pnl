-- ============================================================================
-- review_response_submit_followup: one RPC for the guest follow-up write.
--
-- handleComment in supabase/functions/review-public/index.ts used to run two
-- separate writes: an UPDATE on review_responses, then an INSERT on
-- review_response_contacts. The INSERT's error was logged and swallowed --
-- correct for a comment-only submit, where the comment already saved. Wrong
-- for a contact-only submit: the UPDATE stores nothing but the
-- commented_at stamp, the failed INSERT drops the guest's email on the
-- floor, and the single-use guard below now rejects a retry. The guest has
-- no way to repair it.
--
-- This function puts both writes inside one call, so one failure rolls back
-- the other. A caller does not need an explicit transaction: a single
-- SECURITY DEFINER function body is one implicit transaction, and an
-- unhandled exception in the INSERT unwinds the UPDATE with it. A failed
-- contact insert now leaves commented_at NULL, so a retry works.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.review_response_submit_followup(
  p_response_id UUID,
  p_comment     TEXT,
  p_consent     BOOLEAN,
  p_name        TEXT,
  p_email       TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id UUID;
BEGIN
  -- `commented_at IS NULL` makes the token single-use: a replay updates
  -- zero rows and the caller still answers ok. `comment IS NULL` cannot do
  -- that job -- a contact-only submit leaves comment NULL, so a replay would
  -- match again and hit the primary key on review_response_contacts. This
  -- function is the only writer of commented_at, so this guard rejects
  -- every replay.
  UPDATE public.review_responses
  SET comment = p_comment,
      contact_consent = p_consent,
      commented_at = now()
  WHERE id = p_response_id
    AND commented_at IS NULL
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RETURN false;
  END IF;

  -- Consent false means the values are discarded, not stored and hidden.
  IF p_consent AND (p_name IS NOT NULL OR p_email IS NOT NULL) THEN
    INSERT INTO public.review_response_contacts (
      review_response_id, restaurant_id, contact_name, contact_email
    ) VALUES (
      v_updated_id,
      '00000000-0000-0000-0000-000000000000', -- overwritten by the trigger
      p_name,
      p_email
    );
  END IF;

  RETURN true;
END;
$$;

-- Least privilege: only review-public (service_role) may call this. A
-- signed-in user edits a response through `status` and RLS, never through
-- this path.
REVOKE ALL ON FUNCTION public.review_response_submit_followup(UUID, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_response_submit_followup(UUID, TEXT, BOOLEAN, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.review_response_submit_followup IS
'Guest follow-up write for review-public''s handleComment. Runs the guarded UPDATE (commented_at IS NULL makes the token single-use) and, on a real write with consent and a name or an email, the review_response_contacts INSERT -- in one implicit transaction, so a failed INSERT rolls back the UPDATE and commented_at stays NULL for a retry. Returns true on a real write, false on a replay (zero rows updated). SECURITY DEFINER, service_role only.';
