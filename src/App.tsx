import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { RestaurantProvider } from "@/contexts/RestaurantContext";
import { AppHeader } from "@/components/AppHeader";
import { InstallBanner } from "@/components/InstallBanner";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Team from "./pages/Team";
import Integrations from "./pages/Integrations";
import Recipes from "./pages/Recipes";
import POSSales from "./pages/POSSales";
import Reports from "./pages/Reports";
import RestaurantSettings from "./pages/RestaurantSettings";
import SquareCallback from "./pages/SquareCallback";
import { AcceptInvitation } from "./pages/AcceptInvitation";
import { Inventory } from "./pages/Inventory";
import InventoryAudit from "./pages/InventoryAudit";
import NotFound from "./pages/NotFound";
import { ReceiptImport } from "@/pages/ReceiptImport";

const queryClient = new QueryClient();

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

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
    return <Navigate to="/auth" replace />;
  }

  return (
    <RestaurantProvider>
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="container px-4 py-4 md:py-6">
          {children}
        </main>
      </div>
    </RestaurantProvider>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <InstallBanner />
        <Analytics />
        <SpeedInsights />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/settings" element={<ProtectedRoute><RestaurantSettings /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute><Team /></ProtectedRoute>} />
            <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
            <Route path="/recipes" element={<ProtectedRoute><Recipes /></ProtectedRoute>} />
            <Route path="/pos-sales" element={<ProtectedRoute><POSSales /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
            <Route path="/inventory-audit" element={<ProtectedRoute><InventoryAudit /></ProtectedRoute>} />
            <Route path="/receipt-import" element={<ProtectedRoute><ReceiptImport /></ProtectedRoute>} />
            <Route path="/square/callback" element={<SquareCallback />} />
            <Route path="/accept-invitation" element={<AcceptInvitation />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;