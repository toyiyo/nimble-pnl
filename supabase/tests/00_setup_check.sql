-- Basic setup check to ensure pgTAP is working
BEGIN;
SELECT plan(5);

-- Test that pgTAP extension is loaded
SELECT has_extension('pgtap', 'pgTAP extension should be installed');

-- Test basic pgTAP functionality
SELECT pass('pgTAP is working correctly');

-- Test that public schema exists
SELECT has_schema('public', 'public schema should exist');

-- Test that we can query pg_proc for functions
SELECT ok(
    (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0,
    'public schema should contain functions'
);

-- Test that we have the expected function count (at least 30 functions)
SELECT ok(
    (SELECT COUNT(DISTINCT proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) >= 30,
    'Should have at least 30 unique functions in public schema'
);

SELECT * FROM finish();
ROLLBACK;
