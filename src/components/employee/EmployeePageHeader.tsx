import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';

interface EmployeePageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}

/**
 * Consistent header for employee portal pages
 */
export const EmployeePageHeader = ({ icon: Icon, title, subtitle }: EmployeePageHeaderProps) => {
  return (
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {title}
            </CardTitle>
            <CardDescription>{subtitle}</CardDescription>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
};
