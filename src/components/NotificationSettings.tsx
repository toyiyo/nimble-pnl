import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Bell, Users, Newspaper, AlertTriangle } from 'lucide-react';
import { useNotificationSettings, useUpdateNotificationSettings } from '@/hooks/useNotificationSettings';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { useApproverCount } from '@/hooks/useApproverCount';
import { NotificationChannelMatrix } from '@/components/NotificationChannelMatrix';

interface NotificationSettingsProps {
  restaurantId: string;
}

export function NotificationSettings({ restaurantId }: NotificationSettingsProps) {
  const { settings, loading } = useNotificationSettings(restaurantId);
  const updateSettings = useUpdateNotificationSettings();
  const { preferences: briefPrefs, updatePreferences: updateBriefPrefs, isUpdating: briefUpdating } =
    useNotificationPreferences(restaurantId);
  const {
    data: approverCount,
    isLoading: approverCountLoading,
    isError: approverCountError,
  } = useApproverCount(restaurantId);

  // notify_time_off_request/approved/rejected are retired here — those event
  // toggles are now governed by the NotificationChannelMatrix (per-type ×
  // per-channel). time_off_notify_managers/employee remain: they're recipient
  // routing (WHO gets notified), orthogonal to the channel matrix (WHETHER a
  // channel fires). Like every other control on this page, they save on toggle
  // (no Save button) — see the design doc.
  const notifyManagers = settings?.time_off_notify_managers ?? true;
  const notifyEmployee = settings?.time_off_notify_employee ?? true;
  const savingRecipients = updateSettings.isPending;

  const showNoApproversWarning =
    !approverCountLoading &&
    !approverCountError &&
    approverCount !== undefined &&
    notifyManagers &&
    approverCount === 0;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notification Settings</CardTitle>
          <CardDescription>Loading notification settings...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <CardTitle>Notification Settings</CardTitle>
          </div>
          <CardDescription>
            Choose which channels each notification type sends over, who receives time-off
            emails, and your weekly performance digest. Every toggle saves automatically.
          </CardDescription>
        </CardHeader>
      </Card>

      <NotificationChannelMatrix restaurantId={restaurantId} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Notification Recipients
          </CardTitle>
          <CardDescription>
            Choose who receives time-off notification emails
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-managers" className="text-base">
                Notify Managers
              </Label>
              <p className="text-sm text-muted-foreground">
                Send notifications to all owners and managers
              </p>
            </div>
            <Switch
              id="notify-managers"
              checked={notifyManagers}
              disabled={savingRecipients}
              onCheckedChange={(checked) =>
                updateSettings.mutate({ restaurantId, settings: { time_off_notify_managers: checked } })
              }
              className="data-[state=checked]:bg-foreground"
            />
          </div>

          {showNoApproversWarning && (
            <div
              role="alert"
              className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
            >
              <AlertTriangle
                className="h-4 w-4 text-amber-600 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <div className="text-[13px]">
                <p className="font-medium text-foreground">No approvers configured</p>
                <p className="text-muted-foreground mt-0.5">
                  This restaurant has no owners or managers set up to receive notifications.
                  Invite a teammate with owner or manager access from the Team page.
                </p>
              </div>
            </div>
          )}

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-employee" className="text-base">
                Notify Employee
              </Label>
              <p className="text-sm text-muted-foreground">
                Send notifications to the employee who submitted the request
              </p>
            </div>
            <Switch
              id="notify-employee"
              checked={notifyEmployee}
              disabled={savingRecipients}
              onCheckedChange={(checked) =>
                updateSettings.mutate({ restaurantId, settings: { time_off_notify_employee: checked } })
              }
              className="data-[state=checked]:bg-foreground"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            Weekly Brief
          </CardTitle>
          <CardDescription>
            Receive a weekly summary of your restaurant's performance via email
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="weekly-brief-email" className="text-base">
                Weekly Brief Email
              </Label>
              <p className="text-sm text-muted-foreground">
                Receive a Monday morning email with key metrics, variances, and action items
              </p>
            </div>
            <Switch
              id="weekly-brief-email"
              checked={briefPrefs?.weekly_brief_email ?? true}
              disabled={briefUpdating}
              onCheckedChange={(checked) =>
                updateBriefPrefs({ weekly_brief_email: checked })
              }
              className="data-[state=checked]:bg-foreground"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/50">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            <strong>Note:</strong> Email notifications are sent to registered email addresses only.
            Make sure employees and managers have valid email addresses in their profiles.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
