import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { Download, Edit, DollarSign } from 'lucide-react';
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
    <Card className="rounded-xl border-border/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
            <DollarSign className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h3 className="text-[17px] font-semibold text-foreground">Today's tips</h3>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Imported from POS · {tipData.transactionCount} transaction{tipData.transactionCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1 text-[11px] border-border/40">
          <Download className="h-3 w-3" />
          {tipData.source.toUpperCase()}
        </Badge>
      </div>
      <CardContent className="p-6 space-y-5">
        <div className="text-center py-2">
          <div className="text-[28px] font-semibold text-foreground">
            {formatCurrencyFromCents(tipData.totalTipsCents)}
          </div>
          <p className="text-[13px] text-muted-foreground mt-1">
            Total tips from {tipData.source.charAt(0).toUpperCase() + tipData.source.slice(1)}
          </p>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => onImport(tipData.totalTipsCents)}
            className="flex-1 h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            Use this amount
          </Button>
          <Button
            onClick={onEdit}
            variant="outline"
            className="h-9 rounded-lg text-[13px] font-medium gap-2"
          >
            <Edit className="h-4 w-4" />
            Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
