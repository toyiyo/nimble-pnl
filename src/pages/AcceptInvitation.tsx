import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { CheckCircle, XCircle, Clock, Users, Building } from 'lucide-react';

export const AcceptInvitation = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [invitation, setInvitation] = useState<any>(null);
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'accepted' | 'error'>('loading');

  const token = searchParams.get('token');

  useEffect(() => {
    if (!authLoading && !user) {
      // Redirect to auth page with return URL
      navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    if (token && user) {
      validateInvitation();
    }
  }, [token, user, authLoading]);

  const validateInvitation = async () => {
    if (!token) {
      setStatus('invalid');
      return;
    }

    try {
      const { data: invitationData, error } = await supabase
        .from('invitations')
        .select(`
          *,
          restaurants(name, address),
          invited_by_profile:profiles!invitations_invited_by_fkey(full_name)
        `)
        .eq('token', token)
        .eq('status', 'pending')
        .single();

      if (error || !invitationData) {
        setStatus('invalid');
        return;
      }

      // Check if invitation is expired
      if (new Date() > new Date(invitationData.expires_at)) {
        setStatus('invalid');
        return;
      }

      // Check if the user's email matches
      if (user?.email !== invitationData.email) {
        setStatus('invalid');
        toast({
          title: "Email Mismatch",
          description: `This invitation was sent to ${invitationData.email}, but you're logged in as ${user?.email}`,
          variant: "destructive",
        });
        return;
      }

      setInvitation(invitationData);
      setStatus('valid');
    } catch (error: any) {
      console.error('Error validating invitation:', error);
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const acceptInvitation = async () => {
    if (!token) return;

    setAccepting(true);
    try {
      const { data, error } = await supabase.functions.invoke('accept-invitation', {
        body: { token }
      });

      if (error) throw error;

      if (data.success) {
        setStatus('accepted');
        toast({
          title: "Invitation Accepted!",
          description: data.message,
        });

        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
          navigate('/');
        }, 2000);
      } else {
        throw new Error(data.error || 'Failed to accept invitation');
      }
    } catch (error: any) {
      console.error('Error accepting invitation:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to accept invitation",
        variant: "destructive",
      });
    } finally {
      setAccepting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/5">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Clock className="w-6 h-6 text-primary animate-spin" />
            </div>
            <CardTitle>Loading Invitation</CardTitle>
            <CardDescription>Please wait while we validate your invitation...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/5">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="w-6 h-6 text-destructive" />
            </div>
            <CardTitle>Invalid Invitation</CardTitle>
            <CardDescription>
              This invitation is invalid, expired, or has already been used.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/')}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'accepted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/5">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <CardTitle className="text-green-600">Invitation Accepted!</CardTitle>
            <CardDescription>
              Welcome to {invitation?.restaurants?.name}! You'll be redirected to the dashboard shortly.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/5">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="w-6 h-6 text-destructive" />
            </div>
            <CardTitle>Error</CardTitle>
            <CardDescription>
              Something went wrong while processing your invitation. Please try again later.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/')}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/5">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>Team Invitation</CardTitle>
          <CardDescription>
            You've been invited to join a restaurant team
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {invitation && (
            <div className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <Building className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <h3 className="font-semibold">{invitation.restaurants?.name}</h3>
                    {invitation.restaurants?.address && (
                      <p className="text-sm text-muted-foreground">{invitation.restaurants.address}</p>
                    )}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Role:</span>
                    <p className="font-medium capitalize">{invitation.role}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Invited by:</span>
                    <p className="font-medium">{invitation.invited_by_profile?.full_name || 'Restaurant Owner'}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Email:</span>
                    <p className="font-medium">{invitation.email}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Expires:</span>
                    <p className="font-medium">{new Date(invitation.expires_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button 
                  onClick={acceptInvitation} 
                  disabled={accepting}
                  className="flex-1"
                >
                  {accepting ? 'Accepting...' : 'Accept Invitation'}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => navigate('/')}
                  className="flex-1"
                >
                  Decline
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};