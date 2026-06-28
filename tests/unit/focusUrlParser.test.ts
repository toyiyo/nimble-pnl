import { describe, it, expect } from 'vitest';
import { parseFocusReportUrl } from '@/lib/focusUrlParser';

const VALID_URL =
  'https://mfprod-1.myfocuspos.com/ReportServer?/generalstorereports/revenuecenter&dbServer=mfaz-rep-1&dbCatalog=KAHALA2&UserID=J.Delgado&StoreID=15312&rs:Command=render';

describe('parseFocusReportUrl', () => {
  describe('happy path — real-shaped URL', () => {
    it('extracts all routing params from a real Focus report URL', () => {
      const result = parseFocusReportUrl(VALID_URL);
      expect(result).not.toBeNull();
      expect(result).toEqual({
        baseUrl: 'https://mfprod-1.myfocuspos.com',
        reportPath: '/ReportServer?/generalstorereports/revenuecenter',
        dbServer: 'mfaz-rep-1',
        dbCatalog: 'KAHALA2',
        userId: 'J.Delgado',
        storeId: '15312',
      });
    });

    it('handles a different myfocuspos subdomain (mfprod-2)', () => {
      const url =
        'https://mfprod-2.myfocuspos.com/ReportServer?/generalstorereports/revenuecenter&dbServer=mfaz-rep-2&dbCatalog=BRANDX&StoreID=99001';
      const result = parseFocusReportUrl(url);
      expect(result).not.toBeNull();
      expect(result!.baseUrl).toBe('https://mfprod-2.myfocuspos.com');
      expect(result!.storeId).toBe('99001');
      expect(result!.dbServer).toBe('mfaz-rep-2');
      expect(result!.dbCatalog).toBe('BRANDX');
    });

    it('returns empty string for optional params when absent', () => {
      const url =
        'https://mfprod-1.myfocuspos.com/ReportServer?/generalstorereports/revenuecenter&StoreID=11111';
      const result = parseFocusReportUrl(url);
      expect(result).not.toBeNull();
      expect(result!.dbServer).toBe('');
      expect(result!.dbCatalog).toBe('');
      expect(result!.userId).toBe('');
    });

    it('is case-insensitive for query-param keys (e.g. storeid vs StoreID)', () => {
      const url =
        'https://mfprod-1.myfocuspos.com/ReportServer?/generalstorereports/revenuecenter&storeid=55555&dbserver=srv1&dbcatalog=CAT1';
      const result = parseFocusReportUrl(url);
      expect(result).not.toBeNull();
      expect(result!.storeId).toBe('55555');
      expect(result!.dbServer).toBe('srv1');
      expect(result!.dbCatalog).toBe('CAT1');
    });
  });

  describe('SSRF / security rejections', () => {
    it('rejects a non-myfocuspos host (evil.com)', () => {
      expect(
        parseFocusReportUrl(
          'https://evil.com/ReportServer?/path&StoreID=1',
        ),
      ).toBeNull();
    });

    it('rejects http:// (non-https) even on a myfocuspos host', () => {
      expect(
        parseFocusReportUrl(
          'http://mfprod-1.myfocuspos.com/ReportServer?/path&StoreID=1',
        ),
      ).toBeNull();
    });

    it('rejects a crafted subdomain attack (evil.myfocuspos.com.attacker.com)', () => {
      expect(
        parseFocusReportUrl(
          'https://evil.myfocuspos.com.attacker.com/ReportServer?/path&StoreID=1',
        ),
      ).toBeNull();
    });

    it('rejects a URL with embedded username (userinfo)', () => {
      expect(
        parseFocusReportUrl(
          'https://user:pw@mfprod-1.myfocuspos.com/ReportServer?/path&StoreID=1',
        ),
      ).toBeNull();
    });

    it('rejects a URL with embedded username only (no password)', () => {
      expect(
        parseFocusReportUrl(
          'https://admin@mfprod-1.myfocuspos.com/ReportServer?/path&StoreID=1',
        ),
      ).toBeNull();
    });

    it('rejects file:// scheme', () => {
      expect(parseFocusReportUrl('file:///etc/passwd')).toBeNull();
    });

    it('rejects javascript: scheme', () => {
      expect(parseFocusReportUrl('javascript:alert(1)')).toBeNull();
    });
  });

  describe('missing required params', () => {
    it('returns null when StoreID is absent', () => {
      expect(
        parseFocusReportUrl(
          'https://mfprod-1.myfocuspos.com/ReportServer?/path&dbServer=srv',
        ),
      ).toBeNull();
    });

    it('returns null for a completely empty string', () => {
      expect(parseFocusReportUrl('')).toBeNull();
    });

    it('returns null for a non-URL string', () => {
      expect(parseFocusReportUrl('not a url')).toBeNull();
    });
  });

  describe('reportPath extraction', () => {
    it('preserves the full path+catalog portion including leading slash', () => {
      const result = parseFocusReportUrl(VALID_URL);
      expect(result!.reportPath).toBe(
        '/ReportServer?/generalstorereports/revenuecenter',
      );
    });

    it('strips Focus-generated params (rs:Command, StartDate, etc.) from reportPath', () => {
      const url =
        'https://mfprod-1.myfocuspos.com/ReportServer?/generalstorereports/revenuecenter&StoreID=42&rs:Command=Render&rs:Format=HTML4.0&StartDate=06%2F27%2F2026';
      const result = parseFocusReportUrl(url);
      expect(result).not.toBeNull();
      // reportPath must contain the catalog segment
      expect(result!.reportPath).toContain('/generalstorereports/revenuecenter');
      // reportPath should not contain StoreID (it is extracted separately)
      expect(result!.reportPath).not.toContain('StoreID');
      expect(result!.storeId).toBe('42');
    });
  });
});
