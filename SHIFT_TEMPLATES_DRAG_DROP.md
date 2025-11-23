# Shift Templates and Drag-and-Drop Scheduling

## Overview
This feature set enhances the scheduling system with reusable shift templates and intuitive drag-and-drop functionality, making it faster and easier to create and manage employee schedules.

## Features

### 1. Shift Templates

#### What are Shift Templates?
Shift templates are reusable schedule patterns that define a shift's day of week, time range, position, and break duration. They allow managers to quickly create recurring shifts without manually entering the same information repeatedly.

#### Creating a Template
1. Navigate to **Scheduling** page
2. Click on the **Templates** tab
3. Click **"New Template"** button
4. Fill in the template details:
   - **Template Name**: e.g., "Morning Server Shift"
   - **Day of Week**: Sunday through Saturday
   - **Position**: Server, Cook, Bartender, etc.
   - **Start Time**: HH:MM format
   - **End Time**: HH:MM format
   - **Break Duration**: Minutes (optional)
5. Click **"Create Template"**

#### Managing Templates
Templates are organized by day of week for easy browsing:
- **Edit**: Click the edit icon on any template card
- **Delete**: Click the trash icon with confirmation
- **View**: See all templates grouped by day
- **Apply**: Use templates when creating shifts

#### Template Validation
- Template name is required
- End time must be after start time
- Break duration must be 0 or greater
- Day of week must be Sunday (0) through Saturday (6)

### 2. Copy Previous Week

#### What it does
Creates exact copies of all shifts from the previous week, automatically adjusting dates by 7 days forward while preserving times, employees, and other details.

#### How to use
1. Navigate to the week you want to populate
2. Click **"Copy Previous Week"** button in the schedule header
3. Confirm the operation
4. All shifts from 7 days earlier are duplicated

#### Use Cases
- Repeating weekly schedules
- Consistent staffing patterns
- Quick schedule generation for similar weeks

#### Notes
- Only copies shifts from exactly 7 days prior
- If no shifts exist in the previous week, an error is displayed
- All copied shifts start with "scheduled" status
- Preserves employee assignments, positions, and times

### 3. Drag-and-Drop Scheduling

#### Dragging Shifts
Each shift card has a **grip handle** (vertical dots icon) that appears on hover:
1. Click and hold the grip handle
2. Drag the shift card to a new location
3. Release to drop

#### What You Can Drag
- **Between Employees**: Move a shift from one employee to another
- **Between Dates**: Move a shift to a different day of the week
- **Within Same Cell**: Reorder shifts for the same employee on the same day

#### Visual Feedback
- **Highlighted Drop Zones**: Cells glow blue when you can drop a shift
- **Semi-transparent Drag**: The shift being dragged appears faded
- **Ring Highlight**: Selected shifts have a blue ring
- **Smooth Animations**: All movements animate smoothly

#### Time Preservation
When dragging shifts to different dates:
- Start and end times are preserved
- Only the date changes
- Break duration stays the same
- Position and status remain unchanged

#### Activation Threshold
- Requires 8 pixels of movement before drag activates
- Prevents accidental drags when clicking
- Click normally to edit or select

### 4. Multi-Select Operations

#### Selecting Multiple Shifts
1. Hold **Ctrl** (Windows/Linux) or **Cmd** (Mac)
2. Click on shift cards to add to selection
3. Click again to deselect
4. Release modifier key when done

#### Selection Indicators
- **Blue Ring**: Selected shifts have a visible ring
- **Count Badge**: Header shows "X selected" with count
- **Clear Button**: X icon in badge to clear selection

#### Bulk Operations
Once shifts are selected:
- **Bulk Delete**: Click "Delete Selected" button
  - Shows confirmation with count
  - Deletes all selected shifts at once
  - Cannot be undone

#### Use Cases
- Delete multiple shifts for an employee taking time off
- Remove old or incorrect shifts in bulk
- Clean up schedule quickly

### 5. Schedule Grid Enhancements

#### Improved Layout
- **Sticky Employee Column**: Employee names stay visible when scrolling
- **Hover Effects**: Rows and cards highlight on hover
- **Compact Design**: Fits more information in less space
- **Responsive**: Works on tablets and desktops

#### Quick Actions
- **Add Button**: In each cell to quickly add a shift
- **Edit on Click**: Click any shift card to edit
- **Inline Actions**: Edit and delete buttons appear on hover
- **Week Navigation**: Previous/Today/Next buttons

## Technical Details

### Database Schema
Uses existing `shift_templates` table:
```sql
CREATE TABLE shift_templates (
  id UUID PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_duration INTEGER NOT NULL DEFAULT 0,
  position TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### React Query Integration
All operations use React Query for:
- Automatic cache invalidation
- Optimistic updates
- Loading states
- Error handling
- Retry logic

### Drag-and-Drop Library
Uses `@dnd-kit` for modern, accessible drag-and-drop:
- **Keyboard support**: Tab to focus, Space/Enter to activate
- **Screen reader friendly**: ARIA labels and announcements
- **Touch support**: Works on touch devices
- **Collision detection**: Smart drop zone detection

### Security
- All operations respect Row Level Security (RLS)
- Users can only access templates for their restaurants
- Shift modifications require owner/manager role
- No SQL injection risks (parameterized queries)
- Input validation on all fields

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Multi-select shift | Ctrl/Cmd + Click |
| Clear selection | Click selection badge X |
| Navigate weeks | Arrow keys (when focused) |
| Activate drag | Space/Enter (when focused) |

## Best Practices

### Creating Templates
1. Use descriptive names: "AM Server Shift" not "Shift 1"
2. Create templates for all regular shift patterns
3. Group similar templates by day of week
4. Review and update templates quarterly
5. Delete unused templates to keep the list clean

### Using Drag-and-Drop
1. Use grip handle to avoid accidental drags
2. Preview drop location before releasing
3. Use multi-select for bulk changes
4. Verify changes after dropping
5. Check employee availability before moving shifts

### Multi-Select Operations
1. Select all affected shifts before deleting
2. Review selection count before confirming
3. Clear selection after operation
4. Use for bulk cleanup, not individual changes
5. Cannot undo bulk delete - use carefully

### Copy Previous Week
1. Review previous week schedule before copying
2. Best for consistent weekly patterns
3. Edit copied shifts as needed
4. Check for holidays or special events
5. Consider employee time-off requests

## Troubleshooting

### Drag not working
- Check if grip handle is visible on hover
- Ensure you're clicking and holding the handle
- Try refreshing the page
- Check browser console for errors

### Template not saving
- Verify all required fields are filled
- Check end time is after start time
- Ensure template name is unique
- Check network connection

### Copy previous week fails
- Verify previous week has shifts
- Check you have manager/owner permissions
- Ensure restaurant is selected
- Try refreshing and retry

### Multi-select not working
- Hold Ctrl/Cmd while clicking
- Check shifts are in same week
- Clear browser cache if stuck
- Try using a different browser

## Future Enhancements

Potential improvements for future releases:
1. **Drag Multiple Shifts**: Select and drag multiple shifts at once
2. **Template Library**: Share templates across locations
3. **Auto-Apply Templates**: Automatically apply templates for new weeks
4. **Shift Patterns**: Create multi-week recurring patterns
5. **Conflict Detection**: Warn when shifts overlap
6. **Employee Preferences**: Consider availability when dragging
7. **Undo/Redo**: Restore deleted or moved shifts
8. **Bulk Edit**: Change multiple shifts' properties at once

## Related Documentation
- [Scheduling System Overview](RECURRING_SHIFTS_FEATURE.md)
- [Security Analysis](SECURITY_SUMMARY_SHIFT_TEMPLATES.md)
- [Architecture Guidelines](ARCHITECTURE.md)
- [GitHub Copilot Instructions](.github/copilot-instructions.md)
