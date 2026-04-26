import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import { formatMicrLine } from './micrLine';
import { registerMicrFont, toMicrPdfText } from '@/assets/fonts/micr-e13b';

export interface CheckPrintConfig {
  business_name: string;
  business_address_line1: string | null;
  business_address_line2: string | null;
  business_city: string | null;
  business_state: string | null;
  business_zip: string | null;
  bank_name: string | null;
  print_bank_info: boolean;
  routing_number: string | null;
  account_number: string | null;
}

export interface CheckData {
  checkNumber: number;
  payeeName: string;
  amount: number; // In dollars (not cents)
  issueDate: string; // YYYY-MM-DD
  memo?: string;
}

export interface PrintSecretsInput {
  routing_number: string;
  account_number: string;
}

// ---------------------------------------------------------------------------
// MICR placement (ANSI X9.100-160-1)
// ---------------------------------------------------------------------------

// ANSI X9.100-160-1 reserves positions 1–12 (rightmost 1.5") for the amount
// field encoded by the receiving bank, plus position 13 as a mandatory blank.
// The on-us symbol (⑈) must land at position 14: 5/16" + 13 × 1/8" = 1.9375".
export const MICR_RIGHT_MARGIN_INCHES = 1.9375;

// ANSI allows 3/16"–7/16" from the check bottom; 5/16" is the midpoint and
// matches observed production placement (~0.314").
export const MICR_BASELINE_FROM_CHECK_BOTTOM_INCHES = 0.3125;

// Standard check-on-top height in inches. Shared with renderCheckPageSync.
const CHECK_HEIGHT_INCHES = 3.5;

// ANSI X9.27 spec: MICR-E13B at 0.117" character height + 0.125" pitch
// (8 cpi). Our bundled TTF (unitsPerEm=4096) reaches both at exactly 18pt;
// see docs/superpowers/specs/2026-04-26-check-micr-font-size-design.md.
const MICR_FONT_POINT_SIZE = 18;

// Zero — the font's own advance width at MICR_FONT_POINT_SIZE is already
// the 0.125" 8 cpi pitch, so any extra Tc overshoots the spec.
const MICR_CHAR_SPACE_INCHES = 0;

export function computeMicrPlacement(input: {
  pageWidth: number;
  checkBottomY: number;
  measuredTextWidth: number;
  charCount: number;
  charSpace: number;
}): { leftX: number; baselineY: number; rightEdgeX: number; totalWidth: number } {
  const interCharGaps = Math.max(0, input.charCount - 1);
  const totalWidth = input.measuredTextWidth + input.charSpace * interCharGaps;
  const rightEdgeX = input.pageWidth - MICR_RIGHT_MARGIN_INCHES;
  return {
    leftX: rightEdgeX - totalWidth,
    baselineY: input.checkBottomY - MICR_BASELINE_FROM_CHECK_BOTTOM_INCHES,
    rightEdgeX,
    totalWidth,
  };
}

export function buildPrintConfig(
  settings: Omit<CheckPrintConfig, 'bank_name' | 'print_bank_info' | 'routing_number' | 'account_number'>,
  bankAccount: { bank_name: string | null; print_bank_info: boolean } | null,
  secrets: PrintSecretsInput | null,
): CheckPrintConfig {
  return {
    ...settings,
    bank_name: bankAccount?.bank_name ?? null,
    print_bank_info: Boolean(bankAccount?.print_bank_info && secrets),
    routing_number: secrets?.routing_number ?? null,
    account_number: secrets?.account_number ?? null,
  };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const TEENS = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertLessThanOneThousand(n: number): string {
  if (n === 0) return '';
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 100) {
    const tensPart = TENS[Math.floor(n / 10)];
    const onesPart = ONES[n % 10];
    return onesPart ? `${tensPart}-${onesPart}` : tensPart;
  }
  const hundredsPart = `${ONES[Math.floor(n / 100)]} Hundred`;
  const remainder = n % 100;
  return remainder ? `${hundredsPart} ${convertLessThanOneThousand(remainder)}` : hundredsPart;
}

function dollarsToWords(n: number): string {
  if (n === 0) return 'Zero';
  const billion = Math.floor(n / 1_000_000_000);
  const million = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousand = Math.floor((n % 1_000_000) / 1_000);
  const remainder = n % 1_000;
  let result = '';
  if (billion) result += `${convertLessThanOneThousand(billion)} Billion `;
  if (million) result += `${convertLessThanOneThousand(million)} Million `;
  if (thousand) result += `${convertLessThanOneThousand(thousand)} Thousand `;
  if (remainder) result += convertLessThanOneThousand(remainder);
  return result.trim();
}

export function numberToWords(amount: number): string {
  if (amount < 0) return numberToWords(-amount);
  if (amount === 0) return 'Zero and 00/100';
  const totalCents = Math.round(amount * 100);
  const cents = totalCents % 100;
  const centsFormatted = cents.toString().padStart(2, '0');
  return `${dollarsToWords(Math.floor(totalCents / 100))} and ${centsFormatted}/100`;
}

function formatCheckAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function buildCityStateZip(settings: CheckPrintConfig): string {
  const parts: string[] = [];
  if (settings.business_city) parts.push(settings.business_city);
  if (settings.business_state) {
    if (parts.length > 0) {
      parts[parts.length - 1] += ',';
    }
    parts.push(settings.business_state);
  }
  if (settings.business_zip) parts.push(settings.business_zip);
  return parts.join(' ');
}

function renderCheckPageSync(doc: jsPDF, settings: CheckPrintConfig, check: CheckData) {
  const pageWidth = 8.5;
  const margin = 0.5;
  const checkHeight = CHECK_HEIGHT_INCHES;

  // Business info (top-left)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(settings.business_name, margin, 0.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  let yPos = 0.65;
  if (settings.business_address_line1) {
    doc.text(settings.business_address_line1, margin, yPos);
    yPos += 0.13;
  }
  if (settings.business_address_line2) {
    doc.text(settings.business_address_line2, margin, yPos);
    yPos += 0.13;
  }
  const cityStateZip = buildCityStateZip(settings);
  if (cityStateZip) {
    doc.text(cityStateZip, margin, yPos);
  }

  // Check number (top-right)
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(String(check.checkNumber), pageWidth - margin, 0.5, { align: 'right' });

  // Date line
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const formattedDate = format(new Date(check.issueDate + 'T12:00:00'), 'MM/dd/yyyy');
  doc.text(`Date: ${formattedDate}`, pageWidth - margin - 1.5, 0.85);
  doc.setLineWidth(0.005);
  doc.line(pageWidth - margin - 1.2, 0.9, pageWidth - margin, 0.9);

  // "PAY TO THE ORDER OF" line
  const payToY = 1.35;
  doc.setFontSize(8);
  doc.text('PAY TO THE', margin, payToY - 0.1);
  doc.text('ORDER OF', margin, payToY + 0.02);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(check.payeeName, margin + 0.85, payToY);

  doc.setLineWidth(0.005);
  doc.line(margin + 0.85, payToY + 0.05, pageWidth - margin - 1.6, payToY + 0.05);

  // Amount box (right side)
  const amountBoxX = pageWidth - margin - 1.4;
  const amountBoxY = payToY - 0.18;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.01);
  doc.rect(amountBoxX, amountBoxY, 1.3, 0.32);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(formatCheckAmount(check.amount), amountBoxX + 0.07, amountBoxY + 0.22);

  // Amount in words
  const amountWordsY = payToY + 0.45;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const amountInWords = numberToWords(check.amount);
  const maxWordsWidth = pageWidth - margin - 1.6 - margin;
  let displayWords = amountInWords;
  while (doc.getTextWidth(displayWords) > maxWordsWidth && displayWords.length > 20) {
    displayWords = displayWords.slice(0, -1);
  }
  doc.text(displayWords, margin, amountWordsY);
  doc.line(margin, amountWordsY + 0.05, pageWidth - margin - 1.6, amountWordsY + 0.05);
  doc.setFontSize(8);
  doc.text('DOLLARS', pageWidth - margin - 1.3, amountWordsY);

  // Bank name sits above the payor block so it doesn't collide with long
  // business names that center-extend across the top band. Shrink long names
  // so they always fit between the page margins on a single line.
  if (settings.print_bank_info && settings.bank_name) {
    doc.setFont('helvetica', 'bold');
    const maxBankNameWidth = pageWidth - 2 * margin;
    let bankFontSize = 11;
    doc.setFontSize(bankFontSize);
    while (doc.getTextWidth(settings.bank_name) > maxBankNameWidth && bankFontSize > 8) {
      bankFontSize -= 0.5;
      doc.setFontSize(bankFontSize);
    }
    doc.text(settings.bank_name, pageWidth / 2, 0.30, { align: 'center' });
  }

  // Memo line — moved up from y=2.85 to y=2.55 so the MICR clear band
  // (bottom 5/8" of the check, y=2.875–3.50) stays empty.
  const memoY = 2.55;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Memo', margin, memoY);
  if (check.memo) {
    doc.setFontSize(9);
    doc.text(check.memo, margin + 0.45, memoY);
  }
  doc.line(margin + 0.4, memoY + 0.05, margin + 3, memoY + 0.05);

  // Signature line
  const sigLineX = pageWidth - margin - 2.8;
  doc.line(sigLineX, memoY + 0.05, pageWidth - margin, memoY + 0.05);
  doc.setFontSize(7);
  doc.text('AUTHORIZED SIGNATURE', sigLineX + 0.3, memoY + 0.2);

  // Perforation line between check and first stub
  doc.setLineDashPattern([2, 2], 0);
  doc.setLineWidth(0.003);
  doc.line(0, checkHeight, pageWidth, checkHeight);
  doc.setLineDashPattern([], 0);

  const stub1Top = checkHeight + 0.15;
  renderStub(doc, 'PAYEE RECORD', check, formattedDate, stub1Top, margin, pageWidth);

  const stub1Bottom = 7.0;
  doc.setLineDashPattern([2, 2], 0);
  doc.setLineWidth(0.003);
  doc.line(0, stub1Bottom, pageWidth, stub1Bottom);
  doc.setLineDashPattern([], 0);

  const stub2Top = stub1Bottom + 0.15;
  renderStub(doc, 'COMPANY RECORD', check, formattedDate, stub2Top, margin, pageWidth);
}

function renderStub(
  doc: jsPDF,
  title: string,
  check: CheckData,
  formattedDate: string,
  startY: number,
  margin: number,
  pageWidth: number,
) {
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(title, margin, startY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const col1X = margin;
  const col2X = margin + 3.5;
  let y = startY + 0.35;

  doc.text(`Check #: ${check.checkNumber}`, col1X, y);
  doc.text(`Date: ${formattedDate}`, col2X, y);
  y += 0.22;

  doc.text(`Pay to: ${check.payeeName}`, col1X, y);
  doc.text(`Amount: ${formatCheckAmount(check.amount)}`, col2X, y);
  y += 0.22;

  if (check.memo) {
    doc.text(`Memo: ${check.memo}`, col1X, y);
    y += 0.22;
  }

  // Separator line at bottom of stub data
  doc.setLineWidth(0.002);
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y + 0.1, pageWidth - margin, y + 0.1);
  doc.setDrawColor(0, 0, 0);
}

async function renderMicrLine(
  doc: jsPDF,
  check: CheckData,
  settings: CheckPrintConfig,
  pageWidth: number,
): Promise<void> {
  if (!settings.print_bank_info || !settings.routing_number || !settings.account_number) {
    return;
  }
  const fontFamily = await registerMicrFont(doc);
  const micr = formatMicrLine({
    checkNumber: check.checkNumber,
    routingNumber: settings.routing_number,
    accountNumber: settings.account_number,
  });
  const renderable = toMicrPdfText(micr);

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(MICR_FONT_POINT_SIZE);
  doc.setTextColor(0, 0, 0);

  // jsPDF's `align: 'right'` ignores charSpace, so leftX is computed manually.
  const measuredTextWidth = doc.getTextWidth(renderable);
  const { leftX, baselineY } = computeMicrPlacement({
    pageWidth,
    checkBottomY: CHECK_HEIGHT_INCHES,
    measuredTextWidth,
    charCount: renderable.length,
    charSpace: MICR_CHAR_SPACE_INCHES,
  });

  doc.text(renderable, leftX, baselineY, { charSpace: MICR_CHAR_SPACE_INCHES });

  doc.setFont('helvetica', 'normal');
}

async function renderCheckPage(doc: jsPDF, settings: CheckPrintConfig, check: CheckData) {
  renderCheckPageSync(doc, settings, check);
  await renderMicrLine(doc, check, settings, 8.5);
}

export function generateCheckPDF(
  settings: CheckPrintConfig,
  checks: CheckData[],
): jsPDF {
  if (settings.print_bank_info) {
    throw new Error('print_bank_info requires generateCheckPDFAsync (font loading is async)');
  }
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: 'letter', // 8.5" x 11"
  });

  checks.forEach((check, index) => {
    if (index > 0) doc.addPage();
    renderCheckPageSync(doc, settings, check);
  });

  return doc;
}

export async function generateCheckPDFAsync(
  settings: CheckPrintConfig,
  checks: CheckData[],
): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: 'letter',
  });

  for (let i = 0; i < checks.length; i++) {
    if (i > 0) doc.addPage();
    await renderCheckPage(doc, settings, checks[i]);
  }

  return doc;
}

export function generateCheckFilename(
  restaurantName: string,
  checkNumbers: number[],
): string {
  const sanitized = restaurantName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const timestamp = format(new Date(), 'yyyy-MM-dd-HHmmss');

  if (checkNumbers.length === 1) {
    return `check-${sanitized}-${checkNumbers[0]}-${timestamp}.pdf`;
  }
  return `checks-${sanitized}-${checkNumbers[0]}-to-${checkNumbers[checkNumbers.length - 1]}-${timestamp}.pdf`;
}
