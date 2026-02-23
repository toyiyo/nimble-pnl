import { useState, useCallback } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { CheckCircle, Circle, Loader2, Info, Users, Building2 } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';
import { useSlingConnection } from '@/hooks/useSlingConnection';
import { supabase } from '@/integrations/supabase/client';

import type { Employee } from '@/types/scheduling';
import type { ShiftImportEmployee } from '@/utils/shiftEmployeeMatching';

import { matchEmployees } from '@/utils/shiftEmployeeMatching';
import { ShiftImportEmployeeReview } from '@/components/scheduling/ShiftImportEmployeeReview';
import { cn } from '@/lib/utils';

interface SlingSetupWizardProps {
  readonly restaurantId: string;
  readonly onComplete: () => void;
}

function getSlingUserFullName(u: SlingUser): string {
  return getSlingUserFullName(u);
}

type SetupStep = 'credentials' | 'organization' | 'employees' | 'complete';

interface SlingOrg {
  id: number;
  name: string;
}

interface SlingUser {
  sling_user_id: number;
  name: string | null;
  lastname: string | null;
  email: string | null;
  position: string | null;
  is_active: boolean;
}

export const SlingSetupWizard = ({ restaurantId, onComplete }: SlingSetupWizardProps) => {
  const [currentStep, setCurrentStep] = useState<SetupStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [orgs, setOrgs] = useState<SlingOrg[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [orgName, setOrgName] = useState('');
  const [slingUsers, setSlingUsers] = useState<SlingUser[]>([]);
  const [existingEmployees, setExistingEmployees] = useState<Employee[]>([]);
  const [employeeMatches, setEmployeeMatches] = useState<ShiftImportEmployee[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const { toast } = useToast();
  const { saveCredentials, testConnection } = useSlingConnection(restaurantId);

  const steps: { id: SetupStep; label: string; completed: boolean }[] = [
    { id: 'credentials', label: 'Credentials', completed: currentStep !== 'credentials' },
    { id: 'organization', label: 'Organization', completed: currentStep === 'employees' || currentStep === 'complete' },
    { id: 'employees', label: 'Employees', completed: currentStep === 'complete' },
    { id: 'complete', label: 'Complete', completed: false },
  ];

  const fetchSlingUsersAndEmployees = useCallback(async () => {
    const [usersResult, employeesResult] = await Promise.all([
      supabase
        .from('sling_users' as any)
        .select('sling_user_id, name, lastname, email, position, is_active')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true),
      supabase
        .from('employees')
        .select('id, name, position, restaurant_id, status, email, phone, hire_date, notes, created_at, updated_at, is_active, compensation_type, hourly_rate')
        .eq('restaurant_id', restaurantId),
    ]);

    if (usersResult.error) {
      throw new Error(`Failed to fetch Sling users: ${usersResult.error.message}`);
    }
    if (employeesResult.error) {
      throw new Error(`Failed to fetch employees: ${employeesResult.error.message}`);
    }

    const fetchedUsers = (usersResult.data || []) as unknown as SlingUser[];
    const fetchedEmployees = (employeesResult.data || []) as Employee[];

    setSlingUsers(fetchedUsers);
    setExistingEmployees(fetchedEmployees);

    // Build names array for matchEmployees
    const csvNames = fetchedUsers.map((u) => ({
      name: getSlingUserFullName(u),
      position: u.position || '',
    }));

    const matches = matchEmployees(csvNames, fetchedEmployees);
    setEmployeeMatches(matches);
  }, [restaurantId]);

  const handleConnectAndTest = async () => {
    if (!email || !password) {
      toast({
        title: 'Missing information',
        description: 'Please enter your Sling email and password',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Step 1: Save credentials
      await saveCredentials(restaurantId, email, password);

      // Step 2: Test connection
      const result = await testConnection(restaurantId);

      if (result.needsOrgSelection) {
        // Multiple orgs — show org picker
        setOrgs((result.orgs as SlingOrg[]) || []);
        setCurrentStep('organization');
      } else if (result.success) {
        // Single org — auto-selected, proceed to employee mapping
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

  const handleUpdateMatch = useCallback(
    (normalizedName: string, employeeId: string | null, action: 'link' | 'create' | 'skip') => {
      setEmployeeMatches((prev) =>
        prev.map((m) => {
          if (m.normalizedName !== normalizedName) return m;
          if (action === 'link' && employeeId) {
            const matchedEmp = existingEmployees.find((e) => e.id === employeeId);
            return {
              ...m,
              matchedEmployeeId: employeeId,
              matchedEmployeeName: matchedEmp?.name || null,
              matchConfidence: 'exact' as const,
              action: 'link',
            };
          }
          return { ...m, matchedEmployeeId: null, matchedEmployeeName: null, action };
        })
      );
    },
    [existingEmployees]
  );

  const createEmployeeAndMap = useCallback(
    async (match: ShiftImportEmployee): Promise<void> => {
      // Create the employee
      const { data: newEmp, error: createError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restaurantId,
          name: match.csvName,
          position: match.csvPosition || 'Team Member',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 0,
        })
        .select('id, name, position, restaurant_id')
        .single();

      if (createError) {
        throw new Error(`Failed to create employee ${match.csvName}: ${createError.message}`);
      }

      // Find corresponding Sling user
      const slingUser = slingUsers.find(
        (u) => getSlingUserFullName(u) === match.csvName
      );

      if (slingUser) {
        await supabase
          .from('employee_integration_mappings' as any)
          .upsert(
            {
              restaurant_id: restaurantId,
              employee_id: newEmp.id,
              integration_type: 'sling',
              external_user_id: slingUser.sling_user_id.toString(),
              external_user_name: match.csvName,
            },
            { onConflict: 'restaurant_id,integration_type,external_user_id' }
          );
      }

      // Update local state
      setExistingEmployees((prev) => [...prev, newEmp as unknown as Employee]);
      setEmployeeMatches((prev) =>
        prev.map((m) =>
          m.normalizedName === match.normalizedName
            ? {
                ...m,
                matchedEmployeeId: newEmp.id,
                matchedEmployeeName: newEmp.name,
                matchConfidence: 'exact' as const,
                action: 'link' as const,
              }
            : m
        )
      );
    },
    [restaurantId, slingUsers]
  );

  const handleCreateSingle = useCallback(
    async (normalizedName: string) => {
      const match = employeeMatches.find((m) => m.normalizedName === normalizedName);
      if (!match) return;

      setIsCreating(true);
      try {
        await createEmployeeAndMap(match);
        toast({
          title: 'Employee created',
          description: `${match.csvName} has been added`,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create employee';
        toast({
          title: 'Error',
          description: errorMessage,
          variant: 'destructive',
        });
      } finally {
        setIsCreating(false);
      }
    },
    [employeeMatches, createEmployeeAndMap, toast]
  );

  const handleBulkCreateAll = useCallback(async () => {
    const unmatched = employeeMatches.filter(
      (m) => m.matchConfidence === 'none' && m.action !== 'link'
    );
    if (unmatched.length === 0) return;

    setIsCreating(true);
    try {
      for (const match of unmatched) {
        await createEmployeeAndMap(match);
      }
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
    } finally {
      setIsCreating(false);
    }
  }, [employeeMatches, createEmployeeAndMap, toast]);

  const handleConfirmEmployees = async () => {
    setLoading(true);
    try {
      // Write all linked mappings
      const mappingsToWrite = employeeMatches
        .filter((m): m is typeof m & { matchedEmployeeId: string } =>
          !!m.matchedEmployeeId && m.action === 'link'
        )
        .map((m) => {
          const slingUser = slingUsers.find(
            (u) => getSlingUserFullName(u) === m.csvName
          );
          return {
            restaurant_id: restaurantId,
            employee_id: m.matchedEmployeeId,
            integration_type: 'sling',
            external_user_id: slingUser?.sling_user_id?.toString() || '',
            external_user_name: m.csvName,
          };
        })
        .filter((m) => m.external_user_id);

      if (mappingsToWrite.length > 0) {
        const { error } = await supabase
          .from('employee_integration_mappings' as any)
          .upsert(mappingsToWrite, { onConflict: 'restaurant_id,integration_type,external_user_id' });

        if (error) {
          throw new Error(`Failed to save mappings: ${error.message}`);
        }
      }

      toast({
        title: 'Employee mappings saved',
        description: `${mappingsToWrite.length} employees linked to Sling`,
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
            <Alert className="border-border/40 bg-muted/30">
              <Info className="h-4 w-4 text-muted-foreground" />
              <AlertDescription className="text-[13px] text-muted-foreground">
                Enter the email and password you use to log in to your Sling account at{' '}
                <a
                  href="https://app.getsling.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline"
                >
                  app.getsling.com
                </a>
                . Your credentials are encrypted and stored securely.
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
                  placeholder="you@restaurant.com"
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

              <Button
                onClick={handleConnectAndTest}
                disabled={!email || !password || loading}
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
              onUpdateMatch={handleUpdateMatch}
              onCreateSingle={handleCreateSingle}
              onBulkCreateAll={handleBulkCreateAll}
              isCreating={isCreating}
            />

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setCurrentStep('credentials')}
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
