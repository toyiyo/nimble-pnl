import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useTimePunches, useDeleteTimePunch, useUpdateTimePunch, useCreateTimePunch } from '@/hooks/useTimePunches';
import { useEmployees } from '@/hooks/useEmployees';
import { supabase } from '@/integrations/supabase/client';
import { 
  Clock, Trash2, Edit, Download, Search, Camera, MapPin, Eye,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Table as TableIcon,
  LayoutGrid, BarChart3, List, Code, Shield, KeyRound, TabletSmartphone, Unlock, RefreshCcw, Copy, UserCog, Loader2
} from 'lucide-react';
import { 
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, 
  addDays, addWeeks, addMonths, isSameDay, differenceInMinutes,
  startOfDay, endOfDay
} from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TimePunch } from '@/types/timeTracking';
import { cn } from '@/lib/utils';
import { processPunchesForPeriod } from '@/utils/timePunchProcessing';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useKioskSession } from '@/hooks/useKioskSession';
import { useEmployeePins, useUpsertEmployeePin, EmployeePinWithEmployee } from '@/hooks/useKioskPins';
import { KIOSK_POLICY_KEY, generateNumericPin, loadFromStorage, saveToStorage, isSimpleSequence } from '@/utils/kiosk';
import { Switch } from '@/components/ui/switch';
import { Employee } from '@/types/scheduling';
import { useManagerPin, useUpsertManagerPin } from '@/hooks/useManagerPins';
import { useKioskServiceAccount } from '@/hooks/useKioskServiceAccount';
import {
  TimelineGanttView,
  EmployeeCardView,
  BarcodeStripeView,
  PunchStreamView,
  ReceiptStyleView,
} from '@/components/time-tracking';

const SIGNED_URL_BUFFER_MS = 5 * 60 * 1000; // Refresh URLs a few minutes before expiry

type ViewMode = 'day' | 'week' | 'month';
type VisualizationMode = 'gantt' | 'cards' | 'barcode' | 'stream' | 'receipt';

const TimePunchesManager = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { session: kioskSession, startSession, endSession } = useKioskSession();
  const { pins, loading: pinsLoading } = useEmployeePins(restaurantId);
  const upsertPin = useUpsertEmployeePin();
  const { pin: managerPin } = useManagerPin(restaurantId, user?.id);
  const upsertManagerPin = useUpsertManagerPin();

  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [visualizationMode, setVisualizationMode] = useState<VisualizationMode>('gantt');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [punchToDelete, setPunchToDelete] = useState<TimePunch | null>(null);
  const [viewingPunch, setViewingPunch] = useState<TimePunch | null>(null);
  const [editingPunch, setEditingPunch] = useState<TimePunch | null>(null);
  const [editFormData, setEditFormData] = useState({ punch_time: '', notes: '' });
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [photoThumbnails, setPhotoThumbnails] = useState<Record<string, string>>({});
  const [signedUrlCache, setSignedUrlCache] = useState<Record<string, { url: string; expiresAt: number }>>({});
  const [pinDialogEmployee, setPinDialogEmployee] = useState<Employee | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinForceReset, setPinForceReset] = useState(false);
  const [lastSavedPin, setLastSavedPin] = useState<string | null>(null);
  const [managerPinValue, setManagerPinValue] = useState('');
  const [managerPinSaved, setManagerPinSaved] = useState<string | null>(null);
  const { account: kioskAccount, loading: kioskAccountLoading, createOrRotate } = useKioskServiceAccount(restaurantId);
  const [generatedKioskCreds, setGeneratedKioskCreds] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (managerPin) {
      setManagerPinSaved('PIN on file');
    }
  }, [managerPin]);
  const [pinPolicy, setPinPolicy] = useState({
    minLength: 4,
    forceResetOnNext: false,
    allowSimpleSequences: false,
    requireManagerPin: true,
  });
  const kioskPolicyStorageKey = restaurantId ? `${KIOSK_POLICY_KEY}_${restaurantId}` : KIOSK_POLICY_KEY;
  const kioskActiveForLocation = kioskSession?.kiosk_mode && kioskSession.location_id === restaurantId;
  const isManager = ['owner', 'manager', 'chef'].includes(selectedRestaurant?.role || '');

  useEffect(() => {
    if (!restaurantId) return;
    const stored = loadFromStorage<typeof pinPolicy>(kioskPolicyStorageKey);
    if (stored) {
      setPinPolicy((prev) => ({ ...prev, ...stored }));
    }
  }, [restaurantId, kioskPolicyStorageKey]);

  const persistPolicy = (updates: Partial<typeof pinPolicy>) => {
    const nextPolicy = { ...pinPolicy, ...updates };
    setPinPolicy(nextPolicy);
    if (restaurantId) {
      saveToStorage(kioskPolicyStorageKey, nextPolicy);
    }
  };

  const pinLookup = useMemo(() => {
    const map = new Map<string, EmployeePinWithEmployee>();
    pins.forEach((pin) => map.set(pin.employee_id, pin));
    return map;
  }, [pins]);

  const generatePolicyPin = () => {
    let candidate = generateNumericPin(pinPolicy.minLength);
    let attempts = 0;
    while (!pinPolicy.allowSimpleSequences && isSimpleSequence(candidate) && attempts < 6) {
      candidate = generateNumericPin(pinPolicy.minLength);
      attempts++;
    }
    return candidate;
  };

  const openPinDialog = (employee: Employee) => {
    setPinDialogEmployee(employee);
    setPinForceReset(pinPolicy.forceResetOnNext);
    setPinValue(generatePolicyPin());
    setLastSavedPin(null);
  };

  const closePinDialog = () => {
    setPinDialogEmployee(null);
    setPinValue('');
    setLastSavedPin(null);
  };

  const handleSavePin = async () => {
    if (!restaurantId || !pinDialogEmployee) return;
    try {
      const result = await upsertPin.mutateAsync({
        restaurant_id: restaurantId,
        employee_id: pinDialogEmployee.id,
        pin: pinValue,
        min_length: pinPolicy.minLength,
        force_reset: pinForceReset,
        allowSimpleSequence: pinPolicy.allowSimpleSequences,
      });
      setLastSavedPin(result.pin);
      toast({
        title: 'PIN saved',
        description: `Share this PIN with ${pinDialogEmployee.name} securely.`,
      });
    } catch (error) {
      console.error('Error saving PIN', error);
    }
  };

  const handleAutoGeneratePins = async () => {
    if (!restaurantId) return;
    const missing = employees.filter((emp) => !pinLookup.get(emp.id));
    if (missing.length === 0) {
      toast({
        title: 'All employees covered',
        description: 'Every active employee already has a PIN.',
      });
      return;
    }

    let generated = 0;
    for (const emp of missing) {
      const candidate = generatePolicyPin();
      try {
        await upsertPin.mutateAsync({
          restaurant_id: restaurantId,
          employee_id: emp.id,
          pin: candidate,
          min_length: pinPolicy.minLength,
          force_reset: pinPolicy.forceResetOnNext,
          allowSimpleSequence: pinPolicy.allowSimpleSequences,
        });
        generated += 1;
      } catch (error) {
        console.error('Error generating PIN', error);
        break;
      }
    }

    if (generated > 0) {
      toast({
        title: 'PINs generated',
        description: `Created PINs for ${generated} employee${generated === 1 ? '' : 's'}.`,
      });
    }
  };

  const handleLaunchKiosk = async () => {
    if (!restaurantId) return;
    try {
      await startSession(restaurantId, user?.id || 'manager', {
        requireManagerPin: pinPolicy.requireManagerPin,
        minLength: pinPolicy.minLength,
      });
      toast({
        title: 'Kiosk ready',
        description: 'This device is locked to PIN-only timeclock.',
      });
      navigate('/kiosk');
    } catch (error: any) {
      toast({
        title: 'Could not launch kiosk',
        description: error?.message || 'Check your connection and try again.',
        variant: 'destructive',
      });
    }
  };

  const handleExitKiosk = () => {
    endSession();
    toast({
      title: 'Kiosk exited',
      description: 'Navigation is unlocked for this device.',
    });
  };

  const pinTooShort = pinDialogEmployee ? pinValue.length < pinPolicy.minLength : false;
  const pinLooksSimple = pinDialogEmployee
    ? isSimpleSequence(pinValue) && !pinPolicy.allowSimpleSequences
    : false;

  // Calculate date range based on view mode
  const dateRange = useMemo(() => {
    switch (viewMode) {
      case 'day':
        return { start: startOfDay(currentDate), end: endOfDay(currentDate) };
      case 'week':
        return { 
          start: startOfWeek(currentDate, { weekStartsOn: 0 }), 
          end: endOfWeek(currentDate, { weekStartsOn: 0 }) 
        };
      case 'month':
        return {
          start: startOfMonth(currentDate),
          end: endOfMonth(currentDate)
        };
    }
  }, [viewMode, currentDate]);

  const { employees } = useEmployees(restaurantId);
  const { punches, loading } = useTimePunches(
    restaurantId,
    selectedEmployee !== 'all' ? selectedEmployee : undefined,
    dateRange.start,
    dateRange.end
  );
  const deletePunch = useDeleteTimePunch();
  const updatePunch = useUpdateTimePunch();
  const createPunch = useCreateTimePunch();
  const [forceSessionToClose, setForceSessionToClose] = useState<any | null>(null);
  const [forceOutTime, setForceOutTime] = useState<string>(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  // Filter punches by search term (memoized for performance)
  const filteredPunches = useMemo(() => {
    return punches.filter((punch) => {
      if (!searchTerm) return true;
      const employee = punch.employee;
      return employee?.name.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [punches, searchTerm]);

  // Process punches using the robust calculation logic
  const processedData = useMemo(() => {
    return processPunchesForPeriod(filteredPunches);
  }, [filteredPunches]);

  // Incomplete sessions that are missing a clock_out
  const incompleteSessions = useMemo(() => processedData.sessions.filter(s => !s.is_complete), [processedData.sessions]);

  // Filter sessions for current day (for day view visualizations)
  const todaySessions = useMemo(() => {
    if (viewMode !== 'day') return processedData.sessions;
    
    return processedData.sessions.filter(session => 
      isSameDay(session.clock_in, currentDate)
    );
  }, [processedData.sessions, viewMode, currentDate]);

  // Load photo thumbnails for punches with photos
  useEffect(() => {
    const loadThumbnails = async () => {
      const now = Date.now();
      const punchesWithPhotos = punches.filter((punch) => {
        if (!punch.photo_path) return false;
        const cacheKey = `thumb:${punch.photo_path}`;
        const cached = signedUrlCache[cacheKey];
        return !photoThumbnails[punch.id] || !cached || cached.expiresAt <= now;
      });
      if (punchesWithPhotos.length === 0) return;

      for (const punch of punchesWithPhotos) {
        if (!punch.photo_path) continue;

        const cacheKey = `thumb:${punch.photo_path}`;
        const cached = signedUrlCache[cacheKey];
        const now = Date.now();

        if (cached && cached.expiresAt > now) {
          setPhotoThumbnails(prev => ({ ...prev, [punch.id]: cached.url }));
          continue;
        }

        try {
          const expiresInSeconds = 7200; // 2 hours
          const { data, error } = await supabase.storage
            .from('time-clock-photos')
            .createSignedUrl(punch.photo_path, expiresInSeconds, {
              transform: { width: 200, height: 200, resize: 'contain' },
            });

          if (error) {
            console.error('Error loading thumbnail:', error);
            continue;
          }

          if (data?.signedUrl) {
            const expiresAt = Date.now() + expiresInSeconds * 1000 - SIGNED_URL_BUFFER_MS;
            setSignedUrlCache(prev => ({ ...prev, [cacheKey]: { url: data.signedUrl, expiresAt } }));
            setPhotoThumbnails(prev => ({ ...prev, [punch.id]: data.signedUrl }));
          }
        } catch (error) {
          console.error('Error loading thumbnail:', error);
        }
      }
    };

    loadThumbnails();
  }, [punches]);

  // Fetch photo URL when viewing a punch with photo_path
  useEffect(() => {
    const fetchPhotoUrl = async () => {
      if (viewingPunch?.photo_path) {
        setPhotoError(null);
        setLoadingPhoto(true);
        const cacheKey = `detail:${viewingPunch.photo_path}`;
        const cached = signedUrlCache[cacheKey];
        const now = Date.now();

        if (cached && cached.expiresAt > now) {
          setPhotoUrl(cached.url);
          setLoadingPhoto(false);
          return;
        }

        try {
          const expiresInSeconds = 7200; // 2 hours
          const { data, error } = await supabase.storage
            .from('time-clock-photos')
            .createSignedUrl(viewingPunch.photo_path, expiresInSeconds, {
              transform: { width: 900, resize: 'contain' },
            });

          if (error || !data?.signedUrl) {
            console.error('Error fetching photo URL:', error);
            setPhotoError('Photo unavailable');
            setPhotoUrl(null);
          } else {
            const expiresAt = Date.now() + expiresInSeconds * 1000 - SIGNED_URL_BUFFER_MS;
            setSignedUrlCache(prev => ({ ...prev, [cacheKey]: { url: data.signedUrl, expiresAt } }));
            setPhotoUrl(data.signedUrl);
          }
        } catch (error) {
          console.error('Exception fetching photo:', error);
          setPhotoError('Photo unavailable');
          setPhotoUrl(null);
        } finally {
          setLoadingPhoto(false);
        }
      } else {
        setPhotoUrl(null);
        setPhotoError(null);
      }
    };

    fetchPhotoUrl();
  }, [viewingPunch, signedUrlCache]);

  const confirmDelete = () => {
    if (punchToDelete && restaurantId) {
      deletePunch.mutate({
        id: punchToDelete.id,
        restaurantId,
        employeeId: punchToDelete.employee_id,
      });
      setPunchToDelete(null);
    }
  };

  const openEditDialog = (punch: TimePunch) => {
    setEditingPunch(punch);
    setEditFormData({
      punch_time: format(new Date(punch.punch_time), "yyyy-MM-dd'T'HH:mm"),
      notes: punch.notes || '',
    });
  };

  const closeEditDialog = () => {
    setEditingPunch(null);
    setEditFormData({ punch_time: '', notes: '' });
  };

  const handleEditSubmit = () => {
    if (!editingPunch) return;

    updatePunch.mutate({
      id: editingPunch.id,
      punch_time: new Date(editFormData.punch_time).toISOString(),
      notes: editFormData.notes || undefined,
    });
    closeEditDialog();
  };

  const getPunchTypeColor = (type: string) => {
    switch (type) {
      case 'clock_in':
        return 'bg-green-500/10 text-green-700 border-green-500/20';
      case 'clock_out':
        return 'bg-red-500/10 text-red-700 border-red-500/20';
      case 'break_start':
        return 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20';
      case 'break_end':
        return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
      default:
        return '';
    }
  };

  const getPunchTypeLabel = (type: string) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const navigateDate = (direction: 'prev' | 'next' | 'today') => {
    if (direction === 'today') {
      setCurrentDate(new Date());
      return;
    }

    const increment = direction === 'next' ? 1 : -1;
    switch (viewMode) {
      case 'day':
        setCurrentDate(addDays(currentDate, increment));
        break;
      case 'week':
        setCurrentDate(addWeeks(currentDate, increment));
        break;
      case 'month':
        setCurrentDate(addMonths(currentDate, increment));
        break;
    }
  };

  const getDateRangeLabel = () => {
    switch (viewMode) {
      case 'day':
        return format(currentDate, 'MMMM d, yyyy');
      case 'week':
        return `${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d, yyyy')}`;
      case 'month':
        return format(currentDate, 'MMMM yyyy');
    }
  };

  const totalWeekHours = todaySessions.reduce((sum, session) => sum + session.worked_minutes / 60, 0);

  if (!restaurantId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please select a restaurant.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Clock className="h-6 w-6 text-primary transition-transform duration-300" />
            </div>
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Time Punches
              </CardTitle>
              <CardDescription>
                {getDateRangeLabel()} • {totalWeekHours.toFixed(1)} total hours
                {processedData.totalNoisePunches > 0 && (
                  <span className="text-yellow-600 ml-2">
                    • {processedData.totalNoisePunches} noise punch{processedData.totalNoisePunches !== 1 ? 'es' : ''} detected
                  </span>
                )}
                {processedData.totalAnomalies > 0 && (
                  <span className="text-yellow-600 ml-2">
                    • {processedData.totalAnomalies} anomal{processedData.totalAnomalies !== 1 ? 'ies' : 'y'}
                  </span>
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {isManager && (
        <Card className="border-primary/20">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <TabletSmartphone className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-xl">Kiosk Mode (PIN clock)</CardTitle>
                <CardDescription>Lock this device to PIN-only timeclock for {selectedRestaurant?.restaurant.name ?? 'this location'}.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="p-4 rounded-lg border bg-muted/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge variant={kioskActiveForLocation ? 'default' : 'outline'}>
                    {kioskActiveForLocation ? 'Active on this device' : 'Not active'}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>
                    Location locked:{' '}
                    <span className="font-medium text-foreground">{selectedRestaurant?.restaurant.name}</span>
                  </div>
                  {kioskSession?.started_at && (
                    <div>Started {format(new Date(kioskSession.started_at), 'MMM d, h:mm a')}</div>
                  )}
                  {kioskSession?.kiosk_instance_id && (
                    <div className="text-xs text-muted-foreground">Instance: {kioskSession.kiosk_instance_id.slice(0, 8)}</div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={handleLaunchKiosk}>
                    <Shield className="h-4 w-4 mr-2" />
                    Launch kiosk
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExitKiosk}
                    disabled={!kioskActiveForLocation}
                  >
                    <Unlock className="h-4 w-4 mr-2" />
                    Exit kiosk
                  </Button>
                </div>
              </div>

              <div className="p-4 rounded-lg border bg-card space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">PIN rules</div>
                    <p className="text-xs text-muted-foreground">Enforce clean 4–6 digit PINs for fewer corrections.</p>
                  </div>
                  <Badge variant="outline">{pinPolicy.minLength}-6 digits</Badge>
                </div>
                <div className="space-y-2">
                  <Label>Minimum digits</Label>
                  <Select
                    value={String(pinPolicy.minLength)}
                    onValueChange={(value) => persistPolicy({ minLength: Number(value) })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="4">4</SelectItem>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="6">6</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
                  <div>
                    <div className="font-medium text-sm">Require manager to exit</div>
                    <p className="text-xs text-muted-foreground">Prevents staff from leaving kiosk mode.</p>
                  </div>
                  <Switch
                    checked={pinPolicy.requireManagerPin}
                    onCheckedChange={(checked) => persistPolicy({ requireManagerPin: checked })}
                    aria-label="Require manager to exit kiosk"
                  />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
                  <div>
                    <div className="font-medium text-sm">Force update on next use</div>
                    <p className="text-xs text-muted-foreground">Mark new PINs as temporary until the employee sets their own.</p>
                  </div>
                  <Switch
                    checked={pinPolicy.forceResetOnNext}
                    onCheckedChange={(checked) => persistPolicy({ forceResetOnNext: checked })}
                    aria-label="Force employees to reset PIN"
                  />
                </div>
              </div>

              <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <KeyRound className="h-4 w-4 text-primary" />
                  <span>Daily P&amp;L stays clean when every punch maps to a PIN.</span>
                </div>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                  <li>Install as a PWA or use Guided Access/App Pinning on tablets.</li>
                  <li>Offline punches queue locally and sync when back online.</li>
                  <li>No navigation or shortcuts appear on the kiosk screen.</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="p-4 rounded-lg border bg-muted/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <UserCog className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">Dedicated kiosk login</div>
                      <p className="text-xs text-muted-foreground">
                        Generates a service account that only works on /kiosk for this location.
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline">{kioskAccount ? 'Ready' : 'Not created'}</Badge>
                </div>

                {kioskAccount && (
                  <div className="text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span className="font-mono text-xs">{kioskAccount.email}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Use this to sign in on the tablet. Rotate to issue a new password.
                    </p>
                  </div>
                )}

                {generatedKioskCreds && (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 space-y-2">
                    <div className="font-medium text-emerald-900 text-sm">New kiosk credentials</div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span>Email:</span>
                      <span>{generatedKioskCreds.email}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span>Password:</span>
                      <span>{generatedKioskCreds.password}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `Email: ${generatedKioskCreds.email}\nPassword: ${generatedKioskCreds.password}`
                          );
                        }}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy both
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="flex-1"
                        onClick={() => setGeneratedKioskCreds(null)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        const result = await createOrRotate.mutateAsync({ rotate: true });
                        setGeneratedKioskCreds(result);
                      } catch {
                        // Errors are handled via onError toast in the hook
                      }
                    }}
                    disabled={createOrRotate.isPending || kioskAccountLoading}
                  >
                    {createOrRotate.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCcw className="h-4 w-4 mr-2" />
                    )}
                    {kioskAccount ? 'Rotate credentials' : 'Create kiosk login'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setGeneratedKioskCreds(null)}
                    disabled={!generatedKioskCreds}
                  >
                    Clear shown password
                  </Button>
                </div>
              </div>

              <div className="p-4 rounded-lg border bg-muted/20 space-y-2">
                <div className="font-medium text-sm">How to deploy</div>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                  <li>Sign out the manager on the tablet, then sign in with the kiosk email and one-time password.</li>
                  <li>Use device pinning/Guided Access so the session stays on /kiosk.</li>
                  <li>Rotate credentials after staff turnover or if the tablet is lost.</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isManager && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <KeyRound className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>Employee PINs</CardTitle>
                  <CardDescription>Manage PIN assignments for quick kiosk clock-ins.</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">{pinLookup.size} with PIN</Badge>
                <Badge variant="outline" className="hidden md:inline-flex">
                  Min length {pinPolicy.minLength}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg border bg-muted/30 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <div>
                  <div className="font-medium text-sm">Manager PIN (kiosk lock/unlock)</div>
                  <p className="text-xs text-muted-foreground">
                    This PIN is only for entering or exiting kiosk mode on this device. It does not clock time.
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="Enter 4-6 digit PIN"
                  value={managerPinValue}
                  onChange={(e) => {
                    const digits = e.target.value.replaceAll(/\D/g, '').slice(0, 6);
                    setManagerPinValue(digits);
                    setManagerPinSaved(null);
                  }}
                  className="sm:max-w-xs"
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!restaurantId || !user?.id) return;
                    await upsertManagerPin.mutateAsync({
                      restaurant_id: restaurantId,
                      manager_user_id: user.id,
                      pin: managerPinValue,
                      min_length: pinPolicy.minLength,
                    });
                    setManagerPinSaved(managerPinValue);
                    setManagerPinValue('');
                  }}
                  disabled={managerPinValue.length < pinPolicy.minLength || upsertManagerPin.isPending}
                >
                  Save Manager PIN
                </Button>
                {managerPinSaved && (
                  <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20">
                    Saved
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                Avoid duplicate identities by keeping PINs unique per location.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => persistPolicy({ allowSimpleSequences: !pinPolicy.allowSimpleSequences })}
                >
                  {pinPolicy.allowSimpleSequences ? 'Disable sequence PINs' : 'Allow sequence PINs'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAutoGeneratePins}
                  disabled={pinsLoading || upsertPin.isPending}
                >
                  Auto-generate missing PINs
                </Button>
              </div>
            </div>

            {(() => {
              if (pinsLoading) {
                return (
                  <div className="space-y-2">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                );
              }
              if (employees.length === 0) {
                return <p className="text-muted-foreground text-sm">Add employees to start assigning PINs.</p>;
              }
              return (
                <div className="space-y-2">
                  {employees.map((emp) => {
                    const pinRecord = pinLookup.get(emp.id);
                    return (
                      <div
                        key={emp.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card"
                      >
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="font-medium">{emp.name}</div>
                            <div className="text-xs text-muted-foreground">{emp.position}</div>
                            {pinRecord?.last_used_at && (
                              <div className="text-[11px] text-muted-foreground">
                                Last used {format(new Date(pinRecord.last_used_at), 'MMM d, h:mm a')}
                              </div>
                            )}
                          </div>
                          {pinRecord ? (
                            <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20">
                              PIN set
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20">
                              Not set
                            </Badge>
                          )}
                          {pinRecord?.force_reset && (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/20">
                              Force update
                            </Badge>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openPinDialog(emp)}
                            disabled={upsertPin.isPending}
                          >
                            {pinRecord ? 'Reset PIN' : 'Set PIN'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!pinDialogEmployee} onOpenChange={(open) => !open && closePinDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set PIN for {pinDialogEmployee?.name}</DialogTitle>
            <p className="text-sm text-muted-foreground">
              4–6 digit PINs reduce identity ambiguity and speed up rush-hour clock-ins.
            </p>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="pin_value">PIN</Label>
              <Input
                id="pin_value"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pinValue}
                onChange={(e) => {
                  const digitsOnly = e.target.value.replaceAll(/\D/g, '').slice(0, 6);
                  setPinValue(digitsOnly);
                  setLastSavedPin(null);
                }}
                aria-label="Employee PIN"
              />
              <div className="text-xs text-muted-foreground">
                Must be at least {pinPolicy.minLength} digits. {pinLooksSimple ? 'Avoid simple sequences (1234).' : ''}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <div className="font-medium text-sm">Force update on first use</div>
                <p className="text-xs text-muted-foreground">Treat this as a temporary PIN.</p>
              </div>
              <Switch checked={pinForceReset} onCheckedChange={setPinForceReset} />
            </div>

            {lastSavedPin && (
              <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 text-sm">
                <div className="flex items-center gap-2 font-semibold text-primary">
                  <KeyRound className="h-4 w-4" />
                  New PIN: {lastSavedPin}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Share privately; the PIN is stored hashed.</p>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setPinValue(generatePolicyPin())}>
              Regenerate
            </Button>
            <Button variant="outline" onClick={closePinDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSavePin}
              disabled={pinTooShort || pinLooksSimple || upsertPin.isPending}
            >
              Save PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filters & Navigation */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by employee name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  aria-label="Search employees"
                />
              </div>
            </div>
            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger className="w-full md:w-64" aria-label="Filter by employee">
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>

          {/* Date navigation */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigateDate('prev')}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigateDate('today')}>
                Today
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigateDate('next')}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Select value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="week">Week</SelectItem>
                <SelectItem value="month">Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Visualization Tabs */}
      <Tabs value={visualizationMode} onValueChange={(v) => setVisualizationMode(v as VisualizationMode)}>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Visualizations</CardTitle>
              <TabsList>
                <TabsTrigger value="gantt" className="gap-2">
                  <BarChart3 className="h-4 w-4" />
                  <span className="hidden sm:inline">Gantt</span>
                </TabsTrigger>
                <TabsTrigger value="cards" className="gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  <span className="hidden sm:inline">Cards</span>
                </TabsTrigger>
                <TabsTrigger value="barcode" className="gap-2">
                  <List className="h-4 w-4" />
                  <span className="hidden sm:inline">Barcode</span>
                </TabsTrigger>
                <TabsTrigger value="stream" className="gap-2">
                  <Code className="h-4 w-4" />
                  <span className="hidden sm:inline">Stream</span>
                </TabsTrigger>
                <TabsTrigger value="receipt" className="gap-2">
                  <TableIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Receipt</span>
                </TabsTrigger>
              </TabsList>
            </div>
          </CardHeader>
        </Card>

        <TabsContent value="gantt" className="mt-6">
          <TimelineGanttView
            sessions={todaySessions}
            loading={loading}
            date={currentDate}
          />
        </TabsContent>

        <TabsContent value="cards" className="mt-6">
          <EmployeeCardView
            sessions={todaySessions}
            loading={loading}
            date={currentDate}
          />
        </TabsContent>

        <TabsContent value="barcode" className="mt-6">
          <BarcodeStripeView
            sessions={todaySessions}
            loading={loading}
            date={currentDate}
          />
        </TabsContent>

        <TabsContent value="stream" className="mt-6">
          <PunchStreamView
            processedPunches={processedData.processedPunches}
            loading={loading}
            employeeId={selectedEmployee !== 'all' ? selectedEmployee : undefined}
          />
        </TabsContent>

        <TabsContent value="receipt" className="mt-6">
          {selectedEmployee !== 'all' ? (
            <ReceiptStyleView
              sessions={todaySessions}
              loading={loading}
              employeeId={selectedEmployee}
              employeeName={employees.find(e => e.id === selectedEmployee)?.name}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  Please select a specific employee to view receipt-style timeline
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Collapsible Table View */}
      <Collapsible open={tableOpen} onOpenChange={setTableOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-accent/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TableIcon className="h-5 w-5" />
                  <CardTitle>Detailed Punch List ({filteredPunches.length})</CardTitle>
                </div>
                {tableOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : filteredPunches.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No time punches found</p>
              ) : (
                <div className="space-y-2">
                  {filteredPunches.map((punch) => (
                    <div
                      key={punch.id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        {/* Photo thumbnail */}
                        {punch.photo_path && photoThumbnails[punch.id] && (
                      <div 
                        className="w-12 h-12 rounded-lg overflow-hidden border-2 border-primary/20 cursor-pointer hover:border-primary transition-colors"
                        onClick={() => setViewingPunch(punch)}
                      >
                            <img 
                              src={photoThumbnails[punch.id]} 
                              alt="Employee photo" 
                              className="w-24 h-24 object-cover rounded-md border border-border"
                              loading="lazy"
                              decoding="async"
                            />
                      </div>
                    )}

                        <Badge variant="outline" className={getPunchTypeColor(punch.punch_type)}>
                          {getPunchTypeLabel(punch.punch_type)}
                        </Badge>
                        <div className="flex-1">
                          <div className="font-medium">{punch.employee?.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {punch.employee?.position}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">
                            {format(new Date(punch.punch_time), 'MMM d, yyyy')}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {format(new Date(punch.punch_time), 'h:mm:ss a')}
                          </div>
                        </div>
                        {/* Verification indicators */}
                        <div className="flex items-center gap-2">
                          {punch.photo_path && (
                            <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20">
                              <Camera className="h-3 w-3 mr-1" />
                              Photo
                            </Badge>
                          )}
                          {punch.location && (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/20">
                              <MapPin className="h-3 w-3 mr-1" />
                              GPS
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        {(punch.photo_path || punch.location) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setViewingPunch(punch)}
                            aria-label="View verification details"
                            title="View photo and location"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEditDialog(punch)}
                          aria-label="Edit punch"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setPunchToDelete(punch)}
                          aria-label="Delete punch"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Open / Incomplete Sessions (Managers only) */}
      {selectedRestaurant?.role && ['owner', 'manager'].includes(selectedRestaurant.role) && incompleteSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open / Incomplete Sessions</CardTitle>
            <CardDescription>{incompleteSessions.length} session{incompleteSessions.length !== 1 ? 's' : ''} need attention</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {incompleteSessions.map((session) => (
                <div key={session.sessionId} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div>
                    <div className="font-medium">{session.employee_name}</div>
                    <div className="text-sm text-muted-foreground">Clocked in: {format(new Date(session.clock_in), 'MMM d, yyyy h:mm a')}</div>
                    <div className="text-sm text-muted-foreground">Open for {Math.max(0, Math.round(differenceInMinutes(new Date(), new Date(session.clock_in)) / 60))}h {Math.max(0, differenceInMinutes(new Date(), new Date(session.clock_in)) % 60)}m</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setForceSessionToClose(session)}
                    >
                      Force Clock Out Now
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Force Clock Out Confirmation */}
      <AlertDialog open={!!forceSessionToClose} onOpenChange={() => setForceSessionToClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force Clock Out</AlertDialogTitle>
                  <AlertDialogDescription>
              Specify the date & time to record as the clock-out for <strong>{forceSessionToClose?.employee_name}</strong>. Default is the current time. This will close the open session and will be visible in payroll immediately.
            </AlertDialogDescription>
            <div className="py-3">
              <Label htmlFor="force_out_time">Clock-out time</Label>
              <Input
                id="force_out_time"
                type="datetime-local"
                value={forceOutTime}
                onChange={(e) => setForceOutTime(e.target.value)}
                aria-label="Force clock out time"
                className="mt-2"
              />

              {forceSessionToClose?.clock_in && forceOutTime && (
                <div className="text-sm mt-2 text-muted-foreground">
                  {new Date(forceOutTime).getTime() < new Date(forceSessionToClose.clock_in).getTime() ? (
                    <span className="text-destructive">Selected time is before the session's clock-in — please pick a time after {format(new Date(forceSessionToClose.clock_in), 'MMM d, yyyy h:mm a')}.</span>
                  ) : null}
                </div>
              )}
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!forceSessionToClose || !restaurantId || !forceOutTime) return;
                // Prevent creating a clock_out earlier than the session's clock_in
                const chosen = new Date(forceOutTime).toISOString();
                if (forceSessionToClose.clock_in && new Date(forceOutTime).getTime() < new Date(forceSessionToClose.clock_in).getTime()) return;

                createPunch.mutate({
                  restaurant_id: restaurantId,
                  employee_id: forceSessionToClose.employee_id,
                  punch_type: 'clock_out',
                  punch_time: chosen,
                  notes: 'Force clock out by manager',
                });
                setForceSessionToClose(null);
                // reset default time
                setForceOutTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
              }}
              disabled={!!(forceSessionToClose?.clock_in && forceOutTime && new Date(forceOutTime).getTime() < new Date(forceSessionToClose.clock_in).getTime())}
            >
              Force Clock Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Verification Details Dialog */}
      <Dialog open={!!viewingPunch} onOpenChange={() => setViewingPunch(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Verification Details</DialogTitle>
          </DialogHeader>
          {viewingPunch && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Employee:</span>
                  <div className="font-medium">{viewingPunch.employee?.name}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Action:</span>
                  <div className="font-medium">{getPunchTypeLabel(viewingPunch.punch_type)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Date:</span>
                  <div className="font-medium">{format(new Date(viewingPunch.punch_time), 'MMM d, yyyy')}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Time:</span>
                  <div className="font-medium">{format(new Date(viewingPunch.punch_time), 'h:mm:ss a')}</div>
                </div>
              </div>

              {viewingPunch.photo_path && (
                <div>
                  <div className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Verification Photo
                  </div>
                  <div className="rounded-lg border bg-muted/50 max-h-[70vh] overflow-auto flex items-center justify-center">
                    {loadingPhoto ? (
                      <div className="w-full h-72 flex items-center justify-center text-muted-foreground">
                        <p>Loading photo...</p>
                      </div>
                    ) : photoUrl ? (
                      <img 
                        src={photoUrl} 
                        alt="Employee verification photo" 
                        className="w-40 h-auto max-h-[70vh] object-contain"
                        loading="lazy"
                        decoding="async"
                        onError={() => {
                          setPhotoError('Photo unavailable');
                          setPhotoUrl(null);
                        }}
                      />
                    ) : (
                      <div className="w-full h-72 flex items-center justify-center text-muted-foreground">
                        <p>{photoError || 'Photo unavailable'}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {viewingPunch.location && (
                <div>
                  <div className="text-sm font-medium mb-2 flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Location
                  </div>
                  <div className="p-4 rounded-lg border bg-muted/50 space-y-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Latitude:</span>{' '}
                      <span className="font-mono">{viewingPunch.location.latitude.toFixed(6)}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Longitude:</span>{' '}
                      <span className="font-mono">{viewingPunch.location.longitude.toFixed(6)}</span>
                    </div>
                    <a
                      href={`https://www.google.com/maps?q=${viewingPunch.location.latitude},${viewingPunch.location.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-sm inline-flex items-center gap-1"
                    >
                      <MapPin className="h-3 w-3" />
                      View on Google Maps
                    </a>
                  </div>
                </div>
              )}

              {viewingPunch.device_info && (
                <div>
                  <div className="text-sm font-medium mb-2">Device Information</div>
                  <div className="p-3 rounded-lg border bg-muted/50 text-xs font-mono break-all">
                    {viewingPunch.device_info}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Punch Dialog */}
      <Dialog open={!!editingPunch} onOpenChange={closeEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Time Punch</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="punch_time">Punch Time</Label>
              <Input
                id="punch_time"
                type="datetime-local"
                value={editFormData.punch_time}
                onChange={(e) => setEditFormData({ ...editFormData, punch_time: e.target.value })}
                aria-label="Punch time"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add notes about this punch..."
                value={editFormData.notes}
                onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                aria-label="Notes"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEditDialog}>
              Cancel
            </Button>
            <Button onClick={handleEditSubmit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!punchToDelete} onOpenChange={() => setPunchToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Time Punch</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this time punch? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TimePunchesManager;
