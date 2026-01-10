# Manual Time Entry Feature

## Overview

The Manual Time Entry feature provides managers with a modern, intuitive interface to quickly record employee work hours. It follows Apple/Notion design principles: direct manipulation, low chrome, progressive disclosure, and zero jargon.

## User Intent

**"I already know the hours. Let me quickly reflect reality."**

The system treats this as manager attestation, not a reconstruction of POS punches.

## Access

**Navigation**: Labor → Time Punches → Manual Tab

**Requirements**:
- Manager or Owner role
- Day view only (shows message for week/month views)

## Desktop Experience

### Primary View: Timeline Grid

#### Visual Layout
```
Employee Name   | 6a  8a  10a  12p  2p  4p  6p  8p  10p
---------------------------------------------------
Maria Lopez     | ━━━━━━━━■■■■■■■■■■■━━━━━━  8.5h ✓
Juan Perez      | ━━━━━■■■■■■■■━━━━━━━━━━━━  6.0h ✓
Ana Gomez       | ━━━━━━━■■■■■■■■■■■■■━━━━━ 10.5h ⚠️
```

#### Key Visual Elements
- **Hour markers**: 6am through midnight (12am)
- **Grid lines**: Subtle vertical lines at each hour
- **Time blocks**: Solid blue bars showing work hours
- **Status indicators**:
  - ✓ Green checkmark = valid entry
  - ⚠️ Yellow warning = over 12 hours
- **Real-time totals**: Displayed on the right of each row

### Primary Interaction: Direct Manipulation

#### 1. Drag to Create
1. Click anywhere in an empty row
2. Drag horizontally across the timeline
3. A blue bar appears and stretches with your mouse
4. Release to create the time block
5. Auto-saves after 500ms

**Visual Feedback**:
- Time labels float above the bar while dragging
- Bar snaps to 5-minute increments
- "Saved" indicator appears briefly after save

#### 2. Drag to Adjust
1. Hover over an existing time block
2. Edges show resize cursors
3. Drag left edge to adjust start time
4. Drag right edge to adjust end time
5. Auto-saves after 500ms

**Constraints**:
- Start time must be before end time
- Snaps to 5-minute increments
- Visual feedback during drag

### Secondary Interaction: Inline Edit

#### Keyboard Entry Mode
1. Click employee name or hours total
2. Row expands vertically (Notion-style)
3. Shows detailed editor:

```
Maria Lopez
[ 09:00 AM ] → [ 05:30 PM ]   Total: 8.5h
+ Add another block

Formats supported:
- 9-530      → 9:00 AM to 5:30 PM
- 9a-5:30p   → 9:00 AM to 5:30 PM
- 09:00-17:30 → 9:00 AM to 5:30 PM
- 9am-5pm    → 9:00 AM to 5:00 PM
```

#### Smart Parsing
The system intelligently parses various time formats:
- **Compact**: `9-5` → 9:00 to 5:00
- **With minutes**: `9-530` → 9:00 to 5:30
- **AM/PM**: `9a-5:30p` → 9:00 AM to 5:30 PM
- **Full format**: `9:00am-5:30pm`
- **24-hour**: `09:00-17:30`

#### Managing Multiple Blocks
- Click "+ Add another block" for split shifts
- Each block can be edited independently
- Delete unwanted blocks with trash icon
- Perfect for breaks or double shifts

## Mobile Experience

### Vertical Card Layout

```
┌─────────────────────────────────┐
│ Maria Lopez                     │
│ Server                          │
│                         8.5h ✓ │
└─────────────────────────────────┘
  ▼ Tap to expand
```

### Expanded View
```
┌─────────────────────────────────┐
│ Maria Lopez                     │
│ Server                  8.5h ✓ │
├─────────────────────────────────┤
│ 9:00 AM - 5:30 PM      8.5h    │
│                                 │
│ Start time                      │
│ ●━━━━━━━━━━━━━━━━━━━○          │
│ 6a    9a    12p   3p    6p      │
│                                 │
│ End time                        │
│ ○━━━━━━━━━━━━━━━━━━━●          │
│ 6a    9a    12p   3p    6p      │
│                                 │
│ [ + Add time block ]            │
└─────────────────────────────────┘
```

### Mobile Interactions
- **Tap card** to expand/collapse
- **Drag sliders** to adjust start/end times
- **Large touch targets** for easy manipulation
- **Real-time feedback** as you drag
- **Auto-saves** on slider release

## Visual Feedback System

### Status Indicators

#### Valid Entry ✓
- Green checkmark displayed
- No warnings
- Hours within normal range

#### Warning State ⚠️
Shows when:
- Total hours > 12 in a day
- (Future) Overlapping time blocks
- (Future) Missing employee rate

#### Saving State
- Block shows pulse animation
- "Saving..." indicator (brief)
- "Saved" confirmation (fades after 2s)

### Footer Summary
```
┌─────────────────────────────────────────────────────┐
│ Total hours for January 15, 2024:          34.5h   │
└─────────────────────────────────────────────────────┘
```

Shows aggregate hours across all employees for the day.

## Auto-Save Mechanism

### Default Behavior
1. User makes a change (drag, type, adjust)
2. System waits 500ms for additional changes
3. Automatically saves to database
4. "Saved" indicator appears and fades

### Benefits
- No "Save" button cluttering the interface
- Natural workflow like Apple Notes
- Can't forget to save
- Immediate feedback

### What Gets Saved
Each time block creates/updates two time_punches records:
- **clock_in** punch with start time
- **clock_out** punch with end time
- Notes: "Manual entry by manager"

## Data Integration

### Database Schema
```typescript
interface TimePunch {
  id: string;
  restaurant_id: string;
  employee_id: string;
  punch_type: 'clock_in' | 'clock_out';
  punch_time: string; // ISO 8601
  notes?: string;
  created_by?: string;
  modified_by?: string;
}
```

### Manual Entry Pattern
Each visual time block maps to two punch records:

**Example**: Block from 9:00 AM to 5:30 PM creates:
1. Punch `{ punch_type: 'clock_in', punch_time: '2024-01-15T09:00:00Z', notes: 'Manual entry by manager' }`
2. Punch `{ punch_type: 'clock_out', punch_time: '2024-01-15T17:30:00Z', notes: 'Manual entry by manager' }`

### Integration with Existing System
- Works alongside existing time clock punches
- Uses same `time_punches` table
- Triggers same P&L calculations
- Visible in all time tracking views
- No conflicts with POS data

## Use Cases

### 1. Quick Correction
**Scenario**: Employee forgot to clock out
**Flow**:
1. Navigate to Manual tab
2. Drag across employee's row for their shift
3. Auto-saves immediately
4. P&L updates automatically

**Time**: < 10 seconds

### 2. Bulk Entry for New Staff
**Scenario**: New employees before time clock setup
**Flow**:
1. View list of all employees
2. Drag time blocks for each employee
3. Multiple employees can be done rapidly
4. All save automatically

**Time**: ~5 seconds per employee

### 3. Paper Timesheet Migration
**Scenario**: Converting paper records to digital
**Flow**:
1. Use inline edit mode for precision
2. Type: "8-4:30" for each entry
3. Add multiple blocks for split shifts
4. System handles parsing and validation

**Time**: ~15 seconds per employee

### 4. Split Shift Entry
**Scenario**: Employee works lunch and dinner
**Flow**:
1. Click employee to expand
2. Add first block: "11a-2p"
3. Add second block: "5p-10p"
4. Both blocks save independently

**Time**: ~20 seconds

## Edge Cases & Validation

### Handled Automatically
- ✅ Overlapping blocks (visual warning)
- ✅ Overtime detection (>12 hours)
- ✅ Invalid time ranges (rejected)
- ✅ Past midnight shifts (not yet supported)
- ✅ Snap to 5-minute intervals
- ✅ Whitespace in input (stripped)

### User Feedback
- 🔴 Red indicator for invalid input
- 🟡 Yellow warning for concerns
- 🟢 Green checkmark for valid
- 💬 Tooltip with explanation

## Accessibility

### Keyboard Navigation
- Tab through employees
- Enter to expand/collapse
- Arrow keys to navigate time inputs
- Escape to cancel edits

### Screen Readers
- All elements have aria-labels
- Time blocks announce duration
- Status changes are announced
- Instructions provided on first use

### Touch Targets
- Minimum 44px touch target size
- Large drag handles on mobile
- Sufficient spacing between elements
- Clear visual feedback on touch

## Technical Details

### Components
- **ManualTimelineEditor.tsx**: Desktop timeline view
- **MobileTimeEntry.tsx**: Mobile slider interface
- **Integration**: TimePunchesManager.tsx

### Hooks Used
- `useTimePunches`: Fetch existing punches
- `useCreateTimePunch`: Create new entries
- `useUpdateTimePunch`: Modify entries
- `useDeleteTimePunch`: Remove entries
- `useEmployees`: Get employee list

### State Management
- Local state for UI interactions
- React Query for server synchronization
- Optimistic updates for snappy UX
- Debounced saves (500ms)

### Performance
- Only renders visible employees
- Memoized calculations
- Efficient re-renders
- Lazy loading for large teams

## Future Enhancements

### Planned Features
- [ ] Split shift hover "+" button
- [ ] Ghost bars for POS punch data
- [ ] Audit trail hover ("Edited by X at Y")
- [ ] Overnight shift support
- [ ] Bulk copy from previous day
- [ ] Template shifts (e.g., "Standard 9-5")
- [ ] Export to CSV
- [ ] Keyboard shortcuts

### Technical Improvements
- [ ] Undo/redo functionality
- [ ] Offline mode support
- [ ] Real-time collaboration
- [ ] Advanced conflict resolution

## Best Practices

### For Managers
1. **Use Manual entry for exceptions**, not daily routine
2. **Verify totals** before closing out the day
3. **Add notes** for unusual entries (inline editor)
4. **Review warnings** - don't ignore yellow badges
5. **Split complex shifts** - use multiple blocks

### For Developers
1. **Always test with real data** - edge cases matter
2. **Maintain time precision** - round consistently
3. **Preserve audit trail** - track all modifications
4. **Handle timezones** properly in calculations
5. **Test mobile thoroughly** - touch is different

## Support & Troubleshooting

### Common Issues

**Q: Time block won't save**
- Check internet connection
- Verify you have manager permissions
- Try refreshing the page

**Q: Can't create overlapping shifts**
- This is intentional to prevent errors
- Delete the old block first, then create new

**Q: Mobile sliders too sensitive**
- Zoom out on your device for better precision
- Use two fingers to drag more slowly

**Q: Where did my entry go?**
- Check you're viewing the correct date
- Verify restaurant selection
- Look in other visualization tabs

## Metrics & Success

### Key Performance Indicators
- Time to enter one employee: < 10 seconds
- Entry accuracy: 99%+ (vs. manual clock)
- Mobile usage: 40%+ of entries
- User satisfaction: Target 4.5/5 stars

### User Feedback (Target)
- "So much faster than our old system"
- "Love the drag-to-create feature"
- "Mobile version is a game changer"
- "Finally, time entry that doesn't suck"

---

## Summary

The Manual Time Entry feature transforms a tedious administrative task into a quick, visual, and even enjoyable experience. By following Apple's design principles and focusing on the core user intent—"I already know the hours"—we've created a tool that managers actually want to use.

**One-sentence framing**: "Managers visually mark when people worked — as easily as highlighting text."
