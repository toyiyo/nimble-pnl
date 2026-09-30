export interface CriticalAlert {
  id: string;
  type: "cash" | "cost" | "inventory" | "operations";
  severity: "critical" | "warning";
  title: string;
  description: string;
  action?: {
    label: string;
    path: string;
  };
}
