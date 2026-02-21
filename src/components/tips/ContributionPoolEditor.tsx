import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TipContributionPool, CreatePoolInput, UpdatePoolInput } from '@/hooks/useTipContributionPools';
import type { Employee } from '@/types/scheduling';

interface ContributionPoolEditorProps {
  readonly pools: TipContributionPool[];
  readonly eligibleEmployees: Employee[];
  readonly onCreatePool: (pool: CreatePoolInput) => Promise<TipContributionPool>;
  readonly onUpdatePool: (args: { id: string; updates: UpdatePoolInput }) => Promise<TipContributionPool>;
  readonly onDeletePool: (id: string) => Promise<void>;
  readonly totalContributionPercentage: number;
}

interface PoolCardState {
  name: string;
  contribution_percentage: number;
  share_method: 'hours' | 'role' | 'even';
  role_weights: Record<string, number>;
  eligible_employee_ids: string[];
}

const DEBOUNCE_MS = 600;

function PoolCard({
  pool,
  eligibleEmployees,
  onUpdate,
  onDelete,
}: Readonly<{
  pool: TipContributionPool;
  eligibleEmployees: Employee[];
  onUpdate: (args: { id: string; updates: UpdatePoolInput }) => Promise<TipContributionPool>;
  onDelete: (id: string) => Promise<void>;
}>) {
  const [local, setLocal] = useState<PoolCardState>({
    name: pool.name,
    contribution_percentage: pool.contribution_percentage,
    share_method: pool.share_method,
    role_weights: pool.role_weights ?? {},
    eligible_employee_ids: pool.eligible_employee_ids ?? [],
  });
  const [employeesExpanded, setEmployeesExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when pool prop changes (e.g., after server response)
  useEffect(() => {
    setLocal({
      name: pool.name,
      contribution_percentage: pool.contribution_percentage,
      share_method: pool.share_method,
      role_weights: pool.role_weights ?? {},
      eligible_employee_ids: pool.eligible_employee_ids ?? [],
    });
  }, [pool.name, pool.contribution_percentage, pool.share_method, pool.role_weights, pool.eligible_employee_ids]);

  const debouncedSave = useCallback(
    (updates: UpdatePoolInput) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        onUpdate({ id: pool.id, updates });
      }, DEBOUNCE_MS);
    },
    [onUpdate, pool.id]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const updateField = <K extends keyof PoolCardState>(field: K, value: PoolCardState[K]) => {
    setLocal(prev => ({ ...prev, [field]: value }));
    debouncedSave({ [field]: value });
  };

  const flushAndSave = (updates: UpdatePoolInput) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    onUpdate({ id: pool.id, updates });
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(pool.id);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEmployeeToggle = (employeeId: string, checked: boolean) => {
    const newIds = checked
      ? [...local.eligible_employee_ids, employeeId]
      : local.eligible_employee_ids.filter(id => id !== employeeId);
    updateField('eligible_employee_ids', newIds);
  };

  const handleSelectAllEmployees = () => {
    const allIds = eligibleEmployees.map(e => e.id);
    updateField('eligible_employee_ids', allIds);
  };

  const handleSelectNoEmployees = () => {
    updateField('eligible_employee_ids', []);
  };

  const handleRoleWeightChange = (role: string, weight: number) => {
    const newWeights = { ...local.role_weights, [role]: weight };
    updateField('role_weights', newWeights);
  };

  // Get unique roles from eligible employees
  const uniqueRoles = [...new Set(eligibleEmployees.map(e => e.position).filter(Boolean))];

  const selectedEmployeeSet = new Set(local.eligible_employee_ids);

  return (
    <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
      {/* Pool header: name + percentage + delete */}
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-3">
            {/* Pool Name */}
            <div>
              <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Pool Name
              </Label>
              <Input
                value={local.name}
                onChange={e => setLocal(prev => ({ ...prev, name: e.target.value }))}
                onBlur={() => flushAndSave({ name: local.name })}
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border mt-1"
                placeholder="e.g., Kitchen Pool"
              />
            </div>

            {/* Contribution Percentage */}
            <div>
              <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Contribution %
              </Label>
              <div className="relative mt-1">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={local.contribution_percentage}
                  onChange={e => setLocal(prev => ({
                    ...prev,
                    contribution_percentage: Number.parseFloat(e.target.value) || 0,
                  }))}
                  onBlur={() => flushAndSave({ contribution_percentage: local.contribution_percentage })}
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                  %
                </span>
              </div>
            </div>
          </div>

          {/* Delete button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={isDeleting}
            className="h-9 px-2 text-destructive hover:text-destructive/80 hover:bg-destructive/10 mt-5"
            aria-label={`Delete ${local.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Distribution Method */}
        <div>
          <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Distribution Method
          </Label>
          <div className="flex gap-1 mt-1">
            {(['hours', 'role', 'even'] as const).map(method => (
              <button
                key={method}
                type="button"
                onClick={() => updateField('share_method', method)}
                className={cn(
                  'flex-1 h-9 rounded-lg text-[13px] font-medium transition-colors',
                  local.share_method === method
                    ? 'bg-foreground text-background'
                    : 'bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-border/40'
                )}
              >
                {{ hours: 'Hours', role: 'Role', even: 'Even' }[method]}
              </button>
            ))}
          </div>
        </div>

        {/* Role Weights (conditional) */}
        {local.share_method === 'role' && uniqueRoles.length > 0 && (
          <div>
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Role Weights
            </Label>
            <div className="grid grid-cols-2 gap-3 mt-1">
              {uniqueRoles.map(role => (
                <div key={role} className="flex items-center gap-2">
                  <span className="text-[13px] text-foreground w-20 truncate">{role}</span>
                  <Input
                    type="number"
                    step={0.1}
                    min={0}
                    max={10}
                    value={local.role_weights[role] ?? 1}
                    onChange={e => handleRoleWeightChange(role, Number.parseFloat(e.target.value) || 0)}
                    className="h-8 w-20 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Eligible Employees (collapsible) */}
        <div>
          <button
            type="button"
            onClick={() => setEmployeesExpanded(!employeesExpanded)}
            aria-expanded={employeesExpanded}
            className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', employeesExpanded && 'rotate-90')} />
            Eligible Employees
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted normal-case tracking-normal">
              {local.eligible_employee_ids.length} of {eligibleEmployees.length}
            </span>
          </button>

          {employeesExpanded && (
            <div className="mt-2 space-y-2">
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAllEmployees}
                  className="h-7 text-[12px]"
                >
                  Select All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectNoEmployees}
                  className="h-7 text-[12px]"
                >
                  Select None
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto border border-border/40 rounded-xl p-3">
                {eligibleEmployees.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground col-span-2">
                    No eligible employees found.
                  </p>
                ) : (
                  eligibleEmployees.map(employee => (
                    <Label
                      key={employee.id}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selectedEmployeeSet.has(employee.id)}
                        onCheckedChange={(checked) => handleEmployeeToggle(employee.id, !!checked)}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-medium truncate block">{employee.name}</span>
                        <span className="text-[11px] text-muted-foreground">{employee.position}</span>
                      </div>
                    </Label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ContributionPoolEditor({
  pools,
  eligibleEmployees,
  onCreatePool,
  onUpdatePool,
  onDeletePool,
  totalContributionPercentage,
}: ContributionPoolEditorProps) {
  const [isCreating, setIsCreating] = useState(false);

  const handleAddPool = async () => {
    setIsCreating(true);
    try {
      await onCreatePool({
        name: `Pool ${pools.length + 1}`,
        contribution_percentage: 5,
        share_method: 'even',
        eligible_employee_ids: [],
        sort_order: pools.length,
      });
    } finally {
      setIsCreating(false);
    }
  };

  const totalExceedsWarning = totalContributionPercentage > 50;

  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
      {/* Section header */}
      <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">Contribution Pools</h3>
        <div className="flex items-center gap-2">
          {totalExceedsWarning && (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          )}
          <span
            className={cn(
              'text-[11px] px-1.5 py-0.5 rounded-md',
              totalExceedsWarning
                ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                : 'bg-muted text-muted-foreground'
            )}
          >
            Total: {totalContributionPercentage}%
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {totalExceedsWarning && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="text-[13px] text-amber-600">
              Total contribution exceeds 50%. Servers may find this share too high.
            </p>
          </div>
        )}

        {pools.length === 0 ? (
          <p className="text-[13px] text-muted-foreground py-2">
            No contribution pools yet. Add a pool to define how servers share a percentage of their tips.
          </p>
        ) : (
          <div className="space-y-3">
            {pools.map(pool => (
              <PoolCard
                key={pool.id}
                pool={pool}
                eligibleEmployees={eligibleEmployees}
                onUpdate={onUpdatePool}
                onDelete={onDeletePool}
              />
            ))}
          </div>
        )}

        {/* Add Pool button */}
        <Button
          variant="outline"
          onClick={handleAddPool}
          disabled={isCreating}
          className="w-full h-9 rounded-lg text-[13px] font-medium border-dashed border-border/40 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Pool
        </Button>
      </div>
    </div>
  );
}
