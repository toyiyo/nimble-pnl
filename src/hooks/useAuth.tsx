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
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
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
      
      // Get current session for debugging
      const { data: { session } } = await supabase.auth.getSession();
      console.log('Sign out - current session exists:', !!session);
      
      // Sign out from Supabase with local scope (current device only)
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      
      if (error) {
        console.error('Sign out error from Supabase:', error);
      }
      
      // Clear local state
      setSession(null);
      setUser(null);
      
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