import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useShiftOffers } from '@/hooks/useShiftOffers';
import { useOpenShifts } from '@/hooks/useOpenShifts';
import { useCreateShiftClaim } from '@/hooks/useShiftClaims';
import { format } from 'date-fns';
import { 
  Calendar, 
  Clock, 
  User, 
  MapPin, 
  DollarSign,
  MessageSquare,
  ArrowRightLeft,
  AlertCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface ShiftMarketplaceProps {
  restaurantId: string;
  currentEmployeeId: string;
}

export const ShiftMarketplace = ({ restaurantId, currentEmployeeId }: ShiftMarketplaceProps) => {
  const { shiftOffers, loading: offersLoading } = useShiftOffers(restaurantId, 'open');
  const { openShifts, loading: openShiftsLoading } = useOpenShifts(restaurantId);
  const createShiftClaim = useCreateShiftClaim();

  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [selectedOpenShiftId, setSelectedOpenShiftId] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState('');
  const [claiming, setClaiming] = useState(false);

  const handleClaimOffer = (offerId: string) => {
    setSelectedOfferId(offerId);
    setSelectedOpenShiftId(null);
    setClaimDialogOpen(true);
  };

  const handleClaimOpenShift = (shiftId: string) => {
    setSelectedOpenShiftId(shiftId);
    setSelectedOfferId(null);
    setClaimDialogOpen(true);
  };

  const handleSubmitClaim = async () => {
    setClaiming(true);
    try {
      await createShiftClaim.mutateAsync({
        restaurant_id: restaurantId,
        shift_offer_id: selectedOfferId,
        open_shift_id: selectedOpenShiftId,
        claiming_employee_id: currentEmployeeId,
        message: claimMessage || undefined,
      });
      
      setClaimDialogOpen(false);
      setClaimMessage('');
      setSelectedOfferId(null);
      setSelectedOpenShiftId(null);
    } catch (error) {
      console.error('Error claiming shift:', error);
    } finally {
      setClaiming(false);
    }
  };

  if (offersLoading || openShiftsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const filteredOffers = shiftOffers.filter(
    offer => offer.offering_employee_id !== currentEmployeeId
  );

  return (
    <>
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <ArrowRightLeft className="h-6 w-6 text-primary" />
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Shift Marketplace
              </CardTitle>
              <CardDescription>
                Available shifts you can claim
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="offers" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="offers">
                Shift Trades ({filteredOffers.length})
              </TabsTrigger>
              <TabsTrigger value="open">
                Open Shifts ({openShifts.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="offers" className="space-y-4 mt-4">
              {filteredOffers.length === 0 ? (
                <div className="text-center py-12">
                  <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Shift Trades Available</h3>
                  <p className="text-muted-foreground">
                    Check back later for shifts that others want to trade.
                  </p>
                </div>
              ) : (
                filteredOffers.map((offer) => (
                  <Card key={offer.id} className="border-primary/20">
                    <CardContent className="pt-6">
                      <div className="flex justify-between items-start">
                        <div className="space-y-3 flex-1">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-primary" />
                            <span className="font-semibold">
                              {offer.shift && format(new Date(offer.shift.start_time), 'EEEE, MMMM d, yyyy')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span>
                              {offer.shift && format(new Date(offer.shift.start_time), 'h:mm a')} - {offer.shift && format(new Date(offer.shift.end_time), 'h:mm a')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span>Position: {offer.shift?.position}</span>
                          </div>
                          {offer.offering_employee && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <User className="h-4 w-4" />
                              <span>Offered by: {offer.offering_employee.name}</span>
                            </div>
                          )}
                          {offer.reason && (
                            <div className="flex items-start gap-2 text-sm">
                              <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
                              <span className="text-muted-foreground">{offer.reason}</span>
                            </div>
                          )}
                          {offer.is_partial && (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                              Partial Trade Available
                            </Badge>
                          )}
                        </div>
                        <Button
                          onClick={() => handleClaimOffer(offer.id)}
                          className="bg-gradient-to-r from-primary to-accent"
                        >
                          Claim Shift
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="open" className="space-y-4 mt-4">
              {openShifts.length === 0 ? (
                <div className="text-center py-12">
                  <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Open Shifts</h3>
                  <p className="text-muted-foreground">
                    There are no unassigned shifts available at the moment.
                  </p>
                </div>
              ) : (
                openShifts.map((shift) => (
                  <Card key={shift.id} className="border-primary/20">
                    <CardContent className="pt-6">
                      <div className="flex justify-between items-start">
                        <div className="space-y-3 flex-1">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-primary" />
                            <span className="font-semibold">
                              {format(new Date(shift.start_time), 'EEEE, MMMM d, yyyy')}
                            </span>
                            <Badge className="bg-gradient-to-r from-green-500 to-emerald-600 ml-2">
                              Open
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span>
                              {format(new Date(shift.start_time), 'h:mm a')} - {format(new Date(shift.end_time), 'h:mm a')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span>Position: {shift.position}</span>
                          </div>
                          {shift.notes && (
                            <div className="flex items-start gap-2 text-sm">
                              <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
                              <span className="text-muted-foreground">{shift.notes}</span>
                            </div>
                          )}
                        </div>
                        <Button
                          onClick={() => handleClaimOpenShift(shift.id)}
                          className="bg-gradient-to-r from-green-500 to-emerald-600"
                        >
                          Claim Shift
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Claim Confirmation Dialog */}
      <Dialog open={claimDialogOpen} onOpenChange={setClaimDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Claim This Shift</DialogTitle>
            <DialogDescription>
              Your request will be sent to a manager for approval.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="message">Message to Manager (Optional)</Label>
              <Textarea
                id="message"
                placeholder="Add a message for the manager..."
                value={claimMessage}
                onChange={(e) => setClaimMessage(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setClaimDialogOpen(false)}
                disabled={claiming}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmitClaim}
                disabled={claiming}
                className="bg-gradient-to-r from-primary to-accent"
              >
                {claiming ? 'Submitting...' : 'Submit Claim Request'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
