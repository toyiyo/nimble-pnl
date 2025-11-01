import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash, MapPin, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { ReconciliationItemFind } from '@/hooks/useReconciliation';
import { useToast } from '@/hooks/use-toast';

interface ReconciliationItemFindsProps {
  itemId: string;
  productName: string;
  uom: string;
  onFindsChange: () => void;
  refetchTrigger?: number; // Add trigger to force refetch
}

export function ReconciliationItemFinds({
  itemId,
  productName,
  uom,
  onFindsChange,
  refetchTrigger
}: ReconciliationItemFindsProps) {
  const [finds, setFinds] = useState<ReconciliationItemFind[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchFinds();
  }, [itemId, refetchTrigger]); // Refetch when trigger changes

  const fetchFinds = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reconciliation_item_finds')
        .select('*')
        .eq('reconciliation_item_id', itemId)
        .order('found_at', { ascending: true });

      if (error) throw error;
      setFinds(data || []);
    } catch (error) {
      console.error('Error fetching finds:', error);
      toast({
        title: 'Error loading finds',
        description: 'Failed to load item finds',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFind = async (findId: string) => {
    try {
      // Get the find to know the quantity
      const findToDelete = finds.find(f => f.id === findId);
      if (!findToDelete) return;

      // Delete the find
      const { error: deleteError } = await supabase
        .from('reconciliation_item_finds')
        .delete()
        .eq('id', findId);

      if (deleteError) throw deleteError;

      // Update the actual_quantity in reconciliation_items
      const { data: item, error: fetchError } = await supabase
        .from('reconciliation_items')
        .select('actual_quantity')
        .eq('id', itemId)
        .single();

      if (fetchError) throw fetchError;

      const newActualQuantity = (item.actual_quantity || 0) - Number(findToDelete.quantity);

      const { error: updateError } = await supabase
        .from('reconciliation_items')
        .update({ actual_quantity: Math.max(0, newActualQuantity) })
        .eq('id', itemId);

      if (updateError) throw updateError;

      toast({
        title: 'Find deleted',
        description: 'The find has been removed and count updated'
      });

      await fetchFinds();
      onFindsChange();
    } catch (error) {
      console.error('Error deleting find:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete find',
        variant: 'destructive'
      });
    }
  };

  const totalQuantity = finds.reduce((sum, f) => sum + Number(f.quantity), 0);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading finds...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h4 className="font-semibold">Finds ({finds.length})</h4>
        <div className="text-sm text-muted-foreground">
          Total: <span className="font-semibold text-foreground">{totalQuantity} {uom}</span>
        </div>
      </div>

      <div className="space-y-2">
        {finds.map((find, idx) => (
          <div
            key={find.id}
            className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">#{idx + 1}</Badge>
                <span className="font-semibold">{find.quantity} {uom}</span>
                {find.location && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {find.location}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                <Calendar className="h-3 w-3" />
                {format(new Date(find.found_at), 'MMM d, h:mm a')}
              </div>
              {find.notes && (
                <div className="text-xs text-muted-foreground mt-1 italic">
                  {find.notes}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDeleteFind(find.id)}
              className="ml-2"
              aria-label="Delete find"
            >
              <Trash className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {finds.length === 0 && (
        <div className="text-center py-6 text-muted-foreground text-sm bg-muted/50 rounded-lg">
          No finds yet. Scan or manually add to record finds.
        </div>
      )}
    </div>
  );
}
