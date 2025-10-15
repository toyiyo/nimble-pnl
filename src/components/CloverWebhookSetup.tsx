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

  const webhookUrl = "https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/clover-webhooks";

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
          Webhook Setup
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
          Configure real-time data sync from Clover
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Webhooks were automatically configured when you connected to Clover. You can verify the setup below or reconfigure if needed.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <label className="text-sm font-medium">Webhook URL</label>
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
        </div>

        <div className="space-y-3 text-sm">
          <p className="font-medium">Setup Instructions:</p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Go to your{" "}
              <a
                href="https://sandbox.dev.clover.com/developer-home/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Clover Developer Dashboard
              </a>
            </li>
            <li>Navigate to Your Apps → Your App → App Settings → Webhooks</li>
            <li>Paste the webhook URL above in the "Webhook URL" field</li>
            <li>Click "Send Verification Code"</li>
            <li>
              Copy the verification code from the response and paste it in the
              "Verification Code" field
            </li>
            <li>Click "Verify" and then "Save"</li>
            <li>
              Subscribe to event types:
              <ul className="list-disc list-inside ml-4 mt-1">
                <li><strong>Orders</strong> - For real-time sales data</li>
                <li><strong>Payments</strong> - For payment processing updates</li>
                <li><strong>Inventory</strong> - For inventory changes (optional)</li>
              </ul>
            </li>
          </ol>
        </div>

        <Alert>
          <AlertDescription className="text-xs text-muted-foreground">
            <strong>Note:</strong> Each event subscription requires the corresponding read
            permission. Merchants may need to reinstall your app if permissions change.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
