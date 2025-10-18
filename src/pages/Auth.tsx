import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { useSSO } from '@/hooks/useSSO';
import { useToast } from '@/hooks/use-toast';
import { SSOProviderButtons } from '@/components/SSOProviderButtons';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { Building, ArrowRight, Shield, CalendarCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const Auth = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoRequired, setSSORequired] = useState<any>(null);
  const [showSSORedirect, setShowSSORedirect] = useState(false);
  const { signIn, signUp, user } = useAuth();
  const { checkSSORequired, initiateSSO } = useSSO();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    // Check for SSO requirement when email changes
    if (email) {
      const ssoConfig = checkSSORequired(email);
      setSSORequired(ssoConfig);
      if (ssoConfig) {
        setShowSSORedirect(true);
      }
    } else {
      setSSORequired(null);
      setShowSSORedirect(false);
    }
  }, [email, checkSSORequired]);

  const handleSSORedirect = async () => {
    if (!ssoRequired) return;
    
    setLoading(true);
    try {
      const result = await initiateSSO(email, ssoRequired.sso_provider);
      
      if (result.success) {
        toast({
          title: "SSO Redirect",
          description: result.message,
        });
        // Supabase OAuth handles the redirect automatically
      } else {
        toast({
          title: "SSO Error",
          description: result.error,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to initiate SSO",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check if SSO is required for this email domain
    if (ssoRequired) {
      await handleSSORedirect();
      return;
    }
    
    setLoading(true);

    const { error } = await signIn(email, password);
    
    if (error) {
      toast({
        title: "Error signing in",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Welcome back!",
        description: "You have successfully signed in.",
      });
    }
    
    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check if SSO is required for this email domain
    if (ssoRequired) {
      await handleSSORedirect();
      return;
    }
    
    setLoading(true);

    const { error } = await signUp(email, password, fullName);
    
    if (error) {
      toast({
        title: "Error creating account",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Account created!",
        description: "Please check your email to verify your account.",
      });
    }
    
    setLoading(false);
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        }
      });

      if (error) {
        throw error;
      }

      toast({
        title: "Redirecting...",
        description: "Signing in with Google",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center gap-2 mb-2">
            <CalendarCheck className="h-8 w-8 text-emerald-600" />
            <CardTitle className="text-2xl">EasyShiftHQ</CardTitle>
          </div>
          <CardDescription>
            Manage your restaurant's costs and profitability
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin">
              {ssoRequired && showSSORedirect && (
                <Alert className="mb-4">
                  <Shield className="h-4 w-4" />
                  <AlertDescription>
                    Your organization uses SSO. Click below to sign in through your identity provider.
                  </AlertDescription>
                </Alert>
              )}
              
              <div className="space-y-4">
                <GoogleSignInButton
                  onClick={handleGoogleAuth}
                  disabled={loading}
                  text="continue"
                />

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or continue with email
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  
                  {ssoRequired ? (
                    <div className="space-y-4">
                      <SSOProviderButtons onSuccess={() => console.log('SSO login successful')} />
                      
                      <div className="text-center text-sm text-muted-foreground">
                        SSO is required for @{ssoRequired.sso_domain} emails
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="signin-password">Password</Label>
                        <Input
                          id="signin-password"
                          type="password"
                          placeholder="Enter your password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? "Signing in..." : "Sign In"}
                      </Button>
                    </>
                  )}
                </form>
              </div>
            </TabsContent>
            
            <TabsContent value="signup">
              {ssoRequired && showSSORedirect && (
                <Alert className="mb-4">
                  <Shield className="h-4 w-4" />
                  <AlertDescription>
                    Your organization uses SSO. New accounts must be created through your identity provider.
                  </AlertDescription>
                </Alert>
              )}
              
              <div className="space-y-4">
                <GoogleSignInButton
                  onClick={handleGoogleAuth}
                  disabled={loading}
                  text="continue"
                />

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or continue with email
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  
                  {ssoRequired ? (
                    <div className="space-y-4">
                      <SSOProviderButtons onSuccess={() => console.log('SSO signup successful')} />
                      
                      <div className="text-center text-sm text-muted-foreground">
                        SSO is required for @{ssoRequired.sso_domain} emails
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="signup-name">Full Name</Label>
                        <Input
                          id="signup-name"
                          type="text"
                          placeholder="Enter your full name"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signup-password">Password</Label>
                        <Input
                          id="signup-password"
                          type="password"
                          placeholder="Create a password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? "Creating account..." : "Sign Up"}
                      </Button>
                    </>
                  )}
                </form>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;