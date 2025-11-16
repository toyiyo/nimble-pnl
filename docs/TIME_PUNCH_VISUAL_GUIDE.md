# Time Punch Visualization Modes - Visual Guide

## 1. Gantt Timeline View (Primary Manager View)

```
┌─────────────────────────────────────────────────────────────────┐
│ Horizontal Timeline - Gantt View                               │
│ Visual timeline of employee work sessions for Jan 15, 2024     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│         6a  7a  8a  9a 10a 11a 12p  1p  2p  3p  4p  5p  6p ...│
│ ───────────────────────────────────────────────────────────────│
│ Juan Valdez  ⚠️  ████████████████░░░██████████████          8.5h│
│                  └─ work ──┘break└─── work ────┘             │
│                                                                 │
│ Maria Lopez      ████████████████████████████████░░░████      7.2h│
│                  └────── work ──────────────┘break└work┘      │
│                                                                 │
│ Carlos Diaz          ██████████████████████████████████       6.0h│
│                      └────────── work ──────────────┘         │
│                                                                 │
│ Legend:                                                         │
│ ████ Work session  ░░░ Break time  ████ Incomplete            │
│  ⚠️  Has anomalies                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Use Case**: Daily manager review, pattern detection
**Best For**: Desktop viewing, multiple employees at once

---

## 2. Employee Card View (Quick Approval)

```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Juan Valdez  ⚠️ │ │ Maria Lopez  ✓ │ │ Carlos Diaz  ✓ │
├─────────────────┤ ├─────────────────┤ ├─────────────────┤
│                 │ │                 │ │                 │
│ Shift:          │ │ Shift:          │ │ Shift:          │
│ 9:00 AM→5:30 PM│ │ 8:00 AM→5:00 PM│ │ 10:00 AM→4:00PM│
│                 │ │                 │ │                 │
│ Total: ┏━━━━━┓ │ │ Total: ┏━━━━━┓ │ │ Total: ┏━━━━━┓ │
│        ┃ 8.5h┃ │ │        ┃ 7.2h┃ │ │        ┃ 6.0h┃ │
│        ┗━━━━━┛ │ │        ┗━━━━━┛ │ │        ┗━━━━━┛ │
│                 │ │                 │ │                 │
│ Breaks: 0.5h    │ │ Breaks: 1.8h    │ │ Breaks: 0h      │
│                 │ │                 │ │                 │
│ ⚠️ Anomalies:   │ │ Sessions: 1     │ │ Sessions: 1     │
│ • 2 rapid       │ │                 │ │                 │
│   punches       │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

**Use Case**: Payroll approval, quick scanning
**Best For**: Grid view, mobile-friendly, manager dashboard

---

## 3. Barcode Stripe View (Compact)

```
┌─────────────────────────────────────────────────────────────────┐
│ Barcode Stripe View - Compact Timeline                         │
│ Black bars = work, gray = breaks/off-time                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Juan Valdez    |███░░██░░░████████| 8.5h                       │
│ Maria Lopez    |████████░░░░░█████| 7.2h                       │
│ Carlos Diaz    |░░███████████████░| 6.0h                       │
│ Ana Martinez   |░░░░████░░░░░█████| 5.5h                       │
│ Tom Williams   |███████░██████████| 9.0h                       │
│                                                                 │
│ Legend: █ Work  ░ Break/Off                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Use Case**: High-level pattern scanning, staffing overview
**Best For**: Seeing many employees at once, identifying gaps

---

## 4. Punch Stream View (Debug Mode)

```
┌─────────────────────────────────────────────────────────────────┐
│ Punch Stream Timeline - Debug View                             │
│ Chronological punch log with noise detection                   │
├─────────────────────────────────────────────────────────────────┤
│ Juan Valdez                                     ⚠️ 2 noise     │
│ │                                                               │
│ ●─┬─ Clock In      9:56:25 AM                                 │
│ │ │                                                             │
│ ●─┴─ Break Start   9:56:50 AM  ⚠️ Noise                       │
│ │    ⚠️ Burst noise (>3 punches in 60s)                       │
│ │                                                               │
│ ●─┬─ Clock In      9:57:10 AM  ⚠️ Noise → 20s later          │
│ │ │   ⚠️ Burst noise                                          │
│ │ │                                                             │
│ ●─┴─ Clock Out     11:37:07 AM → 1h 39m later                │
│ │                                                               │
│ ●─┬─ Clock In      3:49:28 PM  → 4h 12m later                │
│ │ │                                                             │
│ ●─┴─ Clock Out     3:51:27 PM  → 2m later                    │
│                                                                 │
│ Total: 8 punches │ Noise: 2 │ Clean: 6                        │
└─────────────────────────────────────────────────────────────────┘
```

**Use Case**: Troubleshooting, investigating anomalies
**Best For**: Admin review, understanding what happened

---

## 5. Receipt Style View (Mobile)

```
┌───────────────────────┐
│ Juan Valdez           │
│ Daily timesheet       │
├───────────────────────┤
│                       │
│ Session 1      ⚠️     │
│ ──────────────────────│
│ IN     9:56:25 AM     │
│                       │
│ OUT   11:37:07 AM     │
│ ──────────────────────│
│ Break time     0.0h   │
│ Total worked   1.68h  │
│                       │
│ ⚠️ 2 rapid punches    │
│                       │
├───────────────────────┤
│                       │
│ Session 2      ⚠️     │
│ ──────────────────────│
│ IN     3:49:28 PM     │
│                       │
│ OUT    3:51:27 PM     │
│ ──────────────────────│
│ Total worked   0.03h  │
│                       │
│ ⚠️ Very short session │
│                       │
├───────────────────────┤
│ Sessions         2    │
│ Total breaks    0.0h  │
│ ──────────────────────│
│ Daily Total    1.71h  │
└───────────────────────┘
```

**Use Case**: Mobile viewing, employee self-service
**Best For**: Phone screens, detailed session review

---

## Anomaly Indicators Across All Views

### Visual Cues:
- **⚠️ Yellow Alert Icon**: Session or employee has anomalies
- **Yellow Border**: Cards/bars with issues highlighted
- **Yellow Background**: Noise punches in stream view
- **Orange/Yellow Bars**: Incomplete sessions in Gantt view

### Types of Anomalies Detected:
1. **Burst noise** - 3+ punches within 60 seconds
2. **Duplicate punches** - 2 identical punches within 60s
3. **Break cancellation** - Break start → clock in < 2 min
4. **Very short session** - Session < 3 minutes (when not only session)
5. **Missing clock out** - Clock in without matching clock out
6. **Incomplete break** - Break start without break end

---

## Choosing the Right View

| Task | Recommended View | Why |
|------|-----------------|-----|
| Daily manager review | Gantt Timeline | See all employees, spot patterns |
| Payroll approval | Employee Cards | Quick scanning, clear totals |
| Staffing patterns | Barcode Stripe | Compact, see coverage gaps |
| Investigate issues | Punch Stream | Detailed chronology, noise marked |
| Mobile check | Receipt Style | Vertical layout, one employee |
| Export for reports | Gantt Timeline | Most comprehensive overview |

---

## Responsive Design

### Desktop (> 1024px):
- Gantt: Full timeline with all employees
- Cards: 3 cards per row
- Barcode: 10-15 employees visible

### Tablet (768px - 1024px):
- Gantt: Horizontal scroll if needed
- Cards: 2 cards per row
- Barcode: 8-10 employees visible

### Mobile (< 768px):
- Gantt: Switches to Receipt Style automatically
- Cards: 1 card per row (stacked)
- Barcode: Simplified with fewer blocks
- Stream: Full vertical layout (native fit)
- Receipt: Optimized for single employee

---

## Tab Navigation

All views are accessible via tabs at the top:

```
┌────────┬────────┬────────┬────────┬────────┐
│ Gantt  │ Cards  │Barcode │ Stream │Receipt │
│   📊   │   📋   │   ▓▓▓  │   💻   │   📝   │
└────────┴────────┴────────┴────────┴────────┘
```

Switching between views is instant - no page reload.
All filters (employee, date) are preserved across views.
