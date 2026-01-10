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
  Trash2, Edit, Download, Search, Camera, MapPin, Eye,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Table as TableIcon,
  LayoutGrid, BarChart3, List, Code, KeyRound, PenLine, Settings2
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
import { Switch } from '@/components/ui/switch';
import { TimePunch } from '@/types/timeTracking';
import { cn } from '@/lib/utils';
import { processPunchesForPeriod } from '@/utils/timePunchProcessing';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useKioskSession } from '@/hooks/useKioskSession';
import { useEmployeePins, useUpsertEmployeePin, EmployeePinWithEmployee } from '@/hooks/useKioskPins';
import { KIOSK_POLICY_KEY, generateNumericPin, loadFromStorage, saveToStorage, isSimpleSequence } from '@/utils/kiosk';
import { Employee } from '@/types/scheduling';
import { useKioskServiceAccount } from '@/hooks/useKioskServiceAccount';
import {
  TimelineGanttView,
  EmployeeCardView,
  BarcodeStripeView,
  PunchStreamView,
  ReceiptStyleView,
  ManualTimelineEditor,
  MobileTimeEntry,
} from '@/components/time-tracking';
import { StatusSummary, KioskModeCard, EmployeePinsCard } from '@/components/time-clock';

const SIGNED_URL_BUFFER_MS = 5 * 60 * 1000;

type ViewMode = 'day' | 'week' | 'month';
type VisualizationMode = 'gantt' | 'cards' | 'barcode' | 'stream' | 'receipt' | 'manual';

const TimePunchesManager = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { session: kioskSession, startSession, endSession } = useKioskSession();
  const { pins, loading: pinsLoading } = useEmployeePins(restaurantId);
  const upsertPin = useUpsertEmployeePin();

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
  const [configOpen, setConfigOpen] = useState(false);
  const [photoThumbnails, setPhotoThumbnails] = useState<Record<string, string>>({});
  const [signedUrlCache, setSignedUrlCache] = useState<Record<string, { url: string; expiresAt: number }>>({});
  const [pinDialogEmployee, setPinDialogEmployee] = useState<Employee | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinForceReset, setPinForceReset] = useState(false);
  const [lastSavedPin, setLastSavedPin] = useState<string | null>(null);
  const { account: kioskAccount, loading: kioskAccountLoading, createOrRotate } = useKioskServiceAccount(restaurantId);
  const [generatedKioskCreds, setGeneratedKioskCreds] = useState<{ email: string; password: string } | null>(null);

  const [pinPolicy, setPinPolicy] = useState({
    minLength: 4,
    forceResetOnNext: false,
    allowSimpleSequences: false,
  });
  const kioskPolicyStorageKey = restaurantId ? `${KIOSK_POLICY_KEY}_${restaurantId}` : KIOSK_POLICY_KEY;
  const kioskActiveForLocation = kioskSession?.kiosk_mode && kioskSession.location_id === restaurantId;
  const isManager = ['owner', 'manager'].includes(selectedRestaurant?.role || '');

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
        minLength: pinPolicy.minLength,
      });
      toast({
        title: 'Kiosk ready',
        description: 'This device is locked to PIN-only timeclock.',
      });
      navigate('/kiosk');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Check your connection and try again.';
      toast({
        title: 'Could not launch kiosk',
        description: message,
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

  // Filter punches by search term
  const filteredPunches = useMemo(() => {
    return punches.filter((punch) => {
      if (!searchTerm) return true;
      const employee = punch.employee;
      return employee?.name.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [punches, searchTerm]);

  // Process punches
  const processedData = useMemo(() => {
    return processPunchesForPeriod(filteredPunches);
  }, [filteredPunches]);

  // Incomplete sessions
  const incompleteSessions = useMemo(() => processedData.sessions.filter(s => !s.is_complete), [processedData.sessions]);

  // Filter sessions for current day
  const todaySessions = useMemo(() => {
    if (viewMode !== 'day') return processedData.sessions;
    return processedData.sessions.filter(session => 
      isSameDay(session.clock_in, currentDate)
    );
  }, [processedData.sessions, viewMode, currentDate]);

  // Load photo thumbnails
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
          const expiresInSeconds = 7200;
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

  // Fetch photo URL when viewing
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
          const expiresInSeconds = 7200;
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
        return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
      case 'clock_out':
        return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20';
      case 'break_start':
        return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
      case 'break_end':
        return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20';
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
        return format(currentDate, 'EEEE, MMMM d');
      case 'week':
        return `${format(dateRange.start, 'MMM d')} – ${format(dateRange.end, 'MMM d, yyyy')}`;
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
      {/* Section 1: Status Summary - Glanceable */}
      <StatusSummary
        kioskActive={kioskActiveForLocation}
        totalHours={totalWeekHours}
        employeesWithPins={pinLookup.size}
        totalEmployees={employees.length}
        date={getDateRangeLabel()}
        anomalies={processedData.totalAnomalies}
        incompleteSessions={incompleteSessions.length}
      />

      {/* Section 2: Primary Workspace - Daily manager work */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Filters Row */}
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
              <SelectTrigger className="w-full md:w-56" aria-label="Filter by employee">
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
            <Button variant="outline" size="icon" className="hidden md:flex" aria-label="Export data">
              <Download className="h-4 w-4" />
            </Button>
          </div>

          {/* Date Navigation */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => navigateDate('prev')} aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigateDate('today')}>
                Today
              </Button>
              <Button variant="outline" size="icon" onClick={() => navigateDate('next')} aria-label="Next">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Select value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
              <SelectTrigger className="w-28">
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

      {/* Visualization Tabs - Default to Timeline/Gantt */}
      <Tabs value={visualizationMode} onValueChange={(v) => setVisualizationMode(v as VisualizationMode)}>
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="gantt" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Timeline</span>
            </TabsTrigger>
            <TabsTrigger value="cards" className="gap-2">
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden sm:inline">Cards</span>
            </TabsTrigger>
            <TabsTrigger value="barcode" className="gap-2">
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">Stripes</span>
            </TabsTrigger>
            <TabsTrigger value="stream" className="gap-2">
              <Code className="h-4 w-4" />
              <span className="hidden sm:inline">Stream</span>
            </TabsTrigger>
            <TabsTrigger value="receipt" className="gap-2">
              <TableIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Receipt</span>
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <PenLine className="h-4 w-4" />
              <span className="hidden sm:inline">Manual</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="gantt" className="mt-0">
          <TimelineGanttView
            sessions={todaySessions}
            loading={loading}
            date={currentDate}
          />
        </TabsContent>

        <TabsContent value="cards" className="mt-0">
          <EmployeeCardView
            sessions={todaySessions}
            loading={loading}
            date={currentDate}
          />
        </TabsContent>

        <TabsContent value="barcode" className="mt-0">
          <BarcodeStripeView
            sessions={todaySessions}
            loading={loading}
            date={currentDate}
          />
        </TabsContent>

        <TabsContent value="stream" className="mt-0">
          <PunchStreamView
            processedPunches={processedData.processedPunches}
            loading={loading}
            employeeId={selectedEmployee !== 'all' ? selectedEmployee : undefined}
          />
        </TabsContent>

        <TabsContent value="receipt" className="mt-0">
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
                  Select a specific employee to view receipt-style timeline
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="manual" className="mt-0">
          {viewMode === 'day' ? (
            <>
              <div className="hidden md:block">
                <ManualTimelineEditor
                  employees={employees}
                  date={currentDate}
                  existingPunches={filteredPunches}
                  loading={loading}
                  restaurantId={restaurantId || ''}
                />
              </div>
              <div className="block md:hidden">
                <MobileTimeEntry
                  employees={employees}
                  date={currentDate}
                  restaurantId={restaurantId || ''}
                />
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  Manual time entry is only available in day view.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Collapsible Punch List */}
      <Collapsible open={tableOpen} onOpenChange={setTableOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TableIcon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Punch List ({filteredPunches.length})</CardTitle>
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
                      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        {punch.photo_path && photoThumbnails[punch.id] && (
                          <div 
                            className="w-10 h-10 rounded-lg overflow-hidden border cursor-pointer hover:ring-2 ring-primary transition-all flex-shrink-0"
                            onClick={() => setViewingPunch(punch)}
                          >
                            <img 
                              src={photoThumbnails[punch.id]} 
                              alt="Photo" 
                              className="w-full h-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          </div>
                        )}

                        <Badge variant="outline" className={cn("flex-shrink-0", getPunchTypeColor(punch.punch_type))}>
                          {getPunchTypeLabel(punch.punch_type)}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{punch.employee?.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{punch.employee?.position}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-medium">{format(new Date(punch.punch_time), 'MMM d')}</div>
                          <div className="text-xs text-muted-foreground">{format(new Date(punch.punch_time), 'h:mm a')}</div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {punch.photo_path && (
                            <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
                              <Camera className="h-3 w-3" />
                            </Badge>
                          )}
                          {punch.location && (
                            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">
                              <MapPin className="h-3 w-3" />
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 ml-4 flex-shrink-0">
                        {(punch.photo_path || punch.location) && (
                          <Button size="icon" variant="ghost" onClick={() => setViewingPunch(punch)} aria-label="View details">
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => openEditDialog(punch)} aria-label="Edit punch">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setPunchToDelete(punch)} aria-label="Delete punch">
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

      {/* Open Sessions Alert (Managers only) */}
      {isManager && incompleteSessions.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Open Sessions
            </CardTitle>
            <CardDescription>{incompleteSessions.length} session{incompleteSessions.length !== 1 ? 's' : ''} need attention</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {incompleteSessions.map((session) => (
                <div key={session.sessionId} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div>
                    <div className="font-medium">{session.employee_name}</div>
                    <div className="text-xs text-muted-foreground">
                      In: {format(new Date(session.clock_in), 'h:mm a')} • 
                      Open for {Math.max(0, Math.floor(differenceInMinutes(new Date(), new Date(session.clock_in)) / 60))}h {Math.max(0, differenceInMinutes(new Date(), new Date(session.clock_in)) % 60)}m
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setForceSessionToClose(session)}>
                    Force Out
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section 3: Configuration - Collapsed by default */}
      {isManager && (
        <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2 w-full">
            <Settings2 className="h-4 w-4" />
            <span>Time Clock Settings</span>
            <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${configOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <KioskModeCard
                kioskActive={kioskActiveForLocation}
                locationName={selectedRestaurant?.restaurant.name ?? 'this location'}
                session={kioskSession}
                kioskAccount={kioskAccount}
                kioskAccountLoading={kioskAccountLoading}
                generatedCreds={generatedKioskCreds}
                onLaunchKiosk={handleLaunchKiosk}
                onExitKiosk={handleExitKiosk}
                onCreateOrRotate={async () => {
                  try {
                    const result = await createOrRotate.mutateAsync({ rotate: true });
                    setGeneratedKioskCreds(result);
                  } catch {
                    // Errors handled in hook
                  }
                }}
                onClearCreds={() => setGeneratedKioskCreds(null)}
                isCreating={createOrRotate.isPending}
                pinPolicy={pinPolicy}
                onPolicyChange={persistPolicy}
              />

              <EmployeePinsCard
                employees={employees}
                pinLookup={pinLookup}
                pinsLoading={pinsLoading}
                isPinSaving={upsertPin.isPending}
                onSetPin={openPinDialog}
                onAutoGenerate={handleAutoGeneratePins}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* PIN Dialog */}
      <Dialog open={!!pinDialogEmployee} onOpenChange={(open) => !open && closePinDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set PIN for {pinDialogEmployee?.name}</DialogTitle>
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
                  const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setPinValue(digitsOnly);
                  setLastSavedPin(null);
                }}
                aria-label="Employee PIN"
                className="text-center text-2xl tracking-widest font-mono"
              />
              {(pinTooShort || pinLooksSimple) && (
                <p className="text-xs text-amber-600">
                  {pinTooShort ? `Must be at least ${pinPolicy.minLength} digits.` : 'Avoid simple sequences.'}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <div className="text-sm font-medium">Force update on first use</div>
                <p className="text-xs text-muted-foreground">Treat this as a temporary PIN.</p>
              </div>
              <Switch checked={pinForceReset} onCheckedChange={setPinForceReset} />
            </div>

            {lastSavedPin && (
              <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
                <div className="flex items-center gap-2 font-semibold text-primary">
                  <KeyRound className="h-4 w-4" />
                  Saved: {lastSavedPin}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Share privately. PIN is stored hashed.</p>
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
            <Button onClick={handleSavePin} disabled={pinTooShort || pinLooksSimple || upsertPin.isPending}>
              Save PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Clock Out Dialog */}
      <AlertDialog open={!!forceSessionToClose} onOpenChange={() => setForceSessionToClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force Clock Out</AlertDialogTitle>
            <AlertDialogDescription>
              Set the clock-out time for <strong>{forceSessionToClose?.employee_name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-3">
            <Label htmlFor="force_out_time">Clock-out time</Label>
            <Input
              id="force_out_time"
              type="datetime-local"
              value={forceOutTime}
              onChange={(e) => setForceOutTime(e.target.value)}
              className="mt-2"
            />
            {forceSessionToClose?.clock_in && forceOutTime && 
              new Date(forceOutTime).getTime() < new Date(forceSessionToClose.clock_in).getTime() && (
              <p className="text-xs text-destructive mt-2">
                Time must be after {format(new Date(forceSessionToClose.clock_in), 'h:mm a')}.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!forceSessionToClose || !restaurantId || !forceOutTime) return;
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
                    Photo
                  </div>
                  <div className="rounded-lg border bg-muted/50 max-h-[50vh] overflow-auto flex items-center justify-center p-4">
                    {loadingPhoto ? (
                      <p className="text-muted-foreground">Loading photo...</p>
                    ) : photoUrl ? (
                      <img 
                        src={photoUrl} 
                        alt="Verification" 
                        className="max-w-full max-h-[45vh] object-contain rounded"
                        onError={() => {
                          setPhotoError('Photo unavailable');
                          setPhotoUrl(null);
                        }}
                      />
                    ) : (
                      <p className="text-muted-foreground">{photoError || 'Photo unavailable'}</p>
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
                    <div className="text-sm font-mono">
                      {viewingPunch.location.latitude.toFixed(6)}, {viewingPunch.location.longitude.toFixed(6)}
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
                  <div className="text-sm font-medium mb-2">Device</div>
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add notes about this punch..."
                value={editFormData.notes}
                onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEditDialog}>Cancel</Button>
            <Button onClick={handleEditSubmit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!punchToDelete} onOpenChange={() => setPunchToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Time Punch</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Are you sure?
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
