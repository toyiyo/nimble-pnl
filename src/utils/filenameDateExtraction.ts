/**
 * Utility for extracting dates from filenames
 * Common patterns: YYYY-MM-DD, MM-DD-YYYY, YYYYMMDD, etc.
 */

export interface ExtractedDate {
  date: Date;
  confidence: 'high' | 'medium' | 'low';
  pattern: string;
}

/**
 * Extract date from filename using various common patterns
 */
export function extractDateFromFilename(filename: string): ExtractedDate | null {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  
  // Pattern 1: YYYY-MM-DD or YYYY_MM_DD or YYYY.MM.DD (high confidence)
  const isoPattern = /(\d{4})[-_.\/](\d{1,2})[-_.\/](\d{1,2})/;
  const isoMatch = nameWithoutExt.match(isoPattern);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (isValidDate(date)) {
      return {
        date,
        confidence: 'high',
        pattern: 'YYYY-MM-DD',
      };
    }
  }

  // Pattern 2: MM-DD-YYYY or MM_DD_YYYY (high confidence)
  const usPattern = /(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{4})/;
  const usMatch = nameWithoutExt.match(usPattern);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (isValidDate(date)) {
      return {
        date,
        confidence: 'high',
        pattern: 'MM-DD-YYYY',
      };
    }
  }

  // Pattern 3: YYYYMMDD (medium confidence)
  const compactPattern = /(\d{4})(\d{2})(\d{2})/;
  const compactMatch = nameWithoutExt.match(compactPattern);
  if (compactMatch) {
    const [, year, month, day] = compactMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (isValidDate(date)) {
      return {
        date,
        confidence: 'medium',
        pattern: 'YYYYMMDD',
      };
    }
  }

  // Pattern 4: Month name patterns (medium confidence)
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthPattern = new RegExp(`(${monthNames.join('|')})[a-z]*[-_.\\s]*(\\d{1,2})[^\\d]*(\\d{4})`, 'i');
  const monthMatch = nameWithoutExt.match(monthPattern);
  if (monthMatch) {
    const [, monthStr, day, year] = monthMatch;
    const monthIndex = monthNames.findIndex(m => monthStr.toLowerCase().startsWith(m));
    if (monthIndex >= 0) {
      const date = new Date(parseInt(year), monthIndex, parseInt(day));
      if (isValidDate(date)) {
        return {
          date,
          confidence: 'medium',
          pattern: 'Month DD, YYYY',
        };
      }
    }
  }

  // Pattern 5: Look for any 6 or 8 digit number that could be a date (low confidence)
  const digitPattern = /(\d{6,8})/;
  const digitMatch = nameWithoutExt.match(digitPattern);
  if (digitMatch) {
    const digits = digitMatch[1];
    
    // Try MMDDYYYY if 8 digits
    if (digits.length === 8) {
      const month = parseInt(digits.substring(0, 2));
      const day = parseInt(digits.substring(2, 4));
      const year = parseInt(digits.substring(4, 8));
      const date = new Date(year, month - 1, day);
      if (isValidDate(date) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return {
          date,
          confidence: 'low',
          pattern: 'MMDDYYYY',
        };
      }
    }
    
    // Try MMDDYY if 6 digits
    if (digits.length === 6) {
      const month = parseInt(digits.substring(0, 2));
      const day = parseInt(digits.substring(2, 4));
      const yearShort = parseInt(digits.substring(4, 6));
      // Assume 2000s for years 00-50, 1900s for 51-99
      const year = yearShort <= 50 ? 2000 + yearShort : 1900 + yearShort;
      const date = new Date(year, month - 1, day);
      if (isValidDate(date) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return {
          date,
          confidence: 'low',
          pattern: 'MMDDYY',
        };
      }
    }
  }

  return null;
}

/**
 * Check if a date is valid and within reasonable bounds
 */
function isValidDate(date: Date): boolean {
  if (isNaN(date.getTime())) {
    return false;
  }
  
  // Reasonable date range: 2000 to 10 years in the future
  const minDate = new Date(2000, 0, 1);
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 10);
  
  return date >= minDate && date <= maxDate;
}
