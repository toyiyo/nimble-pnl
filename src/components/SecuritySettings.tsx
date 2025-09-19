import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Shield, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export const SecuritySettings = () => {
  const { toast } = useToast();
  const [isChecking, setIsChecking] = useState(false);

  const securityChecklist = [
    {
      id: 'encryption',
      title: 'Token Encryption',
      description: 'Square OAuth tokens are now encrypted at rest',
      status: 'completed',
      severity: 'high'
    },
    {
      id: 'audit_logging',
      title: 'Security Audit Logging',
      description: 'All security events are logged for monitoring',
      status: 'completed',
      severity: 'medium'
    },
    {
      id: 'leaked_passwords',
      title: 'Leaked Password Protection',
      description: 'Enable protection against compromised passwords',
      status: 'pending',
      severity: 'medium',
      action: 'Enable in Supabase Auth Settings',
      link: 'https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection'
    },
    {
      id: 'rls_policies',
      title: 'Row Level Security',
      description: 'Database access is properly restricted by user roles',
      status: 'completed',
      severity: 'high'
    }
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'pending':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      default:
        return <Shield className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-100 text-green-800">Secured</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Action Required</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'high':
        return <Badge variant="destructive">High Priority</Badge>;
      case 'medium':
        return <Badge variant="secondary">Medium Priority</Badge>;
      case 'low':
        return <Badge variant="outline">Low Priority</Badge>;
      default:
        return null;
    }
  };

  const pendingItems = securityChecklist.filter(item => item.status === 'pending');
  const completedItems = securityChecklist.filter(item => item.status === 'completed');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Security Settings</h2>
          <p className="text-muted-foreground">
            Monitor and manage your application security
          </p>
        </div>
      </div>

      {pendingItems.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {pendingItems.length} security configuration{pendingItems.length > 1 ? 's' : ''} require attention.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Security Checklist
              <Badge variant="outline">
                {completedItems.length}/{securityChecklist.length} Complete
              </Badge>
            </CardTitle>
            <CardDescription>
              Review the security status of your application components
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {securityChecklist.map((item) => (
                <div key={item.id} className="flex items-start justify-between p-4 rounded-lg border">
                  <div className="flex items-start gap-3">
                    {getStatusIcon(item.status)}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{item.title}</h4>
                        {getSeverityBadge(item.severity)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {item.description}
                      </p>
                      {item.action && (
                        <p className="text-sm font-medium text-orange-700">
                          Required: {item.action}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(item.status)}
                    {item.link && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(item.link, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Guide
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security Enhancements Implemented</CardTitle>
            <CardDescription>
              Recent security improvements to your application
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-green-900">Square OAuth Token Encryption</p>
                  <p className="text-sm text-green-700">
                    All payment integration tokens are now encrypted using AES-256-GCM
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-green-900">Security Audit Logging</p>
                  <p className="text-sm text-green-700">
                    All security events are now tracked and logged for monitoring
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-green-900">Row Level Security</p>
                  <p className="text-sm text-green-700">
                    Database access is properly restricted based on user roles and restaurant associations
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription>
            <strong>Next Steps:</strong> To complete the security setup, please enable leaked password protection 
            in your Supabase Auth settings. This will prevent users from using passwords that have been 
            compromised in data breaches.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
};