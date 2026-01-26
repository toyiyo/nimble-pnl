import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useGusto } from '@/hooks/useGusto';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DollarSign,
  Users,
  Clock,
  Heart,
  FileText,
  Settings,
  Loader2,
  RefreshCw,
  Unlink,
  AlertCircle,
  CheckCircle,
  Building2,
} from 'lucide-react';
import { GustoFlowType } from '@/types/gusto';

const GustoPayroll = () => {
  const navigate = useNavigate();
  const { selectedRestaurant } = useRestaurantContext();
  const { user } = useAuth();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const {
    isConnected,
    connection,
    connectionLoading,
    flowUrl,
    flowType,
    flowLoading,
    flowExpired,
    openPayroll,
    openCompanySetup,
    openBenefits,
    openTaxes,
    openFlow,
    clearFlow,
    syncEmployees,
    syncTimePunches,
    isSyncingEmployees,
    isSyncingTimePunches,
    disconnectGusto,
    isDisconnecting,
    createGustoCompany,
    isCreatingCompany,
  } = useGusto(restaurantId);

  const [activeTab, setActiveTab] = useState<string>('setup');

  // Form state for company creation
  const [companyName, setCompanyName] = useState(selectedRestaurant?.restaurant?.name || '');
  const [adminFirstName, setAdminFirstName] = useState('');
  const [adminLastName, setAdminLastName] = useState('');
  const [adminEmail, setAdminEmail] = useState(user?.email || '');
  const [ein, setEin] = useState('');
  const [contractorOnly, setContractorOnly] = useState(false);

  // Load initial flow when tab changes
  useEffect(() => {
    if (isConnected && !flowLoading) {
      const tabToFlowType: Record<string, GustoFlowType> = {
        payroll: 'run_payroll',
        employees: 'add_employees',
        benefits: 'company_onboarding', // Benefits are part of company onboarding
        taxes: 'federal_tax_setup',
        setup: 'company_onboarding',
      };

      const flowTypeForTab = tabToFlowType[activeTab];
      if (flowTypeForTab && flowType !== flowTypeForTab) {
        openFlow(flowTypeForTab);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isConnected]);

  // Handle company creation form submit
  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName || !adminFirstName || !adminLastName || !adminEmail) {
      return;
    }
    await createGustoCompany({
      companyName,
      adminFirstName,
      adminLastName,
      adminEmail,
      ein: ein || undefined,
      contractorOnly,
    });
  };

  // Show setup form if not connected
  if (!connectionLoading && !isConnected) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle>Set Up Gusto Payroll</CardTitle>
                <CardDescription>
                  Create your payroll account to manage employees, run payroll, and file taxes.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateCompany} className="space-y-6">
              {/* Company Information */}
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                  Company Information
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="companyName">Legal Company Name *</Label>
                  <Input
                    id="companyName"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Enter your company's legal name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ein">EIN (Employer Identification Number)</Label>
                  <Input
                    id="ein"
                    value={ein}
                    onChange={(e) => setEin(e.target.value)}
                    placeholder="XX-XXXXXXX (optional)"
                    pattern="\d{2}-?\d{7}"
                  />
                  <p className="text-xs text-muted-foreground">
                    You can add this later during company setup
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="contractorOnly"
                    checked={contractorOnly}
                    onCheckedChange={(checked) => setContractorOnly(checked === true)}
                  />
                  <Label htmlFor="contractorOnly" className="text-sm font-normal">
                    This company only pays contractors (no W-2 employees)
                  </Label>
                </div>
              </div>

              {/* Admin Information */}
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                  Primary Admin
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="adminFirstName">First Name *</Label>
                    <Input
                      id="adminFirstName"
                      value={adminFirstName}
                      onChange={(e) => setAdminFirstName(e.target.value)}
                      placeholder="First name"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="adminLastName">Last Name *</Label>
                    <Input
                      id="adminLastName"
                      value={adminLastName}
                      onChange={(e) => setAdminLastName(e.target.value)}
                      placeholder="Last name"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adminEmail">Email Address *</Label>
                  <Input
                    id="adminEmail"
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@company.com"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    This person will be the primary payroll administrator
                  </p>
                </div>
              </div>

              {/* Features */}
              <div className="rounded-lg bg-muted/50 p-4 space-y-3">
                <h4 className="font-medium text-sm">What you'll get:</h4>
                <div className="grid gap-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>Process payroll for employees and contractors</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>Automatic tax calculations and filings</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>Health insurance and 401(k) benefits</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>Sync employees and time tracking data</span>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isCreatingCompany || !companyName || !adminFirstName || !adminLastName || !adminEmail}
                size="lg"
                className="w-full"
              >
                {isCreatingCompany ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Payroll Account...
                  </>
                ) : (
                  <>
                    <DollarSign className="mr-2 h-4 w-4" />
                    Create Payroll Account
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading state
  if (connectionLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gusto Payroll</h1>
          <p className="text-muted-foreground">
            {connection?.company_name || 'Connected to Gusto'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <CheckCircle className="h-3 w-3 text-green-500" />
            Connected
          </Badge>
        </div>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncEmployees()}
              disabled={isSyncingEmployees}
            >
              {isSyncingEmployees ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Users className="mr-2 h-4 w-4" />
              )}
              Sync Employees
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncTimePunches()}
              disabled={isSyncingTimePunches}
            >
              {isSyncingTimePunches ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Clock className="mr-2 h-4 w-4" />
              )}
              Sync Time Punches
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => clearFlow()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                  <Unlink className="mr-2 h-4 w-4" />
                  Disconnect
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect from Gusto?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will disconnect your restaurant from Gusto. You can reconnect at any time.
                    Your payroll history in Gusto will be preserved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => disconnectGusto(false)}
                    disabled={isDisconnecting}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Flow expired alert */}
      {flowExpired && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Session Expired</AlertTitle>
          <AlertDescription>
            Your Gusto session has expired. Click a tab to refresh.
          </AlertDescription>
        </Alert>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="payroll" className="gap-2">
            <DollarSign className="h-4 w-4" />
            <span className="hidden sm:inline">Payroll</span>
          </TabsTrigger>
          <TabsTrigger value="employees" className="gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Employees</span>
          </TabsTrigger>
          <TabsTrigger value="benefits" className="gap-2">
            <Heart className="h-4 w-4" />
            <span className="hidden sm:inline">Benefits</span>
          </TabsTrigger>
          <TabsTrigger value="taxes" className="gap-2">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Taxes</span>
          </TabsTrigger>
          <TabsTrigger value="setup" className="gap-2">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Setup</span>
          </TabsTrigger>
        </TabsList>

        {/* Tab Content - Gusto Flow Iframe */}
        <TabsContent value={activeTab} className="mt-0">
          <Card>
            <CardContent className="p-0">
              {flowLoading ? (
                <div className="flex items-center justify-center h-[600px]">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : flowUrl ? (
                <iframe
                  src={flowUrl}
                  className="w-full h-[600px] border-0 rounded-lg"
                  title={`Gusto ${activeTab}`}
                  allow="clipboard-write"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mb-4" />
                  <p>Failed to load Gusto interface</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => openFlow(activeTab as GustoFlowType)}
                  >
                    Try Again
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Footer Info */}
      <div className="text-center text-xs text-muted-foreground">
        <p>
          Powered by{' '}
          <a
            href="https://gusto.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Gusto
          </a>
        </p>
        {connection?.last_synced_at && (
          <p className="mt-1">
            Last synced: {new Date(connection.last_synced_at).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
};

export default GustoPayroll;
