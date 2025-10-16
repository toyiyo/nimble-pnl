import { useState } from "react";
import { Copy, Check, ExternalLink, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

interface CloverWebhookSetupProps {
  isConnected: boolean;
}

export const CloverWebhookSetup = ({ isConnected }: CloverWebhookSetupProps) => {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  
  if (!supabaseUrl) {
    console.error("VITE_SUPABASE_URL is not configured");
  }
  
  const webhookUrl = supabaseUrl 
    ? `${supabaseUrl}/functions/v1/clover-webhooks`
    : "Webhook URL not configured - missing VITE_SUPABASE_URL";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast({
        title: "Copied!",
        description: "Webhook URL copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Please copy the URL manually",
        variant: "destructive",
      });
    }
  };

  if (!isConnected) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Webhook Configuration
          <a
            href="https://docs.clover.com/dev/docs/webhooks"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-normal text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </CardTitle>
        <CardDescription>
          Technical reference for debugging
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Webhook Endpoint</label>
          <div className="flex gap-2">
            <div className="flex-1 p-3 bg-muted rounded-md font-mono text-sm break-all">
              {webhookUrl}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              title="Copy webhook URL"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            This endpoint was automatically registered with your Clover account during connection.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
