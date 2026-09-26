import { useMutation, useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { isConnectorRole } from '../../supabase/functions/_shared/connectorRoles';
import {
  getAuthorization,
  submitConsent,
  type ConsentAction,
} from '@/lib/oauthConsentApi';

/**
 * Loads one OAuth authorization request and sends the user's decision.
 * The authorization is single use, so the query never retries or refetches:
 * a refetch after consent would show an error for a used authorization.
 */
export function useOAuthConsent(authorizationId: string | null, userId: string | null) {
  const enabled = !!authorizationId && !!userId;

  const authorization = useQuery({
    queryKey: ['oauth-authorization', authorizationId, userId],
    queryFn: () => getAuthorization(authorizationId as string),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const connectorRestaurantCount = useQuery({
    queryKey: ['oauth-connector-restaurant-count', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_restaurants')
        .select('role')
        .eq('user_id', userId as string);
      if (error) throw error;
      return (data ?? []).filter((row) => isConnectorRole(row.role)).length;
    },
    enabled,
    staleTime: 30_000,
  });

  const decision = useMutation({
    mutationFn: (action: ConsentAction) => submitConsent(authorizationId as string, action),
  });

  return { authorization, connectorRestaurantCount, decision };
}
