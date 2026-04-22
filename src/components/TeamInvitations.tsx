import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Mail, Plus, Clock, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react';
import { formatExpiresIn } from '@/lib/invitationUtils';

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  createdAt: string;
  expiresAt?: string;
  invitedBy?: string;
}

interface TeamInvitationsProps {
  restaurantId: string;
  userRole: string;
}

export const TeamInvitations = ({ restaurantId, userRole }: TeamInvitationsProps) => {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'staff',
  });
  const [sending, setSending] = useState(false);
  const [resendingIds, setResendingIds] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [pendingConflict, setPendingConflict] = useState(false);
  const { toast } = useToast();

  const canManageInvites = userRole === 'owner' || userRole === 'manager';

  useEffect(() => {
    setShowHistory(false);
    fetchInvitations();
  }, [restaurantId]);

  const fetchInvitations = async () => {
    try {
      const { data: invitations, error } = await supabase
        .from('invitations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get profile information for invited_by users
      const invitedByIds = [...new Set(invitations.map(inv => inv.invited_by))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', invitedByIds);

      const profilesMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      const formattedInvitations: Invitation[] = invitations.map(inv => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.status as 'pending' | 'accepted' | 'expired' | 'cancelled',
        createdAt: inv.created_at,
        expiresAt: inv.expires_at,
        invitedBy: profilesMap.get(inv.invited_by)?.full_name || 'Unknown'
      }));

      setInvitations(formattedInvitations);
    } catch (error: any) {
      console.error('Error fetching invitations:', error);
      toast({
        title: "Error",
        description: "Failed to load invitations",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteInvitation = async (invitationId: string, email: string) => {
    try {
      const { error } = await supabase
        .from('invitations')
        .delete()
        .eq('id', invitationId)
        .eq('restaurant_id', restaurantId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Invitation to ${email} has been cancelled`,
      });

      fetchInvitations();
    } catch (error: any) {
      console.error('Error deleting invitation:', error);
      toast({
        title: "Error",
        description: "Failed to cancel invitation",
        variant: "destructive",
      });
    }
  };

  const sendInvitation = async () => {
    if (!inviteForm.email || !inviteForm.role) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    const hasConflict = invitations.some(
      inv => inv.email.toLowerCase() === inviteForm.email.toLowerCase() && inv.status === 'pending'
    );
    if (hasConflict && !pendingConflict) {
      setPendingConflict(true);
      return;
    }
    setPendingConflict(false);

    setSending(true);
    try {
      // Call edge function to send invitation email
      const { data, error } = await supabase.functions.invoke('send-team-invitation', {
        body: {
          restaurantId,
          email: inviteForm.email,
          role: inviteForm.role,
        },
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Invitation sent to ${inviteForm.email}`,
      });

      setInviteForm({ email: '', role: 'staff' });
      setIsDialogOpen(false);
      fetchInvitations();
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to send invitation",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const resendInvitation = async (invitation: Invitation) => {
    setResendingIds(prev => new Set(prev).add(invitation.id));
    try {
      const { error } = await supabase.functions.invoke('send-team-invitation', {
        body: { restaurantId, email: invitation.email, role: invitation.role },
      });
      if (error) throw error;
      toast({ title: 'Invitation resent', description: `New invite sent to ${invitation.email}` });
      fetchInvitations();
    } catch (err) {
      console.error('Error resending invitation:', err);
      toast({ title: 'Error', description: 'Failed to resend invitation', variant: 'destructive' });
    } finally {
      setResendingIds(prev => { const s = new Set(prev); s.delete(invitation.id); return s; });
    }
  };

  const statusIcons = {
    pending: <Clock className="h-4 w-4 text-yellow-500" />,
    accepted: <CheckCircle className="h-4 w-4 text-green-500" />,
    expired: <XCircle className="h-4 w-4 text-destructive" />,
    cancelled: null,
  };

  const statusColors = {
    pending: "secondary",
    accepted: "default",
    expired: "destructive",
    cancelled: "outline",
  } as const;

  const activeInvitations = invitations.filter(
    inv => inv.status === 'pending' || inv.status === 'expired'
  );
  const historyInvitations = invitations.filter(
    inv => inv.status === 'accepted' || inv.status === 'cancelled'
  );
  const visibleInvitations = showHistory ? invitations : activeInvitations;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-lg md:text-xl">Team Invitations</CardTitle>
            <CardDescription className="text-sm">
              Send invitations to new team members
            </CardDescription>
          </div>
          
          {canManageInvites && (
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) {
                setPendingConflict(false);
                setInviteForm({ email: '', role: 'staff' });
              }
            }}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2 w-full sm:w-auto" size="sm">
                  <Plus className="h-4 w-4" />
                  <span className="sm:inline">Send Invitation</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md p-0 gap-0 border-border/40">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
                      <Mail className="h-5 w-5 text-foreground" />
                    </div>
                    <div>
                      <DialogTitle className="text-[17px] font-semibold text-foreground">Invite Team Member</DialogTitle>
                      <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                        Send an invitation to join your restaurant team
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className="px-6 py-5 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Enter email address"
                      value={inviteForm.email}
                      className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                      onChange={(e) => {
                        setPendingConflict(false);
                        setInviteForm({ ...inviteForm, email: e.target.value });
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="role" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Role</Label>
                    <Select
                      value={inviteForm.role}
                      onValueChange={(value) => setInviteForm({ ...inviteForm, role: value })}
                    >
                      <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="staff">Staff</SelectItem>
                        <SelectItem value="chef">Chef</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        {userRole === 'owner' && (
                          <SelectItem value="owner">Owner</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {pendingConflict && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[13px]">
                      <Clock className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <p className="text-foreground">
                        A pending invite for <strong>{inviteForm.email}</strong> already exists. Sending a new one will cancel the old link.
                      </p>
                    </div>
                  )}
                </div>

                <DialogFooter className="px-6 py-4 border-t border-border/40">
                  <Button variant="outline" className="h-9 px-4 rounded-lg text-[13px] font-medium" onClick={() => { setIsDialogOpen(false); setPendingConflict(false); }}>
                    Cancel
                  </Button>
                  <Button onClick={sendInvitation} disabled={sending} className="h-9 px-4 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90">
                    {sending ? 'Sending...' : pendingConflict ? 'Yes, resend anyway' : 'Send Invitation'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      
      <CardContent>
        {loading ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading invitations...</p>
          </div>
        ) : invitations.length > 0 ? (
          <div className="space-y-3 md:space-y-4">
            {visibleInvitations.map((invitation) => (
              <div key={invitation.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 md:p-4 border border-border/40 rounded-xl hover:border-border transition-colors">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <Mail className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm md:text-base truncate">{invitation.email}</p>
                    <div className="text-xs md:text-sm text-muted-foreground space-y-1">
                      <p className="truncate">
                        Invited as <span className="capitalize font-medium">{invitation.role}</span> by {invitation.invitedBy}
                      </p>
                      <p>
                        {invitation.expiresAt && (invitation.status === 'pending' || invitation.status === 'expired')
                          ? formatExpiresIn(invitation.expiresAt)
                          : new Date(invitation.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3">
                  <Badge variant={statusColors[invitation.status]} className="flex items-center gap-1 text-xs">
                    {statusIcons[invitation.status]}
                    <span className="capitalize">{invitation.status}</span>
                  </Badge>

                  {canManageInvites && invitation.status === 'pending' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteInvitation(invitation.id, invitation.email)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 p-2"
                      aria-label={`Cancel invitation for ${invitation.email}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  {canManageInvites && invitation.status === 'expired' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resendInvitation(invitation)}
                      disabled={resendingIds.has(invitation.id)}
                      className="text-primary hover:text-primary hover:bg-primary/10 p-2"
                      aria-label={`Resend invitation to ${invitation.email}`}
                    >
                      <RefreshCw className={`h-4 w-4 ${resendingIds.has(invitation.id) ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {visibleInvitations.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                All invitations are in history.
              </p>
            )}
            {historyInvitations.length > 0 && (
              <button
                type="button"
                aria-expanded={showHistory}
                onClick={() => setShowHistory(prev => !prev)}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
              >
                {showHistory
                  ? 'Hide history'
                  : `Show history (${historyInvitations.length})`}
              </button>
            )}
          </div>
        ) : (
          <div className="text-center py-6 md:py-8">
            <Mail className="h-10 w-10 md:h-12 md:w-12 text-muted-foreground mx-auto mb-3 md:mb-4" />
            <p className="text-sm md:text-base text-muted-foreground mb-3 md:mb-4">No invitations sent yet</p>
            {canManageInvites && (
              <Button onClick={() => setIsDialogOpen(true)} className="flex items-center gap-2 mx-auto" size="sm">
                <Plus className="h-4 w-4" />
                Send Your First Invitation
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};