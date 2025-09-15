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
import { Mail, Plus, Clock, CheckCircle, XCircle, Trash2 } from 'lucide-react';

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired';
  created_at: string;
  expires_at: string;
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
  const { toast } = useToast();

  const canManageInvites = userRole === 'owner' || userRole === 'manager';

  useEffect(() => {
    fetchInvitations();
  }, [restaurantId]);

  const fetchInvitations = async () => {
    try {
      // This would typically fetch from a team_invitations table
      // For now, we'll simulate with empty data
      setInvitations([]);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load invitations",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
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

  const statusIcons = {
    pending: <Clock className="h-4 w-4 text-yellow-500" />,
    accepted: <CheckCircle className="h-4 w-4 text-green-500" />,
    expired: <XCircle className="h-4 w-4 text-red-500" />,
  };

  const statusColors = {
    pending: "secondary",
    accepted: "default",
    expired: "destructive",
  } as const;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Team Invitations</CardTitle>
            <CardDescription>
              Send invitations to new team members
            </CardDescription>
          </div>
          
          {canManageInvites && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Send Invitation
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite Team Member</DialogTitle>
                  <DialogDescription>
                    Send an invitation to join your restaurant team
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Enter email address"
                      value={inviteForm.email}
                      onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="role">Role</Label>
                    <Select
                      value={inviteForm.role}
                      onValueChange={(value) => setInviteForm({ ...inviteForm, role: value })}
                    >
                      <SelectTrigger>
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
                </div>
                
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={sendInvitation} disabled={sending}>
                    {sending ? 'Sending...' : 'Send Invitation'}
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
          <div className="space-y-4">
            {invitations.map((invitation) => (
              <div key={invitation.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{invitation.email}</p>
                    <p className="text-sm text-muted-foreground">
                      Invited as {invitation.role} • {new Date(invitation.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Badge variant={statusColors[invitation.status]} className="flex items-center gap-1">
                    {statusIcons[invitation.status]}
                    {invitation.status}
                  </Badge>
                  
                  {canManageInvites && invitation.status === 'pending' && (
                    <Button variant="ghost" size="sm">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Mail className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">No invitations sent yet</p>
            {canManageInvites && (
              <Button onClick={() => setIsDialogOpen(true)} className="flex items-center gap-2 mx-auto">
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