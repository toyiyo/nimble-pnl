import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, Receipt, ChefHat, TrendingUp, ShoppingCart, Users, Settings, FileText, Wallet } from "lucide-react";

interface DashboardQuickActionsProps {
  restaurantId: string;
}

export function DashboardQuickActions({ restaurantId }: DashboardQuickActionsProps) {
  const navigate = useNavigate();

  const actions = [
    {
      title: "Add Inventory",
      description: "Scan or add products",
      icon: Package,
      onClick: () => navigate("/inventory"),
      color: "text-blue-600 dark:text-blue-400",
    },
    {
      title: "Upload Receipt",
      description: "Import from supplier",
      icon: Receipt,
      onClick: () => navigate("/receipt-import"),
      color: "text-purple-600 dark:text-purple-400",
    },
    {
      title: "Manage Recipes",
      description: "Create & edit recipes",
      icon: ChefHat,
      onClick: () => navigate("/recipes"),
      color: "text-orange-600 dark:text-orange-400",
    },
    {
      title: "View Reports",
      description: "Analytics & insights",
      icon: TrendingUp,
      onClick: () => navigate("/reports"),
      color: "text-green-600 dark:text-green-400",
    },
    {
      title: "POS Sales",
      description: "Import sales data",
      icon: ShoppingCart,
      onClick: () => navigate("/pos-sales"),
      color: "text-pink-600 dark:text-pink-400",
    },
    {
      title: "Bank Accounts",
      description: "Connect banks",
      icon: Wallet,
      onClick: () => navigate("/banking"),
      color: "text-emerald-600 dark:text-emerald-400",
    },
    {
      title: "Integrations",
      description: "Connect systems",
      icon: Users,
      onClick: () => navigate("/integrations"),
      color: "text-indigo-600 dark:text-indigo-400",
    },
    {
      title: "Settings",
      description: "Restaurant config",
      icon: Settings,
      onClick: () => navigate("/settings"),
      color: "text-gray-600 dark:text-gray-400",
    },
  ];

  return (
    <Card className="bg-gradient-to-br from-card via-background to-muted/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="h-1 w-8 bg-gradient-to-r from-primary to-primary/50 rounded-full" />
          Quick Actions
        </CardTitle>
        <CardDescription>Common tasks and shortcuts</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {actions.map((action, index) => (
            <button
              key={action.title}
              onClick={action.onClick}
              className="group relative h-auto flex flex-col items-start gap-3 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-all duration-300 hover:shadow-lg hover:scale-105 hover:-translate-y-1 text-left overflow-hidden"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative z-10 flex items-center justify-between w-full">
                <div className="rounded-lg p-2 bg-gradient-to-br from-background to-muted/50 shadow-sm group-hover:shadow-md transition-shadow">
                  <action.icon className={`h-5 w-5 ${action.color}`} />
                </div>
              </div>
              <div className="relative z-10 space-y-1">
                <div className="font-semibold text-sm">{action.title}</div>
                <div className="text-xs text-muted-foreground line-clamp-2">{action.description}</div>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
