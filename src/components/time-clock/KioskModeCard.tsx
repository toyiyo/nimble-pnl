import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { 
  TabletSmartphone, Shield, Unlock, ChevronDown, UserCog, 
  RefreshCcw, Loader2, Copy 
} from 'lucide-react';
import { format } from 'date-fns';

interface KioskModeCardProps {
  kioskActive: boolean;
  locationName: string;
  session: { started_at?: string; kiosk_instance_id?: string } | null;
  kioskAccount: { email: string } | null;
  kioskAccountLoading: boolean;
  generatedCreds: { email: string; password: string } | null;
  onLaunchKiosk: () => void;
  onExitKiosk: () => void;
  onCreateOrRotate: () => Promise<void>;
  onClearCreds: () => void;
  isCreating: boolean;
  pinPolicy: { minLength: number; forceResetOnNext: boolean };
  onPolicyChange: (updates: Partial<{ minLength: number; forceResetOnNext: boolean }>) => void;
}

export function KioskModeCard({
  kioskActive,
  locationName,
  session,
  kioskAccount,
  kioskAccountLoading,
  generatedCreds,
  onLaunchKiosk,
  onExitKiosk,
  onCreateOrRotate,
  onClearCreds,
  isCreating,
  pinPolicy,
  onPolicyChange,
}: KioskModeCardProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <TabletSmartphone className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Kiosk Mode</CardTitle>
              <CardDescription>PIN clock-in for {locationName}</CardDescription>
            </div>
          </div>
          <Badge variant={kioskActive ? 'default' : 'outline'}>
            {kioskActive ? 'Active' : 'Off'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Primary Toggle Area */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border">
          <div className="space-y-1">
            <p className="text-sm font-medium">Enable kiosk for this location</p>
            <p className="text-xs text-muted-foreground">
              Locks this device to PIN-only clock-in mode.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={onLaunchKiosk}>
              <Shield className="h-4 w-4 mr-2" />
              Launch
            </Button>
            {kioskActive && (
              <Button size="sm" variant="outline" onClick={onExitKiosk}>
                <Unlock className="h-4 w-4 mr-2" />
                Exit
              </Button>
            )}
          </div>
        </div>

        {/* Session Info (if active) */}
        {session?.started_at && (
          <div className="text-xs text-muted-foreground pl-1">
            Started {format(new Date(session.started_at), 'MMM d, h:mm a')}
            {session.kiosk_instance_id && (
              <span className="ml-2">• Instance: {session.kiosk_instance_id.slice(0, 8)}</span>
            )}
          </div>
        )}

        {/* Advanced Settings */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2">
            <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            Advanced
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-2">
            {/* PIN Rules */}
            <div className="p-4 rounded-lg border bg-card space-y-4">
              <div className="flex items-center justify-between">
                <Label>Minimum PIN digits</Label>
                <Select
                  value={String(pinPolicy.minLength)}
                  onValueChange={(value) => onPolicyChange({ minLength: Number(value) })}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4</SelectItem>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="6">6</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Force update on first use</div>
                  <p className="text-xs text-muted-foreground">Mark new PINs as temporary.</p>
                </div>
                <Switch
                  checked={pinPolicy.forceResetOnNext}
                  onCheckedChange={(checked) => onPolicyChange({ forceResetOnNext: checked })}
                />
              </div>
            </div>

            {/* Dedicated Kiosk Login */}
            <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
              <div className="flex items-center gap-2">
                <UserCog className="h-4 w-4 text-primary" />
                <div>
                  <div className="text-sm font-medium">Dedicated kiosk login</div>
                  <p className="text-xs text-muted-foreground">
                    Service account for tablet sign-in.
                  </p>
                </div>
              </div>

              {kioskAccount && (
                <div className="text-xs font-mono text-muted-foreground">
                  {kioskAccount.email}
                </div>
              )}

              {generatedCreds && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-2">
                  <div className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                    New credentials
                  </div>
                  <div className="text-xs font-mono space-y-1">
                    <div>Email: {generatedCreds.email}</div>
                    <div>Password: {generatedCreds.password}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `Email: ${generatedCreds.email}\nPassword: ${generatedCreds.password}`
                        );
                      }}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </Button>
                    <Button size="sm" variant="secondary" className="flex-1" onClick={onClearCreds}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={onCreateOrRotate}
                disabled={isCreating || kioskAccountLoading}
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4 mr-2" />
                )}
                {kioskAccount ? 'Rotate credentials' : 'Create login'}
              </Button>
            </div>

            {/* Deployment Tips */}
            <div className="text-xs text-muted-foreground space-y-1 pl-1">
              <p>• Install as PWA or use Guided Access / App Pinning on tablets.</p>
              <p>• Offline punches queue locally and sync when back online.</p>
              <p>• Rotate credentials after staff turnover or if device is lost.</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
