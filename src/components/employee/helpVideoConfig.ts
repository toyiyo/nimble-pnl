interface HelpVideoEntry {
  videoKey: string;
  videoUrl: string;
  title: string;
  description: string;
  duration: string;
}

// Supabase Storage public URL for help videos bucket
// Uses the app's SUPABASE_URL which resolves to local or production automatically
import { SUPABASE_URL } from '@/integrations/supabase/client';

const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/help-videos`;

export const HELP_VIDEOS: Record<string, HelpVideoEntry> = {
  welcome: {
    videoKey: 'help_video_welcome',
    videoUrl: `${STORAGE_BASE}/welcome.mp4`,
    title: 'Welcome to EasyShiftHQ',
    description: 'A quick overview of your schedule, clock, pay, and more',
    duration: '0:30',
  },
  clock: {
    videoKey: 'help_video_clock',
    videoUrl: `${STORAGE_BASE}/clock.mp4`,
    title: 'How to Clock In & Out',
    description: 'Use the time clock to start and end your shifts',
    duration: '0:20',
  },
  schedule: {
    videoKey: 'help_video_schedule',
    videoUrl: `${STORAGE_BASE}/schedule.mp4`,
    title: 'Viewing Your Schedule',
    description: 'Navigate weeks and see your upcoming shifts',
    duration: '0:20',
  },
  pay: {
    videoKey: 'help_video_pay',
    videoUrl: `${STORAGE_BASE}/pay.mp4`,
    title: 'Understanding Your Pay',
    description: 'View your earnings and pay period breakdown',
    duration: '0:15',
  },
  timecard: {
    videoKey: 'help_video_timecard',
    videoUrl: `${STORAGE_BASE}/timecard.mp4`,
    title: 'Your Timecard',
    description: 'Check your hours worked and period totals',
    duration: '0:15',
  },
  tips: {
    videoKey: 'help_video_tips',
    videoUrl: `${STORAGE_BASE}/tips.mp4`,
    title: 'Your Tips',
    description: 'View tip history, splits, and disputes',
    duration: '0:15',
  },
  shifts: {
    videoKey: 'help_video_shifts',
    videoUrl: `${STORAGE_BASE}/shifts.mp4`,
    title: 'Trading Shifts',
    description: 'Browse available shifts and request trades',
    duration: '0:20',
  },
  requests: {
    videoKey: 'help_video_requests',
    videoUrl: `${STORAGE_BASE}/requests.mp4`,
    title: 'Time Off & Availability',
    description: 'Request time off and set your availability',
    duration: '0:20',
  },
};
