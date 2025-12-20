import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { Download, Edit } from 'lucide-react';
import type { POSTipData } from '@/hooks/usePOSTips';

interface POSTipImporterProps {
  tipData: POSTipData;
  onImport: (amountCents: number) => void;
  onEdit: () => void;
}

/**
 * POSTipImporter - Display POS-imported tips with edit option
 * Part 2 of Apple-style UX: "Imported from POS"
 */
export function POSTipImporter({ tipData, onImport, onEdit }: POSTipImporterProps) {
  return (
    <Card className="bg-gradient-to-br from-primary/5 to-accent/5">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Today's tips</CardTitle>
          <Badge variant="outline" className="gap-1">
            <Download className="h-3 w-3" />
            {tipData.source.toUpperCase()}
          </Badge>
        </div>
        <CardDescription>
          Imported from POS • {tipData.transactionCount} transaction{tipData.transactionCount !== 1 ? 's' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center py-4">
          <div className="text-4xl font-bold text-primary">
            {formatCurrencyFromCents(tipData.totalTipsCents)}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Total tips from {tipData.source.charAt(0).toUpperCase() + tipData.source.slice(1)}
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button 
            onClick={() => onImport(tipData.totalTipsCents)} 
            className="flex-1"
            size="lg"
          >
            Use this amount
          </Button>
          <Button 
            onClick={onEdit} 
            variant="outline"
            size="lg"
            className="gap-2"
          >
            <Edit className="h-4 w-4" />
            Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
