import { formatWholeDollarAmount } from '@/lib/formatWholeDollarAmount';

export type BreakEvenHeadlineTone = 'positive' | 'negative' | 'neutral';

export interface BreakEvenHeadlineInput {
  todayStatus: 'above' | 'at' | 'below';
  todayDelta: number;
  dailyBreakEven: number;
  todaySales: number;
}

export interface BreakEvenHeadline {
  tone: BreakEvenHeadlineTone;
  sentence: string;
  progressPercent: number;
}

const NO_TARGET_HEADLINE: BreakEvenHeadline = {
  tone: 'neutral',
  sentence: 'Set your operating costs to see break-even.',
  progressPercent: 0,
};

function hasTarget(dailyBreakEven: number): boolean {
  return Number.isFinite(dailyBreakEven) && dailyBreakEven > 0;
}

function buildProgressPercent(todaySales: number, dailyBreakEven: number): number {
  const rawPercent = (todaySales / dailyBreakEven) * 100;
  const boundedPercent = Math.min(100, Math.max(0, rawPercent));
  return Math.round(boundedPercent);
}

/**
 * Build the break-even headline for the Today card.
 * It returns a tone, a visible sentence and a progress percent.
 */
export function buildBreakEvenHeadline(
  data: BreakEvenHeadlineInput | null
): BreakEvenHeadline {
  if (!data || !hasTarget(data.dailyBreakEven)) {
    return NO_TARGET_HEADLINE;
  }

  const { todayStatus, todayDelta, dailyBreakEven, todaySales } = data;
  const progressPercent = buildProgressPercent(todaySales, dailyBreakEven);
  const deltaAmount = formatWholeDollarAmount(Math.abs(todayDelta));

  if (todayStatus === 'above') {
    return {
      tone: 'positive',
      sentence: `Today is ${deltaAmount} above break-even.`,
      progressPercent,
    };
  }

  if (todayStatus === 'below') {
    return {
      tone: 'negative',
      sentence: `You need ${deltaAmount} more today to break even.`,
      progressPercent,
    };
  }

  return {
    tone: 'neutral',
    sentence: 'Today is at break-even.',
    progressPercent,
  };
}
