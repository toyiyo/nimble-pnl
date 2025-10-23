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
  
  const csv = Papa.unparse(csvData);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
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
  const suffixPart = suffix ? `_${suffix}` : "";
  return `${prefix}${suffixPart}_${timestamp}.csv`;
};
