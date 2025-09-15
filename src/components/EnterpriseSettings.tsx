import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Building, Shield, Zap, Key, Users, Link, Server } from 'lucide-react';

interface EnterpriseConfig {
  scim_enabled: boolean;
  scim_endpoint: string;
  scim_token: string;
  sso_enabled: boolean;
  sso_provider: string;
  sso_domain: string;
  auto_provisioning: boolean;
  default_role: string;
}

interface EnterpriseSettingsProps {
  restaurantId: string;
}

export const EnterpriseSettings = ({ restaurantId }: EnterpriseSettingsProps) => {
  const [config, setConfig] = useState<EnterpriseConfig>({
    scim_enabled: false,
    scim_endpoint: '',
    scim_token: '',
    sso_enabled: false,
    sso_provider: 'saml',
    sso_domain: '',
    auto_provisioning: false,
    default_role: 'staff',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchEnterpriseConfig();
  }, [restaurantId]);

  const fetchEnterpriseConfig = async () => {
    try {
      // Fetch from enterprise_settings table
      const { data: settings, error } = await supabase
        .from('enterprise_settings')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error;
      }

      if (settings) {
        setConfig({
          scim_enabled: settings.scim_enabled,
          scim_endpoint: settings.scim_endpoint || `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2`,
          scim_token: settings.scim_token || '',
          sso_enabled: settings.sso_enabled,
          sso_provider: settings.sso_provider || 'saml',
          sso_domain: settings.sso_domain || '',
          auto_provisioning: settings.auto_provisioning,
          default_role: settings.default_role || 'staff',
        });
      } else {
        // Set defaults for new restaurant
        setConfig({
          scim_enabled: false,
          scim_endpoint: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/scim-v2`,
          scim_token: '',
          sso_enabled: false,
          sso_provider: 'saml',
          sso_domain: '',
          auto_provisioning: true,
          default_role: 'staff',
        });
      }
    } catch (error: any) {
      console.error('Error fetching enterprise settings:', error);
      toast({
        title: "Error",
        description: "Failed to load enterprise settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      // Call edge function to save enterprise settings
      const { error } = await supabase.functions.invoke('update-enterprise-settings', {
        body: {
          restaurantId,
          config,
        },
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Enterprise settings updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to update enterprise settings",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const generateScimToken = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('generate-scim-token', {
        body: { restaurantId },
      });

      if (error) throw error;

      setConfig({ ...config, scim_token: data.token });
      
      toast({
        title: "Success",
        description: "New SCIM token generated",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to generate SCIM token",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Enterprise Settings</CardTitle>
          <CardDescription>Loading enterprise configuration...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            <CardTitle>Enterprise Settings</CardTitle>
            <Badge variant="outline">Premium Feature</Badge>
          </div>
          <CardDescription>
            Configure SCIM provisioning, SSO, and advanced team management features
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="scim" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="scim" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            SCIM
          </TabsTrigger>
          <TabsTrigger value="sso" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            SSO
          </TabsTrigger>
          <TabsTrigger value="provisioning" className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Auto-Provisioning
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scim">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                SCIM Configuration
              </CardTitle>
              <CardDescription>
                System for Cross-domain Identity Management (SCIM) enables automated user provisioning and deprovisioning
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="scim-enabled" className="text-base">Enable SCIM</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow external identity providers to manage users automatically
                  </p>
                </div>
                <Switch
                  id="scim-enabled"
                  checked={config.scim_enabled}
                  onCheckedChange={(checked) => setConfig({ ...config, scim_enabled: checked })}
                />
              </div>

              {config.scim_enabled && (
                <>
                  <Separator />
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="scim-endpoint">SCIM Endpoint URL</Label>
                      <Input
                        id="scim-endpoint"
                        value={config.scim_endpoint}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Use this endpoint in your identity provider configuration
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="scim-token">SCIM Bearer Token</Label>
                        <Button variant="outline" size="sm" onClick={generateScimToken}>
                          <Key className="h-4 w-4 mr-2" />
                          Generate New Token
                        </Button>
                      </div>
                      <Input
                        id="scim-token"
                        type="password"
                        value={config.scim_token}
                        readOnly
                        placeholder="No token generated"
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        This token is required for SCIM authentication
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg">
                    <h4 className="font-medium mb-2">SCIM Capabilities</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Automatic user creation and updates</li>
                      <li>• Role-based access control</li>
                      <li>• User deprovisioning on removal</li>
                      <li>• Group membership management</li>
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sso">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Single Sign-On (SSO)
              </CardTitle>
              <CardDescription>
                Enable SSO with SAML, OAuth, or OpenID Connect providers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="sso-enabled" className="text-base">Enable SSO</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow users to sign in with your organization's identity provider
                  </p>
                </div>
                <Switch
                  id="sso-enabled"
                  checked={config.sso_enabled}
                  onCheckedChange={(checked) => setConfig({ ...config, sso_enabled: checked })}
                />
              </div>

              {config.sso_enabled && (
                <>
                  <Separator />
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="sso-provider">SSO Provider</Label>
                      <select
                        id="sso-provider"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                        value={config.sso_provider}
                        onChange={(e) => setConfig({ ...config, sso_provider: e.target.value })}
                      >
                        <option value="saml">SAML 2.0</option>
                        <option value="oauth">OAuth 2.0</option>
                        <option value="oidc">OpenID Connect</option>
                      </select>
                    </div>

                    <div>
                      <Label htmlFor="sso-domain">Organization Domain</Label>
                      <Input
                        id="sso-domain"
                        placeholder="example.com"
                        value={config.sso_domain}
                        onChange={(e) => setConfig({ ...config, sso_domain: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Users with this email domain will be redirected to SSO
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg">
                    <h4 className="font-medium mb-2">SSO Configuration Required</h4>
                    <p className="text-sm text-muted-foreground mb-3">
                      To complete SSO setup, you'll need to configure your identity provider with these details:
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• ACS URL: https://api.restaurantops.app/auth/saml/acs</li>
                      <li>• Entity ID: restaurantops-{restaurantId}</li>
                      <li>• Name ID Format: urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</li>
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="provisioning">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Auto-Provisioning
              </CardTitle>
              <CardDescription>
                Automatically create user accounts and assign roles
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="auto-provisioning" className="text-base">Enable Auto-Provisioning</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically create accounts for new users on first login
                  </p>
                </div>
                <Switch
                  id="auto-provisioning"
                  checked={config.auto_provisioning}
                  onCheckedChange={(checked) => setConfig({ ...config, auto_provisioning: checked })}
                />
              </div>

              {config.auto_provisioning && (
                <>
                  <Separator />
                  
                  <div>
                    <Label htmlFor="default-role">Default Role</Label>
                    <select
                      id="default-role"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                      value={config.default_role}
                      onChange={(e) => setConfig({ ...config, default_role: e.target.value })}
                    >
                      <option value="staff">Staff</option>
                      <option value="chef">Chef</option>
                      <option value="manager">Manager</option>
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      New users will be assigned this role by default
                    </p>
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg">
                    <h4 className="font-medium mb-2">Auto-Provisioning Rules</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Users are created on first successful login</li>
                      <li>• Email domain must match organization domain</li>
                      <li>• Role can be overridden via SCIM or manual assignment</li>
                      <li>• Account creation is logged for audit purposes</li>
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={saveConfig} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
};