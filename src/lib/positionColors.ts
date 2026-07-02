export interface PositionColors {
  bg: string;
  border: string;
  text: string;
}

export const POSITION_COLORS: Record<string, PositionColors> = {
  server: { bg: 'bg-blue-500/15', border: 'border-blue-500/30', text: 'text-blue-700 dark:text-blue-300' },
  cook: { bg: 'bg-orange-500/15', border: 'border-orange-500/30', text: 'text-orange-700 dark:text-orange-300' },
  bartender: { bg: 'bg-purple-500/15', border: 'border-purple-500/30', text: 'text-purple-700 dark:text-purple-300' },
  host: { bg: 'bg-green-500/15', border: 'border-green-500/30', text: 'text-green-700 dark:text-green-300' },
  manager: { bg: 'bg-red-500/15', border: 'border-red-500/30', text: 'text-red-700 dark:text-red-300' },
};

export const DEFAULT_POSITION_COLORS: PositionColors = {
  bg: 'bg-muted/50',
  border: 'border-border/40',
  text: 'text-foreground',
};

export function getPositionColors(position: string): PositionColors {
  return POSITION_COLORS[position.toLowerCase()] ?? DEFAULT_POSITION_COLORS;
}
