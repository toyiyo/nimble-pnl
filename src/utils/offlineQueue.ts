import { supabase } from '@/integrations/supabase/client';
import { verifyPinForRestaurant } from '@/hooks/useKioskPins';

export type QueuedKioskPunch = {
  id: string;
  payload: {
    restaurant_id: string;
    employee_id?: string;
    pin?: string;
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

const randomId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `kiosk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const addQueuedPunch = async (
  payload: QueuedKioskPunch['payload'],
  photoBlob?: Blob | null
) => {
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

type PunchSender = (input: QueuedKioskPunch['payload'] & { photoBlob?: Blob }) => Promise<any>;

export const flushQueuedPunches = async (sendPunch: PunchSender) => {
  const queue = loadQueue();
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  let flushed = 0;
  const remaining: QueuedKioskPunch[] = [];

  for (const entry of queue) {
    try {
      const photoBlob =
        entry.payload.photoDataUrl ? await dataUrlToBlob(entry.payload.photoDataUrl) : undefined;

      let payload = entry.payload;
      if (!payload.employee_id && payload.pin) {
        const match = await verifyPinForRestaurant(payload.restaurant_id, payload.pin);
        if (!match?.employee_id) {
          throw new Error('PIN not recognized during sync');
        }
        payload = { ...payload, employee_id: match.employee_id };
      }

      if (!payload.employee_id) {
        throw new Error('Missing employee_id for queued punch');
      }

      await sendPunch({ ...payload, photoBlob });
      flushed += 1;
    } catch (error) {
      console.warn('Failed to flush kiosk punch, will retry later', error);
      remaining.push(entry);
      break; // Stop early to avoid hammering while offline
    }
  }

  saveQueue(remaining);
  return { flushed, remaining: remaining.length };
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
