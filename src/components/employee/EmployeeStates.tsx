import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';

/**
 * Displayed when no restaurant is selected
 */
export const NoRestaurantState = () => {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <p className="text-muted-foreground">Please select a restaurant.</p>
    </div>
  );
};

/**
 * Loading skeleton for employee pages
 */
export const EmployeePageSkeleton = () => {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
};

/**
 * Displayed when user account is not linked to an employee record
 */
export const EmployeeNotLinkedState = () => {
  return (
    <Card className="bg-gradient-to-br from-destructive/5 via-destructive/5 to-transparent border-destructive/10">
      <CardHeader>
        <div className="flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
          <div>
            <CardTitle className="text-2xl">Access Required</CardTitle>
            <CardDescription>
              Your account is not linked to an employee record.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          Please contact your manager to link your account to your employee profile.
        </p>
      </CardContent>
    </Card>
  );
};
