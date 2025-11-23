import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
