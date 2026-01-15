const PDF_DATA_URL_PREFIX = 'data:application/pdf;base64,';
const PDF_REMOTE_URL_PATTERN = /^https?:\/\//i;

export function normalizeDate(dateString: string | undefined, allowFuture = false): string | null {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    const now = new Date();
    const minDate = new Date('2000-01-01');
    if (isNaN(date.getTime()) || (!allowFuture && date > now) || date < minDate) {
      return null;
    }
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

export function normalizePdfInput(imageData: string): { value: string; isRemote: boolean } {
  if (imageData.startsWith(PDF_DATA_URL_PREFIX)) {
    return { value: imageData, isRemote: false };
  }
  if (PDF_REMOTE_URL_PATTERN.test(imageData)) {
    return { value: imageData, isRemote: true };
  }
  return { value: `${PDF_DATA_URL_PREFIX}${imageData}`, isRemote: false };
}
