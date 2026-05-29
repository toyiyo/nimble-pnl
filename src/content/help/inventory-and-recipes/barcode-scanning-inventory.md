---
title: "Scan Barcodes to Add and Update Inventory"
category: "inventory-and-recipes"
summary: "Use the Scanner tab to add new products or update existing stock counts by scanning barcodes with a device camera, USB laser scanner, or AI-powered photo scan."
audience: ["owner", "manager", "chef", "staff"]
order: 20
keywords: ["barcode", "scanner", "camera", "USB", "OCR", "UPC", "inventory", "scan"]
related: ["manage-inventory-products", "inventory-reconciliation", "receipt-import"]
---

# Scan Barcodes to Add and Update Inventory

This article explains how to use the Scanner tab in Inventory to quickly add new products and update stock counts by scanning barcodes. It covers all three scanning methods available: Camera Scanner, AI OCR Scanner, and Keyboard Scanner.

## Before you begin

You must have an owner, manager, chef, or staff role to access Inventory and use the scanner.

## Open the Scanner tab

1. Go to **Inventory** at `/inventory`.
2. In the tab bar at the top of the page, tap or click **Scanner**.
3. Three scanning methods appear as tiles: **Camera Scanner**, **AI OCR Scanner**, and **Keyboard Scanner**. Tap the tile for the method you want to use.

## Use Camera Scanner (continuous camera scanning)

Camera Scanner uses your device's camera to scan barcodes automatically. It is selected by default when you open the Scanner tab.

Supported barcode formats:
- UPC-A and UPC-E
- EAN-13 and EAN-8
- Code 128
- QR Codes
- Data Matrix

Steps:

1. On the Scanner tab, tap **Camera Scanner** if it is not already selected.
2. Allow camera access when your browser or device asks for permission.
3. Point your device camera at the barcode on the product. Hold it steady and make sure the barcode is well lit and flat.
4. The scanner reads the barcode automatically — no button press is needed.
5. Once the barcode is detected, one of two things happens:
   - **Product already in your inventory:** The **Quick Inventory** dialog opens. Enter the quantity and tap the save button (which shows your entry, for example **Add 24**) to save the change (see [Updating stock counts with Quick Inventory](#updating-stock-counts-with-the-quick-inventory-dialog) below).
   - **New product:** A detail form opens pre-filled with any product information found in the catalog (name, brand, size, category). Review and complete the details, then save to add the product to your inventory.

## Use AI OCR Scanner (photo of a barcode for AI analysis)

AI OCR Scanner lets you take a still photo of a barcode and uses AI to detect the barcode number from the image. This is useful when continuous camera scanning struggles with a damaged, curved, or unclear barcode.

Steps:

1. On the Scanner tab, tap **AI OCR Scanner**.
2. The card labeled **AI OCR Barcode Scanner** appears with the status "Ready to scan."
3. Position the barcode in good lighting and take a clear, focused photo using the capture control that appears.
4. The status changes to "Analyzing image with AI..." while the image is processed.
5. If a barcode is detected:
   - The status shows "Barcode detected: [number]" and a green confirmation banner appears.
   - The same product lookup and dialog flow as Camera Scanner runs (Quick Inventory for known products, detail form for new ones).
   - Tap **Scan Another** to scan the next item.
6. If no barcode is found, a "Detection failed" message appears with tips. Tap **Try Again** to retake the photo.

## Use Keyboard Scanner (USB or Bluetooth HID barcode scanner)

Keyboard Scanner works with USB laser scanners and Bluetooth scanners configured in HID (keyboard) mode. The scanner sends keystrokes to the app exactly like a keyboard — no drivers or special software are required. This method works on all devices including iOS.

### One-time setup (do this once per scanner)

1. Put your scanner in **Bluetooth HID** (keyboard) mode — refer to your scanner's manual.
2. Configure the scanner's suffix to **Enter/CR** so it sends a return signal after each scan.
3. Pair the scanner with your device (for Bluetooth, go to your device's Bluetooth settings and pair there first).

### Scanning with the Keyboard Scanner

1. On the Scanner tab, tap **Keyboard Scanner**.
2. Tap **Start Scanner**. The card shows "Scanner Ready" and an active indicator pulses.
3. Point your scanner at a barcode and press the trigger. The app captures the keystrokes automatically.
4. The barcode is detected and the same product lookup flow runs (Quick Inventory for known products, detail form for new ones).
5. The "Last Scanned" barcode and a scan count are shown so you can track progress.
6. When you are done, tap **Stop Scanner**.

## Updating stock counts with the Quick Inventory dialog

When you scan a barcode that matches a product already in your inventory, the **Quick Inventory** dialog opens. It shows the product name, brand, current stock level, and whether you are adding to stock or setting a total count.

To update the quantity:

1. Use the **Quick Select** buttons (6, 10, 20, 24) to enter a common amount quickly, or use the number pad to type any amount.
2. You can also enter a math expression — for example, type `3*6` and the dialog calculates the result for you.
3. Optionally, choose a **Location** (such as Bar, Fridge, or Storage) from the location field.
4. The button at the bottom shows your entry — for example, **Add 24** or **Set to 24**. Tap it to save.
5. The dialog closes and the scanner is ready for the next scan.

## Add a product manually (no barcode)

If a product has no barcode, use the **Add Product** button in the top-right corner of the Inventory page to open the product detail form and enter information by hand.

## Tips

- Good lighting is the single biggest factor in scan success. Move to a brighter area or use a torch if scans are failing.
- For Camera Scanner, try adjusting the distance between your camera and the barcode if it does not detect immediately — some cameras have a minimum focus distance.
- AI OCR Scanner is a helpful fallback for barcodes that are scratched, curved on a bottle, or partially obscured.
- Keyboard Scanner is the fastest option for high-volume counting sessions — keep your device plugged in and use it as a dedicated scanning station.
- After scanning a new product for the first time, complete the detail form and save it. The next time you scan that same barcode, the Quick Inventory dialog will open immediately.

## Troubleshooting

**Camera scanner shows "Initializing scanner..." and never starts.**
Your browser may not have camera permission. Check your browser's site permissions and allow camera access, then reload the page.

**AI OCR Scanner shows "Detection failed" or "No barcode detected."**
Retake the photo with the barcode centered in the frame, the product held flat, and no glare or shadows crossing the barcode lines.

**Keyboard Scanner is not picking up scans.**
Make sure you tapped **Start Scanner** first. If keystrokes are still not captured, tap the scanner area on screen to give it focus, then try scanning again. Also verify your hardware scanner is configured to send an Enter/CR suffix after each barcode.

**A scanned barcode opens a new-product form instead of Quick Inventory.**
The product is not yet in your inventory. Complete and save the form — the next scan of that barcode will open Quick Inventory directly.

**The Quick Inventory dialog opened but the save button is not active.**
You need to enter a quantity greater than zero before the save button becomes active. Use the number pad or Quick Select buttons to enter an amount.

## Frequently asked questions

**Do I need a special barcode scanner device?**
No. Camera Scanner works with any device that has a camera — a phone, tablet, or laptop. AI OCR Scanner also uses your camera but requires a photo instead of a live view. Keyboard Scanner is for USB or Bluetooth laser scanner hardware that appears as a keyboard (HID mode).

**What happens if the barcode is not in any product catalog?**
The detail form still opens with the barcode number pre-filled. You can manually enter the product name, brand, and other details, then save. The product is added to your inventory and future scans of that barcode will open Quick Inventory.

**Can I set the exact total count instead of adding to the current number?**
When the Quick Inventory dialog opens from the Scanner tab, the save button reads **Add [quantity]** and adds to the existing count. To replace the total stock count instead of adding, use the Reconciliation tab where the dialog opens in Set mode and the button reads **Set to [quantity]**.

**Does AI OCR Scanner work offline?**
No. The AI OCR Scanner sends the photo to an AI service for analysis and requires an internet connection.

**Can I use multiple scanner types in the same session?**
Yes. Tap any of the three scanner tiles at any time to switch methods. Your inventory data is not affected by switching.

## Related articles

- [Manage Your Inventory: Add, Edit, and Track Products](/help/manage-inventory-products)
- [Run an Inventory Count (Reconciliation)](/help/inventory-reconciliation)
- [Import Supplier Receipts to Update Inventory](/help/receipt-import)
