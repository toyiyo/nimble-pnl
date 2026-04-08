import { useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { CheckCircle, Circle, Loader2, Info, Users, Building2, Key } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';
import { useSlingConnection } from '@/hooks/useSlingConnection';
import { useSlingEmployeeMapping } from '@/hooks/useSlingEmployeeMapping';

import { ShiftImportEmployeeReview } from '@/components/scheduling/ShiftImportEmployeeReview';
import { cn } from '@/lib/utils';

interface SlingSetupWizardProps {
  readonly restaurantId: string;
  readonly onComplete: () => void;
}

type SetupStep = 'credentials' | 'organization' | 'employees' | 'complete';

interface SlingOrg {
  id: number;
  name: string;
}

type AuthMode = 'password' | 'token';

export const SlingSetupWizard = ({ restaurantId, onComplete }: SlingSetupWizardProps) => {
  const [currentStep, setCurrentStep] = useState<SetupStep>('credentials');
  const [authMode, setAuthMode] = useState<AuthMode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [orgs, setOrgs] = useState<SlingOrg[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [orgName, setOrgName] = useState('');

  const { toast } = useToast();
  const { saveCredentials, testConnection } = useSlingConnection(restaurantId);
  const {
    employeeMatches,
    existingEmployees,
    isCreating,
    fetchSlingUsersAndEmployees,
    updateMatch,
    createSingle,
    bulkCreateAll,
    confirmMappings,
  } = useSlingEmployeeMapping(restaurantId);

  const steps: { id: SetupStep; label: string; completed: boolean }[] = [
    { id: 'credentials', label: 'Credentials', completed: currentStep !== 'credentials' },
    { id: 'organization', label: 'Organization', completed: currentStep === 'employees' || currentStep === 'complete' },
    { id: 'employees', label: 'Employees', completed: currentStep === 'complete' },
    { id: 'complete', label: 'Complete', completed: false },
  ];

  const handleConnectAndTest = async () => {
    if (authMode === 'password' && (!email || !password)) {
      toast({
        title: 'Missing information',
        description: 'Please enter your Sling email and password',
        variant: 'destructive',
      });
      return;
    }
    if (authMode === 'token' && !authToken) {
      toast({
        title: 'Missing information',
        description: 'Please enter your Sling auth token',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      if (authMode === 'token') {
        await saveCredentials(restaurantId, '', '', authToken);
      } else {
        await saveCredentials(restaurantId, email, password);
      }
      const result = await testConnection(restaurantId);

      if (result.needsOrgSelection) {
        setOrgs((result.orgs as SlingOrg[]) || []);
        setCurrentStep('organization');
      } else if (result.success) {
        setOrgName((result.orgName as string) || 'Sling');
        await fetchSlingUsersAndEmployees();
        setCurrentStep('employees');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to Sling';
      toast({
        title: 'Connection failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOrg = async () => {
    if (!selectedOrgId) {
      toast({
        title: 'Missing selection',
        description: 'Please select an organization',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const result = await testConnection(restaurantId, Number(selectedOrgId));

      if (result.success) {
        setOrgName(String(result.orgName || orgs.find((o) => o.id === Number(selectedOrgId))?.name || 'Sling'));
        await fetchSlingUsersAndEmployees();
        setCurrentStep('employees');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to organization';
      toast({
        title: 'Connection failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSingle = async (normalizedName: string) => {
    try {
      await createSingle(normalizedName);
      const match = employeeMatches.find((m) => m.normalizedName === normalizedName);
      toast({
        title: 'Employee created',
        description: `${match?.csvName || normalizedName} has been added`,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create employee';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleBulkCreateAll = async () => {
    try {
      await bulkCreateAll();
      const unmatched = employeeMatches.filter(
        (m) => m.matchConfidence === 'none' && m.action !== 'link'
      );
      toast({
        title: 'Employees created',
        description: `${unmatched.length} employees have been added`,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create employees';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleConfirmEmployees = async () => {
    setLoading(true);
    try {
      const count = await confirmMappings();
      toast({
        title: 'Employee mappings saved',
        description: `${count} employees linked to Sling`,
      });
      setCurrentStep('complete');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save employee mappings';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto rounded-xl border-border/40">
      <CardHeader className="px-6 pt-6 pb-4 border-b border-border/40">
        <CardTitle className="text-[17px] font-semibold text-foreground">Sling Setup</CardTitle>
        <CardDescription className="text-[13px] text-muted-foreground mt-0.5">
          Connect your Sling account to sync shifts and employee data
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6 py-5 space-y-6">
        {/* Progress Steps */}
        <div className="flex items-center justify-between mb-2">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors',
                    step.completed && 'bg-foreground border-foreground text-background',
                    !step.completed && currentStep === step.id && 'border-foreground text-foreground',
                    !step.completed && currentStep !== step.id && 'border-border text-muted-foreground',
                  )}
                >
                  {step.completed ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <Circle className="w-5 h-5" />
                  )}
                </div>
                <span className="text-[12px] mt-1.5 text-center font-medium text-muted-foreground">
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`w-20 sm:w-28 h-0.5 mx-2 transition-colors ${
                    step.completed ? 'bg-foreground' : 'bg-border'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Credentials */}
        {currentStep === 'credentials' && (
          <div className="space-y-5">
            {/* Auth mode toggle */}
            <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40">
              <button
                type="button"
                onClick={() => setAuthMode('password')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[13px] font-medium transition-colors',
                  authMode === 'password'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Email & Password
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('token')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[13px] font-medium transition-colors',
                  authMode === 'token'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Key className="w-3.5 h-3.5" />
                Auth Token
              </button>
            </div>

            {authMode === 'password' ? (
              <>
                <Alert className="border-border/40 bg-muted/30">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <AlertDescription className="text-[13px] text-muted-foreground">
                    Enter the email and password for a Sling <span className="font-medium text-foreground">admin or manager</span> account.
                    Your credentials are encrypted and stored securely.
                  </AlertDescription>
                </Alert>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="sling-email"
                      className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      Email
                    </Label>
                    <Input
                      id="sling-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@restaurant.com"
                      className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="sling-password"
                      className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      Password
                    </Label>
                    <Input
                      id="sling-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your Sling password"
                      className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <Alert className="border-border/40 bg-muted/30">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <AlertDescription className="text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground">How to get your auth token:</span>
                    <ol className="mt-1.5 ml-4 list-decimal space-y-0.5">
                      <li>Log in to <a href="https://app.getsling.com" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline">app.getsling.com</a> with an admin account</li>
                      <li>Open browser DevTools (F12) and go to the Network tab</li>
                      <li>Refresh the page and click any API request to <code className="text-[12px] bg-muted/50 px-1 rounded">api.getsling.com</code></li>
                      <li>Copy the <code className="text-[12px] bg-muted/50 px-1 rounded">Authorization</code> header value</li>
                    </ol>
                  </AlertDescription>
                </Alert>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="sling-token"
                    className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    Authorization Token
                  </Label>
                  <Input
                    id="sling-token"
                    type="password"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="Paste the Authorization header value"
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
                </div>
              </>
            )}

            <Button
              onClick={handleConnectAndTest}
              disabled={(authMode === 'password' ? (!email || !password) : !authToken) || loading}
              className="w-full h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </div>
        )}

        {/* Step 2: Organization Selection */}
        {currentStep === 'organization' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-muted/30">
              <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-foreground" />
              </div>
              <div>
                <p className="text-[14px] font-medium text-foreground">Select Organization</p>
                <p className="text-[13px] text-muted-foreground mt-0.5">
                  Your Sling account has access to multiple organizations. Choose the one to connect.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="sling-org"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Organization
              </Label>
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger
                  id="sling-org"
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  aria-label="Select Sling organization"
                >
                  <SelectValue placeholder="Choose an organization" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((org) => (
                    <SelectItem key={org.id} value={org.id.toString()}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentStep('credentials')}
                className="flex-1 h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
              >
                Back
              </Button>
              <Button
                onClick={handleSelectOrg}
                disabled={!selectedOrgId || loading}
                className="flex-1 h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Employee Mapping */}
        {currentStep === 'employees' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-muted/30">
              <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
                <Users className="h-5 w-5 text-foreground" />
              </div>
              <div>
                <p className="text-[14px] font-medium text-foreground">
                  Map Sling Employees
                  {orgName ? ` - ${orgName}` : ''}
                </p>
                <p className="text-[13px] text-muted-foreground mt-0.5">
                  Match Sling users to your existing employees, or create new ones.
                </p>
              </div>
            </div>

            <ShiftImportEmployeeReview
              employeeMatches={employeeMatches}
              existingEmployees={existingEmployees}
              onUpdateMatch={updateMatch}
              onCreateSingle={handleCreateSingle}
              onBulkCreateAll={handleBulkCreateAll}
              isCreating={isCreating}
            />

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(orgs.length > 0 ? 'organization' : 'credentials')}
                className="flex-1 h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
              >
                Back
              </Button>
              <Button
                onClick={handleConfirmEmployees}
                disabled={loading}
                className="flex-1 h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Confirm & Finish'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {currentStep === 'complete' && (
          <div className="space-y-6 text-center py-8">
            <div className="w-20 h-20 bg-muted/50 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-12 h-12 text-foreground" />
            </div>

            <div>
              <h3 className="text-[17px] font-semibold text-foreground mb-1">Setup Complete!</h3>
              <p className="text-[13px] text-muted-foreground">
                Your Sling account{orgName ? ` (${orgName})` : ''} is now connected and ready to sync.
              </p>
            </div>

            <Alert className="border-border/40 bg-muted/30 text-left">
              <AlertDescription className="text-[13px] text-muted-foreground">
                <p className="font-medium text-foreground mb-2">How syncing works:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Shifts and timesheets sync automatically on a schedule</li>
                  <li>You can trigger a manual sync anytime from the Sling settings</li>
                  <li>Employee mappings are used to link Sling shifts to your payroll</li>
                </ul>
              </AlertDescription>
            </Alert>

            <Button
              onClick={onComplete}
              className="w-full h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              Done
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
