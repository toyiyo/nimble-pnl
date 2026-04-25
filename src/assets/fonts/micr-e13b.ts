import type { jsPDF } from 'jspdf';
import { MICR_ON_US, MICR_TRANSIT } from '@/utils/micrLine';
import micrFontUrl from './micr-e13b.ttf?url';

const MICR_FONT_FAMILY = 'MICR-E13B';
const MICR_FONT_FILENAME = 'micr-e13b.ttf';

let cachedBase64: string | null = null;

async function loadFontBase64(): Promise<string> {
  if (cachedBase64) return cachedBase64;
  const res = await fetch(micrFontUrl);
  if (!res.ok) throw new Error(`Failed to load MICR font: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < buf.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, i + chunkSize) as unknown as number[]);
  }
  cachedBase64 = btoa(binary);
  return cachedBase64;
}

/**
 * Register the MICR E-13B font with the given jsPDF instance.
 * Returns the font family name to pass to doc.setFont().
 */
export async function registerMicrFont(doc: jsPDF): Promise<string> {
  const base64 = await loadFontBase64();
  doc.addFileToVFS(MICR_FONT_FILENAME, base64);
  doc.addFont(MICR_FONT_FILENAME, MICR_FONT_FAMILY, 'normal');
  return MICR_FONT_FAMILY;
}

/**
 * The bundled MICR Encoding TTF (Digital Graphic Labs) maps the four
 * MICR control symbols to ASCII letters rather than Unicode 0x2446-0x2449.
 * Translate the Unicode-form output of formatMicrLine into the font's chars.
 *
 *   transit (⑆) -> 'A',  amount (⑇) -> 'B',  on-us (⑈) -> 'C',  dash (⑉) -> 'D'
 */
export const MICR_PDF_CHAR_MAP: Record<string, string> = {
  [MICR_TRANSIT]: 'A',
  [MICR_ON_US]: 'C',
};

export function toMicrPdfText(unicodeMicr: string): string {
  if (Object.keys(MICR_PDF_CHAR_MAP).length === 0) return unicodeMicr;
  let out = '';
  for (const ch of unicodeMicr) {
    out += MICR_PDF_CHAR_MAP[ch] ?? ch;
  }
  return out;
}
