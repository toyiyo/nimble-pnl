import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface CashFlowStatementProps {
  restaurantId: string;
  dateFrom: Date;
  dateTo: Date;
}

export function CashFlowStatement({ restaurantId, dateFrom, dateTo }: CashFlowStatementProps) {
  const { toast } = useToast();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const handleExport = () => {
    toast({
      title: 'Coming soon',
      description: 'Cash flow statement export will be available soon',
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Cash Flow Statement</CardTitle>
            <CardDescription>
              For the period {format(dateFrom, 'MMM dd, yyyy')} - {format(dateTo, 'MMM dd, yyyy')}
            </CardDescription>
          </div>
          <Button onClick={handleExport} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Cash Flow Statement coming soon...</p>
          <p className="text-sm text-muted-foreground mt-2">
            This will show cash flows from operating, investing, and financing activities
          </p>
        </div>
      </CardContent>
    </Card>
  );
}