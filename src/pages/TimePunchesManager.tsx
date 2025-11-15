import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useTimePunches, useDeleteTimePunch } from '@/hooks/useTimePunches';
import { useEmployees } from '@/hooks/useEmployees';
import { supabase } from '@/integrations/supabase/client';
import { Clock, Trash2, Edit, Download, Search, Camera, MapPin, Eye } from 'lucide-react';
import { format, startOfWeek, endOfWeek } from 'date-fns';
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
import { TimePunch } from '@/types/timeTracking';

const TimePunchesManager = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [currentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 0 });
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [punchToDelete, setPunchToDelete] = useState<TimePunch | null>(null);
  const [viewingPunch, setViewingPunch] = useState<TimePunch | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);

  const { employees } = useEmployees(restaurantId);
  const { punches, loading } = useTimePunches(
    restaurantId,
    selectedEmployee !== 'all' ? selectedEmployee : undefined,
    currentWeekStart,
    weekEnd
  );
  const deletePunch = useDeleteTimePunch();

  // Fetch photo URL when viewing a punch with photo_path
  useEffect(() => {
    const fetchPhotoUrl = async () => {
      if (viewingPunch?.photo_path) {
        setLoadingPhoto(true);
        try {
          const { data, error } = await supabase.storage
            .from('time-clock-photos')
            .createSignedUrl(viewingPunch.photo_path, 3600); // 1 hour expiry

          if (error) {
            console.error('Error fetching photo URL:', error);
            setPhotoUrl(null);
          } else {
            setPhotoUrl(data.signedUrl);
          }
        } catch (error) {
          console.error('Exception fetching photo:', error);
          setPhotoUrl(null);
        } finally {
          setLoadingPhoto(false);
        }
      } else {
        setPhotoUrl(null);
      }
    };

    fetchPhotoUrl();
  }, [viewingPunch]);

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

  const filteredPunches = punches.filter((punch) => {
    if (!searchTerm) return true;
    const employee = punch.employee;
    return employee?.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

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
                Manage employee time tracking for {format(currentWeekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
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
        </CardContent>
      </Card>

      {/* Punches Table */}
      <Card>
        <CardHeader>
          <CardTitle>Time Punches ({filteredPunches.length})</CardTitle>
        </CardHeader>
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
                      onClick={() => {
                        // TODO: Open edit dialog
                      }}
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
      </Card>

      {/* Verification Details Dialog */}
      <Dialog open={!!viewingPunch} onOpenChange={() => setViewingPunch(null)}>
        <DialogContent className="sm:max-w-2xl">
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
                  <div className="rounded-lg overflow-hidden border">
                    {loadingPhoto ? (
                      <div className="w-full h-64 flex items-center justify-center bg-muted">
                        <p className="text-muted-foreground">Loading photo...</p>
                      </div>
                    ) : photoUrl ? (
                      <img 
                        src={photoUrl} 
                        alt="Employee verification photo" 
                        className="w-full h-auto"
                      />
                    ) : (
                      <div className="w-full h-64 flex items-center justify-center bg-muted">
                        <p className="text-muted-foreground">Photo unavailable</p>
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
