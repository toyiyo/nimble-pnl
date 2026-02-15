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
              'settings',
              'daily-brief',
              'ops-inbox'
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

    // Labor cost analysis - available to all users
    {
      name: 'get_labor_costs',
      description: 'Get labor cost breakdown by compensation type (hourly, salary, contractor, daily_rate). Shows daily costs, total hours worked, and optional employee-level breakdown. Uses time punches + employee configs for accurate calculations.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'yesterday', 'week', 'month', 'custom'],
            description: 'The time period for labor costs'
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
          },
          include_daily_breakdown: {
            type: 'boolean',
            description: 'Include day-by-day cost breakdown (default: true)',
            default: true
          },
          include_employee_breakdown: {
            type: 'boolean',
            description: 'Include per-employee cost breakdown (default: false)',
            default: false
          }
        },
        required: ['period']
      }
    },

    // Proactive insights - available to all users
    {
      name: 'get_proactive_insights',
      description: 'Check for urgent operational items and the latest daily brief. Call this at the start of new conversations to surface important issues proactively. Returns open ops inbox items ranked by priority and a summary of the most recent daily brief.',
      parameters: {
        type: 'object',
        properties: {
          include_brief: {
            type: 'boolean',
            description: 'Include latest daily brief summary (default: true)',
            default: true
          }
        }
      }
    },

    // Schedule overview - available to all users
    {
      name: 'get_schedule_overview',
      description: 'Get overview of scheduled shifts and projected labor costs. Shows upcoming shifts, conflicts, and estimated labor cost based on scheduled hours.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'tomorrow', 'week', 'month', 'custom'],
            description: 'The time period for schedule overview'
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
          },
          include_projected_costs: {
            type: 'boolean',
            description: 'Include projected labor costs based on scheduled shifts (default: true)',
            default: true
          }
        },
        required: ['period']
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
        name: 'get_payroll_summary',
        description: 'Get payroll summary for a pay period including employee earnings, hours worked, tips, and manual payments. Calculates regular and overtime pay for hourly employees, prorated salary for salaried employees, and contractor payments.',
        parameters: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: ['current_week', 'last_week', 'current_month', 'last_month', 'custom'],
              description: 'The pay period to summarize'
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
            },
            include_employee_details: {
              type: 'boolean',
              description: 'Include per-employee earnings breakdown (default: true)',
              default: true
            }
          },
          required: ['period']
        }
      },
      {
        name: 'get_tip_summary',
        description: 'Get tip pooling summary including daily splits, employee tip earnings, and dispute tracking. Shows approved, draft, and archived tip splits.',
        parameters: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: ['today', 'week', 'month', 'custom'],
              description: 'The time period for tip summary'
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
            },
            status_filter: {
              type: 'string',
              enum: ['all', 'draft', 'approved', 'archived'],
              description: 'Filter by tip split status (default: all)',
              default: 'all'
            }
          },
          required: ['period']
        }
      },
      {
        name: 'get_pending_outflows',
        description: 'Get uncommitted expenses (checks, ACH pending clearance) that haven\'t been matched to bank transactions. Helps track outstanding payments and cash flow commitments.',
        parameters: {
          type: 'object',
          properties: {
            status_filter: {
              type: 'string',
              enum: ['all', 'pending', 'stale_30', 'stale_60', 'stale_90', 'cleared', 'voided'],
              description: 'Filter by outflow status (default: all pending)',
              default: 'all'
            },
            include_category_breakdown: {
              type: 'boolean',
              description: 'Include breakdown by expense category (default: true)',
              default: true
            }
          }
        }
      },
      {
        name: 'get_operating_costs',
        description: 'Get fixed, semi-variable, and variable operating cost breakdown. Includes break-even analysis showing required revenue to cover all costs.',
        parameters: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: ['month', 'quarter', 'year', 'custom'],
              description: 'The time period for operating costs analysis'
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
            },
            include_break_even: {
              type: 'boolean',
              description: 'Include break-even analysis (default: true)',
              default: true
            }
          },
          required: ['period']
        }
      },
      {
        name: 'get_monthly_trends',
        description: 'Get 12-month P&L trends with full cost breakdown including revenue, food cost, labor cost (pending vs actual), and prime cost percentages per month.',
        parameters: {
          type: 'object',
          properties: {
            months_back: {
              type: 'integer',
              description: 'Number of months to look back (default: 12, max: 24)',
              default: 12
            },
            include_percentages: {
              type: 'boolean',
              description: 'Include food/labor/prime cost percentages (default: true)',
              default: true
            }
          }
        }
      },
      {
        name: 'get_expense_health',
        description: 'Get expense health metrics including prime cost %, food cost %, labor cost % with industry benchmarks. Tracks processing fees, uncategorized spend, and cash coverage before payroll.',
        parameters: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: ['week', 'month', 'quarter', 'custom'],
              description: 'The time period for expense health analysis'
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
            },
            bank_account_id: {
              type: 'string',
              description: 'Optional bank account ID to filter by'
            }
          },
          required: ['period']
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

  // Add action execution tools for managers and owners
  if (userRole === 'manager' || userRole === 'owner') {
    tools.push(
      {
        name: 'batch_categorize_transactions',
        description: 'Categorize a batch of uncategorized bank transactions. Call with preview:true first to show what will change, then with confirmed:true after user approves. Returns evidence references.',
        parameters: {
          type: 'object',
          properties: {
            transaction_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of bank transaction IDs to categorize'
            },
            category_id: {
              type: 'string',
              description: 'Chart of accounts category ID to assign'
            },
            preview: {
              type: 'boolean',
              description: 'If true, returns preview of changes without executing',
              default: false
            },
            confirmed: {
              type: 'boolean',
              description: 'If true, executes the categorization. Must call with preview:true first.',
              default: false
            }
          },
          required: ['transaction_ids', 'category_id']
        }
      },
      {
        name: 'batch_categorize_pos_sales',
        description: 'Categorize a batch of uncategorized POS sales items. Call with preview:true first, then confirmed:true after user approves. Returns evidence references.',
        parameters: {
          type: 'object',
          properties: {
            sale_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of unified_sales IDs to categorize'
            },
            category_id: {
              type: 'string',
              description: 'Chart of accounts category ID to assign'
            },
            preview: {
              type: 'boolean',
              description: 'If true, returns preview of changes without executing',
              default: false
            },
            confirmed: {
              type: 'boolean',
              description: 'If true, executes the categorization. Must call with preview:true first.',
              default: false
            }
          },
          required: ['sale_ids', 'category_id']
        }
      },
      {
        name: 'create_categorization_rule',
        description: 'Create a new auto-categorization rule from a pattern. Call with preview:true to show rule details, then confirmed:true to create. Returns evidence references.',
        parameters: {
          type: 'object',
          properties: {
            rule_name: {
              type: 'string',
              description: 'Name for the new rule'
            },
            pattern_type: {
              type: 'string',
              enum: ['exact', 'contains', 'starts_with', 'ends_with', 'regex'],
              description: 'How to match the pattern'
            },
            pattern_value: {
              type: 'string',
              description: 'The pattern to match against transaction descriptions'
            },
            category_id: {
              type: 'string',
              description: 'Chart of accounts category ID to assign when matched'
            },
            source: {
              type: 'string',
              enum: ['bank', 'pos', 'both'],
              description: 'Apply to bank transactions, POS sales, or both (default: both)',
              default: 'both'
            },
            preview: {
              type: 'boolean',
              description: 'If true, returns preview including historical match count',
              default: false
            },
            confirmed: {
              type: 'boolean',
              description: 'If true, creates the rule. Must call with preview:true first.',
              default: false
            }
          },
          required: ['rule_name', 'pattern_type', 'pattern_value', 'category_id']
        }
      },
      {
        name: 'resolve_inbox_item',
        description: 'Mark an ops inbox item as done or dismissed.',
        parameters: {
          type: 'object',
          properties: {
            item_id: {
              type: 'string',
              description: 'The ops_inbox_item ID to resolve'
            },
            resolution: {
              type: 'string',
              enum: ['done', 'dismissed'],
              description: 'How to resolve the item'
            }
          },
          required: ['item_id', 'resolution']
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
  // Navigation and basic query tools available to all users
  const basicTools = [
    'navigate',
    'get_kpis',
    'get_inventory_status',
    'get_recipe_analytics',
    'get_sales_summary',
    'get_inventory_transactions',
    'get_labor_costs',           // Labor costs visible to all (aggregate data)
    'get_schedule_overview',     // Schedule overview visible to all
    'get_proactive_insights'     // Proactive insights for all users
  ];

  if (basicTools.includes(toolName)) {
    return true;
  }

  // Financial intelligence, payroll, tips, and detailed financial tools for managers and owners
  const managerOwnerTools = [
    'get_financial_intelligence',
    'get_bank_transactions',
    'get_financial_statement',
    'generate_report',
    'get_payroll_summary',              // Payroll details - manager+
    'get_tip_summary',                  // Tip pooling details - manager+
    'get_pending_outflows',             // Uncommitted expenses - manager+
    'get_operating_costs',              // Operating cost breakdown - manager+
    'get_monthly_trends',               // Monthly P&L trends - manager+
    'get_expense_health',               // Expense health metrics - manager+
    'batch_categorize_transactions',    // Action: categorize bank txns - manager+
    'batch_categorize_pos_sales',       // Action: categorize POS sales - manager+
    'create_categorization_rule',       // Action: create rules - manager+
    'resolve_inbox_item'                // Action: resolve inbox items - manager+
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
