import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { RestaurantProvider } from "@/contexts/RestaurantContext";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Team from "./pages/Team";
import Integrations from "./pages/Integrations";
import Recipes from "./pages/Recipes";
import POSSales from "./pages/POSSales";
import Reports from "./pages/Reports";
import SquareCallback from "./pages/SquareCallback";
import { AcceptInvitation } from "./pages/AcceptInvitation";
import { Inventory } from "./pages/Inventory";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/square/callback" element={<SquareCallback />} />
        <Route path="/accept-invitation" element={<AcceptInvitation />} />
        <Route path="*" element={<Auth />} />
      </Routes>
    );
  }

  return (
    <RestaurantProvider>
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="container mx-auto px-4">
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/team" element={<Team />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/pos-sales" element={<POSSales />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/square/callback" element={<SquareCallback />} />
            <Route path="/accept-invitation" element={<AcceptInvitation />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </RestaurantProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;