# Scheduling Module - Testing Guide

## Database Testing

### 1. Verify Tables Created

```sql
-- Check all scheduling tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('employees', 'shifts', 'shift_templates', 'time_off_requests');
```

Expected: 4 rows returned

### 2. Verify RLS Policies

```sql
-- Check RLS is enabled
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('employees', 'shifts', 'shift_templates', 'time_off_requests');
```

Expected: All rows should have `rowsecurity = true`

```sql
-- List all policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('employees', 'shifts', 'shift_templates', 'time_off_requests')
ORDER BY tablename, policyname;
```

Expected: 16 policies total (4 per table: SELECT, INSERT, UPDATE, DELETE)

### 3. Verify Indexes

```sql
-- Check indexes
SELECT schemaname, tablename, indexname, indexdef 
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename IN ('employees', 'shifts', 'shift_templates', 'time_off_requests')
ORDER BY tablename, indexname;
```

Expected: At least 10 indexes

### 4. Verify Triggers

```sql
-- Check update triggers
SELECT event_object_table, trigger_name, action_statement 
FROM information_schema.triggers 
WHERE event_object_table IN ('employees', 'shifts', 'shift_templates', 'time_off_requests')
ORDER BY event_object_table;
```

Expected: 4 triggers (one per table) for `updated_at`

## Sample Data Insertion

### Insert Test Restaurant (if needed)

```sql
-- First, get your user ID
SELECT id FROM auth.users WHERE email = 'your-email@example.com';

-- Create a test restaurant
INSERT INTO restaurants (name, description, owner_id)
VALUES ('Test Restaurant', 'For scheduling testing', 'your-user-id-here')
RETURNING id;

-- Associate user with restaurant
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('your-user-id-here', 'restaurant-id-from-above', 'owner');
```

### Insert Test Employees

```sql
-- Replace 'restaurant-id' with actual ID
INSERT INTO employees (restaurant_id, name, position, hourly_rate, status)
VALUES 
  ('restaurant-id', 'John Doe', 'Server', 1500, 'active'),
  ('restaurant-id', 'Jane Smith', 'Cook', 1800, 'active'),
  ('restaurant-id', 'Bob Johnson', 'Bartender', 1600, 'active'),
  ('restaurant-id', 'Alice Williams', 'Host', 1400, 'active'),
  ('restaurant-id', 'Charlie Brown', 'Manager', 2500, 'active');
```

### Insert Test Shifts

```sql
-- Get employee IDs first
SELECT id, name, position FROM employees WHERE restaurant_id = 'restaurant-id';

-- Insert shifts for the current week
INSERT INTO shifts (restaurant_id, employee_id, start_time, end_time, break_duration, position, status)
VALUES 
  -- Monday shifts
  ('restaurant-id', 'john-doe-id', '2025-11-17 09:00:00+00', '2025-11-17 17:00:00+00', 30, 'Server', 'scheduled'),
  ('restaurant-id', 'jane-smith-id', '2025-11-17 10:00:00+00', '2025-11-17 18:00:00+00', 30, 'Cook', 'scheduled'),
  
  -- Tuesday shifts
  ('restaurant-id', 'bob-johnson-id', '2025-11-18 17:00:00+00', '2025-11-18 23:00:00+00', 0, 'Bartender', 'scheduled'),
  ('restaurant-id', 'alice-williams-id', '2025-11-18 11:00:00+00', '2025-11-18 19:00:00+00', 30, 'Host', 'scheduled'),
  
  -- Wednesday shifts
  ('restaurant-id', 'charlie-brown-id', '2025-11-19 08:00:00+00', '2025-11-19 16:00:00+00', 30, 'Manager', 'scheduled');
```

### Insert Shift Templates

```sql
-- Create recurring weekly templates
INSERT INTO shift_templates (restaurant_id, name, day_of_week, start_time, end_time, break_duration, position)
VALUES 
  ('restaurant-id', 'Monday Opening', 1, '09:00:00', '17:00:00', 30, 'Server'),
  ('restaurant-id', 'Tuesday Evening', 2, '17:00:00', '23:00:00', 0, 'Bartender'),
  ('restaurant-id', 'Wednesday Morning', 3, '08:00:00', '16:00:00', 30, 'Manager');
```

## Query Examples

### 1. Get All Active Employees for a Restaurant

```sql
SELECT id, name, position, hourly_rate / 100.0 AS hourly_rate_dollars, status, hire_date
FROM employees
WHERE restaurant_id = 'restaurant-id'
  AND status = 'active'
ORDER BY name;
```

### 2. Get All Shifts for Current Week

```sql
SELECT 
  s.id,
  e.name AS employee_name,
  s.position,
  s.start_time,
  s.end_time,
  s.break_duration,
  s.status,
  -- Calculate hours
  EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600 - (s.break_duration / 60.0) AS hours
FROM shifts s
JOIN employees e ON e.id = s.employee_id
WHERE s.restaurant_id = 'restaurant-id'
  AND s.start_time >= date_trunc('week', CURRENT_DATE)
  AND s.start_time < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
ORDER BY s.start_time, e.name;
```

### 3. Calculate Weekly Labor Metrics

```sql
SELECT 
  COUNT(DISTINCT s.employee_id) AS active_employees,
  SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600 - (s.break_duration / 60.0)) AS total_hours,
  SUM((EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600 - (s.break_duration / 60.0)) * (e.hourly_rate / 100.0)) AS total_labor_cost
FROM shifts s
JOIN employees e ON e.id = s.employee_id
WHERE s.restaurant_id = 'restaurant-id'
  AND s.start_time >= date_trunc('week', CURRENT_DATE)
  AND s.start_time < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days';
```

### 4. Find Employees Without Shifts This Week

```sql
SELECT e.id, e.name, e.position
FROM employees e
WHERE e.restaurant_id = 'restaurant-id'
  AND e.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM shifts s
    WHERE s.employee_id = e.id
      AND s.start_time >= date_trunc('week', CURRENT_DATE)
      AND s.start_time < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
  )
ORDER BY e.name;
```

### 5. Check for Overlapping Shifts (Same Employee)

```sql
SELECT 
  s1.id AS shift1_id,
  s2.id AS shift2_id,
  e.name AS employee_name,
  s1.start_time AS shift1_start,
  s1.end_time AS shift1_end,
  s2.start_time AS shift2_start,
  s2.end_time AS shift2_end
FROM shifts s1
JOIN shifts s2 ON s1.employee_id = s2.employee_id AND s1.id < s2.id
JOIN employees e ON e.id = s1.employee_id
WHERE s1.restaurant_id = 'restaurant-id'
  AND (s1.start_time, s1.end_time) OVERLAPS (s2.start_time, s2.end_time)
ORDER BY e.name, s1.start_time;
```

### 6. Get Shift Summary by Day

```sql
SELECT 
  date_trunc('day', s.start_time)::date AS shift_date,
  to_char(s.start_time, 'Day') AS day_name,
  COUNT(*) AS shift_count,
  COUNT(DISTINCT s.employee_id) AS employee_count,
  SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600 - (s.break_duration / 60.0)) AS total_hours
FROM shifts s
WHERE s.restaurant_id = 'restaurant-id'
  AND s.start_time >= CURRENT_DATE - INTERVAL '7 days'
  AND s.start_time < CURRENT_DATE + INTERVAL '14 days'
GROUP BY date_trunc('day', s.start_time), to_char(s.start_time, 'Day')
ORDER BY date_trunc('day', s.start_time);
```

## Application Testing Checklist

### Employee Management
- [ ] Create employee with all fields
- [ ] Create employee with minimal required fields (name, position, hourly_rate)
- [ ] Edit employee details
- [ ] Change employee status (active → inactive)
- [ ] Delete employee (should cascade delete shifts)
- [ ] Try to create employee without required fields (should fail)

### Shift Management
- [ ] Create shift with all fields
- [ ] Create shift with minimal required fields
- [ ] Edit shift details
- [ ] Change shift status (scheduled → confirmed → completed)
- [ ] Delete shift
- [ ] Try to create shift with end_time < start_time (should fail)
- [ ] Try to assign shift to inactive employee (UI should prevent this)

### Calendar View
- [ ] Navigate to previous week
- [ ] Navigate to next week
- [ ] Click "Today" to jump to current week
- [ ] View shifts for all employees in grid
- [ ] Click shift card to edit
- [ ] Hover shift card to see edit/delete buttons
- [ ] Click "Add" button in empty cell
- [ ] Verify labor metrics update when adding/removing shifts

### Permissions (RLS Testing)
- [ ] User can only see employees for their restaurants
- [ ] User can only see shifts for their restaurants
- [ ] User cannot access another restaurant's data
- [ ] Manager can create/edit shifts
- [ ] Manager can create/edit employees
- [ ] Owner can delete employees
- [ ] Regular employee (if applicable) cannot create shifts

### UI/UX
- [ ] Loading states show skeleton placeholders
- [ ] Empty state shows when no employees exist
- [ ] Toast notifications appear for all actions
- [ ] Delete confirmation dialog works
- [ ] Form validation shows errors
- [ ] Responsive layout works on mobile
- [ ] Sticky employee column scrolls horizontally
- [ ] Keyboard navigation works in forms

## Performance Testing

### Test Query Performance

```sql
-- Explain analyze for shift query
EXPLAIN ANALYZE
SELECT s.*, e.name, e.position AS employee_position
FROM shifts s
JOIN employees e ON e.id = s.employee_id
WHERE s.restaurant_id = 'restaurant-id'
  AND s.start_time >= '2025-11-17'
  AND s.start_time < '2025-11-24'
ORDER BY s.start_time;
```

Should use indexes on:
- `shifts.restaurant_id`
- `shifts.start_time`
- `shifts.employee_id`

### Bulk Insert Test

```sql
-- Insert 100 shifts for testing
DO $$
DECLARE
  emp_id UUID;
  rest_id UUID := 'restaurant-id';
  shift_date DATE := CURRENT_DATE;
  i INT;
BEGIN
  -- Get first employee
  SELECT id INTO emp_id FROM employees WHERE restaurant_id = rest_id LIMIT 1;
  
  -- Insert 100 shifts
  FOR i IN 1..100 LOOP
    INSERT INTO shifts (restaurant_id, employee_id, start_time, end_time, break_duration, position, status)
    VALUES (
      rest_id,
      emp_id,
      shift_date + (i || ' days')::INTERVAL + '09:00:00'::TIME,
      shift_date + (i || ' days')::INTERVAL + '17:00:00'::TIME,
      30,
      'Server',
      'scheduled'
    );
  END LOOP;
END $$;
```

## Cleanup

### Remove Test Data

```sql
-- Delete in order to respect foreign keys
DELETE FROM shifts WHERE restaurant_id = 'restaurant-id';
DELETE FROM shift_templates WHERE restaurant_id = 'restaurant-id';
DELETE FROM time_off_requests WHERE restaurant_id = 'restaurant-id';
DELETE FROM employees WHERE restaurant_id = 'restaurant-id';

-- Optionally delete test restaurant
DELETE FROM user_restaurants WHERE restaurant_id = 'restaurant-id';
DELETE FROM restaurants WHERE id = 'restaurant-id';
```

## Common Issues & Solutions

### Issue: "Permission denied for table employees"
**Solution:** User is not associated with the restaurant. Check `user_restaurants` table.

### Issue: "violates check constraint valid_shift_time"
**Solution:** End time is not after start time. Verify datetime values.

### Issue: "No employees showing in shift dialog"
**Solution:** No active employees exist. Create an employee with status='active'.

### Issue: Shifts not showing in calendar
**Solution:** Check date range. Shifts may be outside current week view.

### Issue: Labor cost is 0
**Solution:** Employee hourly_rate may be 0. Update employee hourly rate.

## Automated Testing (Future)

Example Playwright test:

```typescript
test('can create employee and shift', async ({ page }) => {
  // Login
  await page.goto('/auth');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'password');
  await page.click('button:has-text("Sign In")');
  
  // Navigate to scheduling
  await page.click('text=Scheduling');
  await expect(page).toHaveURL('/scheduling');
  
  // Create employee
  await page.click('button:has-text("Add Employee")');
  await page.fill('[name="name"]', 'Test Employee');
  await page.selectOption('[name="position"]', 'Server');
  await page.fill('[name="hourlyRate"]', '15.00');
  await page.click('button:has-text("Add Employee")');
  
  // Verify employee appears
  await expect(page.locator('text=Test Employee')).toBeVisible();
  
  // Create shift
  await page.click('button:has-text("Create Shift")');
  await page.selectOption('[name="employee"]', { label: /Test Employee/ });
  await page.fill('[name="startDate"]', '2025-11-17');
  await page.fill('[name="startTime"]', '09:00');
  await page.fill('[name="endTime"]', '17:00');
  await page.click('button:has-text("Create Shift")');
  
  // Verify shift appears in calendar
  await expect(page.locator('text=9:00 AM - 5:00 PM')).toBeVisible();
});
```

## Notes

- All timestamps are stored in UTC
- Hourly rates are stored in cents (integer)
- Break durations are in minutes
- Day of week: 0=Sunday, 1=Monday, ..., 6=Saturday
- RLS automatically filters data by restaurant access
