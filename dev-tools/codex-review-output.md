::finding:: severity=minor file=src/pages/EmployeeTips.tsx line=376
The new History-tab guard uses `Boolean(tip.hours)`, which treats a real `hours_worked: 0` the same as `null`. If an approved split item has an explicit zero-hour value, the row now hides the hours line instead of rendering `0.0 hours`; the intended null fix should distinguish absent data from valid zero with `tip.hours != null`.
