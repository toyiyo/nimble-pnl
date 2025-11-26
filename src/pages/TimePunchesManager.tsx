import { useState, useEffect, useMemo } from 'react';
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
  LayoutGrid, BarChart3, List, Code
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
