import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import Papa from "papaparse";
import { PurchaseOrderViewModel, PurchaseOrderLine } from "@/types/purchaseOrder";

/**
 * Format currency for display
 */
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
};

/**
 * Add footer with timestamp and page numbers to PDF
 */
const addFooter = (doc: jsPDF) => {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    const genText = `Generated on ${format(new Date(), "MMM dd, yyyy 'at' h:mm a")}`;
    const footerY = pageHeight - margin;
    
    doc.text(genText, 14, footerY);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 30, footerY, { align: 'right' });
  }
};

/**
 * Export Purchase Order to PDF
 */
export const exportPurchaseOrderToPDF = (
  po: PurchaseOrderViewModel,
  restaurantName: string,
  supplierNames: Record<string, string>
) => {
  const doc = new jsPDF();
  let yPosition = 20;

  // Header - Restaurant Name
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(restaurantName, 105, yPosition, { align: "center" });
  yPosition += 8;

  // Document Title
  doc.setFontSize(14);
  doc.text("PURCHASE ORDER", 105, yPosition, { align: "center" });
  yPosition += 10;

  // PO Details (Left side)
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("PO Number:", 14, yPosition);
  doc.setFont("helvetica", "normal");
  doc.text(po.po_number || "N/A", 50, yPosition);
  yPosition += 6;

  doc.setFont("helvetica", "bold");
  doc.text("Status:", 14, yPosition);
  doc.setFont("helvetica", "normal");
  doc.text(po.status.replace(/_/g, " "), 50, yPosition);
  yPosition += 6;

  doc.setFont("helvetica", "bold");
  doc.text("Date:", 14, yPosition);
  doc.setFont("helvetica", "normal");
  doc.text(format(new Date(po.created_at), "MMM dd, yyyy"), 50, yPosition);
  yPosition += 6;

  if (po.supplier_name) {
    doc.setFont("helvetica", "bold");
    doc.text("Supplier:", 14, yPosition);
    doc.setFont("helvetica", "normal");
    doc.text(po.supplier_name, 50, yPosition);
    yPosition += 6;
  }

  if (po.budget) {
    doc.setFont("helvetica", "bold");
    doc.text("Budget:", 14, yPosition);
    doc.setFont("helvetica", "normal");
    doc.text(formatCurrency(po.budget), 50, yPosition);
    yPosition += 6;
  }

  yPosition += 4;

  // Line Items Table
  const tableData = po.lines.map((line, index) => [
    (index + 1).toString(),
    line.item_name,
    supplierNames[line.supplier_id] || "Unknown",
    line.unit_label || "Unit",
    formatCurrency(line.unit_cost),
    line.quantity.toString(),
    formatCurrency(line.line_total),
  ]);

  autoTable(doc, {
    startY: yPosition,
    head: [["#", "Item", "Supplier", "Unit", "Unit Cost", "Qty", "Total"]],
    body: tableData,
    theme: "grid",
    headStyles: {
      fillColor: [66, 66, 66],
      textColor: 255,
      fontStyle: "bold",
    },
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 50 },
      2: { cellWidth: 35 },
      3: { cellWidth: 20 },
      4: { cellWidth: 25, halign: "right" },
      5: { cellWidth: 15, halign: "center" },
      6: { cellWidth: 25, halign: "right" },
    },
  });

  // Get final Y position after table
  const finalY = (doc as any).lastAutoTable.finalY + 10;

  // Summary Section
  doc.setFontSize(10);
  const summaryX = 140;
  let summaryY = finalY;

  doc.setFont("helvetica", "bold");
  doc.text("Order Total:", summaryX, summaryY);
  doc.setFont("helvetica", "normal");
  doc.text(formatCurrency(po.total), 190, summaryY, { align: "right" });
  summaryY += 6;

  if (po.budget) {
    if (po.budgetRemaining !== undefined && po.budgetRemaining > 0) {
      doc.setFont("helvetica", "bold");
      doc.text("Budget Remaining:", summaryX, summaryY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 128, 0); // Green
      doc.text(formatCurrency(po.budgetRemaining), 190, summaryY, { align: "right" });
      doc.setTextColor(0, 0, 0); // Reset to black
    } else if (po.budgetOverage !== undefined && po.budgetOverage > 0) {
      doc.setFont("helvetica", "bold");
      doc.text("Over Budget:", summaryX, summaryY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(255, 0, 0); // Red
      doc.text(formatCurrency(po.budgetOverage), 190, summaryY, { align: "right" });
      doc.setTextColor(0, 0, 0); // Reset to black
    }
    summaryY += 6;
  }

  // Notes section
  if (po.notes) {
    summaryY += 4;
    doc.setFont("helvetica", "bold");
    doc.text("Notes:", 14, summaryY);
    summaryY += 6;
    doc.setFont("helvetica", "normal");
    const splitNotes = doc.splitTextToSize(po.notes, 180);
    doc.text(splitNotes, 14, summaryY);
  }

  // Add footer
  addFooter(doc);

  // Save PDF
  const filename = `PO_${po.po_number || po.id}_${format(new Date(), "yyyyMMdd")}.pdf`;
  doc.save(filename);
};

/**
 * Export Purchase Order to CSV
 */
export const exportPurchaseOrderToCSV = (
  po: PurchaseOrderViewModel,
  supplierNames: Record<string, string>
) => {
  const csvData = po.lines.map((line, index) => ({
    "#": index + 1,
    "PO Number": po.po_number || "N/A",
    "Item Name": line.item_name,
    "SKU": line.sku || "",
    "Supplier": supplierNames[line.supplier_id] || "Unknown",
    "Unit": line.unit_label || "Unit",
    "Unit Cost": line.unit_cost.toFixed(2),
    "Quantity": line.quantity,
    "Line Total": line.line_total.toFixed(2),
  }));

  // Add BOM for better Excel compatibility
  const csv = Papa.unparse(csvData);
  const csvWithBOM = '\uFEFF' + csv;
  const blob = new Blob([csvWithBOM], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  const filename = `PO_${po.po_number || po.id}_${format(new Date(), "yyyyMMdd")}.csv`;
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Export Purchase Order to plain text format
 */
export const exportPurchaseOrderToText = (
  po: PurchaseOrderViewModel,
  restaurantName: string,
  supplierNames: Record<string, string>
) => {
  let text = "";
  
  // Header
  text += `${restaurantName}\n`;
  text += "PURCHASE ORDER\n";
  text += "=".repeat(60) + "\n\n";
  
  // PO Details
  text += `PO Number: ${po.po_number || "N/A"}\n`;
  text += `Status: ${po.status.replace(/_/g, " ")}\n`;
  text += `Date: ${format(new Date(po.created_at), "MMM dd, yyyy")}\n`;
  if (po.supplier_name) {
    text += `Supplier: ${po.supplier_name}\n`;
  }
  if (po.budget) {
    text += `Budget: ${formatCurrency(po.budget)}\n`;
  }
  text += "\n";
  
  // Line Items Header
  text += "LINE ITEMS\n";
  text += "-".repeat(60) + "\n";
  text += String(
    "#".padEnd(4) +
    "Item".padEnd(25) +
    "Supplier".padEnd(15) +
    "Qty".padEnd(6) +
    "Total".padStart(10)
  ) + "\n";
  text += "-".repeat(60) + "\n";
  
  // Line Items
  po.lines.forEach((line, index) => {
    const itemName = line.item_name.length > 23 
      ? line.item_name.substring(0, 20) + "..." 
      : line.item_name;
    const supplier = (supplierNames[line.supplier_id] || "Unknown").substring(0, 13);
    
    text += String(
      `${index + 1}`.padEnd(4) +
      itemName.padEnd(25) +
      supplier.padEnd(15) +
      line.quantity.toString().padEnd(6) +
      formatCurrency(line.line_total).padStart(10)
    ) + "\n";
  });
  
  text += "-".repeat(60) + "\n";
  
  // Summary
  text += `\nOrder Total: ${formatCurrency(po.total)}\n`;
  if (po.budget) {
    if (po.budgetRemaining !== undefined && po.budgetRemaining > 0) {
      text += `Budget Remaining: ${formatCurrency(po.budgetRemaining)}\n`;
    } else if (po.budgetOverage !== undefined && po.budgetOverage > 0) {
      text += `Over Budget: ${formatCurrency(po.budgetOverage)}\n`;
    }
  }
  
  // Notes
  if (po.notes) {
    text += `\nNotes:\n${po.notes}\n`;
  }
  
  text += "\n" + "=".repeat(60) + "\n";
  text += `Generated on ${format(new Date(), "MMM dd, yyyy 'at' h:mm a")}\n`;
  
  // Download
  const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  const filename = `PO_${po.po_number || po.id}_${format(new Date(), "yyyyMMdd")}.txt`;
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
