import { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';

import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';

import {
  Upload,
  FileText,
  Loader2,
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
} from 'lucide-react';

import { useToast } from '@/hooks/use-toast';
import { useBulkCreateShifts } from '@/hooks/useBulkCreateShifts';
import { useCreateEmployee } from '@/hooks/useEmployees';
import { useQueryClient } from '@tanstack/react-query';

import type { Employee, Shift } from '@/types/scheduling';
import type { ParsedShift } from '@/utils/slingCsvParser';
import type { ShiftColumnMapping } from '@/utils/shiftColumnMapping';
import type { ShiftImportEmployee } from '@/utils/shiftEmployeeMatching';
import type { ShiftImportPreviewResult } from '@/utils/shiftImportPreview';

import { isSlingFormat, parseSlingCSV } from '@/utils/slingCsvParser';
import { suggestShiftMappings, SHIFT_FIELD_OPTIONS } from '@/utils/shiftColumnMapping';
import { matchEmployees } from '@/utils/shiftEmployeeMatching';
import { buildShiftImportPreview } from '@/utils/shiftImportPreview';
import { cn } from '@/lib/utils';
import { ShiftImportEmployeeReview } from './ShiftImportEmployeeReview';
import { ShiftImportPreview } from './ShiftImportPreview';

type ImportStep = 'upload' | 'mapping' | 'employees' | 'preview' | 'importing';

// TODO: publishedWeeks and existingShifts are currently passed from the parent, which only
// has data for the current week view. For accurate duplicate/published detection, the import
// sheet should fetch its own shifts and published weeks for the full date range of the
// imported CSV. This is a known limitation — fast-follow to add date-range-aware fetching.
interface ShiftImportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  employees: Employee[];
  existingShifts?: Shift[];
  publishedWeeks?: string[];
}

const STEP_LABELS: Record<ImportStep, string> = {
  upload: 'Upload',
  mapping: 'Map Columns',
  employees: 'Employees',
  preview: 'Preview',
  importing: 'Importing',
};

const STEP_ORDER: ImportStep[] = ['upload', 'mapping', 'employees', 'preview', 'importing'];

function parseDateAndTime(dateStr?: string, timeStr?: string): string | null {
  const combined = [dateStr, timeStr].filter(Boolean).join(' ').trim();
  if (!combined) return null;
  const d = new Date(combined);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function resolveTime(
  fieldMap: Map<string, string>,
  row: Record<string, string>,
  dateVal: string,
  datetimeField: string,
  timeField: string,
): string | null {
  if (fieldMap.has(datetimeField)) {
    return parseDateAndTime(row[fieldMap.get(datetimeField) ?? '']);
  }
  return parseDateAndTime(dateVal, row[fieldMap.get(timeField) ?? '']?.trim());
}

function buildParsedShiftsFromMappings(
  rows: Record<string, string>[],
  mappings: ShiftColumnMapping[],
): ParsedShift[] {
  const fieldMap = new Map<string, string>();
  mappings.forEach(m => {
    if (m.targetField) fieldMap.set(m.targetField, m.csvColumn);
  });

  const shifts: ParsedShift[] = [];

  for (const row of rows) {
    const employeeName = row[fieldMap.get('employee_name') ?? '']?.trim() || '';
    if (!employeeName) continue;

    const dateVal = row[fieldMap.get('date') ?? '']?.trim() || '';
    const startTime = resolveTime(fieldMap, row, dateVal, 'start_datetime', 'start_time');
    const endTime = resolveTime(fieldMap, row, dateVal, 'end_datetime', 'end_time');

    if (!startTime || !endTime) continue;

    const position = row[fieldMap.get('position') ?? '']?.trim() || '';
    const breakStr = row[fieldMap.get('break_duration') ?? '']?.trim() || '';
    const breakDuration = breakStr ? Number.parseInt(breakStr, 10) : undefined;
    const notes = row[fieldMap.get('notes') ?? '']?.trim() || undefined;

    shifts.push({
      employeeName,
      startTime,
      endTime,
      position,
      breakDuration: breakDuration && !Number.isNaN(breakDuration) ? breakDuration : undefined,
      notes,
    });
  }

  return shifts;
}

export const ShiftImportSheet = ({
  open,
  onOpenChange,
  restaurantId,
  employees,
  existingShifts = [],
  publishedWeeks = [],
}: ShiftImportSheetProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const bulkCreateShifts = useBulkCreateShifts();
  const createEmployeeMutation = useCreateEmployee();

  const [step, setStep] = useState<ImportStep>('upload');
  const [parsedShifts, setParsedShifts] = useState<ParsedShift[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<ShiftColumnMapping[]>([]);
  const [isSling, setIsSling] = useState(false);
  const [employeeMatches, setEmployeeMatches] = useState<ShiftImportEmployee[]>([]);
  const [employeeMap, setEmployeeMap] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [availableEmployees, setAvailableEmployees] = useState<Employee[]>(employees);
  const [isCreatingEmployees, setIsCreatingEmployees] = useState(false);
  const [previewResult, setPreviewResult] = useState<ShiftImportPreviewResult | null>(null);

  useEffect(() => {
    setAvailableEmployees(employees);
  }, [employees]);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    handler();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    if (!open) {
      setStep('upload');
      setParsedShifts([]);
      setHeaders([]);
      setRows([]);
      setMappings([]);
      setIsSling(false);
      setEmployeeMatches([]);
      setEmployeeMap({});
      setFileName('');
      setIsCreatingEmployees(false);
      setPreviewResult(null);
    }
  }, [open]);

  const currentStepIndex = STEP_ORDER.indexOf(step);

  const mappingValidation = useMemo(() => {
    const mappedFields = new Map<string, number>();
    mappings.forEach(m => {
      if (m.targetField) {
        mappedFields.set(m.targetField, (mappedFields.get(m.targetField) || 0) + 1);
      }
    });

    const duplicates = Array.from(mappedFields.entries())
      .filter(([, count]) => count > 1)
      .map(([field]) => field);

    const hasEmployee = mappings.some(m => m.targetField === 'employee_name' || m.targetField === 'employee_id');
    const hasStartTime = mappings.some(m => m.targetField === 'start_time' || m.targetField === 'start_datetime');
    const hasEndTime = mappings.some(m => m.targetField === 'end_time' || m.targetField === 'end_datetime');

    const isValid = hasEmployee && hasStartTime && hasEndTime && duplicates.length === 0;
    const errors = [
      !hasEmployee && 'Map a column to Employee Name or Employee ID.',
      !hasStartTime && 'Map a column to Start Time or Start Date/Time.',
      !hasEndTime && 'Map a column to End Time or End Date/Time.',
      duplicates.length > 0 && `Duplicate mappings: ${duplicates.join(', ')}`,
    ].filter((e): e is string => Boolean(e));

    return { isValid, errors };
  }, [mappings]);

  const runEmployeeMatching = useCallback((shifts: ParsedShift[], emps: Employee[]) => {
    const csvNames = shifts.map(s => ({ name: s.employeeName, position: s.position }));
    const matches = matchEmployees(csvNames, emps);
    setEmployeeMatches(matches);

    const map: Record<string, string> = {};
    matches.forEach(m => {
      if (m.matchedEmployeeId && m.action === 'link') {
        map[m.csvName] = m.matchedEmployeeId;
      }
    });
    setEmployeeMap(map);
  }, []);

  const handleFile = async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension && !['csv', 'txt'].includes(extension)) {
      toast({
        title: 'Unsupported file',
        description: 'Please upload a CSV or TXT file.',
        variant: 'destructive',
      });
      return;
    }

    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedRows = results.data as Record<string, string>[];
        const parsedHeaders = results.meta.fields || [];

        if (!parsedRows.length) {
          toast({
            title: 'Empty file',
            description: 'The file contains no data rows.',
            variant: 'destructive',
          });
          return;
        }

        setHeaders(parsedHeaders);
        setRows(parsedRows);

        if (isSlingFormat(parsedHeaders, parsedRows)) {
          setIsSling(true);
          const shifts = parseSlingCSV(parsedHeaders, parsedRows);
          setParsedShifts(shifts);
          runEmployeeMatching(shifts, availableEmployees);
          setStep('employees');
        } else {
          setIsSling(false);
          const suggested = suggestShiftMappings(parsedHeaders, parsedRows);
          setMappings(suggested);
          setStep('mapping');
        }
      },
      error: (error) => {
        toast({
          title: 'Upload failed',
          description: error.message || 'Could not read the file.',
          variant: 'destructive',
        });
      },
    });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleMappingNext = () => {
    const shifts = buildParsedShiftsFromMappings(rows, mappings);
    if (!shifts.length) {
      toast({
        title: 'No shifts parsed',
        description: 'Could not extract any shifts from the data. Check your column mappings.',
        variant: 'destructive',
      });
      return;
    }
    setParsedShifts(shifts);
    runEmployeeMatching(shifts, availableEmployees);
    setStep('employees');
  };

  const handleEmployeesNext = () => {
    const newEmployeesCount = employeeMatches.filter(m => m.action === 'create').length;
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts,
      publishedWeeks,
      newEmployeesCount,
    });
    setPreviewResult(result);
    setStep('preview');
  };

  const updateMatchEntry = useCallback((
    match: ShiftImportEmployee,
    employeeId: string | null,
    action: 'link' | 'create' | 'skip',
  ): ShiftImportEmployee => {
    if (action === 'link' && employeeId) {
      const emp = availableEmployees.find(e => e.id === employeeId);
      return { ...match, matchedEmployeeId: employeeId, matchedEmployeeName: emp?.name || null, action: 'link', matchConfidence: 'exact' as const };
    }
    if (action === 'skip') {
      return { ...match, matchedEmployeeId: null, matchedEmployeeName: null, action: 'skip' };
    }
    return { ...match, action };
  }, [availableEmployees]);

  const handleUpdateMatch = useCallback((normalizedName: string, employeeId: string | null, action: 'link' | 'create' | 'skip') => {
    const matchEntry = employeeMatches.find(m => m.normalizedName === normalizedName);
    const csvName = matchEntry?.csvName;

    setEmployeeMatches(prev =>
      prev.map(m => m.normalizedName === normalizedName ? updateMatchEntry(m, employeeId, action) : m)
    );

    setEmployeeMap(prev => {
      const next = { ...prev };
      if (!csvName) return next;
      if (action === 'link' && employeeId) {
        next[csvName] = employeeId;
      } else {
        delete next[csvName];
      }
      return next;
    });
  }, [updateMatchEntry, employeeMatches]);

  const handleBulkCreateAll = async () => {
    const toCreate = employeeMatches.filter(m => m.matchConfidence === 'none' && m.action !== 'link');
    if (!toCreate.length) return;

    setIsCreatingEmployees(true);
    const newMap = { ...employeeMap };
    const newMatches = [...employeeMatches];
    const newAvailable = [...availableEmployees];

    for (const match of toCreate) {
      try {
        const result = await createEmployeeMutation.mutateAsync({
          restaurant_id: restaurantId,
          name: match.csvName.trim(),
          position: match.csvPosition || 'Staff',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 0,
        });

        newAvailable.push(result as Employee);
        newMap[match.csvName] = result.id;

        const idx = newMatches.findIndex(m => m.normalizedName === match.normalizedName);
        if (idx >= 0) {
          newMatches[idx] = {
            ...newMatches[idx],
            matchedEmployeeId: result.id,
            matchedEmployeeName: result.name,
            matchConfidence: 'exact',
            action: 'link',
          };
        }
      } catch {
        // Error is surfaced via the hook toast
      }
    }

    setAvailableEmployees(newAvailable);
    setEmployeeMap(newMap);
    setEmployeeMatches(newMatches);
    setIsCreatingEmployees(false);
  };

  const handleImport = async () => {
    if (!previewResult) return;

    const readyShifts = previewResult.shifts.filter(s => s.status === 'ready' && s.employeeId);
    if (!readyShifts.length) {
      toast({
        title: 'Nothing to import',
        description: 'No shifts are ready to import. Resolve duplicates or unmatched employees.',
        variant: 'destructive',
      });
      return;
    }

    setStep('importing');

    try {
      const inserts = readyShifts.map(s => ({
        restaurant_id: restaurantId,
        employee_id: s.employeeId || '',
        start_time: s.startTime,
        end_time: s.endTime,
        break_duration: s.breakDuration || 0,
        position: s.position || '',
        notes: s.notes || null,
        status: 'scheduled' as const,
        is_published: false,
        locked: false,
      }));

      await bulkCreateShifts.mutateAsync(inserts);

      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['employees', restaurantId] });

      toast({
        title: 'Import complete',
        description: `Imported ${readyShifts.length} shift${readyShifts.length === 1 ? '' : 's'} successfully.`,
      });

      onOpenChange(false);
    } catch (error) {
      setStep('preview');
      toast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleBack = () => {
    if (step === 'upload') {
      onOpenChange(false);
    } else if (step === 'mapping') {
      setStep('upload');
    } else if (step === 'employees') {
      setStep(isSling ? 'upload' : 'mapping');
    } else if (step === 'preview') {
      setStep('employees');
    }
  };

  const renderStepIndicator = () => {
    const steps = isSling
      ? (['upload', 'employees', 'preview'] as ImportStep[])
      : (['upload', 'mapping', 'employees', 'preview'] as ImportStep[]);

    return (
      <div className="flex items-center gap-1.5 mb-5">
        {steps.map((s, i) => {
          const stepIdx = STEP_ORDER.indexOf(s);
          const isActive = s === step;
          const isCompleted = currentStepIndex > stepIdx;
          return (
            <div key={s} className="flex items-center gap-1.5">
              {i > 0 && <div className={cn('h-px w-4', isCompleted ? 'bg-foreground' : 'bg-border/40')} />}
              <div
                className={cn(
                  'h-6 px-2 rounded-md flex items-center justify-center text-[11px] font-medium transition-colors',
                  isActive && 'bg-foreground text-background',
                  !isActive && isCompleted && 'bg-muted text-foreground',
                  !isActive && !isCompleted && 'bg-muted/50 text-muted-foreground',
                )}
              >
                {STEP_LABELS[s]}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderUploadStep = () => (
    <div className="space-y-5">
      <label
        className="border border-dashed border-border/40 rounded-xl p-8 text-center bg-muted/20 hover:bg-muted/30 transition-colors cursor-pointer block"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="mx-auto flex items-center justify-center h-10 w-10 rounded-xl bg-muted/50 mb-3">
          <Upload className="h-5 w-5 text-foreground" />
        </div>
        <p className="text-[14px] font-medium text-foreground">Drop a CSV file here</p>
        <p className="text-[13px] text-muted-foreground mt-1">or choose a file to upload</p>
        <div className="mt-4 flex items-center justify-center">
          <span className="inline-flex items-center gap-2 text-[13px] font-medium text-foreground cursor-pointer hover:text-foreground/80 transition-colors">
            <FileText className="h-4 w-4" />
            Choose file
          </span>
        </div>
        <Input
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={handleFileChange}
        />
      </label>
      <div className="text-[12px] text-muted-foreground space-y-1">
        <p>Supported formats: CSV, TXT</p>
        <p>Works with Sling exports and generic shift schedules.</p>
      </div>
    </div>
  );

  const handleMappingChange = useCallback((header: string, value: string) => {
    const targetField = value === 'ignore' ? null : (value as ShiftColumnMapping['targetField']);
    setMappings(prev => prev.map(m => m.csvColumn === header ? { ...m, targetField } : m));
  }, []);

  const renderMappingStep = () => (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">{fileName}</Badge>
        <span className="text-[12px] text-muted-foreground">{rows.length} rows</span>
      </div>

      {!mappingValidation.isValid && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1 text-[13px]">
              {mappingValidation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border border-border/40 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => {
                const mapping = mappings.find(m => m.csvColumn === header);
                return (
                  <TableHead key={header} className="min-w-[180px] align-top">
                    <div className="space-y-2 py-1">
                      <Select
                        value={mapping?.targetField || 'ignore'}
                        onValueChange={(value) => handleMappingChange(header, value)}
                      >
                        <SelectTrigger
                          className="h-8 text-[13px] bg-muted/30 border-border/40 rounded-lg"
                          aria-label={`Map column ${header}`}
                        >
                          <SelectValue placeholder="Ignore" />
                        </SelectTrigger>
                        <SelectContent>
                          {SHIFT_FIELD_OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground font-mono truncate">{header}</span>
                        {mapping && mapping.confidence !== 'none' && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] px-1 py-0 rounded',
                              mapping.confidence === 'high' && 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
                              mapping.confidence === 'medium' && 'bg-amber-500/10 text-amber-700 border-amber-500/20',
                              mapping.confidence === 'low' && 'bg-muted text-muted-foreground border-border/40',
                            )}
                          >
                            {mapping.confidence}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 5).map((row) => (
              <TableRow key={headers.map(h => row[h] ?? '').join('|')}>
                {headers.map((header) => (
                  <TableCell key={`${row[headers[0]] ?? ''}-${header}`} className="text-[12px] text-muted-foreground">
                    {row[header]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const renderEmployeesStep = () => (
    <ShiftImportEmployeeReview
      employeeMatches={employeeMatches}
      existingEmployees={availableEmployees}
      onUpdateMatch={handleUpdateMatch}
      onBulkCreateAll={handleBulkCreateAll}
      isCreating={isCreatingEmployees}
    />
  );

  const renderPreviewStep = () => {
    if (!previewResult) return null;
    return (
      <ShiftImportPreview
        preview={previewResult}
        employeeMatches={employeeMatches}
      />
    );
  };

  const renderImportingStep = () => (
    <div className="space-y-4 py-8">
      <div className="flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="text-[14px] font-medium text-foreground">Importing shifts...</p>
        <p className="text-[13px] text-muted-foreground mt-1">This may take a moment.</p>
      </div>
    </div>
  );

  const canGoNext = () => {
    if (step === 'mapping') return mappingValidation.isValid;
    if (step === 'employees') return parsedShifts.length > 0;
    if (step === 'preview') return previewResult && previewResult.summary.readyCount > 0;
    return false;
  };

  const handleNext = () => {
    if (step === 'mapping') handleMappingNext();
    else if (step === 'employees') handleEmployeesNext();
    else if (step === 'preview') handleImport();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn(
          'w-full overflow-y-auto',
          isMobile ? 'max-h-[90vh] rounded-t-xl' : 'sm:max-w-3xl'
        )}
      >
        <SheetHeader className="pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <CalendarPlus className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <SheetTitle className="text-[17px] font-semibold text-foreground">Import Shifts</SheetTitle>
              <SheetDescription className="text-[13px] text-muted-foreground mt-0.5">
                Upload a CSV to bulk-add scheduled shifts.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-5">
          {step !== 'upload' && step !== 'importing' && renderStepIndicator()}
          {step === 'upload' && renderUploadStep()}
          {step === 'mapping' && renderMappingStep()}
          {step === 'employees' && renderEmployeesStep()}
          {step === 'preview' && renderPreviewStep()}
          {step === 'importing' && renderImportingStep()}
        </div>

        {step !== 'importing' && (
          <SheetFooter className="mt-6 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={handleBack}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              {step === 'upload' ? (
                'Cancel'
              ) : (
                <>
                  <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                  Back
                </>
              )}
            </Button>
            {step !== 'upload' && (
              <Button
                onClick={handleNext}
                disabled={!canGoNext()}
                className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                {step === 'preview' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    Import {previewResult?.summary.readyCount || 0} Shifts
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                  </>
                )}
              </Button>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};
