// Tools Registry - Defines available tools for the AI agent

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Get available tools based on restaurant and user permissions
 * @param restaurantId The restaurant ID for scoping
 * @param userRole User's role (owner, manager, viewer)
 * @returns Array of tool definitions
 */
export function getTools(restaurantId: string, userRole: string = 'viewer'): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    // Navigation tools - available to all users
    {
      name: 'navigate',
      description: 'Navigate to a specific section of the application. Use this to help users find what they need.',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            enum: [
              'dashboard',
              'inventory',
              'recipes',
              'pos-sales',
              'banking',
              'transactions',
              'accounting',
              'financial-statements',
              'financial-intelligence',
              'reports',
              'integrations',
              'team',
              'settings'
            ],
            description: 'The section to navigate to'
          },
          entity_id: {
            type: 'string',
            description: 'Optional ID of a specific entity (e.g., product ID, recipe ID)'
          }
        },
        required: ['section']
      }
    },
    
    // KPI/Metrics tools - available to all users
    {
      name: 'get_kpis',
      description: 'Get key performance indicators for the restaurant. Returns metrics like revenue, costs, margins, inventory value, etc.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'custom'],
            description: 'The time period for the KPIs'
          },
          start_date: {
            type: 'string',
            format: 'date',
            description: 'Start date for custom period (YYYY-MM-DD)'
          },
          end_date: {
            type: 'string',
            format: 'date',
            description: 'End date for custom period (YYYY-MM-DD)'
          }
        },
        required: ['period']
      }
    },

    // Inventory queries - available to all users
    {
      name: 'get_inventory_status',
      description: 'Get current inventory status including low stock items, total value, and recent changes',
      parameters: {
        type: 'object',
        properties: {
          include_low_stock: {
            type: 'boolean',
            description: 'Include items with low stock',
            default: true
          },
          category: {
            type: 'string',
            description: 'Optional category to filter by'
          }
        }
      }
    },

    // Recipe queries - available to all users
    {
      name: 'get_recipe_analytics',
      description: 'Get analytics for recipes including costs, margins, and profitability',
      parameters: {
        type: 'object',
        properties: {
          recipe_id: {
            type: 'string',
            description: 'Optional specific recipe ID to analyze'
          },
          sort_by: {
            type: 'string',
            enum: ['margin', 'cost', 'name', 'popularity'],
            description: 'How to sort the results'
          }
        }
      }
    },

    // Sales analysis - available to all users
    {
      name: 'get_sales_summary',
      description: 'Get sales summary for a time period, including trends and comparisons',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'yesterday', 'week', 'month', 'quarter', 'year'],
            description: 'The time period for sales summary'
          },
          compare_to_previous: {
            type: 'boolean',
            description: 'Compare to previous period',
            default: true
          }
        },
        required: ['period']
      }
    },
  ];

  // Add report generation for managers and owners
  if (userRole === 'manager' || userRole === 'owner') {
    tools.push({
      name: 'generate_report',
      description: 'Generate a financial or operational report in various formats',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'monthly_pnl',
              'inventory_variance',
              'recipe_profitability',
              'sales_by_category',
              'cash_flow',
              'balance_sheet'
            ],
            description: 'Type of report to generate'
          },
          start_date: {
            type: 'string',
            format: 'date',
            description: 'Start date for the report (YYYY-MM-DD)'
          },
          end_date: {
            type: 'string',
            format: 'date',
            description: 'End date for the report (YYYY-MM-DD)'
          },
          format: {
            type: 'string',
            enum: ['json', 'csv', 'pdf'],
            description: 'Output format',
            default: 'json'
          }
        },
        required: ['type', 'start_date', 'end_date']
      }
    });
  }

  // Add AI-powered insights for owners
  if (userRole === 'owner') {
    tools.push({
      name: 'get_ai_insights',
      description: 'Get AI-powered actionable insights and recommendations for the business based on your data',
      parameters: {
        type: 'object',
        properties: {
          focus_area: {
            type: 'string',
            enum: ['cost_reduction', 'revenue_growth', 'inventory_optimization', 'menu_engineering', 'overall_health'],
            description: 'Area to focus insights on',
            default: 'overall_health'
          }
        }
      }
    });
  }

  return tools;
}

/**
 * Check if user has permission to use a tool
 */
export function canUseTool(toolName: string, userRole: string): boolean {
  // Navigation and basic query tools available to all
  const basicTools = [
    'navigate',
    'get_kpis',
    'get_inventory_status',
    'get_recipe_analytics',
    'get_sales_summary'
  ];

  if (basicTools.includes(toolName)) {
    return true;
  }

  // Report generation for managers and owners
  if (toolName === 'generate_report') {
    return userRole === 'manager' || userRole === 'owner';
  }

  // AI insights only for owners
  if (toolName === 'get_ai_insights') {
    return userRole === 'owner';
  }

  return false;
}
