import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';

interface StatusSummaryProps {
  kioskActive: boolean;
  totalHours: number;
  employeesWithPins: number;
  totalEmployees: number;
  date: string;
  anomalies?: number;
  incompleteSessions?: number;
}

export function StatusSummary({
  kioskActive,
  totalHours,
  employeesWithPins,
  totalEmployees,
  date,
  anomalies = 0,
  incompleteSessions = 0,
}: StatusSummaryProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8 p-4 rounded-lg bg-card border">
      {/* Page Title */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Clock className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Time Clock</h1>
          <p className="text-sm text-muted-foreground">{date}</p>
        </div>
      </div>

      {/* Status Indicators */}
      <div className="flex flex-wrap items-center gap-4 md:gap-6 text-sm">
        {/* Kiosk Status */}
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${kioskActive ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
          <span className="text-muted-foreground">
            Kiosk Mode: <span className="font-medium text-foreground">{kioskActive ? 'On' : 'Off'}</span>
          </span>
        </div>

        {/* Hours Logged */}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
          <span className="text-muted-foreground">
            Today: <span className="font-medium text-foreground">{totalHours.toFixed(1)} hours</span>
          </span>
        </div>

        {/* PINs Status */}
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${employeesWithPins === totalEmployees && totalEmployees > 0 ? 'bg-emerald-500' : employeesWithPins > 0 ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
          <span className="text-muted-foreground">
            PINs: <span className="font-medium text-foreground">{employeesWithPins} / {totalEmployees}</span>
          </span>
        </div>

        {/* Warnings */}
        {incompleteSessions > 0 && (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20">
            {incompleteSessions} open session{incompleteSessions !== 1 ? 's' : ''}
          </Badge>
        )}

        {anomalies > 0 && (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20">
            {anomalies} anomal{anomalies !== 1 ? 'ies' : 'y'}
          </Badge>
        )}
      </div>
    </div>
  );
}
