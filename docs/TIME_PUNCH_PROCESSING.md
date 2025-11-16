# Time Punch Processing - Calculation Logic

This document explains the robust time punch processing algorithm implemented in `src/utils/timePunchProcessing.ts`.

## Overview

The processing follows a 3-step approach:
1. **Normalize** - Remove noise and sort chronologically
2. **Identify Sessions** - Group punches into work sessions with breaks
3. **Calculate Hours** - Compute worked hours minus breaks

## Step 1: Normalize Punch Stream

### Noise Detection Rules

The system automatically detects and filters out noisy punches:

| Pattern | Detection Rule | Action |
|---------|---------------|--------|
| Burst noise | 3+ punches within 60 seconds | Keep first, mark others as noise |
| Duplicate punches | 2 punches within 60 seconds (same type) | Keep first, mark second as noise |
| Break cancellation | Break Start → Clock In within 2 minutes | Mark break start as noise |

### Example: Handling Burst Noise

**Input:**
```
9:56:25 AM - Clock In
9:56:26 AM - Break Start  
9:56:45 AM - Clock In
9:57:05 AM - Clock Out
9:57:25 AM - Clock In
```

**Processed:**
```
9:56:25 AM - Clock In (VALID)
9:56:26 AM - Break Start (NOISE: "Burst noise")
9:56:45 AM - Clock In (NOISE: "Burst noise")
9:57:05 AM - Clock Out (NOISE: "Burst noise")
9:57:25 AM - Clock In (VALID - outside 60s window)
```

## Step 2: Identify Work Sessions

### Session Rules

A valid work session consists of:
- **Start**: Clock In
- **End**: Clock Out (optional - may be incomplete)
- **Breaks**: Break Start → Break End pairs within the session

### Anomaly Detection

Sessions are flagged with anomalies if they have:
- Missing clock out
- Very short duration (< 3 minutes) when not the only session
- Incomplete breaks (Break Start without Break End)

### Example: Complete Session with Break

**Input Punches:**
```
9:00:00 AM - Clock In
12:00:00 PM - Break Start
12:30:00 PM - Break End
5:00:00 PM - Clock Out
```

**Identified Session:**
```json
{
  "clock_in": "9:00:00 AM",
  "clock_out": "5:00:00 PM",
  "breaks": [
    {
      "break_start": "12:00:00 PM",
      "break_end": "12:30:00 PM",
      "duration_minutes": 30
    }
  ],
  "total_minutes": 480,
  "break_minutes": 30,
  "worked_minutes": 450,
  "is_complete": true,
  "has_anomalies": false
}
```

## Step 3: Calculate Hours

### Formula

```
Worked Hours = (Clock Out - Clock In) - Sum(Break Durations)
```

### Break Rules

- Breaks must be **inside** a Clock In/Out window
- Only **complete** breaks (with both start and end) are counted
- Incomplete breaks are flagged as anomalies

## Test Scenarios

### Scenario 1: Clean Data

**Input:**
```
Juan Valdez - 9:00 AM Clock In
Juan Valdez - 5:00 PM Clock Out
```

**Result:**
- 1 session
- 8.00 hours worked
- 0 noise punches
- 0 anomalies

---

### Scenario 2: Chaotic Test Data (from problem statement)

**Input:**
```
9:56:25 - Clock In
9:56:50 - Break Start
9:57:10 - Clock In
9:57:30 - Clock Out
9:57:50 - Clock In
9:58:10 - Clock Out
11:37:07 - Clock Out
3:49:28 PM - Clock In
3:50:28 PM - Break Start
3:51:27 PM - Clock Out
```

**Processing:**

**Step 1 - Normalize:**
- Detects burst noise in first 5 punches
- Keeps: 9:56:25 Clock In, 9:57:50 Clock In (outside 60s window), 11:37:07 Clock Out
- Keeps: 3:49:28 PM Clock In, 3:51:27 PM Clock Out
- Noise: 4 punches marked

**Step 2 - Identify Sessions:**

Session 1:
```
9:56:25 → 11:37:07 (1h 40m 42s = 100.7 minutes)
Breaks: None (break start was filtered as noise)
Worked: 1h 40m
```

Session 2:
```
3:49:28 PM → 3:51:27 PM (1m 59s)
Breaks: None
Worked: ~2 minutes
Anomaly: "Very short session (< 3 min) - possible error"
```

**Result:**
- 2 sessions identified
- 4 noise punches filtered
- 1 anomaly detected
- Session 1: 1.68 hours
- Session 2: 0.03 hours (flagged)

---

### Scenario 3: Missing Clock Out

**Input:**
```
Maria Lopez - 9:00 AM Clock In
Maria Lopez - 12:00 PM Break Start
Maria Lopez - 12:30 PM Break End
[No Clock Out]
```

**Result:**
```json
{
  "employee_name": "Maria Lopez",
  "clock_in": "9:00 AM",
  "clock_out": null,
  "breaks": [
    {
      "break_start": "12:00 PM",
      "break_end": "12:30 PM",
      "duration_minutes": 30,
      "is_complete": true
    }
  ],
  "is_complete": false,
  "has_anomalies": true,
  "anomalies": ["Incomplete session (missing clock out)"],
  "worked_minutes": 0
}
```

---

### Scenario 4: Incomplete Break

**Input:**
```
Carlos Diaz - 9:00 AM Clock In
Carlos Diaz - 12:00 PM Break Start
Carlos Diaz - 5:00 PM Clock Out
[No Break End]
```

**Result:**
```json
{
  "employee_name": "Carlos Diaz",
  "clock_in": "9:00 AM",
  "clock_out": "5:00 PM",
  "breaks": [
    {
      "break_start": "12:00 PM",
      "break_end": null,
      "duration_minutes": 0,
      "is_complete": false
    }
  ],
  "total_minutes": 480,
  "break_minutes": 0,
  "worked_minutes": 480,
  "is_complete": true,
  "has_anomalies": true,
  "anomalies": ["Incomplete break (missing break end)"]
}
```

## Visualization Integration

The processed data feeds into multiple visualization modes:

1. **Gantt Timeline** - Shows sessions as horizontal bars with break indicators
2. **Card View** - Displays summary cards with anomaly badges
3. **Barcode Stripe** - Compact visualization with 15-minute blocks
4. **Punch Stream** - Debug view showing all punches chronologically with noise annotations
5. **Receipt Style** - Mobile-friendly vertical timeline

## API Usage

```typescript
import { processPunchesForPeriod } from '@/utils/timePunchProcessing';

const result = processPunchesForPeriod(punches);

console.log(`Sessions: ${result.sessions.length}`);
console.log(`Noise punches: ${result.totalNoisePunches}`);
console.log(`Anomalies: ${result.totalAnomalies}`);

// Access individual session data
result.sessions.forEach(session => {
  console.log(`${session.employee_name}: ${session.worked_minutes / 60}h`);
  if (session.has_anomalies) {
    console.log(`⚠️ Anomalies: ${session.anomalies.join(', ')}`);
  }
});
```

## Benefits

✅ **Handles Real-World Chaos**
- POS system button mashing
- Mobile GPS check-in spam
- Network retry duplicates

✅ **Accurate Calculations**
- Proper break deduction
- Session continuity tracking
- Time precision to the minute

✅ **Manager-Friendly**
- Clear anomaly reporting
- Visual noise indicators
- Quick approval workflows

✅ **Audit Trail**
- All punches preserved
- Noise reasons logged
- Anomaly descriptions provided
