import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { Upload, FileText, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useBulkCreateEmployeeTips, useBulkCreateTimePunches } from '@/hooks/useTimePunches';
import { useCreateEmployee } from '@/hooks/useEmployees';
import { cn, formatCurrency } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { Employee } from '@/types/scheduling';
import {
  TIME_PUNCH_FIELD_OPTIONS,
  TimePunchColumnMapping,
  buildTimePunchImportPreview,
  normalizeEmployeeKey,
  suggestTimePunchMappings,
} from '@/utils/timePunchImport';

type UploadStep = 'upload' | 'processing' | 'mapping' | 'importing';

interface TimePunchUploadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  employees: Employee[];
  onImportComplete?: (summary: { punchCount: number; firstPunchDate?: Date }) => void;
}

const detectSourceLabel = (fileName: string) => {
  const lower = fileName.toLowerCase();
  if (lower.includes('toast')) return 'Toast upload';
  if (lower.includes('timeentries')) return 'Toast upload';
  if (lower.includes('square')) return 'Square upload';
  if (lower.includes('clover')) return 'Clover upload';
  if (lower.includes('focus')) return 'Focus upload';
  if (lower.includes('shift4')) return 'Shift4 upload';
  if (lower.endsWith('.xlsx')) return 'Spreadsheet upload';
  if (lower.endsWith('.txt')) return 'Text upload';
  return 'CSV upload';
};

const normalizeHeaderKey = (value: string) => value.toLowerCase().trim();

const getHeaderIndex = (headers: string[], candidates: string[]) => {
  const normalizedCandidates = candidates.map(normalizeHeaderKey);
  return headers.findIndex((header) => normalizedCandidates.includes(normalizeHeaderKey(header)));
};

const shouldMergeEmployee = (value?: string, nextValue?: string) => {
  if (!value || !nextValue) return false;
  const trimmedNext = nextValue.trim().toLowerCase();
  if (!/[a-z]/i.test(trimmedNext)) return false;
  if (trimmedNext.includes('auto') || trimmedNext.includes('clock')) return false;
  return /[a-z]/i.test(value);
};

const shouldMergeDate = (value?: string, nextValue?: string) => {
  if (!value || !nextValue) return false;
  const left = value.trim();
  const right = nextValue.trim();
  const monthDay = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}$/i.test(left);
  const numericDay = /^\d{1,2}\/\d{1,2}$/.test(left);
  const year = /^\d{4}$/.test(right);
  return year && (monthDay || numericDay);
};

const repairRow = (headers: string[], row: string[]) => {
  if (row.length === headers.length) return row;
  const repaired = [...row];
  const targetLength = headers.length;

  const mergeAt = (index: number, joiner = ', ') => {
    repaired[index] = `${repaired[index] ?? ''}${joiner}${repaired[index + 1] ?? ''}`.trim();
    repaired.splice(index + 1, 1);
  };

  const employeeIndex = getHeaderIndex(headers, ['employee', 'employee name', 'staff']);
  const anomaliesIndex = getHeaderIndex(headers, ['anomalies', 'notes', 'comment']);
  if (repaired.length > targetLength && employeeIndex !== -1 && anomaliesIndex === employeeIndex + 1) {
    if (shouldMergeEmployee(repaired[employeeIndex], repaired[employeeIndex + 1])) {
      mergeAt(employeeIndex);
    }
  }

  const dateIndex = getHeaderIndex(headers, ['date', 'work date', 'punch date', 'shift date']);
  if (repaired.length > targetLength && dateIndex !== -1) {
    if (shouldMergeDate(repaired[dateIndex], repaired[dateIndex + 1])) {
      mergeAt(dateIndex);
    }
  }

  if (repaired.length > targetLength) {
    const keep = repaired.slice(0, targetLength - 1);
    const tail = repaired.slice(targetLength - 1).join(' ').trim();
    return [...keep, tail];
  }

  while (repaired.length < targetLength) {
    repaired.push('');
  }

  return repaired;
};

const parseCsvFile = (file: File) =>
  new Promise<{ headers: string[]; rows: Record<string, string>[] }>((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][];
        if (!rows.length) {
          reject(new Error('File appears to be empty.'));
          return;
        }

        const headers = rows[0].map((header, index) => {
          const trimmed = String(header ?? '').trim();
          return trimmed ? trimmed : `Column_${index}`;
        });

        const dataRows = rows.slice(1).map((row) => repairRow(headers, row));
        const records = dataRows.map((row) =>
          headers.reduce<Record<string, string>>((acc, header, index) => {
            acc[header] = row[index] ?? '';
            return acc;
          }, {})
        );

        if (!records.length) {
          reject(new Error('File appears to be empty.'));
          return;
        }

        resolve({ headers, rows: records });
      },
      error: (error) => reject(error),
    });
  });

export const TimePunchUploadSheet = ({
  open,
  onOpenChange,
  restaurantId,
  employees,
  onImportComplete,
}: TimePunchUploadSheetProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createEmployeeMutation = useCreateEmployee();
  const bulkCreateTimePunches = useBulkCreateTimePunches();
  const bulkCreateEmployeeTips = useBulkCreateEmployeeTips();
  const [step, setStep] = useState<UploadStep>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<TimePunchColumnMapping[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState('CSV upload');
  const [isMobile, setIsMobile] = useState(false);
  const [employeeOverrides, setEmployeeOverrides] = useState<Record<string, string>>({});
  const [employeePositions, setEmployeePositions] = useState<Record<string, string>>({});
  const [creatingEmployees, setCreatingEmployees] = useState<Record<string, boolean>>({});
  const [availableEmployees, setAvailableEmployees] = useState<Employee[]>(employees);
  const mappingTimeoutRef = useRef<number | null>(null);

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
      if (mappingTimeoutRef.current) {
        clearTimeout(mappingTimeoutRef.current);
        mappingTimeoutRef.current = null;
      }
      setStep('upload');
      setHeaders([]);
      setRows([]);
      setMappings([]);
      setFileName(null);
      setSourceLabel('CSV upload');
      setEmployeeOverrides({});
      setEmployeePositions({});
      setCreatingEmployees({});
    }
  }, [open]);

  useEffect(() => () => {
    if (mappingTimeoutRef.current) {
      clearTimeout(mappingTimeoutRef.current);
      mappingTimeoutRef.current = null;
    }
  }, []);

  const mappingValidation = useMemo(() => {
    const mappedFields = new Map<string, number>();
    mappings.forEach(mapping => {
      if (mapping.targetField) {
        mappedFields.set(mapping.targetField, (mappedFields.get(mapping.targetField) || 0) + 1);
      }
    });

    const duplicates = Array.from(mappedFields.entries())
      .filter(([, count]) => count > 1)
      .map(([field]) => field);

    const hasEmployee = mappings.some(m => m.targetField === 'employee_name' || m.targetField === 'employee_id');
    const hasActionMode = mappings.some(m => m.targetField === 'action') && mappings.some(m => m.targetField === 'timestamp');
    const hasShiftMode = mappings.some(m => ['clock_in_time', 'clock_out_time', 'break_start_time', 'break_end_time'].includes(m.targetField || ''));

    const isValid = hasEmployee && (hasActionMode || hasShiftMode) && duplicates.length === 0;
    const errors = [
      !hasEmployee && 'Map a column to Employee Name or Employee ID.',
      !hasActionMode && !hasShiftMode && 'Map either Action + Timestamp or Clock In/Out times.',
      duplicates.length > 0 && `Duplicate mappings: ${duplicates.join(', ')}`,
    ].filter(Boolean) as string[];

    return { isValid, errors };
  }, [mappings]);

  const preview = useMemo(() => {
    if (!rows.length || !mappings.length || !restaurantId) return null;
    return buildTimePunchImportPreview({
      rows,
      mappings,
      employees,
      restaurantId,
      sourceLabel,
      employeeOverrides,
    });
  }, [rows, mappings, employees, restaurantId, sourceLabel, employeeOverrides]);

  useEffect(() => {
    if (!preview?.unmatchedEmployees?.length) return;
    setEmployeePositions(prev => {
      const next = { ...prev };
      preview.unmatchedEmployees.forEach(({ name }) => {
        const key = normalizeEmployeeKey(name);
        if (!next[key]) {
          next[key] = 'Staff';
        }
      });
      return next;
    });
  }, [preview?.unmatchedEmployees]);

  const handleMapEmployee = (name: string, employeeId: string | null) => {
    const key = normalizeEmployeeKey(name);
    setEmployeeOverrides(prev => {
      const next = { ...prev };
      if (!employeeId) {
        delete next[key];
        return next;
      }
      next[key] = employeeId;
      return next;
    });
  };

  const handleCreateEmployee = async (name: string) => {
    const key = normalizeEmployeeKey(name);
    const position = employeePositions[key]?.trim() || 'Staff';
    const existing = availableEmployees.find(emp => normalizeEmployeeKey(emp.name) === key);

    if (existing) {
      handleMapEmployee(name, existing.id);
      toast({
        title: 'Employee matched',
        description: `${name} mapped to ${existing.name}.`,
      });
      return;
    }

    setCreatingEmployees(prev => ({ ...prev, [key]: true }));

    try {
      await createEmployeeMutation.mutateAsync(
        {
          restaurant_id: restaurantId,
          name: name.trim(),
          position,
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 0,
        },
        {
          onSuccess: (data) => {
            setAvailableEmployees(prev => [data as Employee, ...prev]);
            handleMapEmployee(name, data.id);
          },
        }
      );
    } catch {
      // Errors are surfaced via the hook toast
    } finally {
      setCreatingEmployees(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleFile = async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension && !['csv', 'txt', 'xlsx'].includes(extension)) {
      toast({
        title: 'Unsupported file',
        description: 'Please upload a CSV, TXT, or XLSX file.',
        variant: 'destructive',
      });
      return;
    }

    if (extension === 'xlsx') {
      toast({
        title: 'XLSX support needs setup',
        description: 'Please export as CSV for now.',
        variant: 'destructive',
      });
      return;
    }

    setStep('processing');
    setFileName(file.name);
    setSourceLabel(detectSourceLabel(file.name));

    try {
      const { headers, rows } = await parseCsvFile(file);
      setHeaders(headers);
      setRows(rows);
      setMappings(suggestTimePunchMappings(headers, rows));
      if (mappingTimeoutRef.current) {
        clearTimeout(mappingTimeoutRef.current);
      }
      mappingTimeoutRef.current = window.setTimeout(() => {
        setStep('mapping');
        mappingTimeoutRef.current = null;
      }, 350);
    } catch (error) {
      setStep('upload');
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Could not read the file.',
        variant: 'destructive',
      });
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleImport = async () => {
    if (!preview || !preview.punches.length) {
      toast({
        title: 'Nothing to import',
        description: 'Resolve unmatched employees or fix mappings to include punches.',
        variant: 'destructive',
      });
      return;
    }

    setStep('importing');

    try {
      const employeeLookup = availableEmployees.reduce<Record<string, { id: string; name: string; position?: string | null }>>((acc, employee) => {
        acc[employee.id] = {
          id: employee.id,
          name: employee.name,
          position: employee.position ?? null,
        };
        return acc;
      }, {});

      await bulkCreateTimePunches.mutateAsync({
        restaurantId,
        punches: preview.punches,
        employeeLookup,
      });

      if (preview.tips.length > 0) {
        await bulkCreateEmployeeTips.mutateAsync({
          restaurantId,
          tips: preview.tips,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['employees', restaurantId] });

      toast({
        title: 'Import complete',
        description: `Imported ${preview.totalPunches} punch${preview.totalPunches === 1 ? '' : 'es'}.`,
      });

      onImportComplete?.({
        punchCount: preview.totalPunches,
        firstPunchDate: preview.punches[0] ? new Date(preview.punches[0].punch_time) : undefined,
      });

      onOpenChange(false);
    } catch (error) {
      setStep('mapping');
      toast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const renderUploadStep = () => (
    <div className="space-y-6">
      <div
        className="border border-dashed rounded-lg p-8 text-center bg-muted/20 hover:bg-muted/30 transition-colors"
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
      >
        <div className="mx-auto flex items-center justify-center h-10 w-10 rounded-full bg-primary/10 mb-3">
          <Upload className="h-5 w-5 text-primary" />
        </div>
        <p className="text-sm font-medium">Drop a file here</p>
        <p className="text-xs text-muted-foreground mt-1">or choose a file to upload</p>
        <div className="mt-4 flex items-center justify-center">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-primary cursor-pointer">
            <FileText className="h-4 w-4" />
            Choose file
            <Input
              type="file"
              accept=".csv,.txt,.xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        </div>
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <p>Supported formats: CSV, XLSX, TXT</p>
        <p>Works with Toast, Square, Clover, Focus, and others.</p>
      </div>
    </div>
  );

  const renderProcessingStep = () => (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Analyzing file...</p>
        <p className="text-xs text-muted-foreground">Detecting columns and punch patterns.</p>
      </div>
      <Progress value={60} />
      <div className="text-xs text-muted-foreground space-y-1">
        <p>• Detecting columns</p>
        <p>• Inferring employees</p>
        <p>• Identifying punch pairs</p>
      </div>
    </div>
  );

  const renderMappingStep = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-xs">{sourceLabel}</Badge>
        {fileName && <span>{fileName}</span>}
        <span>·</span>
        <span>{rows.length} rows</span>
      </div>

      {preview && (
        <div className="rounded-lg border bg-muted/20 p-3 text-sm">
          <div className="font-medium mb-2">Preview Summary</div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{preview.totalPunches} punches detected</span>
            <span>{preview.incompleteShifts} incomplete shifts</span>
            <span>{preview.overlappingShifts} overlapping shifts</span>
            {preview.totalTips > 0 && <span>{formatCurrency(preview.totalTips)} tips found</span>}
            {preview.missingEmployees > 0 && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20">
                {preview.missingEmployees} missing employees
              </Badge>
            )}
            {preview.invalidTimes > 0 && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20">
                {preview.invalidTimes} invalid times
              </Badge>
            )}
          </div>
        </div>
      )}

      {preview?.unmatchedEmployees?.length ? (
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">Unmatched employees</div>
            <p className="text-xs text-muted-foreground">
              Map or create these employees to include their rows.
            </p>
          </div>
          <div className="space-y-2">
            {preview.unmatchedEmployees.map(({ name, count }) => {
              const key = normalizeEmployeeKey(name);
              const mappedId = employeeOverrides[key] ?? '';
              const positionValue = employeePositions[key] ?? 'Staff';
              const isCreating = creatingEmployees[key];
              return (
                <div key={key} className="rounded-lg border bg-muted/20 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{name}</div>
                      <div className="text-xs text-muted-foreground">{count} row{count === 1 ? '' : 's'}</div>
                    </div>
                    {mappedId && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
                        Mapped
                      </Badge>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <Select
                      value={mappedId}
                      onValueChange={(value) => {
                        if (value === '__clear__') {
                          handleMapEmployee(name, null);
                          return;
                        }
                        handleMapEmployee(name, value);
                      }}
                    >
                      <SelectTrigger
                        className="h-9"
                        aria-label={`Map employee for ${name} (${key})`}
                      >
                        <SelectValue placeholder="Map to employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {mappedId && (
                          <SelectItem value="__clear__">Clear mapping</SelectItem>
                        )}
                        {availableEmployees.map((employee) => (
                          <SelectItem key={employee.id} value={employee.id}>
                            {employee.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Input
                        value={positionValue}
                        onChange={(event) =>
                          setEmployeePositions(prev => ({
                            ...prev,
                            [key]: event.target.value,
                          }))
                        }
                        className="h-9"
                        placeholder="Position"
                        aria-label={`Position for ${name} (${key})`}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCreateEmployee(name)}
                        disabled={isCreating}
                      >
                        {isCreating && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                        Create
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {!mappingValidation.isValid && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1 text-sm">
              {mappingValidation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => (
                <TableHead key={header} className="min-w-[180px] align-top">
                  <div className="space-y-2">
                    <Select
                      value={mappings.find(m => m.csvColumn === header)?.targetField || 'ignore'}
                      onValueChange={(value) => {
                        setMappings(prev => prev.map(mapping => (
                          mapping.csvColumn === header
                            ? { ...mapping, targetField: value === 'ignore' ? null : value as TimePunchColumnMapping['targetField'] }
                            : mapping
                        )));
                      }}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Ignore" />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_PUNCH_FIELD_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="text-xs text-muted-foreground font-mono">{header}</div>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 6).map((row, index) => (
              <TableRow key={index}>
                {headers.map((header) => (
                  <TableCell key={`${index}-${header}`} className="text-xs text-muted-foreground">
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn(
          'w-full overflow-y-auto',
          isMobile ? 'max-h-[90vh] rounded-t-xl' : 'sm:max-w-3xl'
        )}
      >
        <SheetHeader>
          <SheetTitle>Upload Time Punches</SheetTitle>
          <SheetDescription>
            Import raw punch data, then review and edit it in the time clock.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {step === 'upload' && renderUploadStep()}
          {step === 'processing' && renderProcessingStep()}
          {(step === 'mapping' || step === 'importing') && renderMappingStep()}
        </div>

        <SheetFooter className="mt-6">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={step === 'importing' || !mappingValidation.isValid}
          >
            {step === 'importing' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Import & Review
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
