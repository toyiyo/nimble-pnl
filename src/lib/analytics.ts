export const INTERNAL_DOMAINS: readonly string[] = ['@easyshifthq.com'] as const;

export const ATTRIBUTION_STORAGE_KEY = 'signup_attribution';

export interface SignupAttribution {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer: string;
  landing_page: string;
  captured_at: string;
}

export function isInternalEmail(email?: string | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return INTERNAL_DOMAINS.some((domain) => lower.endsWith(domain.toLowerCase()));
}

export function storeAttribution(search: string, referrer: string, landingPage: string): void {
  const params = new URLSearchParams(search);
  const utm_source = params.get('utm_source');
  const utm_medium = params.get('utm_medium');
  const utm_campaign = params.get('utm_campaign');

  const hasFreshData = Boolean(utm_source || utm_medium || utm_campaign || referrer);
  if (!hasFreshData) return;

  const attribution: SignupAttribution = {
    utm_source,
    utm_medium,
    utm_campaign,
    referrer,
    landing_page: landingPage,
    captured_at: new Date().toISOString(),
  };

  try {
    localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // Quota exceeded or storage disabled — analytics must never block signup.
  }
}

export function getStoredAttribution(): SignupAttribution | null {
  try {
    const raw = localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SignupAttribution;
  } catch {
    return null;
  }
}

export function clearStoredAttribution(): void {
  try {
    localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
  } catch {
    // Ignore
  }
}
