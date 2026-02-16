import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { RestaurantProvider, useRestaurantContext } from "@/contexts/RestaurantContext";
import { AiChatProvider } from "@/contexts/AiChatContext";
import { AiChatBubble } from "@/components/ai-chat/AiChatBubble";
import { AiChatPanel } from "@/components/ai-chat/AiChatPanel";
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
import Scheduling from "./pages/Scheduling";
import Employees from "./pages/Employees";
import EmployeeClock from "./pages/EmployeeClock";
import EmployeePortal from "./pages/EmployeePortal";
import EmployeeTimecard from "./pages/EmployeeTimecard";
import EmployeePay from "./pages/EmployeePay";
import EmployeeSchedule from "./pages/EmployeeSchedule";
import EmployeeShiftMarketplace from "./pages/EmployeeShiftMarketplace";
import PrepRecipesEnhanced from "./pages/PrepRecipesEnhanced";
import TimePunchesManager from "./pages/TimePunchesManager";
import Payroll from "./pages/Payroll";
import Expenses from "./pages/Expenses";
import PrintChecks from "./pages/PrintChecks";
import PurchaseOrders from "./pages/PurchaseOrders";
import PurchaseOrderEditor from "./pages/PurchaseOrderEditor";
import KioskMode from "./pages/KioskMode";
import Tips from "./pages/Tips";
import EmployeeTips from "./pages/EmployeeTips";
import Customers from "./pages/Customers";
import Invoices from "./pages/Invoices";
import InvoiceForm from "./pages/InvoiceForm";
import InvoiceDetail from "./pages/InvoiceDetail";
import StripeAccountManagement from "./pages/StripeAccountManagement";
import PayrollCalculationsHelp from "./pages/Help/PayrollCalculations";
import Assets from "./pages/Assets";
import BudgetRunRate from "./pages/BudgetRunRate";
import OpsInbox from "./pages/OpsInbox";
import DailyBrief from "./pages/DailyBrief";
import { queryClientConfig } from "@/lib/react-query-config";

const queryClient = new QueryClient(queryClientConfig);
const enableSpeedInsights = import.meta.env.VITE_ENABLE_SPEED_INSIGHTS === "true";

// Protected Route Component with staff restrictions
const ProtectedRoute = ({ children, allowStaff = false, noChrome = false }: { children: React.ReactNode; allowStaff?: boolean; noChrome?: boolean }) => {
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
      <AiChatProvider>
        <StaffRoleChecker allowStaff={allowStaff} currentPath={location.pathname}>
          {noChrome ? (
            <div className="min-h-screen bg-background">{children}</div>
          ) : (
            <>
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
              {/* Floating AI Chat - only for non-kiosk authenticated pages */}
              <AiChatBubble />
              <AiChatPanel />
            </>
          )}
        </StaffRoleChecker>
      </AiChatProvider>
    </RestaurantProvider>
  );
};

// Collaborator route configurations
// Each collaborator role has a landing page and list of allowed paths
const COLLABORATOR_ROUTES: Record<string, { landing: string; allowed: string[] }> = {
  collaborator_accountant: {
    landing: '/transactions',
    allowed: [
      '/transactions',
      '/banking',
      '/expenses',
      '/print-checks',
      '/invoices',
      '/customers',
      '/chart-of-accounts',
      '/financial-statements',
      '/financial-intelligence',
      '/assets', // Asset management
      '/payroll', // Read-only for bookkeeping
      '/employees', // View for payroll context
      '/settings',
    ],
  },
  collaborator_inventory: {
    landing: '/inventory',
    allowed: [
      '/inventory',
      '/inventory-audit',
      '/purchase-orders',
      '/receipt-import',
      '/settings',
    ],
  },
  collaborator_chef: {
    landing: '/recipes',
    allowed: [
      '/recipes',
      '/prep-recipes',
      '/inventory', // View-only for ingredient context
      '/settings',
    ],
  },
};

// Role Route Checker Component - handles staff, kiosk, and collaborator routing
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

  const role = selectedRestaurant?.role;
  const isStaff = role === 'staff';
  const isKiosk = role === 'kiosk';
  const isCollaborator = role?.startsWith('collaborator_');

  // CRITICAL: Kiosk users can ONLY access /kiosk - nothing else
  // This must be checked first before any other logic
  if (isKiosk && currentPath !== '/kiosk') {
    return <Navigate to="/kiosk" replace />;
  }

  // Collaborator routing - redirect to their landing page if not on allowed path
  if (isCollaborator && role) {
    const config = COLLABORATOR_ROUTES[role];
    if (config) {
      const isAllowedPath = config.allowed.some(path =>
        currentPath === path || currentPath.startsWith(path + '/')
      );
      if (!isAllowedPath) {
        return <Navigate to={config.landing} replace />;
      }
    }
  }

  // Allowed paths for staff users (excludes kiosk - they have their own check above)
  const staffAllowedPaths = ['/employee/clock', '/employee/portal', '/employee/timecard', '/employee/pay', '/employee/schedule', '/employee/shifts', '/settings'];
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
        {enableSpeedInsights && <SpeedInsights />}
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/settings" element={<ProtectedRoute allowStaff={true}><RestaurantSettings /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute><Team /></ProtectedRoute>} />
            <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
          <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
          <Route path="/recipes" element={<ProtectedRoute><Recipes /></ProtectedRoute>} />
          <Route path="/prep-recipes" element={<ProtectedRoute><PrepRecipesEnhanced /></ProtectedRoute>} />
          <Route path="/pos-sales" element={<ProtectedRoute><POSSales /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
          <Route path="/inventory-audit" element={<ProtectedRoute><InventoryAudit /></ProtectedRoute>} />
          <Route path="/receipt-import" element={<ProtectedRoute><ReceiptImport /></ProtectedRoute>} />
            <Route path="/purchase-orders" element={<ProtectedRoute><PurchaseOrders /></ProtectedRoute>} />
            <Route path="/purchase-orders/:id" element={<ProtectedRoute><PurchaseOrderEditor /></ProtectedRoute>} />
          <Route path="/scheduling" element={<ProtectedRoute><Scheduling /></ProtectedRoute>} />
          <Route path="/employee/clock" element={<ProtectedRoute allowStaff={true}><EmployeeClock /></ProtectedRoute>} />
          <Route path="/employee/portal" element={<ProtectedRoute allowStaff={true}><EmployeePortal /></ProtectedRoute>} />
          <Route path="/employee/timecard" element={<ProtectedRoute allowStaff={true}><EmployeeTimecard /></ProtectedRoute>} />
          <Route path="/employee/pay" element={<ProtectedRoute allowStaff={true}><EmployeePay /></ProtectedRoute>} />
          <Route path="/employee/schedule" element={<ProtectedRoute allowStaff={true}><EmployeeSchedule /></ProtectedRoute>} />
          <Route path="/employee/shifts" element={<ProtectedRoute allowStaff={true}><EmployeeShiftMarketplace /></ProtectedRoute>} />
          <Route path="/kiosk" element={<ProtectedRoute allowStaff={true} noChrome={true}><KioskMode /></ProtectedRoute>} />
          <Route path="/time-punches" element={<ProtectedRoute><TimePunchesManager /></ProtectedRoute>} />
          <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
          <Route path="/tips" element={<ProtectedRoute><Tips /></ProtectedRoute>} />
          <Route path="/employee/tips" element={<ProtectedRoute allowStaff={true}><EmployeeTips /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
          <Route path="/invoices" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
          <Route path="/invoices/new" element={<ProtectedRoute><InvoiceForm /></ProtectedRoute>} />
          <Route path="/invoices/:id" element={<ProtectedRoute><InvoiceDetail /></ProtectedRoute>} />
          <Route path="/invoices/:id/edit" element={<ProtectedRoute><InvoiceForm /></ProtectedRoute>} />
          <Route path="/stripe-account" element={<ProtectedRoute><StripeAccountManagement /></ProtectedRoute>} />
          <Route path="/banking" element={<ProtectedRoute><Banking /></ProtectedRoute>} />
          <Route path="/expenses" element={<ProtectedRoute><Expenses /></ProtectedRoute>} />
          <Route path="/print-checks" element={<ProtectedRoute><PrintChecks /></ProtectedRoute>} />
          <Route path="/financial-intelligence" element={<ProtectedRoute><FinancialIntelligence /></ProtectedRoute>} />
          <Route path="/accounting" element={<ProtectedRoute><Accounting /></ProtectedRoute>} />
          <Route path="/accounting/banks" element={<ProtectedRoute><Accounting /></ProtectedRoute>} />
          <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
          <Route path="/chart-of-accounts" element={<ProtectedRoute><ChartOfAccounts /></ProtectedRoute>} />
          <Route path="/financial-statements" element={<ProtectedRoute><FinancialStatements /></ProtectedRoute>} />
            <Route path="/assets" element={<ProtectedRoute><Assets /></ProtectedRoute>} />
            <Route path="/budget" element={<ProtectedRoute><BudgetRunRate /></ProtectedRoute>} />
            <Route path="/ops-inbox" element={<ProtectedRoute><OpsInbox /></ProtectedRoute>} />
            <Route path="/daily-brief" element={<ProtectedRoute><DailyBrief /></ProtectedRoute>} />
            <Route path="/help/payroll-calculations" element={<ProtectedRoute allowStaff={true}><PayrollCalculationsHelp /></ProtectedRoute>} />
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
