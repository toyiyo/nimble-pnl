Apply targeted TypeScript type assertions across 13 files to bypass out-of-sync Supabase generated types and unblock the production build. No logic changes — purely type-level fixes (`as any` / `as unknown as X`) following the pattern already used elsewhere in the codebase.

## Files to fix

1. `src/components/MLKitBarcodeScanner.tsx` — cast `BarcodeFormat.EanThirteen/EanEight` as `any`
2. `src/components/financial-statements/IncomeStatement.tsx` — cast `'amortization'` comparison as `any`
3. `src/components/scheduling/ShiftImportSheet.tsx` — fix `onDrop` handler element type
4. `src/hooks/useCheckBankAccounts.ts` — cast destructured query results as `any`
5. `src/hooks/useCopyWeekShifts.ts` — cast `p_shifts` payload as `any`
6. `src/hooks/useDeviceToken.ts` — cast `device_tokens` table name as `any`
7. `src/hooks/useEmployeeAreas.tsx` — cast `area` select result as `any`
8. `src/hooks/useSSO.tsx` — remove undeclared `data` from return shorthand
9. `src/hooks/useSchedulePlanTemplates.ts` — cast result via `as unknown as SchedulePlanTemplate[]`
10. `src/hooks/useTimePunches.tsx` — cast result via `as unknown as TimePunch[]`
11. `src/hooks/useTipServerEarnings.tsx` — cast joined result as `any[]`
12. `src/pages/EmployeeTips.tsx` — cast `shareMethod` to `ShareMethod`
13. `src/pages/RestaurantSettings.tsx` — cast geofence update payload as `any`

## After fixes

Run `npm run build` (or `tsc --noEmit`) to confirm the build passes, then the next publish will deploy successfully.

## Note

These are temporary workarounds. The proper long-term fix is to regenerate Supabase types (`.claude/commands/sync-types.md`) so the generated types match the actual database schema. That can be a follow-up task.