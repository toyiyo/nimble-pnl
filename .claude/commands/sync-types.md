---
description: Regenerate Supabase TypeScript types from the database schema
---

# Sync Supabase Types

1. Use the Supabase MCP tool to generate fresh TypeScript types:
   - Call `mcp__supabase__generate_typescript_types`

2. Write the output to `src/types/supabase.ts` (overwrite existing)

3. Run `npx tsc --noEmit` to verify no type breakage

4. If there are type errors, list them so we can decide whether to fix or defer
