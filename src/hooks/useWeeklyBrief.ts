import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Table not yet in generated types -- helper avoids repeating the cast
function weeklyBriefTable() {
  return supabase.from('weekly_brief' as never) as ReturnType<typeof supabase.from>;
}

export interface WeeklyBrief {
  id: string;
  restaurant_id: string;
  brief_week_end: string;
  metrics_json: {
    net_revenue?: number;
    food_cost?: number;
    labor_cost?: number;
    prime_cost?: number;
    gross_profit?: number;
    food_cost_pct?: number;
    labor_cost_pct?: number;
    prime_cost_pct?: number;
  };
  comparisons_json: Record<string, unknown>;
  variances_json: Array<{
    metric: string;
    value: number;
    prior_week: number | null;
    delta_vs_prior: number | null;
    delta_pct_vs_prior: number | null;
    avg_4week: number | null;
    delta_pct_vs_avg: number | null;
    direction: 'up' | 'down' | 'flat';
    flag: 'critical' | 'warning' | null;
  }>;
  inbox_summary_json: {
    open_count?: number;
    critical_count?: number;
    top_items?: Array<{ title: string; priority: number; kind: string }>;
  };
  recommendations_json: Array<{
    title: string;
    body: string;
    impact: string;
    effort: string;
  }>;
  narrative: string | null;
  computed_at: string;
  email_sent_at: string | null;
}

function getMostRecentSunday(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek));
  return lastSunday.toISOString().split('T')[0];
}

export function useWeeklyBrief(restaurantId: string | undefined, weekEnd?: string) {
  const briefWeekEnd = weekEnd || getMostRecentSunday();

  return useQuery({
    queryKey: ['weekly-brief', restaurantId, briefWeekEnd],
    queryFn: async () => {
      if (!restaurantId) return null;

      const { data, error } = await weeklyBriefTable()
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('brief_week_end', briefWeekEnd)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as WeeklyBrief | null;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });
}

export function useWeeklyBriefHistory(restaurantId: string | undefined, limit = 14) {
  return useQuery({
    queryKey: ['weekly-brief-history', restaurantId, limit],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await weeklyBriefTable()
        .select('id, brief_week_end, metrics_json, narrative, computed_at')
        .eq('restaurant_id', restaurantId)
        .order('brief_week_end', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });
}
