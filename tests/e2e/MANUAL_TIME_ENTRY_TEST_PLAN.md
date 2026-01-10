# Manual Time Entry Drag & Drop - E2E Test Plan

## Application Overview

The Manual Time Entry feature is a drag-and-drop interface for managers to quickly enter employee work hours. Located in the Time Punches Manager page, it provides a visual timeline where managers can:

- **Visual Timeline**: Gantt-style view showing 6am to midnight with hourly grid lines
- **Drag to Create**: Click and drag across an employee's row to create a time block
- **Adjust Edges**: Drag the left/right edges of existing blocks to adjust start/end times
- **Auto-Save**: Time entries automatically save 500ms after drag completion
- **Inline Input**: Text input supporting formats like "9-530", "9a-5:30p", "09:00-17:30"
- **Validation**: Warns when employee hours exceed 12 hours per day
- **Expandable Details**: Click employee name to view/edit individual time blocks
- **Day View Only**: Feature is only accessible in day view mode

## Test Scenarios

### 1. Navigation and Access

#### 1.1 Access Manual Time Entry Mode
**Steps:**
1. Sign up with unique test user credentials
2. Create a test restaurant
3. Navigate to "Time Punches" page via main navigation
4. Ensure view mode is set to "Day" (if not, click "Day" button)
5. Click on the "Manual" tab/visualization mode

**Expected Results:**
- Manual Time Entry interface is displayed
- Timeline shows 6am to midnight with 2-hour interval labels (6a, 8a, 10a, 12p, 2p, 4p, 6p, 8p, 10p)
- Header shows "Manual Time Entry" with subtitle "Drag across rows to mark when people worked"
- All active employees are listed with their name on the left
- Empty state message if no employees exist

#### 1.2 Verify Manual Mode Only Available in Day View
**Steps:**
1. Navigate to Manual tab
2. Switch to "Week" view mode
3. Observe the interface
4. Switch to "Month" view mode
5. Observe the interface
6. Switch back to "Day" view mode

**Expected Results:**
- In Week view: Card displays "Manual time entry is only available in day view..."
- In Month view: Card displays same message
- In Day view: Full timeline interface is restored
- No errors occur when switching between views

---

### 2. Creating Time Blocks via Drag and Drop

#### 2.1 Create Single Time Block by Dragging
**Prerequisites:** At least one employee exists in the restaurant

**Steps:**
1. Navigate to Manual Time Entry (day view)
2. Locate an employee row without existing time blocks
3. Click and hold at approximately 9am position on the timeline
4. Drag cursor to approximately 5pm position
5. Release mouse button
6. Wait 1 second for auto-save

**Expected Results:**
- Blue time block appears immediately upon dragging
- Block spans from 9am to 5pm (approximately)
- Block snaps to 15-minute intervals
- Block displays primary color (blue) while dragging
- Block pulses briefly during save (animate-pulse)
- After save: Block stops pulsing and remains solid blue
- Total hours updates to "8.0h" in the employee's right column
- Green check mark appears next to hours
- "Saved" badge appears in header with green background

#### 2.2 Create Multiple Time Blocks for Same Employee
**Prerequisites:** Employee with no existing time blocks

**Steps:**
1. Create first time block: 6am to 10am (drag and release)
2. Wait 1 second for auto-save
3. Create second time block: 2pm to 6pm (drag and release)
4. Wait 1 second for auto-save
5. Verify both blocks persist

**Expected Results:**
- First block: 6am-10am (4 hours)
- Second block: 2pm-6pm (4 hours)
- Total hours displays "8.0h"
- Both blocks saved independently
- No overlap or collision between blocks
- Each block animates pulse during its own save

#### 2.3 Create Time Blocks Across Multiple Employees
**Prerequisites:** At least 3 employees exist

**Steps:**
1. Create time block for Employee A: 8am to 4pm
2. Wait for auto-save
3. Create time block for Employee B: 9am to 5pm
4. Wait for auto-save
5. Create time block for Employee C: 7am to 3pm
6. Wait for auto-save

**Expected Results:**
- Each employee shows their own time block on their row
- No cross-contamination between employee rows
- Total hours summary at bottom shows sum: "24.0h"
- Each employee's individual hour count is correct
- All blocks persist after page refresh

---

### 3. Adjusting Existing Time Blocks

#### 3.1 Extend Block End Time (Drag Right Edge)
**Prerequisites:** Employee with time block 9am-5pm (8 hours)

**Steps:**
1. Hover over the right edge of the time block
2. Cursor changes to resize cursor (ew-resize)
3. Click and hold the right edge
4. Drag right to approximately 6pm position
5. Release mouse button
6. Wait for auto-save

**Expected Results:**
- Right edge follows mouse cursor during drag
- Block extends to 6pm
- Total hours updates to "9.0h"
- Block pulses during save
- Adjustment persists after refresh

#### 3.2 Shorten Block Start Time (Drag Left Edge Right)
**Prerequisites:** Employee with time block 9am-5pm (8 hours)

**Steps:**
1. Hover over the left edge of the time block
2. Cursor changes to resize cursor (ew-resize)
3. Click and hold the left edge
4. Drag right to approximately 10am position
5. Release mouse button
6. Wait for auto-save

**Expected Results:**
- Left edge follows mouse cursor during drag
- Block starts at 10am instead of 9am
- Total hours updates to "7.0h"
- Block pulses during save
- Cannot drag left edge past right edge (validation)

#### 3.3 Extend Block Start Time (Drag Left Edge Left)
**Prerequisites:** Employee with time block 10am-5pm (7 hours)

**Steps:**
1. Click and drag left edge from 10am to 8am
2. Release and wait for auto-save

**Expected Results:**
- Block starts at 8am
- Total hours updates to "9.0h"
- Adjustment saves successfully

#### 3.4 Adjust Multiple Blocks in Quick Succession
**Prerequisites:** Employee with two blocks: 9am-12pm, 1pm-5pm

**Steps:**
1. Extend first block right edge to 12:30pm
2. Wait for auto-save
3. Extend second block left edge to 12:30pm
4. Wait for auto-save
5. Verify both adjustments persist

**Expected Results:**
- First block: 9am-12:30pm (3.5h)
- Second block: 12:30pm-5pm (4.5h)
- Total: 8.0h
- Both adjustments saved independently
- No data loss or race conditions

---

### 4. Inline Text Input for Time Blocks

#### 4.1 Add Time Block Using Shorthand Format (9-530)
**Prerequisites:** Employee exists

**Steps:**
1. Click employee name to expand inline editor
2. In "Add time block" input field, type: `9-530`
3. Press Enter key

**Expected Results:**
- Time block created: 9:00 AM to 5:30 PM
- Block appears on timeline immediately
- Total hours shows "8.5h"
- Input field clears after pressing Enter
- Block is listed in expanded "Time blocks" section

#### 4.2 Add Time Block Using AM/PM Format (9a-5:30p)
**Steps:**
1. Expand employee editor
2. Type: `9a-5:30p`
3. Click "Add" button (instead of Enter)

**Expected Results:**
- Time block created: 9:00 AM to 5:30 PM
- Block appears on timeline
- Input field clears after clicking Add

#### 4.3 Add Time Block Using 24-Hour Format (09:00-17:30)
**Steps:**
1. Expand employee editor
2. Type: `09:00-17:30`
3. Press Enter

**Expected Results:**
- Time block created: 9:00 AM to 5:30 PM
- Correctly interprets 24-hour format
- Block appears on timeline

#### 4.4 Invalid Format Handling
**Steps:**
1. Expand employee editor
2. Type: `invalid text`
3. Press Enter
4. Observe error message

**Expected Results:**
- Toast notification appears with error
- Title: "Invalid format"
- Description: "Try: 9-530, 9a-5:30p, or 09:00-17:30"
- Variant: destructive (red)
- No block is created
- Input field retains the invalid text

#### 4.5 Add Multiple Blocks via Text Input
**Steps:**
1. Expand employee editor
2. Add first block: `7-11` (press Enter)
3. Add second block: `12-4` (press Enter)
4. Add third block: `5-9` (press Enter)

**Expected Results:**
- Three separate blocks created
- First: 7am-11am (4h)
- Second: 12pm-4pm (4h)
- Third: 5pm-9pm (4h)
- Total hours: 12.0h
- All blocks visible on timeline and in list

---

### 5. Validation and Warning States

#### 5.1 Warning for Over 12 Hours
**Prerequisites:** Employee with no existing blocks

**Steps:**
1. Create time block: 6am to 8pm (14 hours)
2. Wait for auto-save
3. Observe warning indicators

**Expected Results:**
- Total hours shows "14.0h"
- Yellow warning badge appears in right column
- Badge text: "Over 12 hours"
- Badge icon: AlertCircle (yellow)
- No green check mark appears
- Warning persists after refresh

#### 5.2 Warning Appears When Total Exceeds 12 Hours
**Prerequisites:** Employee with existing 10-hour block

**Steps:**
1. Add second block of 3 hours
2. Wait for auto-save
3. Observe warning state change

**Expected Results:**
- Before second block: Green check, 10.0h
- After second block: Yellow warning, 13.0h
- Warning text: "Over 12 hours"

#### 5.3 Warning Clears When Hours Reduced
**Prerequisites:** Employee with 14 hours showing warning

**Steps:**
1. Delete one time block to bring total under 12 hours
2. Observe warning disappears

**Expected Results:**
- Warning badge removed
- Green check mark appears
- Total hours reflects reduction

---

### 6. Expanding Employee Details and Block Management

#### 6.1 Expand/Collapse Employee Row
**Steps:**
1. Click on employee name (left side)
2. Observe expanded section appears
3. Click employee name again
4. Observe section collapses

**Expected Results:**
- First click: ChevronDown changes to ChevronUp
- Expanded section shows:
  - "Add time block" input field with placeholder text
  - Format examples: "e.g., 9-530, 9a-5:30p"
  - List of existing time blocks (if any)
- Second click: Section collapses, ChevronUp changes to ChevronDown

#### 6.2 View Time Blocks in Expanded Section
**Prerequisites:** Employee with 2 time blocks: 9am-12pm, 1pm-5pm

**Steps:**
1. Expand employee row
2. Review "Time blocks" list

**Expected Results:**
- Two blocks listed
- First block: "9:00 AM → 12:00 PM (3.0h)"
- Second block: "1:00 PM → 5:00 PM (4.0h)"
- Each block has "Delete" button
- Blocks display in chronological order

#### 6.3 Delete Time Block from Expanded View
**Prerequisites:** Employee with 2 time blocks

**Steps:**
1. Expand employee row
2. Click "Delete" button on first time block
3. Confirm deletion (if dialog appears)
4. Observe block removal

**Expected Results:**
- Deleted block immediately removed from list
- Deleted block immediately removed from timeline
- Total hours recalculated
- Remaining block still visible
- Changes persist after refresh

#### 6.4 Delete Last Block for Employee
**Prerequisites:** Employee with 1 time block

**Steps:**
1. Expand employee row
2. Click "Delete" on the only block
3. Observe empty state

**Expected Results:**
- Block removed from list and timeline
- Total hours shows "0.0h"
- No warning or check icon
- "Time blocks" section empty or shows empty state
- Employee row remains in list

---

### 7. Auto-Save Functionality

#### 7.1 Auto-Save Triggers After Drag
**Steps:**
1. Create time block by dragging 9am-5pm
2. Immediately after releasing mouse, observe save indicator
3. Wait 500ms
4. Observe save completion

**Expected Results:**
- Block pulses (animate-pulse) for ~500ms
- "Saved" badge appears in header after 500ms
- Badge has green background and check icon
- Block stops pulsing after save completes

#### 7.2 Auto-Save Debouncing (Multiple Rapid Edits)
**Steps:**
1. Create time block 9am-5pm
2. Wait for save
3. Quickly drag right edge to 6pm
4. Before save completes, drag again to 7pm
5. Release and wait

**Expected Results:**
- Only one final save occurs (debounced)
- Final state: 9am-7pm
- No duplicate punch records created
- Total hours accurate: 10.0h

#### 7.3 Verify Data Persists After Refresh
**Prerequisites:** Employee with 2 time blocks created

**Steps:**
1. Note current time blocks and hours
2. Refresh page (F5 or CMD+R)
3. Navigate back to Manual mode in day view
4. Verify data is unchanged

**Expected Results:**
- All time blocks present after refresh
- Start and end times match exactly
- Total hours unchanged
- No data loss

#### 7.4 Save State Indicator
**Steps:**
1. Create time block
2. Observe "Saved" badge in header
3. Make adjustment to block
4. Observe badge during save

**Expected Results:**
- Badge appears after first save
- Badge may briefly disappear during subsequent edit
- Badge reappears after adjustment saves
- Badge is green with check icon

---

### 8. Time Snapping and Grid Alignment

#### 8.1 Blocks Snap to 15-Minute Intervals
**Steps:**
1. Drag to create block starting at approximately 9:07am
2. Drag end to approximately 5:23pm
3. Release and observe final times

**Expected Results:**
- Start time snaps to nearest 15-min: 9:00 AM or 9:15 AM
- End time snaps to nearest 15-min: 5:15 PM or 5:30 PM
- Block aligns cleanly with grid
- Times displayed in expanded view match snapped values

#### 8.2 Grid Lines Visible for Alignment
**Steps:**
1. Observe timeline without any blocks
2. Identify vertical grid lines

**Expected Results:**
- Vertical lines at every hour mark (18 lines for 6am-12am)
- Lines are subtle (border-border/30 color)
- Lines help visual alignment during drag
- Hours labeled at top every 2 hours

---

### 9. Summary and Total Hours

#### 9.1 Footer Shows Total Hours for Day
**Prerequisites:** 3 employees with time blocks:
- Employee A: 8 hours
- Employee B: 6 hours
- Employee C: 7 hours

**Steps:**
1. View bottom of Manual Time Entry card
2. Observe footer summary

**Expected Results:**
- Footer displays: "Total hours for [date]"
- Date format: "Jan 9, 2026" (month abbreviation, day, year)
- Right side shows: "21.0h" (sum of all employee hours)
- Font is large and bold for total

#### 9.2 Total Updates in Real-Time
**Steps:**
1. Note current total hours (e.g., "15.0h")
2. Add new 5-hour block for an employee
3. Observe total updates without refresh

**Expected Results:**
- Total immediately updates to "20.0h"
- No page refresh required
- Calculation is accurate

---

### 10. Edge Cases and Error Handling

#### 10.1 Empty Employee List
**Steps:**
1. Create new restaurant with zero employees
2. Navigate to Manual Time Entry

**Expected Results:**
- Message: "No employees to display"
- Centered in card content
- No timeline or rows visible
- No errors in console

#### 10.2 Drag Without Moving Mouse (Click Only)
**Steps:**
1. Click on timeline at 9am position
2. Immediately release without moving mouse
3. Observe behavior

**Expected Results:**
- Either: No block created (requires minimum drag distance)
- Or: Very small block created and can be adjusted
- No error occurs

#### 10.3 Drag Start After End (Invalid Direction)
**Steps:**
1. Click at 5pm and drag left to 9am (backwards)
2. Release

**Expected Results:**
- Block is NOT created (validation prevents start >= end)
- Or: Block is created with corrected order (9am start, 5pm end)
- No error toast shown

#### 10.4 Drag Outside Timeline Boundaries
**Steps:**
1. Drag block starting before 6am or extending after midnight
2. Release

**Expected Results:**
- Block is clamped to 6am-midnight range
- Or: Block cannot extend beyond boundaries
- No visual glitches

#### 10.5 Simultaneous Edits (Multiple Blocks Being Adjusted)
**Steps:**
1. Create 3 time blocks for same employee
2. Quickly adjust all 3 blocks in rapid succession (within 1 second)
3. Wait for all saves to complete

**Expected Results:**
- All adjustments save successfully
- No race conditions or data corruption
- Final state matches last user action
- Total hours accurate

#### 10.6 Network Failure During Save
**Prerequisites:** Ability to simulate offline mode

**Steps:**
1. Create time block by dragging
2. Before save completes, disable network (browser DevTools offline mode)
3. Wait for save attempt
4. Observe error handling

**Expected Results:**
- Error toast appears indicating save failed
- Block may remain in "saving" state or show error indicator
- When network restored, retry or manual refresh shows correct state
- No partial/corrupt data saved

---

### 11. Responsive Behavior (Desktop Only)

**Note:** The ManualTimelineEditor component is desktop-only (hidden on mobile with `hidden md:block` class). Mobile users see MobileTimeEntry component instead.

#### 11.1 Verify Desktop-Only Display
**Steps:**
1. Open Manual Time Entry in desktop viewport (>768px width)
2. Verify timeline editor is visible
3. Resize browser to mobile width (<768px)
4. Observe component switch

**Expected Results:**
- Desktop (≥768px): ManualTimelineEditor with timeline visible
- Mobile (<768px): MobileTimeEntry component visible instead
- No layout breakage during resize

#### 11.2 Horizontal Scrolling (If Needed)
**Steps:**
1. Test on narrow desktop viewport (e.g., 1024px wide)
2. Create multiple time blocks
3. Observe horizontal scrolling behavior

**Expected Results:**
- Timeline may require horizontal scroll if viewport is narrow
- Scrollbar appears if needed
- Employee names remain visible (sticky or scrolls naturally)
- No overlapping UI elements

---

### 12. Integration with Other Views

#### 12.1 Blocks Created in Manual Mode Appear in Gantt View
**Steps:**
1. In Manual mode, create time block 9am-5pm for Employee A
2. Wait for auto-save
3. Switch to "Gantt" visualization mode (or Gantt tab)
4. Verify block appears

**Expected Results:**
- Same time block visible in Gantt view
- Times match exactly: 9am-5pm
- Employee name associated correctly
- Data is consistent across views

#### 12.2 Blocks Appear in Table View
**Steps:**
1. Create 2 time blocks in Manual mode
2. Wait for auto-save
3. Expand "Detailed Punch List" collapsible section at bottom
4. Verify punches listed

**Expected Results:**
- Table shows 4 punch records (2 clock_in, 2 clock_out)
- Each clock_in has notes: "Manual entry by manager"
- Each clock_out has notes: "Manual entry by manager"
- Punch times match the visual blocks
- Punch type badges: "Clock In" and "Clock Out"

#### 12.3 Manual Entries Included in Payroll Calculations
**Prerequisites:** Employee with hourly rate set

**Steps:**
1. Create 8-hour time block in Manual mode for hourly employee
2. Navigate to Payroll page
3. Find employee in payroll report

**Expected Results:**
- Employee's hours include the 8 hours from manual entry
- Pay calculation is accurate (8 × hourly rate)
- Manual entries treated identically to kiosk punches

---

### 13. User Permissions (Manager Only)

#### 13.1 Verify Manager Can Access Manual Mode
**Prerequisites:** User with "manager" role for restaurant

**Steps:**
1. Log in as manager
2. Navigate to Time Punches → Manual mode

**Expected Results:**
- Manual mode tab is visible
- Full functionality accessible
- Can create and edit time blocks

#### 13.2 Verify Staff/Employee Cannot Access (If Applicable)
**Prerequisites:** User with "staff" or "employee" role

**Steps:**
1. Log in as non-manager user
2. Navigate to Time Punches page
3. Attempt to access Manual mode

**Expected Results:**
- Manual mode tab is either:
  - Hidden entirely, OR
  - Visible but disabled with permission message
- No ability to create/edit time blocks

---

## Test Data Requirements

### Minimum Setup for Full Testing:
- **1 Restaurant**: Test restaurant with unique name
- **3-5 Active Employees**: With names like "Alice Test", "Bob Test", "Charlie Test"
- **Date Selection**: Current date or specific test date in Day view
- **Clean State**: No existing time punches for test date (or known baseline)

### Recommended Employee Setup:
```
Employee A: No existing time blocks (fresh state testing)
Employee B: 1 existing time block: 8am-12pm (4 hours)
Employee C: 2 existing time blocks: 7am-11am, 1pm-5pm (8 hours)
Employee D: Existing blocks totaling 13 hours (over 12-hour warning)
```

---

## Performance Considerations

### Expected Behavior:
- **Drag Responsiveness**: Block should follow mouse cursor smoothly without lag (<50ms latency)
- **Auto-Save Time**: 500ms debounce after drag completion
- **Save Confirmation**: Visual feedback within 1 second of save completion
- **Page Load**: Existing blocks should render within 2 seconds of page load
- **Large Dataset**: Interface should remain responsive with 50+ employees and 200+ time blocks

---

## Accessibility Notes

### Keyboard Navigation:
- **Tab Order**: Employee names → Inline inputs → Add buttons → Delete buttons
- **Enter Key**: Submits inline time input
- **Escape Key**: (Optional) Cancel ongoing drag operation

### Screen Reader Support:
- Time blocks should have descriptive labels
- Save state changes announced
- Error messages read aloud

---

## Notes for Test Implementation

1. **Setup Pattern**: Use `generateTestUser()` pattern from existing E2E tests
2. **Supabase Helpers**: May need `exposeSupabaseHelpers(page)` for direct employee creation
3. **Wait Strategies**: Use `page.waitForTimeout(600)` after drag to ensure auto-save completes
4. **Drag Implementation**: Use Playwright's `page.mouse.move()` and `page.mouse.down/up()` for precise drag control
5. **Visual Regression**: Consider screenshot comparison for block positioning accuracy
6. **Test Isolation**: Each test should create fresh employees to avoid conflicts

---

## Success Criteria

All scenarios must pass with:
- ✅ No console errors
- ✅ No network errors (except intentional offline tests)
- ✅ Data persists correctly after page refresh
- ✅ Visual indicators (pulsing, saved badge) appear as specified
- ✅ Total hours calculations are mathematically correct
- ✅ No race conditions or data corruption
- ✅ Consistent behavior across all supported browsers (Chromium, Firefox, WebKit)

---

## Future Test Scenarios (Out of Scope for Initial E2E)

- Concurrent editing by multiple managers (conflict resolution)
- Undo/Redo functionality (if implemented)
- Copy/paste time blocks between employees
- Bulk operations (e.g., apply same schedule to multiple employees)
- Integration with shift scheduling (if blocks should align with scheduled shifts)
- Timezone handling for multi-location restaurants
- Historical data editing (past dates vs. future dates)

---

**Test Plan Version:** 1.0  
**Last Updated:** January 9, 2026  
**Created by:** GitHub Copilot (Claude Sonnet 4.5)
