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

export const NEW_SIGNUP_WINDOW_MS = 5 * 60 * 1000;
export const TRIAL_DURATION_DAYS = 14;
const ACCOUNT_CREATED_FLAG_PREFIX = 'posthog_account_created_';

export function accountCreatedFlagKey(userId: string): string {
  return `${ACCOUNT_CREATED_FLAG_PREFIX}${userId}`;
}

export interface PostHogLike {
  identify(distinctId: string, properties?: Record<string, unknown>): void;
  capture(event: string, properties?: Record<string, unknown>): void;
}

export interface RecordAuthEventsOptions {
  userId: string;
  email: string | null | undefined;
  createdAt: string | null | undefined;
  posthog: PostHogLike;
  now?: Date;
}

export function recordAuthEvents(options: RecordAuthEventsOptions): void {
  const { userId, email, createdAt, posthog } = options;
  if (!userId) return;

  const now = options.now ?? new Date();
  const isRecentSignup = createdAt
    ? now.getTime() - new Date(createdAt).getTime() <= NEW_SIGNUP_WINDOW_MS
    : false;

  let flagAlreadySet = false;
  try {
    flagAlreadySet = !!localStorage.getItem(accountCreatedFlagKey(userId));
  } catch {
    flagAlreadySet = false;
  }

  try {
    if (isRecentSignup && !flagAlreadySet) {
      const attribution = getStoredAttribution();
      const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

      // Email is used locally to compute is_internal and then discarded —
      // it is NOT forwarded to PostHog (PII minimization).
      const safeEmail = email ?? null;
      posthog.identify(userId, {
        signup_source: attribution?.utm_source || attribution?.referrer || 'direct',
        signup_medium: attribution?.utm_medium || 'organic',
        signup_campaign: attribution?.utm_campaign ?? null,
        is_internal: isInternalEmail(safeEmail),
      });

      posthog.capture('account_created');
      posthog.capture('trial_started', { trial_ends_at: trialEndsAt });

      try {
        localStorage.setItem(accountCreatedFlagKey(userId), '1');
      } catch {
        // ignore
      }

      clearStoredAttribution();
    } else {
      posthog.identify(userId, {
        last_login_at: now.toISOString(),
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[analytics] recordAuthEvents failed:', msg);
  }
}

const FIRST_PNL_VIEWED_FLAG_PREFIX = 'pnl_first_view_seen_';

export function firstPnlViewedFlagKey(userId: string): string {
  return `${FIRST_PNL_VIEWED_FLAG_PREFIX}${userId}`;
}

function secondsSinceCreated(now: Date, userCreatedAt: string | null | undefined): number | null {
  if (!userCreatedAt) return null;
  return Math.floor((now.getTime() - new Date(userCreatedAt).getTime()) / 1000);
}

export interface RecordFirstPnlViewedOptions {
  userId: string;
  hasRealData: boolean;
  userCreatedAt: string | null | undefined;
  posthog: PostHogLike;
  now?: Date;
}

export function recordFirstPnlViewed(options: RecordFirstPnlViewedOptions): void {
  const { userId, hasRealData, userCreatedAt, posthog } = options;
  if (!userId) return;

  const flagKey = firstPnlViewedFlagKey(userId);
  let alreadySeen = false;
  try {
    alreadySeen = !!localStorage.getItem(flagKey);
  } catch {
    alreadySeen = false;
  }
  if (alreadySeen) return;

  const now = options.now ?? new Date();
  const seconds_from_trial_start = secondsSinceCreated(now, userCreatedAt);

  try {
    posthog.capture('first_pnl_viewed', {
      seconds_from_trial_start,
      has_real_data: hasRealData,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[analytics] recordFirstPnlViewed failed:', msg);
  }

  try {
    localStorage.setItem(flagKey, '1');
  } catch {
    // ignore
  }
}

export interface RecordPosIntegrationCompletedOptions {
  posProvider: string;
  userCreatedAt: string | null | undefined;
  posthog: PostHogLike;
  now?: Date;
}

export function recordPosIntegrationCompleted(options: RecordPosIntegrationCompletedOptions): void {
  const { posProvider, userCreatedAt, posthog } = options;
  const now = options.now ?? new Date();
  const seconds_from_trial_start = secondsSinceCreated(now, userCreatedAt);

  try {
    posthog.capture('pos_integration_completed', {
      pos_provider: posProvider,
      seconds_from_trial_start,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[analytics] recordPosIntegrationCompleted failed:', msg);
  }
}
