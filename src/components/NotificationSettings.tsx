import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Bell, Mail, Users, CheckCircle, Newspaper } from 'lucide-react';
import { useNotificationSettings, useUpdateNotificationSettings } from '@/hooks/useNotificationSettings';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';

interface NotificationSettingsProps {
  restaurantId: string;
}

export function NotificationSettings({ restaurantId }: NotificationSettingsProps) {
  const { settings, loading } = useNotificationSettings(restaurantId);
  const updateSettings = useUpdateNotificationSettings();
  const { preferences: briefPrefs, updatePreferences: updateBriefPrefs, isUpdating: briefUpdating } = useNotificationPreferences(restaurantId);

  const [localSettings, setLocalSettings] = useState({
    notify_time_off_request: true,
    notify_time_off_approved: true,
    notify_time_off_rejected: true,
    time_off_notify_managers: true,
    time_off_notify_employee: true,
  });

  useEffect(() => {
    if (settings) {
      setLocalSettings({
        notify_time_off_request: settings.notify_time_off_request ?? true,
        notify_time_off_approved: settings.notify_time_off_approved ?? true,
        notify_time_off_rejected: settings.notify_time_off_rejected ?? true,
        time_off_notify_managers: settings.time_off_notify_managers ?? true,
        time_off_notify_employee: settings.time_off_notify_employee ?? true,
      });
    }
  }, [settings]);

  const handleSave = () => {
    updateSettings.mutate({
      restaurantId,
      settings: localSettings,
    });
  };

  const hasChanges = settings && (
    localSettings.notify_time_off_request !== settings.notify_time_off_request ||
    localSettings.notify_time_off_approved !== settings.notify_time_off_approved ||
    localSettings.notify_time_off_rejected !== settings.notify_time_off_rejected ||
    localSettings.time_off_notify_managers !== settings.time_off_notify_managers ||
    localSettings.time_off_notify_employee !== settings.time_off_notify_employee
  );

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
            Configure email notifications for time-off requests and other events
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Time-Off Request Notifications
          </CardTitle>
          <CardDescription>
            Choose which time-off events trigger email notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-request" className="text-base">
                New Request Submitted
              </Label>
              <p className="text-sm text-muted-foreground">
                Send notification when a time-off request is created
              </p>
            </div>
            <Switch
              id="notify-request"
              checked={localSettings.notify_time_off_request}
              onCheckedChange={(checked) =>
                setLocalSettings({ ...localSettings, notify_time_off_request: checked })
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-approved" className="text-base">
                Request Approved
              </Label>
              <p className="text-sm text-muted-foreground">
                Send notification when a time-off request is approved
              </p>
            </div>
            <Switch
              id="notify-approved"
              checked={localSettings.notify_time_off_approved}
              onCheckedChange={(checked) =>
                setLocalSettings({ ...localSettings, notify_time_off_approved: checked })
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-rejected" className="text-base">
                Request Rejected
              </Label>
              <p className="text-sm text-muted-foreground">
                Send notification when a time-off request is rejected
              </p>
            </div>
            <Switch
              id="notify-rejected"
              checked={localSettings.notify_time_off_rejected}
              onCheckedChange={(checked) =>
                setLocalSettings({ ...localSettings, notify_time_off_rejected: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

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
              checked={localSettings.time_off_notify_managers}
              onCheckedChange={(checked) =>
                setLocalSettings({ ...localSettings, time_off_notify_managers: checked })
              }
            />
          </div>

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
              checked={localSettings.time_off_notify_employee}
              onCheckedChange={(checked) =>
                setLocalSettings({ ...localSettings, time_off_notify_employee: checked })
              }
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

      <div className="flex justify-end gap-2">
        {hasChanges && (
          <Button
            variant="outline"
            onClick={() => {
              if (settings) {
                setLocalSettings({
                  notify_time_off_request: settings.notify_time_off_request,
                  notify_time_off_approved: settings.notify_time_off_approved,
                  notify_time_off_rejected: settings.notify_time_off_rejected,
                  time_off_notify_managers: settings.time_off_notify_managers,
                  time_off_notify_employee: settings.time_off_notify_employee,
                });
              }
            }}
          >
            Reset Changes
          </Button>
        )}
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateSettings.isPending}
        >
          {updateSettings.isPending ? (
            'Saving...'
          ) : (
            <>
              <CheckCircle className="h-4 w-4 mr-2" />
              Save Settings
            </>
          )}
        </Button>
      </div>

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
