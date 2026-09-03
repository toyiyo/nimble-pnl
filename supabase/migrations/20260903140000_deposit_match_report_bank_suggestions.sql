-- Deposit match: bank picker mask and settlement-account suggestion
-- (design doc 2026-09-03-deposit-match-bank-picker-design.md).
--
-- Replaces get_deposit_match_report. The banks payload gains two fields:
--   * account_mask       — the last 4 digits, so the SetupDialog picker
--                           can tell two banks at the same institution
--                           apart ("Mercury ••9866" vs "Mercury ••9510").
--   * suggested_sources   — a per-POS-source hit count from a 90-day scan
--                           of the bank's deposits, so the picker can
--                           suggest the right bank for a new rule.
--
-- The scan runs one pass per bank with count(*) FILTER (WHERE ...)
-- clauses, on idx_bank_transactions_bank_date. The row filter matches the
-- refresh engine's own candidate filter (bt.amount > 0, bt.is_transfer IS
-- NOT TRUE) plus a 90-day window on transaction_date. A source is kept
-- only when its count is 3 or more, to cut one-off noise.
--
-- Not in scope (design "Not in scope"): no change to
-- deposit_match_rules.descriptor_pattern defaults, no new index, no Revel
-- pattern.

CREATE OR REPLACE FUNCTION public.get_deposit_match_report(
  p_restaurant_id uuid, p_start_date date, p_end_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_summary jsonb;
  v_streams jsonb;
  v_ledger  jsonb;
  v_banks   jsonb;
BEGIN
  IF NOT (
    public.user_has_capability(p_restaurant_id, 'view:banking')
    AND public.user_has_capability(p_restaurant_id, 'view:pos_sales')
  ) THEN
    RAISE EXCEPTION
      'get_deposit_match_report: caller lacks view:banking and view:pos_sales for restaurant %',
      p_restaurant_id;
  END IF;

  SELECT jsonb_build_object(
    'total_expected', COALESCE(SUM(i.expected_amount), 0),
    'total_received', COALESCE(SUM(i.received_amount), 0),
    'total_fees', COALESCE(SUM(i.fee_amount), 0),
    'pending_count', COUNT(*) FILTER (WHERE i.status = 'pending'),
    'needs_attention_count', COUNT(*) FILTER (WHERE i.status IN ('short', 'over', 'late', 'needs_review'))
  ) INTO v_summary
  FROM public.deposit_match_items i
  WHERE i.restaurant_id = p_restaurant_id
    AND i.business_date BETWEEN p_start_date AND p_end_date;

  SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) INTO v_streams
  FROM (
    SELECT jsonb_build_object(
      'rule_id', r.id,
      'pos_source', r.pos_source,
      'rail', r.rail,
      'active', r.active,
      'expected_total', COALESCE(SUM(i.expected_amount), 0),
      'received_total', COALESCE(SUM(i.received_amount), 0),
      'fee_total', COALESCE(SUM(i.fee_amount), 0),
      'item_count', COUNT(i.id)
    ) AS s
    FROM public.deposit_match_rules r
    LEFT JOIN public.deposit_match_items i
      ON i.rule_id = r.id AND i.business_date BETWEEN p_start_date AND p_end_date
    WHERE r.restaurant_id = p_restaurant_id
    GROUP BY r.id, r.pos_source, r.rail, r.active
    ORDER BY r.pos_source
  ) x;

  SELECT COALESCE(jsonb_agg(l), '[]'::jsonb) INTO v_ledger
  FROM (
    SELECT jsonb_build_object(
      'item_id', i.id,
      'rule_id', i.rule_id,
      'pos_source', r.pos_source,
      'business_date', i.business_date,
      'expected_amount', i.expected_amount,
      'received_amount', i.received_amount,
      'fee_amount', i.fee_amount,
      'status', i.status,
      'status_reason', i.status_reason,
      'resolution', i.resolution,
      'resolution_note', i.resolution_note,
      'links', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'link_id', lk.id,
          'bank_transaction_id', lk.bank_transaction_id,
          'allocated_amount', lk.allocated_amount,
          'method', lk.method,
          'state', lk.state,
          'match_reason', lk.match_reason
        ) ORDER BY lk.created_at)
        FROM public.deposit_match_links lk
        WHERE lk.item_id = i.id
      ), '[]'::jsonb)
    ) AS l
    FROM public.deposit_match_items i
    JOIN public.deposit_match_rules r ON r.id = i.rule_id
    WHERE i.restaurant_id = p_restaurant_id
      AND i.business_date BETWEEN p_start_date AND p_end_date
    ORDER BY i.business_date, r.pos_source
  ) y;

  -- Every bank the restaurant has connected, not only banks an existing
  -- rule already references. A rule-gated join left the SetupDialog's bank
  -- picker empty for the very first rule, so no user could ever create one
  -- (found writing the Task 6 E2E test).
  --
  -- suggested_sources: one 90-day scan per bank, one pass with a
  -- count(*) FILTER per pattern. focus and shift4 share one pattern
  -- (SHIFT.?4), since both settle through Shift4 Payments; a source with
  -- no confirmed descriptor (revel) gets no pattern and so never appears.
  SELECT COALESCE(jsonb_agg(b), '[]'::jsonb) INTO v_banks
  FROM (
    SELECT jsonb_build_object(
      'connected_bank_id', cb.id,
      'institution_name', cb.institution_name,
      'status', cb.status,
      'data_current_through', cb.data_current_through,
      'account_mask', cb.account_mask,
      'suggested_sources', (
        SELECT COALESCE(
          jsonb_object_agg(src.source, src.hits) FILTER (WHERE src.hits >= 3),
          '{}'::jsonb
        )
        FROM (
          SELECT
            count(*) FILTER (WHERE bt.description ~* 'SHIFT.?4') AS focus_hits,
            count(*) FILTER (WHERE bt.description ~* 'TST\*|TOAST') AS toast_hits,
            count(*) FILTER (WHERE bt.description ~* 'SQ \*|SQUARE') AS square_hits,
            count(*) FILTER (WHERE bt.description ~* 'CLOVER') AS clover_hits
          FROM public.bank_transactions bt
          WHERE bt.restaurant_id = p_restaurant_id
            AND bt.connected_bank_id = cb.id
            AND bt.amount > 0
            AND bt.is_transfer IS NOT TRUE
            AND bt.transaction_date >= CURRENT_DATE - 90
        ) counts
        CROSS JOIN LATERAL (
          VALUES
            ('focus', counts.focus_hits),
            ('shift4', counts.focus_hits),
            ('toast', counts.toast_hits),
            ('square', counts.square_hits),
            ('clover', counts.clover_hits)
        ) AS src(source, hits)
      )
    ) AS b
    FROM public.connected_banks cb
    WHERE cb.restaurant_id = p_restaurant_id
    ORDER BY cb.institution_name
  ) z;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'streams', v_streams,
    'ledger', v_ledger,
    'banks', v_banks
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_deposit_match_report(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_deposit_match_report(uuid, date, date) TO authenticated;
