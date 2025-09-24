import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { CheckCircle, XCircle, Clock, Users, Building, ArrowLeft } from 'lucide-react';

export const AcceptInvitation = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [authLoading2, setAuthLoading2] = useState(false);
  const [invitation, setInvitation] = useState<any>(null);
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'accepted' | 'error' | 'needs_auth'>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showSignIn, setShowSignIn] = useState(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (token) {
      validateInvitation();
    }
  }, [token]);

  useEffect(() => {
    if (user && invitation && user.email === invitation.email) {
      // For existing users signing in, accept the invitation
      if (status === 'valid') {
        acceptInvitation();
      }
    } else if (user && invitation && user.email !== invitation.email) {
      toast({
        title: "Email Mismatch",
        description: `This invitation was sent to ${invitation.email}, but you're logged in as ${user.email}`,
        variant: "destructive",
      });
      setStatus('invalid');
    }
  }, [user, invitation, status]);

  const validateInvitation = async () => {
    if (!token) {
      setStatus('invalid');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('validate-invitation', {
        body: { token }
      });

      if (error) throw error;

      if (data.success) {
        setInvitation(data.invitation);
        setEmail(data.invitation.email); // Pre-fill email
        
        if (user) {
          // User is already authenticated, check email match
          if (user.email === data.invitation.email) {
            setStatus('valid');
          } else {
            toast({
              title: "Email Mismatch",
              description: `This invitation was sent to ${data.invitation.email}, but you're logged in as ${user.email}`,
              variant: "destructive",
            });
            setStatus('invalid');
          }
        } else {
          // User needs to authenticate
          setStatus('needs_auth');
        }
      } else {
        throw new Error(data.error || 'Invalid invitation');
      }
    } catch (error: any) {
      console.error('Error validating invitation:', error);
      setStatus('invalid');
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
          title: "Welcome to the Team!",
          description: data.message,
        });

        // Immediate redirect to dashboard
        navigate('/');
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

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading2(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) throw error;
      
      // User will be auto-authenticated and invitation accepted via useEffect
    } catch (error: any) {
      toast({
        title: "Error signing in",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAuthLoading2(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading2(true);

    try {
      // Validate email matches invitation
      if (email !== invitation?.email) {
        toast({
          title: "Email Mismatch",
          description: "Please use the email address from the invitation.",
          variant: "destructive",
        });
        return;
      }

      // Use special signup function that bypasses email confirmation and accepts invitation
      const { data, error } = await supabase.functions.invoke('signup-with-invitation', {
        body: {
          email,
          password,
          fullName,
          token
        }
      });

      if (error) {
        throw error;
      }

      if (data.success) {
        toast({
          title: "Account Created!",
          description: `${data.message} Please sign in to continue.`,
        });
        // Switch to sign-in mode after successful signup
        setShowSignIn(true);
        setPassword(''); // Clear password field
      } else {
        throw new Error(data.error || 'Failed to create account');
      }
    } catch (error: any) {
      console.error('Sign up error:', error);
      toast({
        title: "Error creating account", 
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setAuthLoading2(false);
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
            <CardTitle className="text-green-600">Welcome to the Team!</CardTitle>
            <CardDescription>
              You've successfully joined {invitation?.restaurant?.name}! Redirecting to dashboard...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Show authenticated user's invitation
  if (status === 'valid' && user) {
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
            <div className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <Building className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <h3 className="font-semibold">{invitation.restaurant?.name}</h3>
                    {invitation.restaurant?.address && (
                      <p className="text-sm text-muted-foreground">{invitation.restaurant.address}</p>
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
                    <p className="font-medium">{invitation.invited_by}</p>
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
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show invitation details with authentication required - NEW USER FOCUSED FLOW
  if (status === 'needs_auth' && invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/5 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <CardTitle>Join {invitation.restaurant?.name}</CardTitle>
            <CardDescription>
              You've been invited as a {invitation.role}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {/* Invitation Preview */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Building className="w-4 h-4 text-muted-foreground" />
                <h4 className="font-medium text-sm">{invitation.restaurant?.name}</h4>
              </div>
              <div className="text-xs text-muted-foreground">
                Invited by {invitation.invited_by}
              </div>
            </div>

            {!showSignIn ? (
              /* NEW USER SIGNUP - PRIMARY FLOW */
              <div className="space-y-4">
                <div className="text-center">
                  <h4 className="font-medium mb-2">Create Your Account</h4>
                  <p className="text-sm text-muted-foreground">Join the team instantly - no email verification needed!</p>
                </div>
                
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      value={email}
                      required
                      disabled
                      className="bg-muted/30"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Full Name</Label>
                    <Input
                      id="signup-name"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      placeholder="Enter your full name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Create a secure password"
                      minLength={6}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={authLoading2}>
                    {authLoading2 ? "Creating Account..." : "Join Team"}
                  </Button>
                </form>

                <div className="text-center">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setShowSignIn(true)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Already have an account? Sign in instead
                  </Button>
                </div>
              </div>
            ) : (
              /* EXISTING USER SIGN IN - SECONDARY FLOW */
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setShowSignIn(false)}
                    className="p-1"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div>
                    <h4 className="font-medium">Sign In</h4>
                    <p className="text-sm text-muted-foreground">Use your existing account</p>
                  </div>
                </div>
                
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      value={email}
                      required
                      disabled
                      className="bg-muted/30"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Enter your password"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={authLoading2}>
                    {authLoading2 ? "Signing In..." : "Sign In & Join Team"}
                  </Button>
                </form>
              </div>
            )}
            
            <p className="text-xs text-center text-muted-foreground">
              This invitation was sent to {invitation.email}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
};