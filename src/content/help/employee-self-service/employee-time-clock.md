---
title: "Clock In, Start a Break, and Clock Out"
category: "employee-self-service"
summary: "Use the Time Clock screen to record when you start and stop working, including the selfie verification step, geofence warnings, and viewing today's punch history."
audience: ["staff", "chef"]
order: 10
keywords: ["clock in", "clock out", "break", "selfie", "verification", "geofence", "location", "time clock"]
related: ["kiosk-mode-clock-in-out", "employee-timecard", "employee-pay-estimate", "employee-kiosk-pin"]
---

# Clock In, Start a Break, and Clock Out

This article explains how to use the **Time Clock** screen in EasyShiftHQ to record the start and end of your shift, take breaks, verify your identity with a selfie, and review your punches for the day. It is written for staff and chef accounts.

## Before you begin

- You must be signed in to EasyShiftHQ. If you need help signing in, see [Sign In or Create Your EasyShiftHQ Account](/help/sign-in-create-account).
- Your account must be linked to an employee record at your restaurant. If you see an **Access Required** message, contact your manager — they need to connect your login to your employee profile before you can use the Time Clock.
- Your device browser must allow camera access and, depending on your restaurant's settings, location access.

---

## Clock in at the start of your shift

1. Go to **/employee/clock**. The **Time Clock** screen opens, showing the current time and your name in the welcome card.
2. If your status shows **Clocked Out**, you will see a **Clock In** button in the **Quick Actions** section.
3. Tap **Clock In**. The app immediately checks your location (see the geofence note below).
4. If your location is verified or no location check is configured, the **Verify Your Identity** dialog opens automatically.
5. The camera starts. When you can see yourself in the preview, tap **Take Photo** to snap a selfie.
6. Review the captured image. If you are happy with it, tap **Confirm & Clock In** to record your punch. If you want a better shot, tap **Retake**.
7. To skip the photo entirely, tap **Skip Photo** — your punch will be recorded without a selfie.

After the punch is saved, your status badge updates to **Clocked In** and a confirmation notification appears briefly at the bottom of the screen.

### What happens if you are outside the restaurant boundary

Your restaurant may have a location boundary (geofence) set up. When you tap **Clock In**, the app requests your device location and compares it to the restaurant address.

- If you are detected as being outside the boundary, one of two things will happen depending on how your restaurant has configured its location policy:
  - A **Location Warning** dialog appears showing your approximate distance from the restaurant (for example, "You appear to be about 250 meters from the restaurant"). Tap **Continue Anyway** to proceed to the selfie step — your punch will be flagged for manager review. Tap **Cancel** to stop and try again from the correct location.
  - A notification appears saying "You must be at the restaurant to clock in." In this case, clocking in is blocked entirely until you are within the required area. Contact your manager if you believe this is an error.
- If the app cannot determine your location at all, a **Location Unavailable** dialog appears with the message "We couldn't verify your location. You can still clock in, but this will be flagged for manager review." Tap **Continue Anyway** to proceed, or **Cancel** to stop.

---

## Start and end a break

1. While your status shows **Clocked In**, the **Quick Actions** section shows a **Start Break** button.
2. Tap **Start Break**. The **Verify Your Identity** dialog appears. Take a photo or tap **Skip Photo**, then tap **Confirm & Start Break**.
3. Your status badge changes to **On Break**.
4. When you are ready to return to work, tap **End Break**. Complete the same identity check, then tap **Confirm & End Break**.
5. Your status returns to **Clocked In**.

---

## Clock out at the end of your shift

1. While **Clocked In** (or while **On Break**), tap **Clock Out** in the **Quick Actions** section.
2. The **Verify Your Identity** dialog appears — this is the same selfie step as clocking in.
3. Take a photo or tap **Skip Photo**, then tap **Confirm & Clock Out** to record your punch.
4. Your status badge changes to **Clocked Out**.

---

## View today's punch history

The **Today's Activity** section at the bottom of the Time Clock screen shows every punch recorded for the current day, listed in chronological order. Each entry displays:

- The type of punch (Clock In, Clock Out, Break Start, or Break End).
- The exact time the punch was recorded.
- A camera icon if a selfie was captured with that punch.
- A location pin icon if location data was captured with that punch.

If no punches have been recorded yet today, the section shows "No punches recorded today."

---

## Tips

- **Complete the selfie step in one go** — if you close the Verify Your Identity dialog before tapping a confirm button, the punch will not be recorded.
- **Good lighting matters.** Face a light source so the selfie is clear; a blurry or very dark photo may still be accepted, but a clear photo is more useful if there is ever a pay dispute.
- **Location permission.** The first time you tap **Clock In**, your browser or device may ask for permission to access your location. Tap **Allow** so the geofence check can work correctly.
- **The time shown is the server time** at the moment you tap the confirm button, not when you first opened the dialog.
- The **Last action** line below the status badge shows the time of your most recent punch as a quick reference.

---

## Troubleshooting

**I see "Access Required" and cannot use the Time Clock.**
Your login is not linked to an employee record. Ask your manager to connect your account to your employee profile.

**The camera never starts — I just see "Starting camera...".**
Your browser may have blocked camera access. Check your browser's site settings and allow the camera for this site, then refresh the page and try again. If the camera is unavailable, you can always tap **Skip Photo** to punch without a selfie.

**I tapped Clock In but nothing happened — the button is greyed out.**
The app may still be checking your location. Wait a moment for the check to complete, then try again.

**The Location Warning says I am far from the restaurant but I am standing inside it.**
GPS accuracy can vary, especially indoors or in buildings with thick walls. Tap **Continue Anyway** to proceed. Your manager can review the flagged punch and correct it if needed.

**My punch did not save — I saw an error notification.**
Check that you have a working internet connection and try again. If the problem persists, ask your manager to record the punch manually from the time punches manager view.

---

## Frequently asked questions

**Do I have to take a selfie every time?**
No. The selfie is optional. You can always tap **Skip Photo** to punch without a photo. However, a photo helps protect your pay if there is ever a question about your hours.

**Will my manager see the selfie?**
Yes. Photos are stored securely and can be reviewed by managers and owners when they audit time punches.

**What does the "On Break" status mean for my pay?**
Break time may or may not be paid depending on your restaurant's payroll settings — that is handled separately by your manager. The Time Clock records the exact start and end of each break so the calculation is accurate.

**Can I clock in from home or another location?**
That depends on your restaurant's settings. If a location boundary is enforced, you may see a **Location Warning** dialog that lets you proceed (with the punch flagged for review), or you may be blocked entirely with a message that says "You must be at the restaurant to clock in." If you are blocked, you will need to clock in from inside the restaurant or speak with your manager.

**I forgot to clock out yesterday. What should I do?**
You cannot edit your own punches from the Time Clock screen. Let your manager know — they can correct the record from the [Track and Manage Employee Time Punches](/help/time-punches-manager) page.

---

## Related articles

- [Track and Manage Employee Time Punches](/help/time-punches-manager)
- [Using the Shared Kiosk Tablet to Clock In and Out](/help/kiosk-mode-clock-in-out)
- [Setting and Changing Your Kiosk PIN](/help/employee-kiosk-pin)
- [Sign In or Create Your EasyShiftHQ Account](/help/sign-in-create-account)
