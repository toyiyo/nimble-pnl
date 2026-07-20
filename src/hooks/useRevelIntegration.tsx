import { useRevelConnection, RevelConnection } from '@/hooks/useRevelConnection';

/** Thin status hook mirroring useToastIntegration's { isConnected, connection } shape. */
export function useRevelIntegration(restaurantId: string | null): {
  isConnected: boolean;
  connection: RevelConnection | null;
} {
  const { isConnected, connection } = useRevelConnection(restaurantId);
  return { isConnected, connection: connection ?? null };
}
