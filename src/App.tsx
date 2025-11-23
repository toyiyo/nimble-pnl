import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { RestaurantProvider, useRestaurantContext } from "@/contexts/RestaurantContext";
import { AppHeader } from "@/components/AppHeader";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
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
import CloverCallback from "./pages/CloverCallback";
import ToastCallback from "./pages/ToastCallback";
import { AcceptInvitation } from "./pages/AcceptInvitation";
import { Inventory } from "./pages/Inventory";
import InventoryAudit from "./pages/InventoryAudit";
import NotFound from "./pages/NotFound";
import { ReceiptImport } from "@/pages/ReceiptImport";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Transactions from "./pages/Transactions";
import ChartOfAccounts from "./pages/ChartOfAccounts";
import FinancialStatements from "./pages/FinancialStatements";
import Accounting from "./pages/Accounting";
import Banking from "./pages/Banking";
import FinancialIntelligence from "./pages/FinancialIntelligence";
import AiAssistant from "./pages/AiAssistant";
import Scheduling from "./pages/Scheduling";
import Compliance from "./pages/Compliance";
import EmployeeClock from "./pages/EmployeeClock";
import TimePunchesManager from "./pages/TimePunchesManager";
import Payroll from "./pages/Payroll";
import Expenses from "./pages/Expenses";
import PurchaseOrders from "./pages/PurchaseOrders";
import PurchaseOrderEditor from "./pages/PurchaseOrderEditor";

const queryClient = new QueryClient();

// Protected Route Component with staff restrictions
const ProtectedRoute = ({ children, allowStaff = false }: { children: React.ReactNode; allowStaff?: boolean }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

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
      <StaffRoleChecker allowStaff={allowStaff} currentPath={location.pathname}>
        <SidebarProvider defaultOpen={true}>
          <div className="min-h-screen flex w-full bg-background overflow-x-hidden">
            <AppSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
              <AppHeader />
              <main className="flex-1 container px-4 py-4 md:py-6 max-w-full overflow-x-hidden">
                {children}
              </main>
            </div>
          </div>
        </SidebarProvider>
      </StaffRoleChecker>
    </RestaurantProvider>
  );
};

// Staff Role Checker Component
const StaffRoleChecker = ({ 
  children, 
  allowStaff, 
  currentPath 
}: { 
  children: React.ReactNode; 
  allowStaff: boolean;
  currentPath: string;
}) => {
  const { selectedRestaurant } = useRestaurantContext();
  
  // Check if user is staff role
  const isStaff = selectedRestaurant?.role === 'staff';
  
  // Allowed paths for staff users
  const staffAllowedPaths = ['/employee/clock', '/employee/timecard', '/employee/pay', '/employee/schedule', '/settings'];
  const isStaffAllowedPath = staffAllowedPaths.some(path => currentPath.startsWith(path));
  
  // If user is staff and trying to access restricted route
  if (isStaff && !allowStaff && !isStaffAllowedPath) {
    return <Navigate to="/employee/clock" replace />;
  }
  
  return <>{children}</>;
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
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/settings" element={<ProtectedRoute allowStaff={true}><RestaurantSettings /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute><Team /></ProtectedRoute>} />
            <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
            <Route path="/recipes" element={<ProtectedRoute><Recipes /></ProtectedRoute>} />
            <Route path="/pos-sales" element={<ProtectedRoute><POSSales /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
            <Route path="/inventory-audit" element={<ProtectedRoute><InventoryAudit /></ProtectedRoute>} />
            <Route path="/receipt-import" element={<ProtectedRoute><ReceiptImport /></ProtectedRoute>} />
            <Route path="/purchase-orders" element={<ProtectedRoute><PurchaseOrders /></ProtectedRoute>} />
            <Route path="/purchase-orders/:id" element={<ProtectedRoute><PurchaseOrderEditor /></ProtectedRoute>} />
          <Route path="/scheduling" element={<ProtectedRoute><Scheduling /></ProtectedRoute>} />
          <Route path="/compliance" element={<ProtectedRoute><Compliance /></ProtectedRoute>} />
          <Route path="/employee/clock" element={<ProtectedRoute allowStaff={true}><EmployeeClock /></ProtectedRoute>} />
          <Route path="/time-punches" element={<ProtectedRoute><TimePunchesManager /></ProtectedRoute>} />
          <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
          <Route path="/banking" element={<ProtectedRoute><Banking /></ProtectedRoute>} />
          <Route path="/expenses" element={<ProtectedRoute><Expenses /></ProtectedRoute>} />
          <Route path="/financial-intelligence" element={<ProtectedRoute><FinancialIntelligence /></ProtectedRoute>} />
          <Route path="/accounting" element={<ProtectedRoute><Accounting /></ProtectedRoute>} />
          <Route path="/accounting/banks" element={<ProtectedRoute><Accounting /></ProtectedRoute>} />
          <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
          <Route path="/chart-of-accounts" element={<ProtectedRoute><ChartOfAccounts /></ProtectedRoute>} />
          <Route path="/financial-statements" element={<ProtectedRoute><FinancialStatements /></ProtectedRoute>} />
            <Route path="/ai-assistant" element={<ProtectedRoute><AiAssistant /></ProtectedRoute>} />
            <Route path="/square/callback" element={<SquareCallback />} />
            <Route path="/clover/callback" element={<CloverCallback />} />
            <Route path="/toast/callback" element={<ToastCallback />} />
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