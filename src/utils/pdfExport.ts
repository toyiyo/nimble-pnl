import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";

export interface PDFExportOptions {
  title: string;
  restaurantName: string;
  dateRange?: string;
  asOfDate?: string;
  data: Array<{
    label: string;
    amount?: number;
    isTotal?: boolean;
    isSubtotal?: boolean;
    indent?: number;
    isBold?: boolean;
  }>;
  additionalSections?: Array<{
    title: string;
    data: Array<{
      label: string;
      amount?: number;
      isTotal?: boolean;
      indent?: number;
    }>;
  }>;
  metrics?: Array<{
    label: string;
    value: string;
  }>;
  filename: string;
}

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
};

export interface TablePDFExportOptions {
  title: string;
  restaurantName: string;
  dateRange?: string;
  columns: string[];
  rows: string[][];
  metrics?: Array<{
    label: string;
    value: string;
  }>;
  filename: string;
}

/**
 * Add footer with timestamp and page numbers to PDF
 */
const addFooter = (doc: jsPDF, opts?: { centered?: boolean }) => {
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
    
    if (opts?.centered) {
      const centerX = pageWidth / 2;
      doc.text(`${genText} | Page ${i} of ${pageCount}`, centerX, footerY, { align: 'center' });
    } else {
      doc.text(genText, 14, footerY);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - 30, footerY, { align: 'right' });
    }
  }
};

export const generateTablePDF = (options: TablePDFExportOptions) => {
  const doc = new jsPDF();
  let yPosition = 20;

  // Header - Restaurant Name
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(options.restaurantName, 105, yPosition, { align: "center" });
  yPosition += 8;

  // Report Title
  doc.setFontSize(14);
  doc.text(options.title, 105, yPosition, { align: "center" });
  yPosition += 6;

  // Date Range
  if (options.dateRange) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(options.dateRange, 105, yPosition, { align: "center" });
    yPosition += 10;
  } else {
    yPosition += 5;
  }

  // Metrics Section (if provided)
  if (options.metrics && options.metrics.length > 0) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    
    const metricsPerRow = 3;
    const startX = 20;
    const columnWidth = 60;
    
    options.metrics.forEach((metric, index) => {
      const col = index % metricsPerRow;
      const row = Math.floor(index / metricsPerRow);
      const x = startX + (col * columnWidth);
      const y = yPosition + (row * 10);
      
      doc.setFont("helvetica", "normal");
      doc.text(`${metric.label}:`, x, y);
      doc.setFont("helvetica", "bold");
      doc.text(metric.value, x + 35, y);
    });
    
    yPosition += Math.ceil(options.metrics.length / metricsPerRow) * 10 + 5;
  }

  // Main Table
  autoTable(doc, {
    startY: yPosition,
    head: [options.columns],
    body: options.rows,
    theme: "grid",
    headStyles: {
      fillColor: [59, 130, 246],
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
    },
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    columnStyles: {
      0: { cellWidth: "auto" },
    },
    margin: { top: 10, left: 14, right: 14 },
  });

  addFooter(doc);
  doc.save(options.filename);
};

export const generateFinancialReportPDF = (options: PDFExportOptions) => {
  const doc = new jsPDF();
  let yPosition = 20;

  // Header - Restaurant Name
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(options.restaurantName, 105, yPosition, { align: "center" });
  yPosition += 8;

  // Report Title
  doc.setFontSize(14);
  doc.text(options.title, 105, yPosition, { align: "center" });
  yPosition += 6;

  // Date Range or As Of Date
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const dateText = options.dateRange || options.asOfDate || "";
  doc.text(dateText, 105, yPosition, { align: "center" });
  yPosition += 10;

  // Metrics Section (if provided)
  if (options.metrics && options.metrics.length > 0) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Key Metrics", 14, yPosition);
    yPosition += 6;

    const metricsData = options.metrics.map((metric) => [metric.label, metric.value]);

    autoTable(doc, {
      startY: yPosition,
      head: [],
      body: metricsData,
      theme: "plain",
      styles: { fontSize: 9 },
      columnStyles: {
        0: { fontStyle: "normal", cellWidth: 100 },
        1: { fontStyle: "bold", halign: "right", cellWidth: 80 },
      },
      margin: { left: 14 },
    });

    yPosition = (doc as any).lastAutoTable.finalY + 10;
  }

  // Main Data Section
  const tableData = options.data.map((item) => {
    const indent = "  ".repeat(item.indent || 0);
    const label = indent + item.label;
    const amount = item.amount !== undefined ? formatCurrency(item.amount) : "";

    return [label, amount];
  });

  autoTable(doc, {
    startY: yPosition,
    head: [],
    body: tableData,
    theme: "plain",
    styles: {
      fontSize: 9,
      cellPadding: 2,
    },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { halign: "right", cellWidth: 50 },
    },
    didParseCell: function (data) {
      const rowIndex = data.row.index;
      const item = options.data[rowIndex];

      if (item?.isTotal) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 10;
        data.cell.styles.fillColor = [240, 240, 240];
      } else if (item?.isSubtotal) {
        data.cell.styles.fontStyle = "bold";
      } else if (item?.isBold) {
        data.cell.styles.fontStyle = "bold";
      }
    },
    margin: { left: 14 },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  // Additional Sections
  if (options.additionalSections) {
    options.additionalSections.forEach((section) => {
      // Check if we need a new page
      if (yPosition > 250) {
        doc.addPage();
        yPosition = 20;
      }

      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(section.title, 14, yPosition);
      yPosition += 6;

      const sectionData = section.data.map((item) => {
        const indent = "  ".repeat(item.indent || 0);
        const label = indent + item.label;
        const amount = item.amount !== undefined ? formatCurrency(item.amount) : "";
        return [label, amount];
      });

      autoTable(doc, {
        startY: yPosition,
        head: [],
        body: sectionData,
        theme: "plain",
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: 130 },
          1: { halign: "right", cellWidth: 50 },
        },
        didParseCell: function (data) {
          const rowIndex = data.row.index;
          const item = section.data[rowIndex];

          if (item?.isTotal) {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fontSize = 10;
            data.cell.styles.fillColor = [240, 240, 240];
          }
        },
        margin: { left: 14 },
      });

      yPosition = (doc as any).lastAutoTable.finalY + 10;
    });
  }

  addFooter(doc, { centered: true });
  doc.save(options.filename);
};

export const generateStandardFilename = (
  reportType: string,
  restaurantName: string,
  dateFrom?: Date,
  dateTo?: Date,
  asOfDate?: Date,
): string => {
  const sanitizedRestaurantName = restaurantName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  const timestamp = format(new Date(), "yyyy-MM-dd-HHmmss");

  if (dateFrom && dateTo) {
    const from = format(dateFrom, "yyyy-MM-dd");
    const to = format(dateTo, "yyyy-MM-dd");
    return `${reportType}-${sanitizedRestaurantName}-${from}-to-${to}-${timestamp}`;
  }

  if (asOfDate) {
    const asOf = format(asOfDate, "yyyy-MM-dd");
    return `${reportType}-${sanitizedRestaurantName}-as-of-${asOf}-${timestamp}`;
  }

  return `${reportType}-${sanitizedRestaurantName}-${timestamp}`;
};
