import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { Loader2, UserCheck, UserPlus, UserX } from 'lucide-react';

import type { Employee } from '@/types/scheduling';
import type { ShiftImportEmployee } from '@/utils/shiftEmployeeMatching';

interface ShiftImportEmployeeReviewProps {
  employeeMatches: ShiftImportEmployee[];
  existingEmployees: Employee[];
  onUpdateMatch: (normalizedName: string, employeeId: string | null, action: 'link' | 'create' | 'skip') => void;
  onCreateSingle: (normalizedName: string) => void;
  onBulkCreateAll: () => void;
  isCreating: boolean;
}

const confidenceBadge = (confidence: ShiftImportEmployee['matchConfidence']) => {
  switch (confidence) {
    case 'exact':
      return (
        <Badge variant="outline" className="text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
          Matched
        </Badge>
      );
    case 'partial':
      return (
        <Badge variant="outline" className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 border-amber-500/20">
          Partial
        </Badge>
      );
    case 'none':
      return (
        <Badge variant="outline" className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border-border/40">
          Unmatched
        </Badge>
      );
  }
};

export const ShiftImportEmployeeReview = ({
  employeeMatches,
  existingEmployees,
  onUpdateMatch,
  onCreateSingle,
  onBulkCreateAll,
  isCreating,
}: ShiftImportEmployeeReviewProps) => {
  const matchedCount = useMemo(
    () => employeeMatches.filter(m => m.matchConfidence === 'exact' || (m.matchedEmployeeId && m.action === 'link')).length,
    [employeeMatches]
  );

  const unmatchedCount = useMemo(
    () => employeeMatches.filter(m => (m.matchConfidence === 'none' || m.matchConfidence === 'partial') && m.action !== 'link').length,
    [employeeMatches]
  );

  if (!employeeMatches.length) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-[13px] text-muted-foreground">No employees found in the imported data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">{matchedCount}</span> of{' '}
          <span className="font-medium text-foreground">{employeeMatches.length}</span> employees matched
        </p>
        {unmatchedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-4 rounded-lg text-[13px] font-medium"
            onClick={onBulkCreateAll}
            disabled={isCreating}
            aria-label="Create all unmatched employees"
          >
            {isCreating ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5 mr-2" />
            )}
            Create All Unmatched
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {employeeMatches.map((match) => (
          <div
            key={match.normalizedName}
            className="group flex flex-col gap-3 p-4 rounded-xl border border-border/40 bg-background"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
                  {match.matchConfidence === 'none' ? (
                    <UserX className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <UserCheck className={`h-4 w-4 ${match.matchConfidence === 'exact' ? 'text-emerald-600' : 'text-amber-600'}`} />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-foreground truncate">{match.csvName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {match.csvPosition && (
                      <span className="text-[12px] text-muted-foreground">{match.csvPosition}</span>
                    )}
                    {match.matchedEmployeeName && match.matchConfidence === 'exact' && (
                      <span className="text-[12px] text-muted-foreground">
                        &rarr; {match.matchedEmployeeName}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {confidenceBadge(match.matchConfidence)}
              </div>
            </div>

            {(match.matchConfidence === 'partial' || match.matchConfidence === 'none') && (
              <div className="flex flex-wrap items-center gap-2 pl-11">
                {match.matchConfidence === 'partial' && match.suggestedEmployeeName && (
                  <span className="text-[12px] text-amber-600">
                    Did you mean {match.suggestedEmployeeName}?
                  </span>
                )}
                <Select
                  value={match.matchedEmployeeId || ''}
                  onValueChange={(value) => {
                    if (value === '__clear__') {
                      onUpdateMatch(match.normalizedName, null, 'skip');
                    } else {
                      onUpdateMatch(match.normalizedName, value, 'link');
                    }
                  }}
                >
                  <SelectTrigger
                    className="h-9 text-[13px] bg-muted/30 border-border/40 rounded-lg w-48"
                    aria-label={`Link ${match.csvName} to existing employee`}
                  >
                    <SelectValue placeholder="Link to existing" />
                  </SelectTrigger>
                  <SelectContent>
                    {match.matchedEmployeeId && (
                      <SelectItem value="__clear__">Clear</SelectItem>
                    )}
                    {existingEmployees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.name} {emp.position ? `(${emp.position})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {match.action !== 'link' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 rounded-lg text-[13px] font-medium"
                    onClick={() => onCreateSingle(match.normalizedName)}
                    disabled={isCreating}
                    aria-label={`Create employee ${match.csvName}`}
                  >
                    {isCreating ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Create
                  </Button>
                )}
                {match.action === 'skip' && (
                  <span className="text-[12px] text-muted-foreground">Shifts will be skipped</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
