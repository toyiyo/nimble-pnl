import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { ReactNode } from 'react';

interface EmployeeInfoAlertProps {
  children: ReactNode;
}

/**
 * Consistent info alert for employee pages
 */
export const EmployeeInfoAlert = ({ children }: EmployeeInfoAlertProps) => {
  return (
    <Alert className="bg-primary/5 border-primary/20">
      <AlertCircle className="h-4 w-4 text-primary" aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
};
