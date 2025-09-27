import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { RestaurantProvider } from "@/contexts/RestaurantContext";
import { AppHeader } from "@/components/AppHeader";
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <RestaurantProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <div className="min-h-screen bg-background">
              <AppHeader />
              <main className="container mx-auto px-4">
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/team" element={<Team />} />
                  <Route path="/integrations" element={<Integrations />} />
                  <Route path="/recipes" element={<Recipes />} />
                  <Route path="/pos-sales" element={<POSSales />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/inventory" element={<Inventory />} />
                  <Route path="/square/callback" element={<SquareCallback />} />
                  <Route path="/accept-invitation" element={<AcceptInvitation />} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </main>
            </div>
          </BrowserRouter>
        </TooltipProvider>
      </RestaurantProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;