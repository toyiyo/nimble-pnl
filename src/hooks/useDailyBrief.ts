import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DailyBrief {
  id: string;
  restaurant_id: string;
  brief_date: string;
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
    prior_day: number | null;
    delta_vs_prior: number | null;
    delta_pct_vs_prior: number | null;
    same_day_last_week: number | null;
    avg_7day: number | null;
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

export function useDailyBrief(restaurantId: string | undefined, date?: string) {
  const briefDate = date || new Date(Date.now() - 86400000).toISOString().split('T')[0]; // yesterday

  return useQuery({
    queryKey: ['daily-brief', restaurantId, briefDate],
    queryFn: async () => {
      if (!restaurantId) return null;

      const { data, error } = await (supabase
        .from('daily_brief' as never) as ReturnType<typeof supabase.from>)
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('brief_date', briefDate)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as DailyBrief | null;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });
}

export function useDailyBriefHistory(restaurantId: string | undefined, limit = 14) {
  return useQuery({
    queryKey: ['daily-brief-history', restaurantId, limit],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await (supabase
        .from('daily_brief' as never) as ReturnType<typeof supabase.from>)
        .select('id, brief_date, metrics_json, narrative, computed_at')
        .eq('restaurant_id', restaurantId)
        .order('brief_date', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });
}
