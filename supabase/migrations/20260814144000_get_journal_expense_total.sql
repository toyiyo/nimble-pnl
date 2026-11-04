CREATE OR REPLACE FUNCTION public.get_journal_expense_total(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE
)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0)::NUMERIC
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE je.restaurant_id = p_restaurant_id
    AND coa.restaurant_id = p_restaurant_id
    AND coa.account_type = 'expense'
    AND je.entry_date >= p_start_date AND je.entry_date <= p_end_date;
$$;

REVOKE EXECUTE ON FUNCTION public.get_journal_expense_total(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_journal_expense_total(UUID, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_journal_expense_total(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_journal_expense_total IS
'Net expense debits from journal_entry_lines for one restaurant and range.
Replaces the expense-account id round-trip. SECURITY INVOKER.';
