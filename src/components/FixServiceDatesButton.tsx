import React from 'react';
import { Button } from '@/components/ui/button';
import { useFixServiceDates } from '@/hooks/useFixServiceDates';
import { RefreshCw } from 'lucide-react';

interface FixServiceDatesButtonProps {
  restaurantId: string;
  onComplete?: () => void;
}

export function FixServiceDatesButton({ restaurantId, onComplete }: FixServiceDatesButtonProps) {
  const { fixServiceDates, loading } = useFixServiceDates();

  const handleFix = async () => {
    try {
      await fixServiceDates(restaurantId);
      onComplete?.();
    } catch (error) {
      // Error is handled by the hook
    }
  };

  return (
    <Button 
      onClick={handleFix} 
      disabled={loading}
      variant="outline"
      className="gap-2"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      {loading ? 'Fixing Dates...' : 'Fix Timezone Dates'}
    </Button>
  );
}