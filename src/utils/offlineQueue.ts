import { supabase } from '@/integrations/supabase/client';
import { verifyPinForRestaurant } from '@/hooks/useKioskPins';

export type QueuedKioskPunch = {
  id: string;
  payload: {
    restaurant_id: string;
    employee_id?: string;
    pin_hash?: string; // Store only hashed PIN, never raw PIN
    punch_type: 'clock_in' | 'clock_out';
    punch_time: string;
    notes?: string;
    location?: {
      latitude: number;
      longitude: number;
    };
    device_info?: string;
    photoDataUrl?: string | null;
  };
};

const QUEUE_KEY = 'kiosk_punch_queue';

const loadQueue = (): QueuedKioskPunch[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedKioskPunch[]) : [];
  } catch (error) {
    console.error('Failed to load kiosk queue', error);
    return [];
  }
};

const saveQueue = (queue: QueuedKioskPunch[]) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Failed to save kiosk queue', error);
  }
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = (err) => {
      const message = err instanceof Error ? err.message : 'Failed to read blob';
      reject(new Error(message));
    };
    reader.readAsDataURL(blob);
  });

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const res = await fetch(dataUrl);
  return res.blob();
};

let idCounter = 0;
const randomId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `kiosk-${Date.now()}-${hex}`;
  }
  idCounter += 1;
  return `kiosk-${Date.now()}-${idCounter}`;
};

export const addQueuedPunch = async (
  payload: QueuedKioskPunch['payload'],
  photoBlob?: Blob | null
) => {
  // Security: Never allow raw PIN in queue
  if ('pin' in payload) {
    throw new Error('Raw PIN must not be stored in offline queue. Hash PIN before queueing.');
  }
  const queue = loadQueue();
  let photoDataUrl: string | null | undefined = payload.photoDataUrl ?? null;
  if (!photoDataUrl && photoBlob) {
    try {
      photoDataUrl = await blobToDataUrl(photoBlob);
    } catch (error) {
      console.error('Failed to encode photo for offline queue', error);
    }
  }

  const entry: QueuedKioskPunch = {
    id: randomId(),
    payload: { ...payload, photoDataUrl },
  };
  queue.push(entry);
  saveQueue(queue);
  return entry;
};

type PunchSender = (input: QueuedKioskPunch['payload'] & { photoBlob?: Blob }) => Promise<unknown>;

// Module-level guard: when several `onSuccess` handlers fire in quick
// succession during a shift change, each used to call `flushQueuedPunches`
// concurrently. Without a mutex they would all read the same queue snapshot
// from localStorage and resend the same entries up to N times. This serialises
// to a single in-flight flush.
let flushing = false;

export const flushQueuedPunches = async (sendPunch: PunchSender) => {
  if (flushing) {
    return { flushed: 0, remaining: loadQueue().length };
  }
  flushing = true;
  try {
    const queue = loadQueue();
    if (queue.length === 0) return { flushed: 0, remaining: 0 };

    let flushed = 0;
    const remaining: QueuedKioskPunch[] = [];

    for (let i = 0; i < queue.length; i += 1) {
      const entry = queue[i];
      try {
        const photoBlob =
          entry.payload.photoDataUrl ? await dataUrlToBlob(entry.payload.photoDataUrl) : undefined;

        const payload = entry.payload;
        if (!payload.employee_id) {
          throw new Error('Missing employee_id for queued punch');
        }

        const { restaurant_id, employee_id, punch_type, punch_time, notes, location, device_info } = payload;

        await sendPunch({
          restaurant_id,
          employee_id,
          punch_type,
          punch_time,
          notes,
          location,
          device_info,
          photoBlob,
        });
        flushed += 1;
      } catch (error) {
        console.warn('Failed to flush kiosk punch, will retry later', error);
        // Preserve the failed entry AND every entry we never attempted —
        // otherwise a network failure on entry 1 of 5 silently drops 2-5.
        remaining.push(entry, ...queue.slice(i + 1));
        break;
      }
    }

    saveQueue(remaining);
    return { flushed, remaining: remaining.length };
  } finally {
    flushing = false;
  }
};

export const hasQueuedPunches = () => loadQueue().length > 0;

export const isLikelyOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// Optional helper if we want to quickly test connectivity without a write
export const pingSupabase = async () => {
  try {
    const { error } = await supabase.from('time_punches').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
};
