---
title: "Update Your Restaurant Profile"
category: "settings-and-integrations"
summary: "Edit your restaurant's name, address, phone number, cuisine type, and timezone from the General tab in Settings, and configure geofenced clock-in enforcement."
audience: ["owner", "manager"]
order: 100
keywords: ["restaurant profile", "timezone", "geofence", "clock-in enforcement", "settings", "cuisine type", "address"]
related: ["business-information-settings", "notification-and-email-preferences", "switch-restaurants-add-location", "kiosk-mode-clock-in-out"]
---

# Update Your Restaurant Profile

The **General** tab in Restaurant Settings is where you keep your restaurant's basic details up to date and control where employees are allowed to clock in from. Changes here take effect immediately for everyone on your team.

## Before you begin

You must have the **Owner** or **Manager** role to edit these settings. Staff members can open the General tab but the fields will be disabled and the Geofence Settings section will not be visible. If you only have a Staff role, contact your owner or manager to make changes.

## Edit your restaurant's basic information

1. From the main navigation, go to **Settings** (`/settings`).
2. Make sure the correct restaurant is shown in the header — if you manage more than one location, select the right one before continuing.
3. Click the **General** tab (it is selected by default when you open Settings).
4. Under the **Basic Information** card, fill in or update the following fields:
   - **Restaurant Name** (required) — The display name used throughout the app. This field cannot be left blank.
   - **Address** — The physical location of your restaurant (for example, `123 Main St, City, State`).
   - **Phone** — Your primary contact number.
   - **Cuisine Type** — The type of cuisine you serve (for example, `Italian`, `Mexican`, or `Asian Fusion`).
5. To change your **Timezone**, click the timezone dropdown and select the correct region. The timezone controls how report dates, inventory timestamps, and sales data are displayed across the entire app. A note below the dropdown shows your browser's current timezone as a reference.
6. When you are ready to apply your changes, click **Save Changes**. A confirmation message will appear once the update is successful.
7. If you want to undo all unsaved edits and return to the last saved values, click **Reset**. Both buttons are disabled when there are no pending changes.

## Set up geofenced clock-in enforcement

Geofencing lets you require employees to be physically at your restaurant when they clock in. This section appears below the basic information fields on the same **General** tab.

1. Open **Settings** and select the **General** tab as described above.
2. Scroll down to the **Geofence Settings** card.
3. Click the **Enforcement Mode** dropdown and choose one of the three options:
   - **Off** — No location check is performed. Employees can clock in from anywhere.
   - **Warn (allow but flag)** — Employees outside the radius are allowed to clock in, but their punch is flagged for your review.
   - **Block (prevent clock-in)** — Employees outside the radius cannot complete a clock-in until they are within range.
4. If you choose **Warn** or **Block**, the coordinate and radius fields appear:
   - Enter your restaurant's **Latitude** and **Longitude** directly, or click **Use Current Location** to let the app detect your device's GPS coordinates automatically and fill both fields for you.
   - Drag the **Radius** slider to set the allowed distance from the coordinates. The slider runs from **50 m** to **500 m** in 25 m increments, and the current value is shown next to the label (for example, `Radius (meters): 150m`).
5. Click **Save Geofence Settings** to apply. A confirmation message will appear when saved successfully.

## Tips

- **Timezone accuracy matters.** All P&L reports, inventory counts, and sales summaries use the timezone you set here. If your reports show dates that are off by a day, check that your timezone matches your restaurant's physical location.
- **Use Current Location works best on-site.** For the most accurate geofence center, click **Use Current Location** while you are at the restaurant, not from a remote office.
- **Start with Warn before enabling Block.** Running in Warn mode for a week lets you review flagged punches and fine-tune the radius before hard-blocking employees.
- **Save Changes and Save Geofence Settings are separate buttons.** Basic profile changes and geofence changes are saved independently — remember to click the appropriate button after each set of edits.

## Troubleshooting

**The Save Changes button is grayed out.**
The button is only active when there is at least one unsaved change and the Restaurant Name field is not empty. Check that you have actually modified a field and that the name is filled in.

**Use Current Location did not fill in any coordinates.**
Your browser may have blocked location access. Check your browser's site permissions and allow location for the EasyShiftHQ app, then try again.

**I changed the timezone but my reports still show the old times.**
Reports are generated using the timezone that was active at save time. After updating the timezone, refresh the page and re-open any reports to see them recalculated with the new setting.

**Employees are being blocked even though they are at the restaurant.**
The radius may be set too small, or the saved coordinates may be slightly off. Try increasing the radius by 25–50 m, or click **Use Current Location** from inside the restaurant to recapture more accurate coordinates, then save again.

**I see a "Read Only" badge and cannot edit anything.**
Your account has a role that does not have edit permission (such as Staff). Contact your owner or manager to update your role, or ask them to make the changes on your behalf.

## Frequently asked questions

**Do I need to re-enter the geofence coordinates for every location I manage?**
Yes. Each restaurant location has its own profile and its own geofence settings. Switch to each location using the restaurant selector at the top of the page and configure them individually.

**What happens to historical punches if I change the enforcement mode?**
Changing the enforcement mode only affects future clock-in attempts. Past time punches already recorded are not altered.

**Can staff see what the geofence radius is set to?**
Staff members can open Settings, but the Geofence Settings section is only shown to owners and managers. Staff will not see the coordinates or radius. They will only receive the warning or block message if they try to clock in from outside the allowed area.

**Is the Restaurant Name shown to customers?**
The name is used internally within EasyShiftHQ — on schedules, reports, and team communications. It is not published to any customer-facing channel by EasyShiftHQ itself.

**Why does the timezone dropdown show my browser's timezone as a note?**
This is a helpful reference so you can compare what your browser assumes against what is saved for the restaurant. If they differ and you want report timestamps to match your local clock, update the dropdown to match your browser's timezone and save.

## Related articles

- [Business Information Settings](/help/business-information-settings)
- [Notification and Email Preferences](/help/notification-and-email-preferences)
- [Switch Restaurants / Add a Location](/help/switch-restaurants-add-location)
- [Kiosk Mode: Clock In and Out](/help/kiosk-mode-clock-in-out)
