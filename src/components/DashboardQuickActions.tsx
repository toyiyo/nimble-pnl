import { useNavigate } from "react-router-dom";
import { Package, Receipt, ChefHat, TrendingUp, ShoppingCart, Users, Settings, Wallet } from "lucide-react";

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
    },
    {
      title: "Upload Receipt",
      description: "Import from supplier",
      icon: Receipt,
      onClick: () => navigate("/receipt-import"),
    },
    {
      title: "Manage Recipes",
      description: "Create & edit recipes",
      icon: ChefHat,
      onClick: () => navigate("/recipes"),
    },
    {
      title: "View Reports",
      description: "Analytics & insights",
      icon: TrendingUp,
      onClick: () => navigate("/reports"),
    },
    {
      title: "POS Sales",
      description: "Import sales data",
      icon: ShoppingCart,
      onClick: () => navigate("/pos-sales"),
    },
    {
      title: "Bank Accounts",
      description: "Connect banks",
      icon: Wallet,
      onClick: () => navigate("/banking"),
    },
    {
      title: "Integrations",
      description: "Connect systems",
      icon: Users,
      onClick: () => navigate("/integrations"),
    },
    {
      title: "Settings",
      description: "Restaurant config",
      icon: Settings,
      onClick: () => navigate("/settings"),
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {actions.map((action) => (
        <button
          key={action.title}
          onClick={action.onClick}
          className="group flex flex-col items-start gap-3 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors text-left"
        >
          <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center">
            <action.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
          <div>
            <p className="text-[14px] font-medium text-foreground">{action.title}</p>
            <p className="text-[12px] text-muted-foreground">{action.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
