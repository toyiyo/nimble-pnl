
ALTER TABLE public.ops_inbox_item
  DROP CONSTRAINT ops_inbox_item_kind_check,
  ADD CONSTRAINT ops_inbox_item_kind_check CHECK (
    kind = ANY (ARRAY[
      'uncategorized_txn'::text,
      'uncategorized_pos'::text,
      'anomaly'::text,
      'reconciliation'::text,
      'recommendation'::text,
      'weekly_brief_failure'::text
    ])
  );
