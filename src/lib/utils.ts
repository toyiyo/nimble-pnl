import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitize input for use in Supabase .or() filters.
 * Removes characters that could break the query syntax or cause injection.
 * 
 * PostgREST filter syntax uses:
 * - Commas to separate conditions
 * - Parentheses to group conditions
 * - Quotes for string values
 * - Backslashes for escaping
 * 
 * @param input - The user-provided string to sanitize
 * @returns Sanitized string safe for use in .or() filters (may be empty)
 */
export function sanitizeForOrFilter(input: string): string {
  // Remove commas, parentheses, backslashes, single and double quotes
  // Using regex with global flag for consistency
  return input
    .replace(/,/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\\/g, '')
    .replace(/'/g, '')
    .replace(/"/g, '');
}

/**
 * Format a time string (HH:MM:SS) to display format (HH:MM)
 * @param time - Time string in HH:MM:SS or HH:MM format
 * @returns Time string in HH:MM format
 */
export function formatTime(time: string | null | undefined): string {
  if (!time) return '';
  return time.substring(0, 5);
}

/**
 * Format a number as currency (USD)
 * @param amount - Amount to format
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

