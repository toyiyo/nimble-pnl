import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAutomaticInventoryDeduction } from '@/hooks/useAutomaticInventoryDeduction';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { supabase } from '@/integrations/supabase/client';
import { Settings, Zap, Clock, CheckCircle } from 'lucide-react';

export function AutoDeductionSettings() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { setupAutoDeduction, autoDeductionEnabled, setAutoDeductionEnabled } = useAutomaticInventoryDeduction();
  const { selectedRestaurant } = useRestaurantContext();
  const { toast } = useToast();

  // Sync loading state with hook's data fetching
  useEffect(() => {
    const initializeSettings = async () => {
      if (!selectedRestaurant?.restaurant_id) return;
      
      setIsLoading(true);
      // Check if record exists, create if not
      const { data } = await supabase
        .from('auto_deduction_settings')
        .select('enabled')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .maybeSingle();

      if (!data) {
        // No record exists, create one with default false
        await supabase
          .from('auto_deduction_settings')
          .insert({
            restaurant_id: selectedRestaurant.restaurant_id,
            enabled: false
          });
      }
      setIsLoading(false);
    };

    initializeSettings();
  }, [selectedRestaurant?.restaurant_id]);

  // Handle toggle change - save to database
  const handleToggleChange = async (checked: boolean) => {
    if (!selectedRestaurant?.restaurant_id) return;

    const { error } = await supabase
      .from('auto_deduction_settings')
      .upsert({
        restaurant_id: selectedRestaurant.restaurant_id,
        enabled: checked
      }, {
        onConflict: 'restaurant_id'
      });

    if (error) {
      console.error('Error updating auto deduction settings:', error);
      toast({
        title: "Error",
        description: "Failed to update auto deduction settings",
        variant: "destructive"
      });
    } else {
      setAutoDeductionEnabled(checked);
      toast({
        title: checked ? "Auto Deduction Enabled" : "Auto Deduction Disabled",
        description: checked 
          ? "Inventory will be automatically deducted for new POS sales"
          : "Automatic deduction has been disabled"
      });
    }
  };

  const handleManualSync = async () => {
    setIsProcessing(true);
    try {
      await setupAutoDeduction();
      toast({
        title: "Sync Complete",
        description: "Manual inventory deduction sync completed successfully",
      });
    } catch (error) {
      toast({
        title: "Sync Failed", 
        description: "Failed to sync inventory deductions",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Automatic Inventory Deduction
        </CardTitle>
        <CardDescription>
          Configure automatic inventory deduction when POS sales are processed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Auto Deduction Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="font-medium">Enable Auto Deduction</div>
            <div className="text-sm text-muted-foreground">
              Automatically deduct inventory when new POS sales are synced
            </div>
          </div>
          <Switch
            checked={autoDeductionEnabled}
            onCheckedChange={handleToggleChange}
            disabled={isLoading}
          />
        </div>

        {/* Status Indicators */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <Zap className="w-4 h-4 text-green-500" />
            <div>
              <div className="font-medium text-sm">Real-time Processing</div>
              <Badge variant={autoDeductionEnabled ? "default" : "secondary"} className="text-xs">
                {autoDeductionEnabled ? "Active" : "Disabled"}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <Clock className="w-4 h-4 text-blue-500" />
            <div>
              <div className="font-medium text-sm">Batch Processing</div>
              <Badge variant="outline" className="text-xs">Available</Badge>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <CheckCircle className="w-4 h-4 text-purple-500" />
            <div>
              <div className="font-medium text-sm">Duplicate Prevention</div>
              <Badge variant="outline" className="text-xs">Protected</Badge>
            </div>
          </div>
        </div>

        {/* Manual Actions */}
        <div className="space-y-3">
          <div className="font-medium">Manual Actions</div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={handleManualSync}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Process Pending Sales'}
            </Button>
            <Button 
              variant="outline" 
              onClick={() => window.open('/pos-sales', '_blank')}
            >
              View POS Sales
            </Button>
          </div>
        </div>

        {/* Configuration Info */}
        <div className="p-4 bg-muted rounded-lg">
          <div className="font-medium text-sm mb-2">How it works:</div>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• New POS sales automatically trigger inventory deductions</li>
            <li>• Recipe ingredients are deducted based on conversion factors</li>
            <li>• Duplicate processing is prevented using unique sale references</li>
            <li>• All deductions are logged for audit trail</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}