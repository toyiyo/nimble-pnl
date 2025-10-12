import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, Receipt, ChefHat, TrendingUp, ShoppingCart, Users, Settings, FileText } from "lucide-react";

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
    {
      title: "Inventory Audit",
      description: "View transactions",
      icon: FileText,
      onClick: () => navigate("/inventory-audit"),
      color: "text-teal-600 dark:text-teal-400",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>Common tasks and shortcuts</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {actions.map((action) => (
            <Button
              key={action.title}
              variant="outline"
              className="h-auto flex-col items-start gap-2 p-4 hover:bg-accent"
              onClick={action.onClick}
            >
              <action.icon className={`h-5 w-5 ${action.color}`} />
              <div className="text-left">
                <div className="font-semibold text-sm">{action.title}</div>
                <div className="text-xs text-muted-foreground">{action.description}</div>
              </div>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
