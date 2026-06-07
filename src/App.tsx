import { Suspense } from "react";
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
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileLayout } from '@/components/employee/MobileLayout';
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import RouteFallback from "@/components/RouteFallback";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import { queryClientConfig } from "@/lib/react-query-config";

// ---------------------------------------------------------------------------
// Lazy page imports — each page becomes an on-demand chunk.
// Named-export pages use .then(m => ({ default: m.X })) to satisfy React.lazy.
// ---------------------------------------------------------------------------
const Index = lazyWithRetry(() => import("./pages/Index"));
const Auth = lazyWithRetry(() => import("./pages/Auth"));
const Team = lazyWithRetry(() => import("./pages/Team"));
const Integrations = lazyWithRetry(() => import("./pages/Integrations"));
const Recipes = lazyWithRetry(() => import("./pages/Recipes"));
const POSSales = lazyWithRetry(() => import("./pages/POSSales"));
const Reports = lazyWithRetry(() => import("./pages/Reports"));
const RestaurantSettings = lazyWithRetry(() => import("./pages/RestaurantSettings"));
const SquareCallback = lazyWithRetry(() => import("./pages/SquareCallback"));
const CloverCallback = lazyWithRetry(() => import("./pages/CloverCallback"));
const ToastCallback = lazyWithRetry(() => import("./pages/ToastCallback"));
// Named-export pages
const AcceptInvitation = lazyWithRetry(() => import("./pages/AcceptInvitation").then(m => ({ default: m.AcceptInvitation })));
const Inventory = lazyWithRetry(() => import("./pages/Inventory").then(m => ({ default: m.Inventory })));
const ReceiptImport = lazyWithRetry(() => import("@/pages/ReceiptImport").then(m => ({ default: m.ReceiptImport })));
// Default-export pages (continued)
const InventoryAudit = lazyWithRetry(() => import("./pages/InventoryAudit"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const ForgotPassword = lazyWithRetry(() => import("./pages/ForgotPassword"));
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const Unsubscribe = lazyWithRetry(() => import("./pages/Unsubscribe"));
const Transactions = lazyWithRetry(() => import("./pages/Transactions"));
const ChartOfAccounts = lazyWithRetry(() => import("./pages/ChartOfAccounts"));
const FinancialStatements = lazyWithRetry(() => import("./pages/FinancialStatements"));
const Accounting = lazyWithRetry(() => import("./pages/Accounting"));
const Banking = lazyWithRetry(() => import("./pages/Banking"));
const FinancialIntelligence = lazyWithRetry(() => import("./pages/FinancialIntelligence"));
const Scheduling = lazyWithRetry(() => import("./pages/Scheduling"));
const Employees = lazyWithRetry(() => import("./pages/Employees"));
const EmployeeClock = lazyWithRetry(() => import("./pages/EmployeeClock"));
const EmployeePortal = lazyWithRetry(() => import("./pages/EmployeePortal"));
const EmployeeTimecard = lazyWithRetry(() => import("./pages/EmployeeTimecard"));
const EmployeePin = lazyWithRetry(() => import("./pages/EmployeePin"));
const EmployeePay = lazyWithRetry(() => import("./pages/EmployeePay"));
const EmployeeSchedule = lazyWithRetry(() => import("./pages/EmployeeSchedule"));
const AvailableShiftsPage = lazyWithRetry(() => import("./pages/AvailableShiftsPage"));
const PrepRecipesEnhanced = lazyWithRetry(() => import("./pages/PrepRecipesEnhanced"));
const TimePunchesManager = lazyWithRetry(() => import("./pages/TimePunchesManager"));
const Payroll = lazyWithRetry(() => import("./pages/Payroll"));
const Expenses = lazyWithRetry(() => import("./pages/Expenses"));
const PrintChecks = lazyWithRetry(() => import("./pages/PrintChecks"));
const PurchaseOrders = lazyWithRetry(() => import("./pages/PurchaseOrders"));
const PurchaseOrderEditor = lazyWithRetry(() => import("./pages/PurchaseOrderEditor"));
const KioskMode = lazyWithRetry(() => import("./pages/KioskMode"));
const Tips = lazyWithRetry(() => import("./pages/Tips"));
const EmployeeTips = lazyWithRetry(() => import("./pages/EmployeeTips"));
const EmployeeMore = lazyWithRetry(() => import("./pages/EmployeeMore"));
const Customers = lazyWithRetry(() => import("./pages/Customers"));
const Invoices = lazyWithRetry(() => import("./pages/Invoices"));
const InvoiceForm = lazyWithRetry(() => import("./pages/InvoiceForm"));
const InvoiceDetail = lazyWithRetry(() => import("./pages/InvoiceDetail"));
const StripeAccountManagement = lazyWithRetry(() => import("./pages/StripeAccountManagement"));
const PayrollCalculationsHelp = lazyWithRetry(() => import("./pages/Help/PayrollCalculations"));
const HelpCenter = lazyWithRetry(() => import("./pages/Help/HelpCenter"));
const HelpArticle = lazyWithRetry(() => import("./pages/Help/HelpArticle"));
const Assets = lazyWithRetry(() => import("./pages/Assets"));
const BudgetRunRate = lazyWithRetry(() => import("./pages/BudgetRunRate"));
const OpsInbox = lazyWithRetry(() => import("./pages/OpsInbox"));
const WeeklyBrief = lazyWithRetry(() => import("./pages/WeeklyBrief"));

const queryClient = new QueryClient(queryClientConfig);
const enableSpeedInsights = import.meta.env.VITE_ENABLE_SPEED_INSIGHTS === "true";

// Layout switcher - chooses between mobile employee layout, desktop layout, or no-chrome
function LayoutSwitcher({ children, noChrome, isMobile }: { children: React.ReactNode; noChrome: boolean; isMobile: boolean }) {
  const { selectedRestaurant } = useRestaurantContext();
  const isStaff = selectedRestaurant?.role === 'staff';

  if (noChrome) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  if (isStaff && isMobile) {
    return <MobileLayout>{children}</MobileLayout>;
  }

  return (
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
  );
}

// Protected Route Component with staff restrictions
function ProtectedRoute({ children, allowStaff = false, noChrome = false }: { children: React.ReactNode; allowStaff?: boolean; noChrome?: boolean }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const isMobile = useIsMobile();

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
        <StaffRoleChecker allowStaff={allowStaff} currentPath={pathname}>
          <LayoutSwitcher noChrome={noChrome} isMobile={isMobile}>
            {children}
          </LayoutSwitcher>
        </StaffRoleChecker>
      </AiChatProvider>
    </RestaurantProvider>
  );
}

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
      '/help',
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
      '/help',
    ],
  },
  collaborator_chef: {
    landing: '/recipes',
    allowed: [
      '/recipes',
      '/prep-recipes',
      '/inventory', // View-only for ingredient context
      '/settings',
      '/help',
    ],
  },
};

// Role Route Checker Component - handles staff, kiosk, and collaborator routing
function StaffRoleChecker({
  children,
  allowStaff,
  currentPath
}: {
  children: React.ReactNode;
  allowStaff: boolean;
  currentPath: string;
}) {
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
  const staffAllowedPaths = ['/employee/clock', '/employee/portal', '/employee/timecard', '/employee/pin', '/employee/pay', '/employee/schedule', '/employee/shifts', '/employee/tips', '/employee/more', '/settings'];
  const isStaffAllowedPath = staffAllowedPaths.some(path => currentPath.startsWith(path));

  // If user is staff and trying to access restricted route
  if (isStaff && !allowStaff && !isStaffAllowedPath) {
    return <Navigate to="/employee/schedule" replace />;
  }

  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Analytics />
        {enableSpeedInsights && <SpeedInsights />}
        <BrowserRouter future={{ v7_startTransition: true }}>
          <InstallBanner />
          <RouteErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/unsubscribe" element={<Unsubscribe />} />
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
                <Route path="/employee/pin" element={<ProtectedRoute allowStaff={true}><EmployeePin /></ProtectedRoute>} />
                <Route path="/employee/pay" element={<ProtectedRoute allowStaff={true}><EmployeePay /></ProtectedRoute>} />
                <Route path="/employee/schedule" element={<ProtectedRoute allowStaff={true}><EmployeeSchedule /></ProtectedRoute>} />
                <Route path="/employee/shifts" element={<ProtectedRoute allowStaff={true}><AvailableShiftsPage /></ProtectedRoute>} />
                <Route path="/kiosk" element={<ProtectedRoute allowStaff={true} noChrome={true}><KioskMode /></ProtectedRoute>} />
                <Route path="/time-punches" element={<ProtectedRoute><TimePunchesManager /></ProtectedRoute>} />
                <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
                <Route path="/tips" element={<ProtectedRoute><Tips /></ProtectedRoute>} />
                <Route path="/employee/tips" element={<ProtectedRoute allowStaff={true}><EmployeeTips /></ProtectedRoute>} />
                <Route path="/employee/more" element={<ProtectedRoute allowStaff={true}><EmployeeMore /></ProtectedRoute>} />
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
                <Route path="/weekly-brief" element={<ProtectedRoute><WeeklyBrief /></ProtectedRoute>} />
                <Route path="/help" element={<ProtectedRoute allowStaff={true}><HelpCenter /></ProtectedRoute>} />
                <Route path="/help/payroll-calculations" element={<ProtectedRoute allowStaff={true}><PayrollCalculationsHelp /></ProtectedRoute>} />
                <Route path="/help/:slug" element={<ProtectedRoute allowStaff={true}><HelpArticle /></ProtectedRoute>} />
                <Route path="/square/callback" element={<SquareCallback />} />
                <Route path="/clover/callback" element={<CloverCallback />} />
                <Route path="/toast/callback" element={<ToastCallback />} />
                <Route path="/accept-invitation" element={<AcceptInvitation />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </RouteErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
