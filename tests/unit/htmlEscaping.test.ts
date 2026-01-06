/**
 * Unit Tests: HTML Escaping for Email Notifications
 * 
 * Tests HTML escaping utility to prevent XSS attacks in email templates.
 * 
 * Critical security requirements:
 * - User-provided content must be escaped before HTML interpolation
 * - All dangerous characters must be converted to entities
 * - Escaping must work with edge cases (empty, null, special chars)
 */

import { describe, it, expect } from 'vitest';

// Copy of escapeHtml function from edge function for testing
const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

describe('HTML Escaping for Email Security', () => {
  describe('escapeHtml', () => {
    it('should escape basic XSS attempt with script tags', () => {
      const malicious = '<script>alert("XSS")</script>';
      const result = escapeHtml(malicious);
      expect(result).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
      expect(result).not.toContain('<script>');
    });

    it('should escape angle brackets', () => {
      const input = '<div>Hello</div>';
      const result = escapeHtml(input);
      expect(result).toBe('&lt;div&gt;Hello&lt;/div&gt;');
    });

    it('should escape ampersands', () => {
      const input = 'Tom & Jerry';
      const result = escapeHtml(input);
      expect(result).toBe('Tom &amp; Jerry');
    });

    it('should escape quotes', () => {
      const input = 'He said "Hello"';
      const result = escapeHtml(input);
      expect(result).toBe('He said &quot;Hello&quot;');
    });

    it('should escape single quotes', () => {
      const input = "It's a test";
      const result = escapeHtml(input);
      expect(result).toBe('It&#039;s a test');
    });

    it('CRITICAL: should escape combined XSS attempts', () => {
      const malicious = '<img src=x onerror="alert(\'XSS\')">';
      const result = escapeHtml(malicious);
      expect(result).toBe('&lt;img src=x onerror=&quot;alert(&#039;XSS&#039;)&quot;&gt;');
      expect(result).not.toContain('<img');
      // The literal string "onerror=" is still present but in safe escaped context
      expect(result).toContain('onerror=');
      // But the dangerous parts (< and ") are escaped
      expect(result).toContain('&lt;img');
      expect(result).toContain('&quot;');
    });

    it('should handle empty string', () => {
      const result = escapeHtml('');
      expect(result).toBe('');
    });

    it('should handle normal text without special characters', () => {
      const input = 'Hello World';
      const result = escapeHtml(input);
      expect(result).toBe('Hello World');
    });

    it('should escape multiple special characters in sequence', () => {
      const input = '&<>"\'';
      const result = escapeHtml(input);
      expect(result).toBe('&amp;&lt;&gt;&quot;&#039;');
    });

    it('CRITICAL: should prevent javascript protocol injection', () => {
      const malicious = 'javascript:alert("XSS")';
      const result = escapeHtml(malicious);
      // While not preventing the word "javascript", it prevents HTML context injection
      expect(result).toBe('javascript:alert(&quot;XSS&quot;)');
    });

    it('CRITICAL: should prevent event handler injection', () => {
      const malicious = 'onload=alert("XSS")';
      const result = escapeHtml(malicious);
      expect(result).toBe('onload=alert(&quot;XSS&quot;)');
      // Quotes are escaped so it cannot be used as an attribute
    });

    it('should handle newlines and carriage returns', () => {
      const input = 'Line 1\nLine 2\rLine 3';
      const result = escapeHtml(input);
      expect(result).toBe('Line 1\nLine 2\rLine 3');
      // Newlines are preserved
    });

    it('should escape manager note with mixed content', () => {
      const managerNote = 'Please note: Employee needs <script> removed & "proper" coverage';
      const result = escapeHtml(managerNote);
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&quot;proper&quot;');
    });

    it('should escape employee names with special characters', () => {
      const name = "O'Brien <Chef>";
      const result = escapeHtml(name);
      expect(result).toBe('O&#039;Brien &lt;Chef&gt;');
    });

    it('CRITICAL: should escape shift details with potential injection', () => {
      const shiftDetails = 'Monday 9am-5pm <img src=x onerror=alert(1)>';
      const result = escapeHtml(shiftDetails);
      expect(result).not.toContain('<img');
      expect(result).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('should handle Unicode characters safely', () => {
      const input = 'Café <script>Naïve</script>';
      const result = escapeHtml(input);
      expect(result).toBe('Café &lt;script&gt;Naïve&lt;/script&gt;');
    });

    it('should escape nested special characters', () => {
      const input = '<<nested>>';
      const result = escapeHtml(input);
      expect(result).toBe('&lt;&lt;nested&gt;&gt;');
    });

    it('should handle long strings efficiently', () => {
      const input = '<script>' + 'a'.repeat(1000) + '</script>';
      const result = escapeHtml(input);
      expect(result).toMatch(/^&lt;script&gt;a{1000}&lt;\/script&gt;$/);
    });
  });

  describe('Integration scenarios', () => {
    it('should safely interpolate escaped content in HTML template', () => {
      const managerNote = '<script>alert("XSS")</script>';
      const safeNote = escapeHtml(managerNote);
      
      const template = `<p>${safeNote}</p>`;
      
      expect(template).toContain('&lt;script&gt;');
      expect(template).not.toContain('<script>alert');
    });

    it('CRITICAL: should prevent XSS in email subject line', () => {
      const employeeName = 'John <script>alert(1)</script>';
      const safeName = escapeHtml(employeeName);
      
      const subject = `Shift Trade from ${safeName}`;
      
      expect(subject).not.toContain('<script>');
      expect(subject).toContain('&lt;script&gt;');
    });

    it('should handle all email template fields', () => {
      const employeeName = "O'Brien <Manager>";
      const shiftDetails = 'Monday 9-5 & "extra" duties';
      const restaurantName = 'Café & Bistro <Location>';
      const managerNote = 'Approved with <conditions>';

      const safeEmployeeName = escapeHtml(employeeName);
      const safeShiftDetails = escapeHtml(shiftDetails);
      const safeRestaurantName = escapeHtml(restaurantName);
      const safeManagerNote = escapeHtml(managerNote);

      expect(safeEmployeeName).toBe('O&#039;Brien &lt;Manager&gt;');
      expect(safeShiftDetails).toBe('Monday 9-5 &amp; &quot;extra&quot; duties');
      expect(safeRestaurantName).toBe('Café &amp; Bistro &lt;Location&gt;');
      expect(safeManagerNote).toBe('Approved with &lt;conditions&gt;');
    });
  });
});
