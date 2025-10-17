import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { IntegrationLogo } from "@/components/IntegrationLogo";
import { format } from "date-fns";

interface POSSystemStatusProps {
  integrationStatuses: Array<{
    system: string;
    isConnected: boolean;
    lastSync?: string;
  }>;
  onSync: (system: string) => void;
  isSyncing: boolean;
}

const systemColors: Record<string, string> = {
  "Square": "border-l-blue-500",
  "Clover": "border-l-green-500",
  "Toast": "border-l-orange-500",
  "Manual": "border-l-purple-500",
};

export const POSSystemStatus = ({ integrationStatuses, onSync, isSyncing }: POSSystemStatusProps) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {integrationStatuses.map((status, index) => (
        <Card
          key={status.system}
          className={`border-l-4 ${systemColors[status.system] || "border-l-gray-500"} hover:shadow-md transition-all duration-300 animate-fade-in`}
          style={{ animationDelay: `${index * 100}ms` }}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <IntegrationLogo
                  integrationId={status.system.toLowerCase().replace(" ", "-") + "-pos"}
                  size={24}
                />
                <span className="font-semibold text-sm">{status.system}</span>
              </div>
              {status.isConnected ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-gray-400" />
              )}
            </div>
            
            <div className="space-y-2">
              <Badge
                variant={status.isConnected ? "default" : "secondary"}
                className="text-xs w-full justify-center"
              >
                {status.isConnected ? "Connected" : "Not Connected"}
              </Badge>
              
              {status.isConnected && status.lastSync && (
                <p className="text-xs text-muted-foreground text-center">
                  {format(new Date(status.lastSync), "MMM d, h:mm a")}
                </p>
              )}
              
              {status.isConnected && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSync(status.system)}
                  disabled={isSyncing}
                  className="w-full text-xs"
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${isSyncing ? "animate-spin" : ""}`} />
                  Sync
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
