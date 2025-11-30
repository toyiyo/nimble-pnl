const DIGITS = '0123456789';

export const KIOSK_SESSION_KEY = 'kiosk_session_token';
export const KIOSK_POLICY_KEY = 'kiosk_pin_policy';

export function generateNumericPin(length = 4): string {
  const sanitizedLength = Math.min(6, Math.max(4, length));
  let pin = '';
  const randomValues = new Uint8Array(sanitizedLength);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < sanitizedLength; i++) {
      // Use modulo to map random value to digit index
      const idx = randomValues[i] % DIGITS.length;
      pin += DIGITS[idx];
    }
  } else {
    // Fallback to Math.random if crypto is unavailable (should not happen in modern browsers)
    for (let i = 0; i < sanitizedLength; i++) {
      const idx = Math.floor(Math.random() * DIGITS.length);
      pin += DIGITS[idx];
    }
  }
  return pin;
}

export function isSimpleSequence(pin: string): boolean {
  if (!pin || pin.length < 2) return false;
  const ascending = '0123456789';
  const descending = '9876543210';
  return ascending.includes(pin) || descending.includes(pin);
}

export async function hashString(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function loadFromStorage<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    console.error('Failed to parse kiosk storage', error);
    return null;
  }
}

export function saveToStorage<T>(key: string, value: T | null) {
  if (typeof localStorage === 'undefined') return;
  if (!value) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}
