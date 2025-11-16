import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useSquareIntegration } from '@/hooks/useSquareIntegration';
import { useCloverIntegration } from '@/hooks/useCloverIntegration';
import { useShift4Integration } from '@/hooks/useShift4Integration';
import { SquareSync } from '@/components/SquareSync';
import { CloverSync } from '@/components/CloverSync';
import { Shift4Sync } from '@/components/Shift4Sync';
import { Shift4ConnectDialog } from '@/components/Shift4ConnectDialog';
import { IntegrationLogo } from '@/components/IntegrationLogo';
import { Plug, Settings, CheckCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Integration {
  id: string;
  name: string;
  description: string;
  category: string;
  logo: string;
  connected: boolean;
  features: string[];
}

interface IntegrationCardProps {
  integration: Integration;
  restaurantId: string;
}

export const IntegrationCard = ({ integration, restaurantId }: IntegrationCardProps) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [showShift4Dialog, setShowShift4Dialog] = useState(false);
  const { toast } = useToast();
  
  // Square-specific integration hook
  const squareIntegration = useSquareIntegration(restaurantId);
  
  // Clover-specific integration hook
  const cloverIntegration = useCloverIntegration(restaurantId);
  
  // Shift4-specific integration hook
  const shift4Integration = useShift4Integration(restaurantId);
  
  // Check if this integration is Square, Clover, or Shift4 and if it's connected
  const isSquareIntegration = integration.id === 'square-pos';
  const isCloverIntegration = integration.id === 'clover-pos';
  const isShift4Integration = integration.id === 'shift4-pos';
  const actuallyConnected = isSquareIntegration ? squareIntegration.isConnected : 
                            isCloverIntegration ? cloverIntegration.isConnected :
                            isShift4Integration ? shift4Integration.isConnected :
                            integration.connected;
  const actuallyConnecting = isSquareIntegration ? squareIntegration.isConnecting : 
                             isCloverIntegration ? cloverIntegration.isConnecting :
                             isShift4Integration ? shift4Integration.loading :
                             isConnecting;

  const handleConnect = async () => {
    if (isSquareIntegration) {
      await squareIntegration.connectSquare();
      return;
    }
    
    if (isCloverIntegration) {
      await cloverIntegration.connectClover('na');
      return;
    }
    
    if (isShift4Integration) {
      setShowShift4Dialog(true);
      return;
    }
    
    // For other integrations, show coming soon message
    setIsConnecting(true);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      toast({
        title: "Integration Coming Soon",
        description: `${integration.name} integration is currently in development. You'll be notified when it's available.`,
      });
    } catch (error) {
      toast({
        title: "Connection Failed",
        description: "Failed to connect to the integration. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleShift4Connect = async (secretKey: string, environment: 'production' | 'sandbox') => {
    await shift4Integration.connectShift4(secretKey, undefined, environment);
    setShowShift4Dialog(false);
  };

  const handleDisconnect = async () => {
    if (isSquareIntegration) {
      await squareIntegration.disconnectSquare();
      return;
    }
    
    if (isCloverIntegration) {
      await cloverIntegration.disconnectClover();
      return;
    }
    
    if (isShift4Integration) {
      await shift4Integration.disconnectShift4();
      return;
    }
    
    toast({
      title: "Disconnected",
      description: `Successfully disconnected from ${integration.name}`,
    });
  };

  const handleConfigure = () => {
    toast({
      title: "Configuration",
      description: `Opening ${integration.name} configuration settings...`,
    });
  };

  return (
    <Card className={cn(
      "h-full transition-all duration-300 hover:shadow-lg relative overflow-hidden group",
      actuallyConnected && "border-2 border-emerald-500/20"
    )}>
      {/* Gradient overlay for connected state */}
      {actuallyConnected && (
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />
      )}
      
      <CardHeader className="relative">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {/* Logo with background */}
            <div className={cn(
              "w-12 h-12 rounded-lg flex items-center justify-center transition-transform duration-300 group-hover:scale-110",
              actuallyConnected ? "bg-emerald-500/10" : "bg-muted"
            )}>
              <IntegrationLogo integrationId={integration.id} size={28} />
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {integration.name}
                {actuallyConnected && (
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                )}
              </CardTitle>
              <Badge variant="secondary" className="text-xs mt-1">
                {integration.category}
              </Badge>
            </div>
          </div>
        </div>
        <CardDescription className="text-sm mt-2">
          {integration.description}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4 relative">
        {/* Features */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Key Features</p>
          <div className="flex flex-wrap gap-2">
            {integration.features.map((feature) => (
              <Badge 
                key={feature} 
                variant="outline" 
                className="text-xs bg-background/50 hover:bg-muted/50 transition-colors"
              >
                {feature}
              </Badge>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-2">
          {actuallyConnected ? (
            <>
              <Button 
                variant="outline" 
                className="w-full hover:bg-muted transition-colors" 
                onClick={handleConfigure}
              >
                <Settings className="h-4 w-4 mr-2" />
                Configure
              </Button>
              <Button 
                variant="destructive" 
                size="sm" 
                className="w-full" 
                onClick={handleDisconnect}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button 
              className="w-full bg-primary hover:bg-primary/90 transition-all hover:shadow-md" 
              onClick={handleConnect}
              disabled={actuallyConnecting}
            >
              <Plug className="h-4 w-4 mr-2" />
              {actuallyConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          )}
        </div>

        {actuallyConnected && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
              <Clock className="h-3 w-3" />
              {isSquareIntegration && squareIntegration.connection ? 
                `Connected: ${new Date(squareIntegration.connection.connected_at).toLocaleDateString()}` :
              isCloverIntegration && cloverIntegration.connection ?
                `Connected: ${new Date(cloverIntegration.connection.connected_at).toLocaleDateString()}` :
              isShift4Integration && shift4Integration.connection ?
                `Connected: ${new Date(shift4Integration.connection.connected_at).toLocaleDateString()}` :
                'Last sync: 2 hours ago'
              }
            </div>
            
            {/* Square Sync Component */}
            {isSquareIntegration && (
              <SquareSync 
                restaurantId={restaurantId} 
                isConnected={actuallyConnected} 
              />
            )}
            
            {/* Clover Sync Component */}
            {isCloverIntegration && (
              <CloverSync 
                restaurantId={restaurantId} 
                isConnected={actuallyConnected} 
              />
            )}
            
            {/* Shift4 Sync Component */}
            {isShift4Integration && (
              <Shift4Sync 
                restaurantId={restaurantId} 
                isConnected={actuallyConnected} 
              />
            )}
          </div>
        )}
      </CardContent>
      
      {/* Shift4 Connect Dialog */}
      <Shift4ConnectDialog
        open={showShift4Dialog}
        onOpenChange={setShowShift4Dialog}
        onConnect={handleShift4Connect}
        isLoading={shift4Integration.loading}
      />
    </Card>
  );
};
