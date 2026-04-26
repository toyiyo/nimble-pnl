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

export async function registerMicrFont(doc: jsPDF): Promise<string> {
  const base64 = await loadFontBase64();
  doc.addFileToVFS(MICR_FONT_FILENAME, base64);
  doc.addFont(MICR_FONT_FILENAME, MICR_FONT_FAMILY, 'normal');
  return MICR_FONT_FAMILY;
}

// The bundled TTF maps MICR control symbols to ASCII letters:
//   transit (⑆) → 'A',  on-us (⑈) → 'C'
export const MICR_PDF_CHAR_MAP: Record<string, string> = {
  [MICR_TRANSIT]: 'A',
  [MICR_ON_US]: 'C',
};

export function toMicrPdfText(unicodeMicr: string): string {
  let out = '';
  for (const ch of unicodeMicr) {
    out += MICR_PDF_CHAR_MAP[ch] ?? ch;
  }
  return out;
}
