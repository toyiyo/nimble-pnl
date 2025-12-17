import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useEmployees } from '@/hooks/useEmployees';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { formatCurrencyFromCents, calculateTipSplitByHours, calculateTipSplitByRole, filterTipEligible, calculateTipSplitEven } from '@/utils/tipPooling';
import { useToast } from '@/hooks/use-toast';

type TipSource = 'manual' | 'pos';
type ShareMethod = 'hours' | 'role' | 'manual';
type SplitCadence = 'daily' | 'weekly' | 'shift';

const defaultWeights: Record<string, number> = {};

type TipHistoryEntry = {
  id: string;
  employeeName: string;
  amountCents: number;
  recordedAt: string;
};

export const Tips = () => {
  const { user, loading } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const { employees, loading: employeesLoading } = useEmployees(restaurantId, { status: 'active' });
  const { toast } = useToast();

  const [tipSource, setTipSource] = useState<TipSource>('manual');
  const [shareMethod, setShareMethod] = useState<ShareMethod>('hours');
  const [splitCadence, setSplitCadence] = useState<SplitCadence>('daily');
  const [tipAmount, setTipAmount] = useState('0');
  const [hoursByEmployee, setHoursByEmployee] = useState<Record<string, string>>({});
  const [roleWeights, setRoleWeights] = useState<Record<string, number>>(defaultWeights);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());

  const eligibleEmployees = useMemo(() => filterTipEligible(employees), [employees]);
  const [history, setHistory] = useState<TipHistoryEntry[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (eligibleEmployees.length) {
      setSelectedEmployees(new Set(eligibleEmployees.map(e => e.id)));
      const initialHours: Record<string, string> = {};
      eligibleEmployees.forEach(e => {
        initialHours[e.id] = '0';
      });
      setHoursByEmployee(initialHours);
    }
  }, [eligibleEmployees]);

  useEffect(() => {
    const loadHistory = async () => {
      if (!restaurantId) return;
      const { data, error } = await supabase
        .from('employee_tips')
        .select('id, tip_amount, recorded_at, employees(name)')
        .eq('restaurant_id', restaurantId)
        .order('recorded_at', { ascending: false })
        .limit(20);
      if (error) {
        console.error('Error loading tip history', error);
        return;
      }
      const mapped: TipHistoryEntry[] = (data || []).map(row => ({
        id: row.id,
        employeeName: (row as any).employees?.name || 'Employee',
        amountCents: row.tip_amount,
        recordedAt: row.recorded_at,
      }));
      setHistory(mapped);
    };
    loadHistory();
  }, [restaurantId]);

  const participants = useMemo(() => {
    return eligibleEmployees.filter(e => selectedEmployees.has(e.id));
  }, [eligibleEmployees, selectedEmployees]);

  const totalTipsCents = useMemo(() => {
    const parsed = Number.parseFloat(tipAmount || '0');
    return Math.max(0, Math.round(parsed * 100));
  }, [tipAmount]);

  const hoursAllocations = useMemo(() => {
    return participants.map(e => ({
      id: e.id,
      name: e.name,
      hours: Number.parseFloat(hoursByEmployee[e.id] || '0') || 0,
      role: e.position,
    }));
  }, [participants, hoursByEmployee]);

  const roleAllocations = useMemo(() => {
    return participants.map(e => ({
      id: e.id,
      name: e.name,
      role: e.position,
      weight: roleWeights[e.position] ?? 1,
    }));
  }, [participants, roleWeights]);

  const previewShares = useMemo(() => {
    if (shareMethod === 'hours') {
      return calculateTipSplitByHours(totalTipsCents, hoursAllocations);
    }
    if (shareMethod === 'role') {
      return calculateTipSplitByRole(totalTipsCents, roleAllocations);
    }
    return calculateTipSplitEven(totalTipsCents, participants.map(p => ({ id: p.id, name: p.name })));
  }, [shareMethod, totalTipsCents, hoursAllocations, roleAllocations, participants]);

  const totalAllocated = previewShares.reduce((sum, s) => sum + s.amountCents, 0);
  const remaining = totalTipsCents - totalAllocated;

  const handleApprove = async () => {
    if (!restaurantId || participants.length === 0 || totalTipsCents <= 0) {
      toast({ title: 'Missing info', description: 'Enter tips and select participants.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const rows = previewShares.map(share => ({
        restaurant_id: restaurantId,
        employee_id: share.employeeId,
        tip_amount: share.amountCents,
        tip_source: tipSource === 'manual' ? 'cash' : 'credit',
        recorded_at: new Date().toISOString(),
        shift_id: null,
        notes: null,
        created_by: user.id,
      }));

      const { error } = await supabase.from('employee_tips').insert(rows);
      if (error) throw error;

      const { data: historyData, error: historyError } = await supabase
        .from('employee_tips')
        .select('id, tip_amount, recorded_at, employees(name)')
        .eq('restaurant_id', restaurantId)
        .order('recorded_at', { ascending: false })
        .limit(20);
      if (!historyError && historyData) {
        const mapped: TipHistoryEntry[] = historyData.map(row => ({
          id: row.id,
          employeeName: (row as any).employees?.name || 'Employee',
          amountCents: row.tip_amount,
          recordedAt: row.recorded_at,
        }));
        setHistory(mapped);
      }

      toast({
        title: 'Tips approved',
        description: 'Tip split saved for today.',
      });
    } catch (error: any) {
      console.error('Error approving tips', error);
      toast({
        title: 'Unable to save',
        description: error?.message || 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading || employeesLoading) {
    return null;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">Dashboard → Tips</p>
        <h1 className="text-2xl font-bold">Tips</h1>
        <p className="text-muted-foreground max-w-2xl">
          Simple, trust-building tip splits. One choice at a time, with a live preview.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>1. How were tips collected?</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={tipSource} onValueChange={val => setTipSource(val as TipSource)} className="space-y-3">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="manual" id="source-manual" />
              <Label htmlFor="source-manual">We enter tips ourselves</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="pos" id="source-pos" />
              <Label htmlFor="source-pos">Tips come from the POS</Label>
            </div>
            <p className="text-sm text-muted-foreground">You can change this later.</p>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Who shares tips?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Active, tip-eligible employees only. Salaried roles are hidden.</p>
          <div className="grid md:grid-cols-2 gap-3">
            {eligibleEmployees.map(emp => (
              <label key={emp.id} className="flex items-center space-x-3 rounded-md border p-3 cursor-pointer">
                <Checkbox
                  checked={selectedEmployees.has(emp.id)}
                  onCheckedChange={checked => {
                    setSelectedEmployees(prev => {
                      const next = new Set(prev);
                      if (checked) next.add(emp.id);
                      else next.delete(emp.id);
                      return next;
                    });
                  }}
                />
                <div>
                  <div className="font-medium">{emp.name}</div>
                  <div className="text-sm text-muted-foreground">{emp.position}</div>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. How should tips be shared?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup value={shareMethod} onValueChange={val => setShareMethod(val as ShareMethod)} className="space-y-3">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="hours" id="share-hours" />
              <Label htmlFor="share-hours">By hours worked</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="role" id="share-role" />
              <Label htmlFor="share-role">By role</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="manual" id="share-manual" />
              <Label htmlFor="share-manual">I’ll decide manually</Label>
            </div>
          </RadioGroup>

          {shareMethod === 'role' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Adjust weights by role.</p>
              {Array.from(new Set(participants.map(p => p.position))).map(role => (
                <div key={role} className="flex items-center space-x-3">
                  <Label className="w-32">{role}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={roleWeights[role] ?? 1}
                    onChange={e => {
                      const val = Number.parseFloat(e.target.value || '1');
                      setRoleWeights(prev => ({ ...prev, [role]: Math.max(0, val) }));
                    }}
                  />
                  <span className="text-sm text-muted-foreground">weight</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. When should tips be split?</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={splitCadence} onValueChange={val => setSplitCadence(val as SplitCadence)} className="space-y-3">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="daily" id="cadence-daily" />
              <Label htmlFor="cadence-daily">Every day</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="weekly" id="cadence-weekly" />
              <Label htmlFor="cadence-weekly">Every week</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="shift" id="cadence-shift" />
              <Label htmlFor="cadence-shift">Per shift</Label>
            </div>
            <p className="text-sm text-muted-foreground">Daily keeps things simplest.</p>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>5. Enter tips & hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tipAmount">Enter today's tips</Label>
            <Input
              id="tipAmount"
              type="number"
              step="0.01"
              min="0"
              value={tipAmount}
              onChange={e => setTipAmount(e.target.value)}
              aria-label="Tip amount"
            />
          </div>
          {shareMethod === 'hours' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Hours for this split</p>
              <div className="grid md:grid-cols-2 gap-3">
                {participants.map(emp => (
                  <div key={emp.id} className="space-y-1">
                    <Label htmlFor={`hours-${emp.id}`}>{emp.name}</Label>
                    <Input
                      id={`hours-${emp.id}`}
                      type="number"
                      step="0.1"
                      min="0"
                      value={hoursByEmployee[emp.id] ?? '0'}
                      onChange={e =>
                        setHoursByEmployee(prev => ({
                          ...prev,
                          [emp.id]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Total tips: {formatCurrencyFromCents(totalTipsCents)}</p>
              <p className="text-sm text-muted-foreground">
                People sharing: {participants.length} • Method: {shareMethod === 'hours' ? 'By hours worked' : shareMethod === 'role' ? 'By role' : 'Manual'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total remaining</p>
              <p className="font-semibold">{formatCurrencyFromCents(remaining)}</p>
            </div>
          </div>
          <Separator />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">Name</th>
                  <th className="py-2">Hours</th>
                  <th className="py-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {previewShares.map(share => (
                  <tr key={share.employeeId} className="border-t">
                    <td className="py-2">{share.name}</td>
                    <td className="py-2">{hoursAllocations.find(h => h.id === share.employeeId)?.hours ?? '—'}</td>
                    <td className="py-2 font-medium">{formatCurrencyFromCents(share.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleApprove} disabled={participants.length === 0 || totalTipsCents <= 0}>
              {saving ? 'Saving...' : 'Approve tips'}
            </Button>
            <Button variant="outline">Save as draft</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent splits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 && (
            <p className="text-sm text-muted-foreground">No tip records yet.</p>
          )}
          {history.map(entry => (
            <div key={entry.id} className="flex items-center justify-between border rounded-md p-3">
              <div>
                <p className="font-medium">{entry.employeeName}</p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(entry.recordedAt), 'PPpp')}
                </p>
              </div>
              <p className="font-semibold">{formatCurrencyFromCents(entry.amountCents)}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default Tips;
