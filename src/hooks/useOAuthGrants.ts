import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listOAuthGrants, revokeOAuthGrant } from '@/lib/oauthConsentApi';

const GRANTS_KEY = ['oauth-grants'] as const;

/** The applications (for example Claude) that the user allowed, with a revoke action. */
export function useOAuthGrants(userId: string | null) {
  const queryClient = useQueryClient();

  const grants = useQuery({
    queryKey: [...GRANTS_KEY, userId],
    queryFn: listOAuthGrants,
    enabled: !!userId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const revoke = useMutation({
    mutationFn: (clientId: string) => revokeOAuthGrant(clientId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: GRANTS_KEY }),
  });

  return { grants, revoke };
}
