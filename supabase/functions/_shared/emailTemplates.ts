/**
 * Shared Email Template System for EasyShiftHQ
 * 
 * DRY principle: All notification emails use consistent templates
 * to avoid duplicating HTML/styling across edge functions.
 */

export interface EmailTemplateData {
  heading: string;
  statusBadge?: {
    text: string;
    color: string; // hex color
  };
  greeting?: string;
  message: string;
  detailsCard?: {
    title?: string;
    items: Array<{
      label: string;
      value: string;
    }>;
  };
  managerNote?: string;
  ctaButton?: {
    text: string;
    url: string;
  };
  footerNote?: string;
}

/**
 * Escape HTML to prevent XSS attacks
 */
export const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Generate the standard EasyShiftHQ email header with logo
 */
const generateHeader = (): string => {
  return `
    <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
      <div style="display: inline-flex; align-items: center; justify-content: center; background-color: rgba(255, 255, 255, 0.95); border-radius: 12px; padding: 12px 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 8px; padding: 8px; display: inline-block; margin-right: 12px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </div>
        <span style="font-size: 20px; font-weight: 700; color: #1f2937; letter-spacing: -0.5px;">EasyShiftHQ</span>
      </div>
    </div>
  `;
};

/**
 * Generate the standard EasyShiftHQ email footer
 */
const generateFooter = (): string => {
  const year = new Date().getFullYear();
  return `
    <div style="background-color: #f9fafb; padding: 24px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
      <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0; line-height: 1.5;">
        <strong style="color: #4b5563;">EasyShiftHQ</strong><br>
        Restaurant Operations Management System
      </p>
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 12px 0 0 0;">
        © ${year} EasyShiftHQ. All rights reserved.
      </p>
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 8px 0 0 0;">
        This is an automated notification. Please do not reply to this email.
      </p>
    </div>
  `;
};

/**
 * Generate a status badge
 */
const generateStatusBadge = (badge: { text: string; color: string }): string => {
  const safeText = escapeHtml(badge.text);
  return `
    <div style="margin-bottom: 24px;">
      <span style="background-color: ${badge.color}; color: white; padding: 6px 14px; border-radius: 6px; font-size: 14px; font-weight: 600;">${safeText}</span>
    </div>
  `;
};

/**
 * Generate the details card with key-value pairs
 */
const generateDetailsCard = (card: EmailTemplateData['detailsCard']): string => {
  if (!card || !card.items.length) return '';
  
  const rows = card.items
    .map(item => {
      const safeLabel = escapeHtml(item.label);
      const safeValue = escapeHtml(item.value);
      return `
        <tr>
          <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">${safeLabel}:</td>
          <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${safeValue}</td>
        </tr>
      `;
    })
    .join('');
  
  return `
    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #10b981;">
      ${card.title ? `<h3 style="margin: 0 0 12px 0; color: #1f2937; font-size: 16px; font-weight: 600;">${escapeHtml(card.title)}</h3>` : ''}
      <table style="width: 100%; border-collapse: collapse;">
        ${rows}
      </table>
    </div>
  `;
};

/**
 * Generate a manager note section
 */
const generateManagerNote = (note: string): string => {
  const safeNote = escapeHtml(note);
  return `
    <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; padding: 16px; margin: 24px 0;">
      <p style="margin: 0 0 8px; color: #92400e; font-size: 14px; font-weight: 600;">
        Manager Note:
      </p>
      <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.5;">
        ${safeNote}
      </p>
    </div>
  `;
};

/**
 * Generate a call-to-action button
 */
const generateCTA = (button: { text: string; url: string }): string => {
  const safeText = escapeHtml(button.text);
  const safeUrl = button.url; // URLs should be pre-validated
  
  return `
    <div style="text-align: center; margin: 32px 0;">
      <a href="${safeUrl}" 
         style="background-color: #059669; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); mso-padding-alt: 14px 32px; border: 2px solid #059669;">
        <span style="color: #ffffff !important;">${safeText}</span>
      </a>
    </div>
  `;
};

/**
 * Generate a footer note (appears before the standard footer)
 */
const generateFooterNote = (note: string): string => {
  const safeNote = escapeHtml(note);
  return `
    <p style="color: #6b7280; font-size: 14px; margin: 32px 0 0 0; line-height: 1.6;">
      ${safeNote}
    </p>
  `;
};

/**
 * Main function to generate a complete email template
 * 
 * @param data - Email template data
 * @returns Complete HTML email
 */
export const generateEmailTemplate = (data: EmailTemplateData): string => {
  const safeHeading = escapeHtml(data.heading);
  const safeGreeting = data.greeting ? escapeHtml(data.greeting) : '';
  const safeMessage = escapeHtml(data.message);
  
  // Build content sections
  const statusBadgeHtml = data.statusBadge ? generateStatusBadge(data.statusBadge) : '';
  const greetingHtml = safeGreeting ? `
    <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
      ${safeGreeting}
    </p>
  ` : '';
  const detailsCardHtml = data.detailsCard ? generateDetailsCard(data.detailsCard) : '';
  const managerNoteHtml = data.managerNote ? generateManagerNote(data.managerNote) : '';
  const ctaButtonHtml = data.ctaButton ? generateCTA(data.ctaButton) : '';
  const footerNoteHtml = data.footerNote ? generateFooterNote(data.footerNote) : '';
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeHeading}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    ${generateHeader()}
    
    <!-- Content -->
    <div style="padding: 40px 32px; background-color: #ffffff;">
      ${statusBadgeHtml}
      
      <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3;">${safeHeading}</h1>
      
      ${greetingHtml}
      
      <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
        ${safeMessage}
      </p>
      
      ${detailsCardHtml}
      ${managerNoteHtml}
      ${ctaButtonHtml}
      ${footerNoteHtml}
    </div>
    
    ${generateFooter()}
  </div>
</body>
</html>
  `.trim();
};

/**
 * Helper to format dates consistently
 */
export const formatDate = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
};

/**
 * Helper to format date-time consistently
 */
export const formatDateTime = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

/**
 * Helper to format currency (expects cents)
 */
export const formatCurrency = (cents: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(cents / 100);
};
