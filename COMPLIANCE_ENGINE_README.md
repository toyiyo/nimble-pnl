# Compliance Engine Implementation

## Overview
The Compliance Engine is a comprehensive labor law compliance system integrated into the scheduling workflow. It ensures restaurants stay compliant with labor regulations by automatically detecting violations and providing visual warnings.

## Features Implemented

### 1. Compliance Rules Configuration
- **Rule Types Supported:**
  - **Minor Restrictions**: Age-based work hour restrictions (max hours per day/week, time restrictions)
  - **Clopening Prevention**: Minimum hours required between closing and opening shifts
  - **Rest Period Requirements**: Minimum rest periods between any shifts
  - **Shift Length Limits**: Minimum and maximum shift durations, consecutive days limits
  - **Overtime Regulations**: Weekly and daily overtime thresholds

- **Configuration UI** (`/compliance` → Rules tab):
  - Enable/disable rules individually
  - Configure rule-specific parameters
  - Visual rule cards with icons and descriptions
  - Real-time validation of rule configurations

### 2. Compliance Checking Integration
- **Automatic Validation**: Shifts are checked against all enabled compliance rules when created/edited
- **Real-time Feedback**: Compliance warnings appear in the shift dialog as you type
- **Severity Levels**:
  - **Warning**: Advisory only, doesn't block scheduling
  - **Error**: Requires manager override to proceed
  - **Critical**: Cannot be overridden, shift must be adjusted

- **Database Function**: `check_shift_compliance()` performs server-side validation
  - Checks employee age for minor restrictions
  - Calculates shift duration for length limits
  - Finds previous shifts to check rest periods and clopening
  - Returns array of violations with details

### 3. Visual Warning System
- **ComplianceWarnings Component**: Displays violations in the shift dialog
  - Color-coded alerts (yellow/orange/red based on severity)
  - Rule-specific icons and messages
  - Details like hours between shifts
  - Override button when allowed

- **Shift Dialog Integration**:
  - Compliance checks run automatically when dates/times change
  - Violations shown before saving
  - Critical violations prevent save
  - Errors require explicit override confirmation

### 4. Violations Tracking & Reporting
- **Violations Dashboard** (`/compliance` → Dashboard tab):
  - Total violations count
  - Active violations requiring attention
  - Overridden violations count
  - Compliance rate indicator
  - Violations by severity breakdown
  - Violations by rule type
  - Top violators list (employees with most active violations)

- **Violations Report** (`/compliance` → Violations tab):
  - Filterable list by status (active, overridden, resolved)
  - Employee and shift details
  - Override reason tracking
  - Audit trail with timestamps

### 5. Override & Audit Trail
- **Manager Override Capability**:
  - Override button appears for error-level violations
  - Requires reason input (stored in audit trail)
  - Records user who overrode and timestamp
  - Creates violation records with override status

- **Audit Trail**:
  - All violations stored in database
  - Override reasons preserved
  - Full history maintained
  - Can filter by date, employee, status

## Database Schema

### `compliance_rules` Table
```sql
- id (UUID, primary key)
- restaurant_id (UUID, foreign key)
- rule_type (text: minor_restrictions, clopening, rest_period, shift_length, overtime)
- rule_config (JSONB: flexible config for each rule type)
- enabled (boolean)
- created_at, updated_at (timestamps)
```

### `compliance_violations` Table
```sql
- id (UUID, primary key)
- restaurant_id (UUID, foreign key)
- shift_id (UUID, foreign key, nullable)
- employee_id (UUID, foreign key)
- rule_type (text)
- violation_details (JSONB: message, severity, hours_between, etc.)
- severity (text: warning, error, critical)
- status (text: active, resolved, overridden)
- override_reason (text, nullable)
- overridden_by (UUID, foreign key to auth.users)
- overridden_at (timestamp, nullable)
- created_at, updated_at (timestamps)
```

### `employees` Table Addition
```sql
- birth_date (date, nullable) - Added for age-based minor restrictions
```

## Usage Examples

### Configuring a Rule
1. Navigate to `/compliance` → Rules tab
2. Click "Add Rule"
3. Select rule type (e.g., "Clopening Prevention")
4. Configure parameters:
   - Minimum hours between shifts: 11
   - Allow override: Yes
5. Enable the rule
6. Save

### Scheduling with Compliance Checks
1. Open shift dialog from scheduling page
2. Select employee and enter shift times
3. If violations detected, they appear automatically:
   - Warning: "Shift exceeds maximum length: 12.5 > 12 hours"
   - Can save with warning
4. If error-level violation:
   - "Insufficient rest period: 8 hours < 11 hours required"
   - "Override & Save" button appears
   - Click to confirm override with reason tracking

### Reviewing Violations
1. Navigate to `/compliance` → Dashboard tab
   - See metrics at a glance
   - Identify problem areas by rule type
2. Navigate to Violations tab
   - Filter by status
   - Review specific violations
   - Override active violations with reason

## Technical Architecture

### Hooks (`src/hooks/useCompliance.tsx`)
- `useComplianceRules()` - Fetch rules for restaurant
- `useCreateComplianceRule()` - Create new rule
- `useUpdateComplianceRule()` - Update existing rule
- `useDeleteComplianceRule()` - Delete rule
- `useCheckShiftCompliance()` - Validate shift against rules (calls DB function)
- `useComplianceViolations()` - Fetch violations with filters
- `useOverrideViolation()` - Override a violation
- `useCreateComplianceViolation()` - Record violation

### Components
- **`ComplianceRulesConfig`**: Main rules configuration page
- **`ComplianceRuleDialog`**: Add/edit rule dialog with type-specific forms
- **`ComplianceWarnings`**: Visual display of violations in shift dialog
- **`ComplianceViolationsReport`**: Filterable violations list with override capability
- **`ComplianceDashboard`**: Metrics and overview of compliance status
- **`Compliance`**: Main page with tabs (dashboard, rules, violations)

### Types (`src/types/compliance.ts`)
- Comprehensive TypeScript types for all rule configurations
- Type-safe rule config unions
- Violation details interfaces
- Dashboard metrics types

## Best Practices

### DRY Principles Applied
1. **Reusable Hooks**: All data operations centralized in `useCompliance.tsx`
2. **Shared Components**: `ComplianceWarnings` used in shift dialog and potentially other places
3. **Type Safety**: Strong typing prevents configuration errors
4. **Database Function**: Server-side validation logic reusable across all shifts
5. **React Query Caching**: 30-second stale time reduces redundant API calls

### Performance Considerations
- React Query caching (30s stale time)
- Debounced compliance checking in shift dialog
- JSONB for flexible rule configs (avoids schema changes)
- Database indexes on frequently queried columns
- Efficient SQL function for compliance checking

### Security
- Row Level Security (RLS) on all compliance tables
- Only owners/managers can configure rules
- Override tracking includes user ID for accountability
- All data scoped by restaurant_id

## Future Enhancements
- Email notifications for repeated violations
- Predictive warnings before schedule publish
- Batch violation resolution
- Custom rule templates by region/state
- Integration with payroll for wage/hour compliance
- Mobile app compliance alerts
- Compliance score trending over time
- Weekly compliance summary reports

## Testing
To test the compliance engine:
1. Create a few employees with birth dates (for minor restrictions)
2. Configure compliance rules via `/compliance` → Rules
3. Try creating shifts that violate rules:
   - Schedule a shift >12 hours (if max is 12)
   - Schedule two shifts <11 hours apart (if clopening rule enabled)
   - Schedule a minor past allowed hours
4. Observe warnings in shift dialog
5. Practice overriding violations
6. Review dashboard and violations report

## Accessibility
- All interactive elements keyboard accessible
- ARIA labels on all buttons and inputs
- Screen reader support for violation alerts
- Color is not the only indicator (uses icons + text)
- Focus management in dialogs
- High contrast mode support via semantic colors
