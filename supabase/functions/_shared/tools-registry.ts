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
      description: 'Get key performance indicators for the restaurant. Returns comprehensive metrics including revenue, COGS (Cost of Goods Sold / Food Cost), labor cost, prime cost, margins, profitability, and inventory value. Use this to answer questions about costs, profitability, and financial performance.',
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
      description: 'Get analytics for recipes including actual costs, selling prices from sales data, profit margins, and food cost percentages. Prices are calculated from real POS sales data.',
      parameters: {
        type: 'object',
        properties: {
          recipe_id: {
            type: 'string',
            description: 'Optional specific recipe ID to analyze'
          },
          sort_by: {
            type: 'string',
            enum: ['margin', 'cost', 'name', 'sales'],
            description: 'How to sort the results (margin = profit margin, sales = total revenue)'
          },
          days_back: {
            type: 'integer',
            description: 'Number of days to look back for sales data (default: 30)',
            default: 30
          },
          include_zero_sales: {
            type: 'boolean',
            description: 'Include recipes with no sales data (default: false)',
            default: false
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
          },
          include_items: {
            type: 'boolean',
            description: 'Include breakdown by item',
            default: false
          }
        },
        required: ['period']
      }
    },

    // Inventory transactions audit - available to all users
    {
      name: 'get_inventory_transactions',
      description: 'Query and analyze inventory audit trail including purchases, usage, adjustments, waste, and transfers. Returns detailed transaction history with costs and reasons.',
      parameters: {
        type: 'object',
        properties: {
          transaction_type: {
            type: 'string',
            enum: ['purchase', 'usage', 'adjustment', 'waste', 'transfer', 'all'],
            description: 'Type of inventory transaction to query (default: all)',
            default: 'all'
          },
          product_id: {
            type: 'string',
            description: 'Filter by specific product ID'
          },
          start_date: {
            type: 'string',
            format: 'date',
            description: 'Start date for transactions (YYYY-MM-DD)'
          },
          end_date: {
            type: 'string',
            format: 'date',
            description: 'End date for transactions (YYYY-MM-DD)'
          },
          days_back: {
            type: 'integer',
            description: 'Number of days to look back (default: 30, max: 90)',
            default: 30
          },
          supplier_id: {
            type: 'string',
            description: 'Filter by specific supplier'
          },
          min_cost: {
            type: 'number',
            description: 'Minimum transaction cost'
          },
          max_cost: {
            type: 'number',
            description: 'Maximum transaction cost'
          },
          include_summary: {
            type: 'boolean',
            description: 'Include summary statistics (default: true)',
            default: true
          },
          group_by: {
            type: 'string',
            enum: ['type', 'product', 'supplier', 'date', 'none'],
            description: 'How to group the results (default: none)',
            default: 'none'
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of transactions to return (default: 50, max: 200)',
            default: 50
          }
        }
      }
    },
  ];

  // Add financial intelligence for managers and owners
  if (userRole === 'manager' || userRole === 'owner') {
    tools.push(
      {
        name: 'get_financial_intelligence',
        description: 'Get comprehensive financial intelligence including cash flow metrics, revenue health, spending analysis, liquidity metrics, and predictions',
        parameters: {
          type: 'object',
          properties: {
            analysis_type: {
              type: 'string',
              enum: ['cash_flow', 'revenue_health', 'spending', 'liquidity', 'predictions', 'all'],
              description: 'Type of financial analysis to perform'
            },
            start_date: {
              type: 'string',
              format: 'date',
              description: 'Start date for analysis (YYYY-MM-DD)'
            },
            end_date: {
              type: 'string',
              format: 'date',
              description: 'End date for analysis (YYYY-MM-DD)'
            },
            bank_account_id: {
              type: 'string',
              description: 'Optional bank account ID to filter by'
            }
          },
          required: ['analysis_type', 'start_date', 'end_date']
        }
      },
      {
        name: 'get_bank_transactions',
        description: 'Query and analyze bank transactions with filters',
        parameters: {
          type: 'object',
          properties: {
            start_date: {
              type: 'string',
              format: 'date',
              description: 'Start date for transactions (YYYY-MM-DD)'
            },
            end_date: {
              type: 'string',
              format: 'date',
              description: 'End date for transactions (YYYY-MM-DD)'
            },
            bank_account_id: {
              type: 'string',
              description: 'Filter by specific bank account'
            },
            category_id: {
              type: 'string',
              description: 'Filter by chart of accounts category'
            },
            min_amount: {
              type: 'number',
              description: 'Minimum transaction amount'
            },
            max_amount: {
              type: 'number',
              description: 'Maximum transaction amount'
            },
            is_categorized: {
              type: 'boolean',
              description: 'Filter by categorization status'
            },
            limit: {
              type: 'integer',
              description: 'Maximum number of transactions to return',
              default: 50
            }
          },
          required: ['start_date', 'end_date']
        }
      },
      {
        name: 'get_financial_statement',
        description: 'Get detailed financial statements including income statement, balance sheet, cash flow statement, or trial balance',
        parameters: {
          type: 'object',
          properties: {
            statement_type: {
              type: 'string',
              enum: ['income_statement', 'balance_sheet', 'cash_flow', 'trial_balance'],
              description: 'Type of financial statement to retrieve'
            },
            start_date: {
              type: 'string',
              format: 'date',
              description: 'Start date for the statement (YYYY-MM-DD)'
            },
            end_date: {
              type: 'string',
              format: 'date',
              description: 'End date for the statement (YYYY-MM-DD)'
            }
          },
          required: ['statement_type', 'start_date', 'end_date']
        }
      },
      {
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
      }
    );
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
    'get_sales_summary',
    'get_inventory_transactions'
  ];

  if (basicTools.includes(toolName)) {
    return true;
  }

  // Financial intelligence, bank transactions, financial statements, and report generation for managers and owners
  const managerOwnerTools = [
    'get_financial_intelligence',
    'get_bank_transactions',
    'get_financial_statement',
    'generate_report'
  ];
  
  if (managerOwnerTools.includes(toolName)) {
    return userRole === 'manager' || userRole === 'owner';
  }

  // AI insights only for owners
  if (toolName === 'get_ai_insights') {
    return userRole === 'owner';
  }

  return false;
}
