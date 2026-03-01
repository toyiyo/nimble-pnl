import { DomainError, MAX_SHIFT_HOURS } from './types';

function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function toEpoch(businessDate: string, time: string, nextDay: boolean): number {
  const [y, mo, d] = businessDate.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, m));
  if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
  return date.getTime();
}

export class ShiftInterval {
  readonly businessDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly startEpoch: number;
  readonly endEpoch: number;
  readonly endsOnNextDay: boolean;

  private constructor(businessDate: string, startTime: string, endTime: string) {
    this.businessDate = businessDate;
    this.startTime = startTime;
    this.endTime = endTime;
    this.endsOnNextDay = parseTime(endTime) < parseTime(startTime);
    this.startEpoch = toEpoch(businessDate, startTime, false);
    this.endEpoch = toEpoch(businessDate, endTime, this.endsOnNextDay);
  }

  static create(businessDate: string, startTime: string, endTime: string): ShiftInterval {
    const interval = new ShiftInterval(businessDate, startTime, endTime);
    if (interval.durationInMinutes <= 0) {
      throw new DomainError('INTERVAL_ZERO_DURATION', 'Shift must have positive duration');
    }
    if (interval.durationInHours > MAX_SHIFT_HOURS) {
      throw new DomainError('INTERVAL_EXCEEDS_MAX', `Shift exceeds maximum endurance limit of ${MAX_SHIFT_HOURS}h`);
    }
    return interval;
  }

  get durationInMinutes(): number {
    return (this.endEpoch - this.startEpoch) / 60_000;
  }

  get durationInHours(): number {
    return this.durationInMinutes / 60;
  }

  overlapsWith(other: ShiftInterval): boolean {
    return this.startEpoch < other.endEpoch && other.startEpoch < this.endEpoch;
  }

  restHoursBefore(other: ShiftInterval): number {
    const gap = other.startEpoch - this.endEpoch;
    return gap <= 0 ? 0 : gap / 3_600_000;
  }
}
