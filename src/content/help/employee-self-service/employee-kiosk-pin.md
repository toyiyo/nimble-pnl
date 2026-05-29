---
title: "Setting and Changing Your Kiosk PIN"
category: "employee-self-service"
summary: "Generate a new PIN automatically or choose your own numeric PIN for logging in on the shared kiosk tablet."
audience: ["staff", "chef"]
order: 30
keywords: ["PIN", "kiosk PIN", "generate", "change PIN", "temporary PIN", "security"]
related: ["kiosk-mode-clock-in-out", "employee-time-clock"]
---

# Setting and Changing Your Kiosk PIN

This article explains how to set or update the numeric PIN you use to identify yourself on your restaurant's shared kiosk tablet. Any staff or chef member with access to their account can manage their own PIN from the Kiosk PIN screen.

## Before you begin

You must be logged in to your EasyShiftHQ account and have a restaurant selected. If you see the message "Pick a restaurant from the switcher to manage your kiosk PIN," tap the restaurant switcher at the top of the app and choose your location before continuing.

## Open the Kiosk PIN screen

1. In the bottom navigation bar, tap **More**.
2. Tap **Kiosk PIN**.

The screen shows a **Kiosk PIN** card with your current PIN status and two tabs for setting your PIN.

### Understanding your PIN status

At the top of the card you will see one of three status badges:

- **No PIN yet** — you have not set a PIN for this location.
- **PIN set** — your PIN is active. If you have used it recently, the badge also shows when it was last used.
- **Temporary PIN · Change it on the kiosk** — a manager has assigned you a temporary PIN. You must enter that temporary PIN on the kiosk tablet to trigger the Change PIN dialog and set a permanent one.

## Generate a PIN automatically

Use this option if you want EasyShiftHQ to create a strong PIN for you.

1. On the **Kiosk PIN** screen, make sure the **Generate for me** tab is selected (it is selected by default).
2. Tap **Generate a new PIN**.
3. A green box labeled **Your new PIN** appears, showing your PIN in large digits.
4. Tap **Copy** to copy the PIN to your clipboard. The button briefly changes to **Copied** to confirm.
5. Note your PIN somewhere safe — this is the only time the full PIN is displayed.

Once you leave this screen or generate another PIN, the number is no longer retrievable. If you forget it, return here and generate a new one.

## Choose your own PIN

Use this option if you want to pick a specific number you will remember.

1. On the **Kiosk PIN** screen, tap the **Type my own** tab.
2. In the **New PIN** field, enter a numeric PIN. The field label shows the required range for your location (for example, **New PIN (4–6 digits)**) — your PIN must be at least that many digits and no more than 6.
3. In the **Confirm PIN** field, enter the same PIN again.
4. Tap **Save my PIN**.
5. If the save is successful, a green box labeled **Your new PIN** appears confirming your choice. This is the only time the full PIN is shown, so note it before leaving the screen.

**PIN requirements:**
- Numbers only (letters and symbols are not accepted).
- At least 4 digits (your location may require more), up to 6 digits.
- Simple sequences such as 1234 or 9876 are not allowed. The app will warn you with "Avoid simple sequences like 1234." if your entry is too predictable.
- Both entries in **New PIN** and **Confirm PIN** must match exactly. If they do not, you will see "PINs do not match."

## Use a temporary PIN on the kiosk

If your PIN status shows **Temporary PIN · Change it on the kiosk**:

1. Go to the shared kiosk tablet.
2. Enter the temporary PIN your manager provided.
3. A **Change PIN** dialog will appear on the kiosk screen.
4. Follow the on-screen prompts to set your own permanent PIN.

## Tips

- **Write it down the moment it appears.** EasyShiftHQ stores only a hashed (scrambled) version of your PIN — the readable number is shown just once, right after you save it.
- **Keep your PIN private.** Do not share it with other team members. Each person should have their own unique PIN.
- **Forgot your PIN?** Return to **More > Kiosk PIN** and generate a new one anytime. Your old PIN stops working immediately.
- **Different location, different PIN.** If you work at more than one restaurant, you may need to set a PIN separately for each location. Use the restaurant switcher to select the correct location first.

## Troubleshooting

**The Generate a new PIN button does not appear.**
Make sure you are on the **Generate for me** tab. If a green "Your new PIN" box is already visible from a previous generation, it replaces the button. Reload the page or navigate away and back to reset the view, then tap **Generate a new PIN** again.

**I see "Could not generate a strong PIN. Please try again."**
This is rare. Tap **Generate a new PIN** again — the app will produce a new random PIN.

**I see "Another employee is already using that PIN for this location."**
When you type your own PIN, it must be unique across the team. Choose a different combination of digits.

**The Save my PIN button stays grayed out.**
The button only activates when both fields are filled in, both entries match, the PIN meets the minimum length, and the PIN is not a simple sequence. Check all four conditions before tapping again.

**Copy failed error appears.**
If your browser blocks clipboard access, manually write down or memorize the PIN displayed on screen before navigating away.

**My status still shows "No PIN yet" after saving.**
Try refreshing the page. If the problem persists, check that you have the correct restaurant selected in the switcher, then save again.

## Frequently asked questions

**Can I see my current PIN after I set it?**
No. For security, EasyShiftHQ never stores the readable PIN. Only a scrambled version is kept. If you need your PIN again, generate a new one from **More > Kiosk PIN**.

**How many digits does my PIN need to be?**
Between 4 and 6 digits. Your manager may have configured a higher minimum for your location — if so, the **New PIN** label will show the required minimum (for example, "New PIN (5–6 digits)").

**What if I share a PIN with a coworker by accident?**
The app prevents two employees from using the same PIN at the same location. If you try to save a PIN that someone else already uses, you will see an error. Choose a different PIN.

**Can my manager change my PIN?**
Yes. If a manager resets your PIN, your status will change to **Temporary PIN · Change it on the kiosk**. Enter that temporary PIN on the kiosk tablet to set your own permanent PIN.

**Does my PIN work at other restaurant locations?**
PINs are specific to each location. If you work at multiple locations, select each one from the restaurant switcher and set a PIN for each separately.

## Related articles

- [Using the Shared Kiosk Tablet to Clock In and Out](/help/kiosk-mode-clock-in-out)
- [Clock In, Start a Break, and Clock Out](/help/employee-time-clock)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
