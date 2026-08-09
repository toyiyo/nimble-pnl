// Column projection for the tip_server_earnings read query. The employees embed
// must name only columns that exist on public.employees. That table has a single
// `name` column (no first_name / last_name). A phantom column makes PostgREST
// throw, so tests/unit/useTipServerEarnings.select.test.ts pins this against the
// generated schema. This module stays dependency-free so the test can import it
// without loading the Supabase client.
export const TIP_SERVER_EARNINGS_SELECT = '*, employees(name)';
