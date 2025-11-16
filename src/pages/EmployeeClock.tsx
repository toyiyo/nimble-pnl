import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee, useEmployeePunchStatus, useCreateTimePunch, useTimePunches } from '@/hooks/useTimePunches';
import { Clock, LogIn, LogOut, Coffee, PlayCircle, AlertCircle, Camera, MapPin, Shield, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

const EmployeeClock = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showCameraDialog, setShowCameraDialog] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [pendingPunchType, setPendingPunchType] = useState<'clock_in' | 'clock_out' | 'break_start' | 'break_end' | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();

  const { employee, loading: employeeLoading } = useCurrentEmployee(restaurantId);
  const { status, loading: statusLoading } = useEmployeePunchStatus(employee?.id || null);
  const createPunch = useCreateTimePunch();
  const { punches } = useTimePunches(restaurantId, employee?.id || undefined, new Date(new Date().setHours(0, 0, 0, 0)));

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Cleanup camera stream when dialog closes or component unmounts
  useEffect(() => {
    if (cameraStream && !showCameraDialog) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }

    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        setCameraStream(null);
      }
    };
  }, [cameraStream, showCameraDialog]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 }
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Camera access error:', error);
      toast({
        title: 'Camera Not Available',
        description: 'Unable to access camera. You can still clock in without a photo.',
        variant: 'default',
      });
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0);
        const photoData = canvas.toDataURL('image/jpeg', 0.8);
        setCapturedPhoto(photoData);
      }
    }
  };

  const retakePhoto = () => {
    setCapturedPhoto(null);
  };

  const handleInitiatePunch = async (punchType: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
    setPendingPunchType(punchType);
    setShowCameraDialog(true);
    setCapturedPhoto(null);
    // Start camera automatically
    setTimeout(startCamera, 100);
  };

  const handleConfirmPunch = async () => {
    if (!restaurantId || !employee || !pendingPunchType) return;

    // Close dialog immediately for better UX
    setShowCameraDialog(false);
    const photoToProcess = capturedPhoto;
    const punchType = pendingPunchType;
    
    setPendingPunchType(null);
    setCapturedPhoto(null);
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }

    // Get device info
    const deviceInfo = `${navigator.userAgent.substring(0, 100)}`;

    // Start location fetch in background with very short timeout
    let locationPromise: Promise<{ latitude: number; longitude: number } | undefined> = Promise.resolve(undefined);
    if (navigator.geolocation) {
      locationPromise = new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          console.log('Location timeout - proceeding without location');
          resolve(undefined);
        }, 3000); // Only wait 3 seconds max

        navigator.geolocation.getCurrentPosition(
          (position) => {
            clearTimeout(timeoutId);
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          (error) => {
            clearTimeout(timeoutId);
            console.log('Location not available:', error);
            resolve(undefined);
          },
          {
            timeout: 3000, // 3 second timeout
            enableHighAccuracy: false,
            maximumAge: 60000, // Accept cached position up to 1 minute old
          }
        );
      });
    }

    // Convert photo in background
    let photoBlobPromise: Promise<Blob | undefined> = Promise.resolve(undefined);
    if (photoToProcess) {
      photoBlobPromise = fetch(photoToProcess)
        .then(response => response.blob())
        .catch(error => {
          console.error('Error converting photo to blob:', error);
          return undefined;
        });
    }

    // Wait for both with a maximum total time of 3 seconds
    Promise.race([
      Promise.all([locationPromise, photoBlobPromise]),
      new Promise<[undefined, undefined]>(resolve => setTimeout(() => resolve([undefined, undefined]), 3000))
    ]).then(([location, photoBlob]) => {
      createPunch.mutate({
        restaurant_id: restaurantId,
        employee_id: employee.id,
        punch_type: punchType,
        punch_time: new Date().toISOString(),
        location,
        device_info: deviceInfo,
        photoBlob,
      });
    });
  };

  const handleSkipVerification = () => {
    // Allow punch without photo
    handleConfirmPunch();
  };

  if (!restaurantId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please select a restaurant.</p>
      </div>
    );
  }

  if (employeeLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!employee) {
    return (
      <Card className="bg-gradient-to-br from-destructive/5 via-destructive/5 to-transparent border-destructive/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <div>
              <CardTitle className="text-2xl">Access Required</CardTitle>
              <CardDescription>Your account is not linked to an employee record.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Please contact your manager to link your account to your employee profile.
          </p>
          {import.meta.env.DEV && (
            <div className="p-4 bg-muted rounded-lg text-sm space-y-2">
              <p className="font-semibold">Debug Info (dev mode only):</p>
              <p>Restaurant ID: {restaurantId}</p>
              <p>Looking for employee with user_id matching your auth account</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const isClockedIn = status?.is_clocked_in || false;
  const onBreak = status?.on_break || false;

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
                Time Clock
              </CardTitle>
              <CardDescription>Welcome, {employee.name}</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Current Time Display */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <div className="text-6xl font-bold tabular-nums">
              {format(currentTime, 'h:mm:ss a')}
            </div>
            <div className="text-xl text-muted-foreground">
              {format(currentTime, 'EEEE, MMMM d, yyyy')}
            </div>
            
            {/* Status Badge */}
            <div className="flex justify-center gap-2 mt-4">
              {statusLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : isClockedIn ? (
                onBreak ? (
                  <Badge variant="outline" className="text-lg px-4 py-2 bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                    <Coffee className="w-4 h-4 mr-2" />
                    On Break
                  </Badge>
                ) : (
                  <Badge variant="default" className="text-lg px-4 py-2 bg-green-500/10 text-green-700 border-green-500/20">
                    <PlayCircle className="w-4 h-4 mr-2" />
                    Clocked In
                  </Badge>
                )
              ) : (
                <Badge variant="outline" className="text-lg px-4 py-2">
                  Clocked Out
                </Badge>
              )}
            </div>

            {/* Last Punch Info */}
            {status?.last_punch_time && (
              <p className="text-sm text-muted-foreground">
                Last action: {format(new Date(status.last_punch_time), 'h:mm a')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Verify your identity for accurate time tracking</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!isClockedIn ? (
              <Button
                size="lg"
                className="h-24 text-xl"
                onClick={() => handleInitiatePunch('clock_in')}
                disabled={createPunch.isPending}
              >
                <LogIn className="mr-2 h-6 w-6" />
                Clock In
              </Button>
            ) : onBreak ? (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-24 text-xl"
                  onClick={() => handleInitiatePunch('break_end')}
                  disabled={createPunch.isPending}
                >
                  <PlayCircle className="mr-2 h-6 w-6" />
                  End Break
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="h-24 text-xl"
                  onClick={() => handleInitiatePunch('clock_out')}
                  disabled={createPunch.isPending}
                >
                  <LogOut className="mr-2 h-6 w-6" />
                  Clock Out
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-24 text-xl"
                  onClick={() => handleInitiatePunch('break_start')}
                  disabled={createPunch.isPending}
                >
                  <Coffee className="mr-2 h-6 w-6" />
                  Start Break
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="h-24 text-xl"
                  onClick={() => handleInitiatePunch('clock_out')}
                  disabled={createPunch.isPending}
                >
                  <LogOut className="mr-2 h-6 w-6" />
                  Clock Out
                </Button>
              </>
            )}
          </div>

          {/* Info about verification */}
          <Alert className="mt-4 bg-primary/5 border-primary/20">
            <Shield className="h-4 w-4 text-primary" />
            <AlertDescription className="text-sm">
              <strong>Why we verify:</strong> Your photo and location help ensure accurate time tracking and protect against time theft. 
              This keeps your hours fair and secure for payroll.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Today's Punches */}
      <Card>
        <CardHeader>
          <CardTitle>Today's Activity</CardTitle>
          <CardDescription>Your time punches for today</CardDescription>
        </CardHeader>
        <CardContent>
          {punches.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No punches recorded today</p>
          ) : (
            <div className="space-y-2">
              {punches.map((punch) => (
                <div
                  key={punch.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3">
                    {punch.punch_type === 'clock_in' && <LogIn className="h-4 w-4 text-green-600" />}
                    {punch.punch_type === 'clock_out' && <LogOut className="h-4 w-4 text-red-600" />}
                    {punch.punch_type === 'break_start' && <Coffee className="h-4 w-4 text-yellow-600" />}
                    {punch.punch_type === 'break_end' && <PlayCircle className="h-4 w-4 text-blue-600" />}
                    <div>
                      <div className="font-medium">
                        {punch.punch_type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {format(new Date(punch.punch_time), 'h:mm:ss a')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {punch.photo_path && <Camera className="h-4 w-4 text-green-600" title="Photo verified" />}
                    {punch.location && <MapPin className="h-4 w-4 text-blue-600" title="Location verified" />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Camera Verification Dialog */}
      <Dialog open={showCameraDialog} onOpenChange={(open) => {
        if (!open) {
          // Cleanup when closing
          if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            setCameraStream(null);
          }
          setShowCameraDialog(false);
          setPendingPunchType(null);
          setCapturedPhoto(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Verify Your Identity
            </DialogTitle>
            <DialogDescription>
              Take a quick selfie to confirm it's really you clocking in. This helps prevent time theft and ensures accurate payroll.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Camera Preview or Captured Photo */}
            <div className="relative aspect-[4/3] bg-muted rounded-lg overflow-hidden">
              {!capturedPhoto ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {!cameraStream && (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted">
                      <div className="text-center space-y-2">
                        <Camera className="h-12 w-12 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Starting camera...</p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <img src={capturedPhoto} alt="Captured selfie" className="w-full h-full object-cover" />
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Benefits of verification */}
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span><strong>Protects your earnings:</strong> Ensures only you can clock in with your account</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span><strong>Accurate hours:</strong> Helps resolve any disputes about work time</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span><strong>Fair for everyone:</strong> Prevents buddy punching and time theft</span>
              </div>
            </div>

            {/* Action Buttons */}
            <DialogFooter className="flex-col sm:flex-row gap-2">
              {!capturedPhoto ? (
                <>
                  <Button
                    variant="outline"
                    onClick={handleSkipVerification}
                    className="w-full sm:w-auto"
                  >
                    Skip Photo
                  </Button>
                  <Button
                    onClick={capturePhoto}
                    disabled={!cameraStream}
                    className="w-full sm:w-auto"
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    Take Photo
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={retakePhoto}
                    className="w-full sm:w-auto"
                  >
                    Retake
                  </Button>
                  <Button
                    onClick={handleConfirmPunch}
                    disabled={createPunch.isPending}
                    className="w-full sm:w-auto"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    {pendingPunchType === 'clock_out' ? 'Confirm & Clock Out' : 
                     pendingPunchType === 'break_start' ? 'Confirm & Start Break' :
                     pendingPunchType === 'break_end' ? 'Confirm & End Break' : 'Confirm & Clock In'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmployeeClock;
