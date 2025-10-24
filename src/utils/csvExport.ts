import Papa from "papaparse";
import { format } from "date-fns";

export interface CSVExportOptions {
  data: Record<string, any>[];
  filename: string;
  headers?: string[];
}

/**
 * Exports data to CSV format and triggers download
 * @param options - Configuration for CSV export
 */
export const exportToCSV = (options: CSVExportOptions): void => {
  const { data, filename, headers } = options;
  
  // No-op in SSR or non-DOM environments
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  
  // If headers are provided, ensure they're in the correct order
  let csvData = data;
  if (headers && headers.length > 0) {
    csvData = data.map(row => {
      const orderedRow: Record<string, any> = {};
      headers.forEach(header => {
        orderedRow[header] = row[header] ?? '';
      });
      return orderedRow;
    });
  }
  
  // Ensure headers are emitted even when data is empty
  const csv = headers && headers.length > 0
    ? Papa.unparse({ fields: headers, data: (csvData as Record<string, any>[]).map(r => headers.map(h => r[h])) })
    : Papa.unparse(csvData);
  
  // Add BOM for better Excel compatibility
  const csvWithBOM = '\uFEFF' + csv;
  const blob = new Blob([csvWithBOM], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Generates a standardized CSV filename with timestamp
 * @param prefix - File prefix (e.g., "inventory_audit", "pos_sales")
 * @param suffix - Optional suffix (e.g., date range)
 * @returns Formatted filename
 */
export const generateCSVFilename = (prefix: string, suffix?: string): string => {
  const timestamp = format(new Date(), "yyyyMMdd_HHmmss");
  const sanitize = (s: string) => s.replace(/[^\w.-]+/g, "_");
  const suffixPart = suffix ? `_${sanitize(suffix)}` : "";
  return `${sanitize(prefix)}${suffixPart}_${timestamp}.csv`;
};
