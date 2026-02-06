import { jsPDF } from 'jspdf';
import { format } from 'date-fns';

import type { CheckSettings } from '@/hooks/useCheckSettings';

export interface CheckData {
  checkNumber: number;
  payeeName: string;
  amount: number; // In dollars (not cents)
  issueDate: string; // YYYY-MM-DD
  memo?: string;
}

// --- Number to words conversion ---

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

/**
 * Convert a dollar amount to words for check printing.
 * e.g. 1234.56 → "One Thousand Two Hundred Thirty-Four and 56/100"
 */
export function numberToWords(amount: number): string {
  if (amount < 0) return numberToWords(-amount);
  if (amount === 0) return 'Zero and 00/100';

  // Use integer math to avoid floating-point precision issues
  const totalCents = Math.round(amount * 100);
  const dollars = Math.floor(totalCents / 100);
  const cents = totalCents % 100;

  function convertToWords(n: number): string {
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

  const dollarsInWords = convertToWords(dollars);
  const centsFormatted = cents.toString().padStart(2, '0');
  return `${dollarsInWords} and ${centsFormatted}/100`;
}

// --- Check PDF generation ---

function formatCheckAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Build the city/state/zip line from check settings.
 */
function buildCityStateZip(settings: CheckSettings): string {
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

/**
 * Render one check page (top check layout):
 *  - Top third: the actual check
 *  - Middle third: payee record stub
 *  - Bottom third: company record stub
 */
function renderCheckPage(doc: jsPDF, settings: CheckSettings, check: CheckData) {
  const pageWidth = 8.5;
  const margin = 0.5;
  const checkHeight = 3.5; // Standard check-on-top height in inches

  // =====================
  // TOP: Actual check
  // =====================

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
  // Truncate if too long for the line
  const maxWordsWidth = pageWidth - margin - 1.6 - margin;
  let displayWords = amountInWords;
  while (doc.getTextWidth(displayWords) > maxWordsWidth * 72 && displayWords.length > 20) {
    displayWords = displayWords.slice(0, -1);
  }
  doc.text(displayWords, margin, amountWordsY);
  doc.line(margin, amountWordsY + 0.05, pageWidth - margin - 1.6, amountWordsY + 0.05);
  doc.setFontSize(8);
  doc.text('DOLLARS', pageWidth - margin - 1.3, amountWordsY);

  // Bank name
  if (settings.bank_name) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(settings.bank_name, margin, 2.2);
  }

  // Memo line
  const memoY = 2.85;
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

  // =====================
  // MIDDLE: Payee record stub
  // =====================
  const stub1Top = checkHeight + 0.15;
  renderStub(doc, 'PAYEE RECORD', check, formattedDate, stub1Top, margin, pageWidth);

  // Perforation line between stubs
  const stub1Bottom = 7.0; // 3.5" check + 3.5" stub1
  doc.setLineDashPattern([2, 2], 0);
  doc.setLineWidth(0.003);
  doc.line(0, stub1Bottom, pageWidth, stub1Bottom);
  doc.setLineDashPattern([], 0);

  // =====================
  // BOTTOM: Company record stub
  // =====================
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

/**
 * Generate a multi-page check PDF. One check per page, top check layout.
 */
export function generateCheckPDF(
  settings: CheckSettings,
  checks: CheckData[],
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: 'letter', // 8.5" x 11"
  });

  checks.forEach((check, index) => {
    if (index > 0) doc.addPage();
    renderCheckPage(doc, settings, check);
  });

  return doc;
}

/**
 * Generate a filename for the check PDF.
 */
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
