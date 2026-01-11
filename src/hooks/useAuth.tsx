import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  updatePassword: (newPassword: string) => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // Proactive refresh on visibility change - Layer 2 of JWT fix
  useEffect(() => {
    const handleVisibilityChange = async () => {
      // PROACTIVE REFRESH: When tab becomes visible, check session immediately
      // This handles cases where the device was asleep or tab was backgrounded,
      // pausing the auto-refresh timer.
      if (document.visibilityState === 'visible') {
        const { data, error } = await supabase.auth.getSession();
        if (!error && data.session) {
          // Verify if we have a new token and update state if necessary
          if (data.session.access_token !== session?.access_token) {
            console.log('[Auth] Tab visible: Session refreshed via proactive check');
            setSession(data.session);
            setUser(data.session.user);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [session]);

  // Memoized auth state handler to prevent recreation on each render
  const handleAuthStateChange = useCallback((event: string, session: Session | null) => {
    try {
      console.log('Auth state change:', event, session?.user?.id);
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      setInitialized(true);
    } catch (error) {
      console.error('Error in auth state change handler:', error);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let subscription: any = null;
    let isMounted = true;

    const initializeAuth = async () => {
      try {
        // First, get the current session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Error getting session:', sessionError);
        }

        // Only update state if component is still mounted
        if (isMounted) {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
          setInitialized(true);
        }

        // Then set up the listener for future changes
        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(handleAuthStateChange);
        subscription = authSubscription;

      } catch (error) {
        console.error('Error initializing auth:', error);
        if (isMounted) {
          setLoading(false);
          setInitialized(true);
        }
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [handleAuthStateChange]);

  const signIn = async (email: string, password: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) {
        return { error };
      }

      // Check if user is an inactive employee
      if (data.user) {
        const { data: employees, error: employeeError } = await supabase
          .from('employees')
          .select('id, name, is_active')
          .eq('user_id', data.user.id)
          .limit(1);

        if (employeeError) {
          console.error('Error checking employee status:', employeeError);
          // Don't block login on query error, just log it
        } else if (employees && employees.length > 0) {
          const employee = employees[0];
          if (employee.is_active === false) {
            // Employee is inactive, sign them out and return error
            await supabase.auth.signOut({ scope: 'local' });
            return { 
              error: { 
                message: 'Account is inactive. Please contact your manager.',
                status: 403,
                name: 'EmployeeInactiveError'
              } 
            };
          }
        }
      }

      return { error };
    } catch (error) {
      console.error('Sign in error:', error);
      return { error };
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      setLoading(true);
      const redirectUrl = `${window.location.origin}/`;
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName,
          }
        }
      });
      return { error };
    } catch (error) {
      console.error('Sign up error:', error);
      return { error };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      
      // Clear local state first
      setSession(null);
      setUser(null);
      
      // Manually clear all Supabase localStorage keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // Try to sign out from Supabase (may fail with 403 but that's ok)
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (e) {
        console.log('Supabase signOut failed (continuing anyway):', e);
      }
      
      // Navigate to auth page
      window.location.href = '/auth';
    } catch (error: any) {
      console.error('Sign out exception:', error);
      // Even on error, clear state and redirect
      setSession(null);
      setUser(null);
      window.location.href = '/auth';
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const redirectUrl = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });
      return { error };
    } catch (error) {
      console.error('Password reset error:', error);
      return { error };
    }
  };

  const updatePassword = async (newPassword: string) => {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      return { error };
    } catch (error) {
      console.error('Password update error:', error);
      return { error };
    }
  };

  const value = {
    user,
    session,
    loading: loading || !initialized,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
  };

  // Show loading state until auth is properly initialized
  if (!initialized) {
    return (
      <AuthContext.Provider value={value}>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Initializing...</p>
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}