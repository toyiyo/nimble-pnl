import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

const Index = () => {
  const { user, signOut, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <h1 className="text-xl font-semibold">Restaurant Operations</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Welcome, {user.email}
            </span>
            <Button variant="outline" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </nav>
      
      <main className="container py-6">
        <div className="text-center">
          <h2 className="mb-4 text-3xl font-bold">Daily P&L Dashboard</h2>
          <p className="text-xl text-muted-foreground mb-8">
            Real-time food cost tracking and profitability insights
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <div className="p-6 border rounded-lg">
              <h3 className="text-lg font-semibold mb-2">Food Cost %</h3>
              <p className="text-3xl font-bold text-primary">28.5%</p>
              <p className="text-sm text-muted-foreground">vs 30% target</p>
            </div>
            
            <div className="p-6 border rounded-lg">
              <h3 className="text-lg font-semibold mb-2">Labor Cost %</h3>
              <p className="text-3xl font-bold text-primary">32.1%</p>
              <p className="text-sm text-muted-foreground">vs 30% target</p>
            </div>
            
            <div className="p-6 border rounded-lg">
              <h3 className="text-lg font-semibold mb-2">Prime Cost %</h3>
              <p className="text-3xl font-bold text-primary">60.6%</p>
              <p className="text-sm text-muted-foreground">vs 60% target</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
