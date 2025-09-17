import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useSquareIntegration } from '@/hooks/useSquareIntegration';
import { SquareSync } from '@/components/SquareSync';
import { Plug, Settings, CheckCircle } from 'lucide-react';

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
  const { toast } = useToast();
  
  // Square-specific integration hook
  const squareIntegration = useSquareIntegration(restaurantId);
  
  // Check if this integration is Square and if it's connected
  const isSquareIntegration = integration.id === 'square-pos';
  const actuallyConnected = isSquareIntegration ? squareIntegration.isConnected : integration.connected;
  const actuallyConnecting = isSquareIntegration ? squareIntegration.isConnecting : isConnecting;

  const handleConnect = async () => {
    if (isSquareIntegration) {
      // Use Square-specific connection logic
      await squareIntegration.connectSquare();
      return;
    }
    
    // For other integrations, show coming soon message
    setIsConnecting(true);
    
    try {
      // Simulate connection process
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

  const handleDisconnect = async () => {
    if (isSquareIntegration) {
      await squareIntegration.disconnectSquare();
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
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">{integration.logo}</div>
            <div>
              <CardTitle className="text-lg">{integration.name}</CardTitle>
              <Badge variant="secondary" className="text-xs mt-1">
                {integration.category}
              </Badge>
            </div>
          </div>
          {actuallyConnected && (
            <CheckCircle className="h-5 w-5 text-green-500" />
          )}
        </div>
        <CardDescription className="text-sm">
          {integration.description}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Features */}
        <div>
          <p className="text-sm font-medium mb-2">Features:</p>
          <div className="flex flex-wrap gap-1">
            {integration.features.map((feature) => (
              <Badge key={feature} variant="outline" className="text-xs">
                {feature}
              </Badge>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          {actuallyConnected ? (
            <>
              <Button 
                variant="outline" 
                className="w-full" 
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
              className="w-full" 
              onClick={handleConnect}
              disabled={actuallyConnecting}
            >
              <Plug className="h-4 w-4 mr-2" />
              {actuallyConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          )}
        </div>

        {actuallyConnected && (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              {isSquareIntegration && squareIntegration.connection ? 
                `Connected: ${new Date(squareIntegration.connection.connected_at).toLocaleDateString()}` :
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
          </div>
        )}
      </CardContent>
    </Card>
  );
};