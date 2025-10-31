export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      auto_deduction_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_deduction_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_account_balances: {
        Row: {
          account_mask: string | null
          account_name: string
          account_type: string | null
          as_of_date: string
          available_balance: number | null
          connected_bank_id: string
          created_at: string
          currency: string
          current_balance: number
          id: string
          is_active: boolean
          stripe_financial_account_id: string | null
          updated_at: string
        }
        Insert: {
          account_mask?: string | null
          account_name: string
          account_type?: string | null
          as_of_date?: string
          available_balance?: number | null
          connected_bank_id: string
          created_at?: string
          currency?: string
          current_balance?: number
          id?: string
          is_active?: boolean
          stripe_financial_account_id?: string | null
          updated_at?: string
        }
        Update: {
          account_mask?: string | null
          account_name?: string
          account_type?: string | null
          as_of_date?: string
          available_balance?: number | null
          connected_bank_id?: string
          created_at?: string
          currency?: string
          current_balance?: number
          id?: string
          is_active?: boolean
          stripe_financial_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_account_balances_connected_bank_id_fkey"
            columns: ["connected_bank_id"]
            isOneToOne: false
            referencedRelation: "connected_banks"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transaction_splits: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          description: string | null
          id: string
          transaction_id: string
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string
          description?: string | null
          id?: string
          transaction_id: string
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          description?: string | null
          id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transaction_splits_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transaction_splits_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          ai_confidence: string | null
          ai_reasoning: string | null
          amount: number
          category_id: string | null
          connected_bank_id: string
          created_at: string
          currency: string
          description: string
          excluded_reason: string | null
          id: string
          inventory_transaction_id: string | null
          is_categorized: boolean
          is_reconciled: boolean
          is_split: boolean
          is_transfer: boolean
          match_confidence: number | null
          matched_at: string | null
          matched_by: string | null
          merchant_name: string | null
          normalized_payee: string | null
          notes: string | null
          posted_date: string | null
          raw_data: Json | null
          receipt_id: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["transaction_status_enum"]
          stripe_transaction_id: string
          suggested_category_id: string | null
          suggested_payee: string | null
          supplier_id: string | null
          transaction_date: string
          transaction_type: string | null
          transfer_pair_id: string | null
          updated_at: string
        }
        Insert: {
          ai_confidence?: string | null
          ai_reasoning?: string | null
          amount: number
          category_id?: string | null
          connected_bank_id: string
          created_at?: string
          currency?: string
          description: string
          excluded_reason?: string | null
          id?: string
          inventory_transaction_id?: string | null
          is_categorized?: boolean
          is_reconciled?: boolean
          is_split?: boolean
          is_transfer?: boolean
          match_confidence?: number | null
          matched_at?: string | null
          matched_by?: string | null
          merchant_name?: string | null
          normalized_payee?: string | null
          notes?: string | null
          posted_date?: string | null
          raw_data?: Json | null
          receipt_id?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          restaurant_id: string
          status?: Database["public"]["Enums"]["transaction_status_enum"]
          stripe_transaction_id: string
          suggested_category_id?: string | null
          suggested_payee?: string | null
          supplier_id?: string | null
          transaction_date: string
          transaction_type?: string | null
          transfer_pair_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_confidence?: string | null
          ai_reasoning?: string | null
          amount?: number
          category_id?: string | null
          connected_bank_id?: string
          created_at?: string
          currency?: string
          description?: string
          excluded_reason?: string | null
          id?: string
          inventory_transaction_id?: string | null
          is_categorized?: boolean
          is_reconciled?: boolean
          is_split?: boolean
          is_transfer?: boolean
          match_confidence?: number | null
          matched_at?: string | null
          matched_by?: string | null
          merchant_name?: string | null
          normalized_payee?: string | null
          notes?: string | null
          posted_date?: string | null
          raw_data?: Json | null
          receipt_id?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          restaurant_id?: string
          status?: Database["public"]["Enums"]["transaction_status_enum"]
          stripe_transaction_id?: string
          suggested_category_id?: string | null
          suggested_payee?: string | null
          supplier_id?: string | null
          transaction_date?: string
          transaction_type?: string | null
          transfer_pair_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_connected_bank_id_fkey"
            columns: ["connected_bank_id"]
            isOneToOne: false
            referencedRelation: "connected_banks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_inventory_transaction_id_fkey"
            columns: ["inventory_transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipt_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_suggested_category_id_fkey"
            columns: ["suggested_category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_transfer_pair_id_fkey"
            columns: ["transfer_pair_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          account_code: string
          account_name: string
          account_subtype: Database["public"]["Enums"]["account_subtype_enum"]
          account_type: Database["public"]["Enums"]["account_type_enum"]
          created_at: string
          current_balance: number
          description: string | null
          id: string
          is_active: boolean
          is_system_account: boolean
          location_code: string | null
          normal_balance: string
          parent_account_id: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          account_code: string
          account_name: string
          account_subtype: Database["public"]["Enums"]["account_subtype_enum"]
          account_type: Database["public"]["Enums"]["account_type_enum"]
          created_at?: string
          current_balance?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_system_account?: boolean
          location_code?: string | null
          normal_balance: string
          parent_account_id?: string | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          account_code?: string
          account_name?: string
          account_subtype?: Database["public"]["Enums"]["account_subtype_enum"]
          account_type?: Database["public"]["Enums"]["account_type_enum"]
          created_at?: string
          current_balance?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_system_account?: boolean
          location_code?: string | null
          normal_balance?: string
          parent_account_id?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      clover_connections: {
        Row: {
          access_token: string
          connected_at: string
          created_at: string
          environment: string
          expires_at: string | null
          id: string
          merchant_id: string
          refresh_token: string | null
          region: string
          restaurant_id: string
          scopes: string[]
          updated_at: string
        }
        Insert: {
          access_token: string
          connected_at?: string
          created_at?: string
          environment?: string
          expires_at?: string | null
          id?: string
          merchant_id: string
          refresh_token?: string | null
          region?: string
          restaurant_id: string
          scopes?: string[]
          updated_at?: string
        }
        Update: {
          access_token?: string
          connected_at?: string
          created_at?: string
          environment?: string
          expires_at?: string | null
          id?: string
          merchant_id?: string
          refresh_token?: string | null
          region?: string
          restaurant_id?: string
          scopes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clover_connections_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      clover_locations: {
        Row: {
          address: Json | null
          connection_id: string
          created_at: string
          currency: string | null
          id: string
          location_id: string
          name: string
          restaurant_id: string
          timezone: string | null
          updated_at: string
        }
        Insert: {
          address?: Json | null
          connection_id: string
          created_at?: string
          currency?: string | null
          id?: string
          location_id: string
          name: string
          restaurant_id: string
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          address?: Json | null
          connection_id?: string
          created_at?: string
          currency?: string | null
          id?: string
          location_id?: string
          name?: string
          restaurant_id?: string
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clover_locations_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "clover_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clover_locations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      clover_order_line_items: {
        Row: {
          alternate_name: string | null
          category_id: string | null
          created_at: string
          id: string
          is_revenue: boolean | null
          item_id: string | null
          line_item_id: string
          name: string
          note: string | null
          order_id: string
          price: number | null
          printed: boolean | null
          raw_json: Json | null
          restaurant_id: string
          unit_quantity: number | null
          updated_at: string
        }
        Insert: {
          alternate_name?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          is_revenue?: boolean | null
          item_id?: string | null
          line_item_id: string
          name: string
          note?: string | null
          order_id: string
          price?: number | null
          printed?: boolean | null
          raw_json?: Json | null
          restaurant_id: string
          unit_quantity?: number | null
          updated_at?: string
        }
        Update: {
          alternate_name?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          is_revenue?: boolean | null
          item_id?: string | null
          line_item_id?: string
          name?: string
          note?: string | null
          order_id?: string
          price?: number | null
          printed?: boolean | null
          raw_json?: Json | null
          restaurant_id?: string
          unit_quantity?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clover_order_line_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      clover_orders: {
        Row: {
          closed_time: string | null
          created_at: string
          created_time: string | null
          discount_amount: number | null
          employee_id: string | null
          id: string
          merchant_id: string
          modified_time: string | null
          order_id: string
          raw_json: Json | null
          restaurant_id: string
          service_charge_amount: number | null
          service_date: string | null
          state: string | null
          synced_at: string
          tax_amount: number | null
          tip_amount: number | null
          total: number | null
          updated_at: string
        }
        Insert: {
          closed_time?: string | null
          created_at?: string
          created_time?: string | null
          discount_amount?: number | null
          employee_id?: string | null
          id?: string
          merchant_id: string
          modified_time?: string | null
          order_id: string
          raw_json?: Json | null
          restaurant_id: string
          service_charge_amount?: number | null
          service_date?: string | null
          state?: string | null
          synced_at?: string
          tax_amount?: number | null
          tip_amount?: number | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          closed_time?: string | null
          created_at?: string
          created_time?: string | null
          discount_amount?: number | null
          employee_id?: string | null
          id?: string
          merchant_id?: string
          modified_time?: string | null
          order_id?: string
          raw_json?: Json | null
          restaurant_id?: string
          service_charge_amount?: number | null
          service_date?: string | null
          state?: string | null
          synced_at?: string
          tax_amount?: number | null
          tip_amount?: number | null
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clover_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_banks: {
        Row: {
          connected_at: string
          created_at: string
          disconnected_at: string | null
          id: string
          institution_logo_url: string | null
          institution_name: string
          last_sync_at: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["bank_connection_status_enum"]
          stripe_financial_account_id: string
          sync_error: string | null
          updated_at: string
        }
        Insert: {
          connected_at?: string
          created_at?: string
          disconnected_at?: string | null
          id?: string
          institution_logo_url?: string | null
          institution_name: string
          last_sync_at?: string | null
          restaurant_id: string
          status?: Database["public"]["Enums"]["bank_connection_status_enum"]
          stripe_financial_account_id: string
          sync_error?: string | null
          updated_at?: string
        }
        Update: {
          connected_at?: string
          created_at?: string
          disconnected_at?: string | null
          id?: string
          institution_logo_url?: string | null
          institution_name?: string
          last_sync_at?: string | null
          restaurant_id?: string
          status?: Database["public"]["Enums"]["bank_connection_status_enum"]
          stripe_financial_account_id?: string
          sync_error?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connected_banks_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_food_costs: {
        Row: {
          created_at: string
          date: string
          id: string
          inventory_adjustments: number
          purchases: number
          restaurant_id: string
          source: string
          total_food_cost: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          inventory_adjustments?: number
          purchases?: number
          restaurant_id: string
          source?: string
          total_food_cost?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          inventory_adjustments?: number
          purchases?: number
          restaurant_id?: string
          source?: string
          total_food_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_food_costs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_labor_costs: {
        Row: {
          benefits: number
          created_at: string
          date: string
          hourly_wages: number
          id: string
          restaurant_id: string
          salary_wages: number
          source: string
          total_hours: number | null
          total_labor_cost: number | null
          updated_at: string
        }
        Insert: {
          benefits?: number
          created_at?: string
          date: string
          hourly_wages?: number
          id?: string
          restaurant_id: string
          salary_wages?: number
          source?: string
          total_hours?: number | null
          total_labor_cost?: number | null
          updated_at?: string
        }
        Update: {
          benefits?: number
          created_at?: string
          date?: string
          hourly_wages?: number
          id?: string
          restaurant_id?: string
          salary_wages?: number
          source?: string
          total_hours?: number | null
          total_labor_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_labor_costs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_pnl: {
        Row: {
          created_at: string
          date: string
          food_cost: number
          food_cost_percentage: number | null
          gross_profit: number | null
          id: string
          labor_cost: number
          labor_cost_percentage: number | null
          net_revenue: number
          prime_cost: number | null
          prime_cost_percentage: number | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          food_cost?: number
          food_cost_percentage?: number | null
          gross_profit?: number | null
          id?: string
          labor_cost?: number
          labor_cost_percentage?: number | null
          net_revenue?: number
          prime_cost?: number | null
          prime_cost_percentage?: number | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          food_cost?: number
          food_cost_percentage?: number | null
          gross_profit?: number | null
          id?: string
          labor_cost?: number
          labor_cost_percentage?: number | null
          net_revenue?: number
          prime_cost?: number | null
          prime_cost_percentage?: number | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_pnl_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_sales: {
        Row: {
          comps: number
          created_at: string
          date: string
          discounts: number
          gross_revenue: number
          id: string
          net_revenue: number | null
          restaurant_id: string
          source: string
          transaction_count: number | null
          updated_at: string
        }
        Insert: {
          comps?: number
          created_at?: string
          date: string
          discounts?: number
          gross_revenue?: number
          id?: string
          net_revenue?: number | null
          restaurant_id: string
          source?: string
          transaction_count?: number | null
          updated_at?: string
        }
        Update: {
          comps?: number
          created_at?: string
          date?: string
          discounts?: number
          gross_revenue?: number
          id?: string
          net_revenue?: number | null
          restaurant_id?: string
          source?: string
          transaction_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_sales_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_settings: {
        Row: {
          auto_provisioning: boolean
          created_at: string
          default_role: string | null
          id: string
          restaurant_id: string
          scim_enabled: boolean
          scim_endpoint: string | null
          scim_token: string | null
          sso_domain: string | null
          sso_enabled: boolean
          sso_provider: string | null
          updated_at: string
        }
        Insert: {
          auto_provisioning?: boolean
          created_at?: string
          default_role?: string | null
          id?: string
          restaurant_id: string
          scim_enabled?: boolean
          scim_endpoint?: string | null
          scim_token?: string | null
          sso_domain?: string | null
          sso_enabled?: boolean
          sso_provider?: string | null
          updated_at?: string
        }
        Update: {
          auto_provisioning?: boolean
          created_at?: string
          default_role?: string | null
          id?: string
          restaurant_id?: string
          scim_enabled?: boolean
          scim_endpoint?: string | null
          scim_token?: string | null
          sso_domain?: string | null
          sso_enabled?: boolean
          sso_provider?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      financial_statement_cache: {
        Row: {
          end_date: string
          generated_at: string
          id: string
          restaurant_id: string
          start_date: string
          statement_data: Json
          statement_type: string
        }
        Insert: {
          end_date: string
          generated_at?: string
          id?: string
          restaurant_id: string
          start_date: string
          statement_data: Json
          statement_type: string
        }
        Update: {
          end_date?: string
          generated_at?: string
          id?: string
          restaurant_id?: string
          start_date?: string
          statement_data?: Json
          statement_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_statement_cache_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          is_closed: boolean
          period_end: string
          period_start: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          is_closed?: boolean
          period_end: string
          period_start: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          is_closed?: boolean
          period_end?: string
          period_start?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_periods_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_reconciliations: {
        Row: {
          created_at: string
          id: string
          items_with_variance: number | null
          notes: string | null
          performed_by: string
          reconciliation_date: string
          restaurant_id: string
          started_at: string
          status: string
          submitted_at: string | null
          total_items_counted: number | null
          total_shrinkage_value: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          items_with_variance?: number | null
          notes?: string | null
          performed_by: string
          reconciliation_date?: string
          restaurant_id: string
          started_at?: string
          status?: string
          submitted_at?: string | null
          total_items_counted?: number | null
          total_shrinkage_value?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          items_with_variance?: number | null
          notes?: string | null
          performed_by?: string
          reconciliation_date?: string
          restaurant_id?: string
          started_at?: string
          status?: string
          submitted_at?: string | null
          total_items_counted?: number | null
          total_shrinkage_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reconciliations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          created_at: string
          expiry_date: string | null
          id: string
          location: string | null
          lot_number: string | null
          performed_by: string | null
          product_id: string
          quantity: number
          reason: string | null
          reference_id: string | null
          restaurant_id: string
          supplier_id: string | null
          total_cost: number | null
          transaction_type: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          location?: string | null
          lot_number?: string | null
          performed_by?: string | null
          product_id: string
          quantity: number
          reason?: string | null
          reference_id?: string | null
          restaurant_id: string
          supplier_id?: string | null
          total_cost?: number | null
          transaction_type: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          location?: string | null
          lot_number?: string | null
          performed_by?: string | null
          product_id?: string
          quantity?: number
          reason?: string | null
          reference_id?: string | null
          restaurant_id?: string
          supplier_id?: string | null
          total_cost?: number | null
          transaction_type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          hashed_token: string | null
          id: string
          invited_by: string
          restaurant_id: string
          role: string
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          hashed_token?: string | null
          id?: string
          invited_by: string
          restaurant_id: string
          role?: string
          status?: string
          token: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          hashed_token?: string | null
          id?: string
          invited_by?: string
          restaurant_id?: string
          role?: string
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          entry_date: string
          entry_number: string
          id: string
          is_balanced: boolean | null
          reference_id: string | null
          reference_type: string | null
          restaurant_id: string
          total_credit: number
          total_debit: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          entry_date: string
          entry_number: string
          id?: string
          is_balanced?: boolean | null
          reference_id?: string | null
          reference_type?: string | null
          restaurant_id: string
          total_credit?: number
          total_debit?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          entry_date?: string
          entry_number?: string
          id?: string
          is_balanced?: boolean | null
          reference_id?: string | null
          reference_type?: string | null
          restaurant_id?: string
          total_credit?: number
          total_debit?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_lines: {
        Row: {
          account_id: string
          created_at: string
          credit_amount: number
          debit_amount: number
          description: string | null
          id: string
          journal_entry_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit_amount?: number
          debit_amount?: number
          description?: string | null
          id?: string
          journal_entry_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit_amount?: number
          debit_amount?: number
          description?: string | null
          id?: string
          journal_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sales: {
        Row: {
          created_at: string
          id: string
          pos_item_id: string | null
          pos_item_name: string
          quantity: number
          raw_data: Json | null
          restaurant_id: string
          sale_date: string
          sale_price: number | null
          sale_time: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          pos_item_id?: string | null
          pos_item_name: string
          quantity?: number
          raw_data?: Json | null
          restaurant_id: string
          sale_date: string
          sale_price?: number | null
          sale_time?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          pos_item_id?: string | null
          pos_item_name?: string
          quantity?: number
          raw_data?: Json | null
          restaurant_id?: string
          sale_date?: string
          sale_price?: number | null
          sale_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_sales_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_abbreviations: {
        Row: {
          abbreviation: string
          created_at: string | null
          full_term: string
          id: string
          restaurant_id: string
        }
        Insert: {
          abbreviation: string
          created_at?: string | null
          full_term: string
          id?: string
          restaurant_id: string
        }
        Update: {
          abbreviation?: string
          created_at?: string | null
          full_term?: string
          id?: string
          restaurant_id?: string
        }
        Relationships: []
      }
      product_suppliers: {
        Row: {
          average_unit_cost: number | null
          created_at: string | null
          id: string
          is_preferred: boolean | null
          last_purchase_date: string | null
          last_purchase_quantity: number | null
          last_unit_cost: number | null
          lead_time_days: number | null
          minimum_order_quantity: number | null
          notes: string | null
          product_id: string
          purchase_count: number | null
          restaurant_id: string
          supplier_id: string
          supplier_product_name: string | null
          supplier_sku: string | null
          updated_at: string | null
        }
        Insert: {
          average_unit_cost?: number | null
          created_at?: string | null
          id?: string
          is_preferred?: boolean | null
          last_purchase_date?: string | null
          last_purchase_quantity?: number | null
          last_unit_cost?: number | null
          lead_time_days?: number | null
          minimum_order_quantity?: number | null
          notes?: string | null
          product_id: string
          purchase_count?: number | null
          restaurant_id: string
          supplier_id: string
          supplier_product_name?: string | null
          supplier_sku?: string | null
          updated_at?: string | null
        }
        Update: {
          average_unit_cost?: number | null
          created_at?: string | null
          id?: string
          is_preferred?: boolean | null
          last_purchase_date?: string | null
          last_purchase_quantity?: number | null
          last_unit_cost?: number | null
          lead_time_days?: number | null
          minimum_order_quantity?: number | null
          notes?: string | null
          product_id?: string
          purchase_count?: number | null
          restaurant_id?: string
          supplier_id?: string
          supplier_product_name?: string | null
          supplier_sku?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_suppliers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_suppliers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode_data: Json | null
          brand: string | null
          bulk_purchase_unit: string | null
          category: string | null
          conversion_factor: number | null
          cost_per_unit: number | null
          created_at: string
          current_stock: number | null
          description: string | null
          gtin: string | null
          id: string
          image_url: string | null
          individual_unit: string | null
          individual_unit_size: number | null
          items_per_package: number | null
          name: string
          package_qty: number | null
          par_level_max: number | null
          par_level_min: number | null
          pos_item_name: string | null
          receipt_item_names: string[] | null
          reorder_point: number | null
          restaurant_id: string
          search_vector: unknown
          searchable_text: string | null
          size_unit: string | null
          size_value: number | null
          sku: string
          supplier_id: string | null
          supplier_name: string | null
          supplier_sku: string | null
          uom_purchase: string | null
          uom_recipe: string | null
          updated_at: string
        }
        Insert: {
          barcode_data?: Json | null
          brand?: string | null
          bulk_purchase_unit?: string | null
          category?: string | null
          conversion_factor?: number | null
          cost_per_unit?: number | null
          created_at?: string
          current_stock?: number | null
          description?: string | null
          gtin?: string | null
          id?: string
          image_url?: string | null
          individual_unit?: string | null
          individual_unit_size?: number | null
          items_per_package?: number | null
          name: string
          package_qty?: number | null
          par_level_max?: number | null
          par_level_min?: number | null
          pos_item_name?: string | null
          receipt_item_names?: string[] | null
          reorder_point?: number | null
          restaurant_id: string
          search_vector?: unknown
          searchable_text?: string | null
          size_unit?: string | null
          size_value?: number | null
          sku: string
          supplier_id?: string | null
          supplier_name?: string | null
          supplier_sku?: string | null
          uom_purchase?: string | null
          uom_recipe?: string | null
          updated_at?: string
        }
        Update: {
          barcode_data?: Json | null
          brand?: string | null
          bulk_purchase_unit?: string | null
          category?: string | null
          conversion_factor?: number | null
          cost_per_unit?: number | null
          created_at?: string
          current_stock?: number | null
          description?: string | null
          gtin?: string | null
          id?: string
          image_url?: string | null
          individual_unit?: string | null
          individual_unit_size?: number | null
          items_per_package?: number | null
          name?: string
          package_qty?: number | null
          par_level_max?: number | null
          par_level_min?: number | null
          pos_item_name?: string | null
          receipt_item_names?: string[] | null
          reorder_point?: number | null
          restaurant_id?: string
          search_vector?: unknown
          searchable_text?: string | null
          size_unit?: string | null
          size_value?: number | null
          sku?: string
          supplier_id?: string | null
          supplier_name?: string | null
          supplier_sku?: string | null
          uom_purchase?: string | null
          uom_recipe?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          restaurant_name: string | null
          role: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          restaurant_name?: string | null
          role?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          restaurant_name?: string | null
          role?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_log: {
        Row: {
          action_type: string
          created_at: string | null
          id: string
          ip_address: unknown
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string | null
          id?: string
          ip_address?: unknown
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string | null
          id?: string
          ip_address?: unknown
          user_id?: string
        }
        Relationships: []
      }
      receipt_imports: {
        Row: {
          created_at: string
          file_name: string | null
          file_size: number | null
          id: string
          processed_at: string | null
          processed_by: string | null
          raw_file_url: string | null
          raw_ocr_data: Json | null
          restaurant_id: string
          status: string
          supplier_id: string | null
          total_amount: number | null
          updated_at: string
          vendor_name: string | null
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          raw_file_url?: string | null
          raw_ocr_data?: Json | null
          restaurant_id: string
          status?: string
          supplier_id?: string | null
          total_amount?: number | null
          updated_at?: string
          vendor_name?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          raw_file_url?: string | null
          raw_ocr_data?: Json | null
          restaurant_id?: string
          status?: string
          supplier_id?: string | null
          total_amount?: number | null
          updated_at?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_imports_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_line_items: {
        Row: {
          confidence_score: number | null
          created_at: string
          id: string
          line_sequence: number | null
          mapping_status: string
          matched_product_id: string | null
          parsed_name: string | null
          parsed_price: number | null
          parsed_quantity: number | null
          parsed_unit: string | null
          raw_text: string
          receipt_id: string
          updated_at: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          line_sequence?: number | null
          mapping_status?: string
          matched_product_id?: string | null
          parsed_name?: string | null
          parsed_price?: number | null
          parsed_quantity?: number | null
          parsed_unit?: string | null
          raw_text: string
          receipt_id: string
          updated_at?: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          line_sequence?: number | null
          mapping_status?: string
          matched_product_id?: string | null
          parsed_name?: string | null
          parsed_price?: number | null
          parsed_quantity?: number | null
          parsed_unit?: string | null
          raw_text?: string
          receipt_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_line_items_matched_product_id_fkey"
            columns: ["matched_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_line_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipt_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          product_id: string
          quantity: number
          recipe_id: string
          unit: Database["public"]["Enums"]["measurement_unit"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          recipe_id: string
          unit: Database["public"]["Enums"]["measurement_unit"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          recipe_id?: string
          unit?: Database["public"]["Enums"]["measurement_unit"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          estimated_cost: number | null
          id: string
          is_active: boolean | null
          name: string
          pos_item_id: string | null
          pos_item_name: string | null
          restaurant_id: string
          serving_size: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_cost?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          pos_item_id?: string | null
          pos_item_name?: string | null
          restaurant_id: string
          serving_size?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_cost?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          pos_item_id?: string | null
          pos_item_name?: string | null
          restaurant_id?: string
          serving_size?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_boundaries: {
        Row: {
          balance_start_date: string
          created_at: string
          id: string
          last_reconciled_at: string
          opening_balance: number
          opening_balance_journal_entry_id: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          balance_start_date: string
          created_at?: string
          id?: string
          last_reconciled_at?: string
          opening_balance?: number
          opening_balance_journal_entry_id?: string | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          balance_start_date?: string
          created_at?: string
          id?: string
          last_reconciled_at?: string
          opening_balance?: number
          opening_balance_journal_entry_id?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_boundaries_opening_balance_journal_entry_id_fkey"
            columns: ["opening_balance_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_boundaries_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_items: {
        Row: {
          actual_quantity: number | null
          counted_at: string | null
          created_at: string
          expected_quantity: number
          id: string
          notes: string | null
          product_id: string
          reconciliation_id: string
          unit_cost: number
          updated_at: string
          variance: number | null
          variance_value: number | null
        }
        Insert: {
          actual_quantity?: number | null
          counted_at?: string | null
          created_at?: string
          expected_quantity: number
          id?: string
          notes?: string | null
          product_id: string
          reconciliation_id: string
          unit_cost: number
          updated_at?: string
          variance?: number | null
          variance_value?: number | null
        }
        Update: {
          actual_quantity?: number | null
          counted_at?: string | null
          created_at?: string
          expected_quantity?: number
          id?: string
          notes?: string | null
          product_id?: string
          reconciliation_id?: string
          unit_cost?: number
          updated_at?: string
          variance?: number | null
          variance_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "inventory_reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_inventory_settings: {
        Row: {
          created_at: string
          default_markup_multiplier: number
          id: string
          markup_by_category: Json | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_markup_multiplier?: number
          id?: string
          markup_by_category?: Json | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_markup_multiplier?: number
          id?: string
          markup_by_category?: Json | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_inventory_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          address: string | null
          created_at: string
          cuisine_type: string | null
          id: string
          name: string
          phone: string | null
          stripe_customer_id: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          cuisine_type?: string | null
          id?: string
          name: string
          phone?: string | null
          stripe_customer_id?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          cuisine_type?: string | null
          id?: string
          name?: string
          phone?: string | null
          stripe_customer_id?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      scim_group_members: {
        Row: {
          created_at: string
          group_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scim_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "scim_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scim_group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "scim_users"
            referencedColumns: ["id"]
          },
        ]
      }
      scim_groups: {
        Row: {
          created_at: string
          display_name: string
          external_id: string | null
          id: string
          restaurant_id: string
          scim_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          external_id?: string | null
          id?: string
          restaurant_id: string
          scim_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          external_id?: string | null
          id?: string
          restaurant_id?: string
          scim_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      scim_users: {
        Row: {
          active: boolean
          created_at: string
          email: string
          external_id: string | null
          family_name: string | null
          given_name: string | null
          id: string
          restaurant_id: string
          scim_id: string
          updated_at: string
          user_id: string | null
          user_name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          external_id?: string | null
          family_name?: string | null
          given_name?: string | null
          id?: string
          restaurant_id: string
          scim_id: string
          updated_at?: string
          user_id?: string | null
          user_name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          external_id?: string | null
          family_name?: string | null
          given_name?: string | null
          id?: string
          restaurant_id?: string
          scim_id?: string
          updated_at?: string
          user_id?: string | null
          user_name?: string
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_address: unknown
          metadata: Json | null
          restaurant_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          restaurant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          restaurant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_audit_log_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      security_events: {
        Row: {
          created_at: string | null
          details: Json | null
          event_type: string
          id: string
          ip_address: unknown
          restaurant_id: string | null
          severity: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          details?: Json | null
          event_type: string
          id?: string
          ip_address?: unknown
          restaurant_id?: string | null
          severity?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          details?: Json | null
          event_type?: string
          id?: string
          ip_address?: unknown
          restaurant_id?: string | null
          severity?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      square_catalog_objects: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          modifier_list_ids: string[] | null
          name: string | null
          object_id: string
          object_type: string
          parent_id: string | null
          raw_json: Json | null
          restaurant_id: string
          sku: string | null
          updated_at: string
          version: number | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          modifier_list_ids?: string[] | null
          name?: string | null
          object_id: string
          object_type: string
          parent_id?: string | null
          raw_json?: Json | null
          restaurant_id: string
          sku?: string | null
          updated_at?: string
          version?: number | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          modifier_list_ids?: string[] | null
          name?: string | null
          object_id?: string
          object_type?: string
          parent_id?: string | null
          raw_json?: Json | null
          restaurant_id?: string
          sku?: string | null
          updated_at?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "square_catalog_objects_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      square_connections: {
        Row: {
          access_token: string
          connected_at: string
          created_at: string
          expires_at: string | null
          id: string
          last_refreshed_at: string | null
          merchant_id: string
          refresh_token: string | null
          restaurant_id: string
          scopes: string[] | null
          updated_at: string
        }
        Insert: {
          access_token: string
          connected_at?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_refreshed_at?: string | null
          merchant_id: string
          refresh_token?: string | null
          restaurant_id: string
          scopes?: string[] | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          connected_at?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_refreshed_at?: string | null
          merchant_id?: string
          refresh_token?: string | null
          restaurant_id?: string
          scopes?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_connections_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      square_locations: {
        Row: {
          address: Json | null
          connection_id: string
          created_at: string
          currency: string | null
          id: string
          location_id: string
          name: string | null
          restaurant_id: string
          timezone: string | null
          updated_at: string
        }
        Insert: {
          address?: Json | null
          connection_id: string
          created_at?: string
          currency?: string | null
          id?: string
          location_id: string
          name?: string | null
          restaurant_id: string
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          address?: Json | null
          connection_id?: string
          created_at?: string
          currency?: string | null
          id?: string
          location_id?: string
          name?: string | null
          restaurant_id?: string
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_locations_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "square_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_locations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      square_order_line_items: {
        Row: {
          base_price_money: number | null
          catalog_object_id: string | null
          category_id: string | null
          created_at: string
          id: string
          modifiers: Json | null
          name: string | null
          order_id: string
          quantity: number | null
          raw_json: Json | null
          restaurant_id: string
          total_money: number | null
          uid: string
        }
        Insert: {
          base_price_money?: number | null
          catalog_object_id?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          modifiers?: Json | null
          name?: string | null
          order_id: string
          quantity?: number | null
          raw_json?: Json | null
          restaurant_id: string
          total_money?: number | null
          uid: string
        }
        Update: {
          base_price_money?: number | null
          catalog_object_id?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          modifiers?: Json | null
          name?: string | null
          order_id?: string
          quantity?: number | null
          raw_json?: Json | null
          restaurant_id?: string
          total_money?: number | null
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_order_line_items_order_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "square_orders"
            referencedColumns: ["order_id", "restaurant_id"]
          },
          {
            foreignKeyName: "square_order_line_items_order_id_restaurant_id_fkey"
            columns: ["order_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "square_orders"
            referencedColumns: ["order_id", "restaurant_id"]
          },
          {
            foreignKeyName: "square_order_line_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      square_orders: {
        Row: {
          closed_at: string | null
          created_at: string | null
          gross_sales_money: number | null
          id: string
          location_id: string
          net_amounts_money: number | null
          order_id: string
          raw_json: Json | null
          restaurant_id: string
          service_date: string | null
          source: string | null
          state: string | null
          synced_at: string
          total_discount_money: number | null
          total_service_charge_money: number | null
          total_tax_money: number | null
          total_tip_money: number | null
          updated_at: string | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string | null
          gross_sales_money?: number | null
          id?: string
          location_id: string
          net_amounts_money?: number | null
          order_id: string
          raw_json?: Json | null
          restaurant_id: string
          service_date?: string | null
          source?: string | null
          state?: string | null
          synced_at?: string
          total_discount_money?: number | null
          total_service_charge_money?: number | null
          total_tax_money?: number | null
          total_tip_money?: number | null
          updated_at?: string | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string | null
          gross_sales_money?: number | null
          id?: string
          location_id?: string
          net_amounts_money?: number | null
          order_id?: string
          raw_json?: Json | null
          restaurant_id?: string
          service_date?: string | null
          source?: string | null
          state?: string | null
          synced_at?: string
          total_discount_money?: number | null
          total_service_charge_money?: number | null
          total_tax_money?: number | null
          total_tip_money?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "square_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      square_payments: {
        Row: {
          amount_money: number | null
          created_at: string | null
          id: string
          location_id: string
          order_id: string | null
          payment_id: string
          processing_fee_money: number | null
          raw_json: Json | null
          restaurant_id: string
          status: string | null
          synced_at: string
          tip_money: number | null
        }
        Insert: {
          amount_money?: number | null
          created_at?: string | null
          id?: string
          location_id: string
          order_id?: string | null
          payment_id: string
          processing_fee_money?: number | null
          raw_json?: Json | null
          restaurant_id: string
          status?: string | null
          synced_at?: string
          tip_money?: number | null
        }
        Update: {
          amount_money?: number | null
          created_at?: string | null
          id?: string
          location_id?: string
          order_id?: string | null
          payment_id?: string
          processing_fee_money?: number | null
          raw_json?: Json | null
          restaurant_id?: string
          status?: string | null
          synced_at?: string
          tip_money?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "square_payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      square_refunds: {
        Row: {
          amount_money: number | null
          created_at: string | null
          id: string
          order_id: string | null
          payment_id: string | null
          raw_json: Json | null
          refund_id: string
          restaurant_id: string
          status: string | null
          synced_at: string
        }
        Insert: {
          amount_money?: number | null
          created_at?: string | null
          id?: string
          order_id?: string | null
          payment_id?: string | null
          raw_json?: Json | null
          refund_id: string
          restaurant_id: string
          status?: string | null
          synced_at?: string
        }
        Update: {
          amount_money?: number | null
          created_at?: string | null
          id?: string
          order_id?: string | null
          payment_id?: string | null
          raw_json?: Json | null
          refund_id?: string
          restaurant_id?: string
          status?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_refunds_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      square_shifts: {
        Row: {
          break_seconds: number | null
          end_at: string | null
          hourly_rate_money: number | null
          id: string
          location_id: string
          overtime_seconds: number | null
          raw_json: Json | null
          restaurant_id: string
          service_date: string | null
          shift_id: string
          start_at: string | null
          synced_at: string
          team_member_id: string | null
          total_wage_money: number | null
        }
        Insert: {
          break_seconds?: number | null
          end_at?: string | null
          hourly_rate_money?: number | null
          id?: string
          location_id: string
          overtime_seconds?: number | null
          raw_json?: Json | null
          restaurant_id: string
          service_date?: string | null
          shift_id: string
          start_at?: string | null
          synced_at?: string
          team_member_id?: string | null
          total_wage_money?: number | null
        }
        Update: {
          break_seconds?: number | null
          end_at?: string | null
          hourly_rate_money?: number | null
          id?: string
          location_id?: string
          overtime_seconds?: number | null
          raw_json?: Json | null
          restaurant_id?: string
          service_date?: string | null
          shift_id?: string
          start_at?: string | null
          synced_at?: string
          team_member_id?: string | null
          total_wage_money?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "square_shifts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      square_team_members: {
        Row: {
          created_at: string
          id: string
          name: string | null
          raw_json: Json | null
          restaurant_id: string
          status: string | null
          team_member_id: string
          updated_at: string
          wage_default_money: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
          raw_json?: Json | null
          restaurant_id: string
          status?: string | null
          team_member_id: string
          updated_at?: string
          wage_default_money?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
          raw_json?: Json | null
          restaurant_id?: string
          status?: string | null
          team_member_id?: string
          updated_at?: string
          wage_default_money?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "square_team_members_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          processed_at: string
          stripe_event_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          processed_at?: string
          stripe_event_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          processed_at?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      supplier_categorization_rules: {
        Row: {
          auto_apply: boolean | null
          created_at: string | null
          default_category_id: string | null
          id: string
          restaurant_id: string
          supplier_id: string
          updated_at: string | null
        }
        Insert: {
          auto_apply?: boolean | null
          created_at?: string | null
          default_category_id?: string | null
          id?: string
          restaurant_id: string
          supplier_id: string
          updated_at?: string | null
        }
        Update: {
          auto_apply?: boolean | null
          created_at?: string | null
          default_category_id?: string | null
          id?: string
          restaurant_id?: string
          supplier_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_categorization_rules_default_category_id_fkey"
            columns: ["default_category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_categorization_rules_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_categorization_rules_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_name_variations: {
        Row: {
          created_at: string | null
          id: string
          match_type: string
          name_variation: string
          restaurant_id: string
          supplier_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          match_type: string
          name_variation: string
          restaurant_id: string
          supplier_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          match_type?: string
          name_variation?: string
          restaurant_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_name_variations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_name_variations_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          restaurant_id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          restaurant_id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          restaurant_id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      transaction_categorization_rules: {
        Row: {
          apply_count: number
          category_id: string
          created_at: string
          id: string
          is_active: boolean
          last_applied_at: string | null
          match_type: string
          match_value: string
          priority: number
          restaurant_id: string
          rule_name: string
          updated_at: string
        }
        Insert: {
          apply_count?: number
          category_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_applied_at?: string | null
          match_type: string
          match_value: string
          priority?: number
          restaurant_id: string
          rule_name: string
          updated_at?: string
        }
        Update: {
          apply_count?: number
          category_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_applied_at?: string | null
          match_type?: string
          match_value?: string
          priority?: number
          restaurant_id?: string
          rule_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_categorization_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_categorization_rules_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_reclassifications: {
        Row: {
          bank_transaction_id: string
          created_at: string
          created_by: string | null
          id: string
          new_category_id: string
          original_category_id: string | null
          original_journal_entry_id: string | null
          reason: string | null
          reclass_journal_entry_id: string
          restaurant_id: string
        }
        Insert: {
          bank_transaction_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          new_category_id: string
          original_category_id?: string | null
          original_journal_entry_id?: string | null
          reason?: string | null
          reclass_journal_entry_id: string
          restaurant_id: string
        }
        Update: {
          bank_transaction_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          new_category_id?: string
          original_category_id?: string | null
          original_journal_entry_id?: string | null
          reason?: string | null
          reclass_journal_entry_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_reclassifications_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_reclassifications_new_category_id_fkey"
            columns: ["new_category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_reclassifications_original_category_id_fkey"
            columns: ["original_category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_reclassifications_original_journal_entry_id_fkey"
            columns: ["original_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_reclassifications_reclass_journal_entry_id_fkey"
            columns: ["reclass_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_reclassifications_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      unified_sales: {
        Row: {
          ai_confidence: string | null
          ai_reasoning: string | null
          category_id: string | null
          created_at: string
          external_item_id: string | null
          external_order_id: string
          id: string
          is_categorized: boolean | null
          is_split: boolean | null
          item_name: string
          item_type: string | null
          parent_sale_id: string | null
          pos_category: string | null
          pos_system: string
          quantity: number
          raw_data: Json | null
          restaurant_id: string
          sale_date: string
          sale_time: string | null
          suggested_category_id: string | null
          synced_at: string
          total_price: number | null
          unit_price: number | null
          updated_at: string | null
        }
        Insert: {
          ai_confidence?: string | null
          ai_reasoning?: string | null
          category_id?: string | null
          created_at?: string
          external_item_id?: string | null
          external_order_id: string
          id?: string
          is_categorized?: boolean | null
          is_split?: boolean | null
          item_name: string
          item_type?: string | null
          parent_sale_id?: string | null
          pos_category?: string | null
          pos_system: string
          quantity?: number
          raw_data?: Json | null
          restaurant_id: string
          sale_date: string
          sale_time?: string | null
          suggested_category_id?: string | null
          synced_at?: string
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string | null
        }
        Update: {
          ai_confidence?: string | null
          ai_reasoning?: string | null
          category_id?: string | null
          created_at?: string
          external_item_id?: string | null
          external_order_id?: string
          id?: string
          is_categorized?: boolean | null
          is_split?: boolean | null
          item_name?: string
          item_type?: string | null
          parent_sale_id?: string | null
          pos_category?: string | null
          pos_system?: string
          quantity?: number
          raw_data?: Json | null
          restaurant_id?: string
          sale_date?: string
          sale_time?: string | null
          suggested_category_id?: string | null
          synced_at?: string
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unified_sales_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unified_sales_parent_sale_id_fkey"
            columns: ["parent_sale_id"]
            isOneToOne: false
            referencedRelation: "unified_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unified_sales_suggested_category_id_fkey"
            columns: ["suggested_category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      unified_sales_splits: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          description: string | null
          id: string
          sale_id: string
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string
          description?: string | null
          id?: string
          sale_id: string
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          description?: string | null
          id?: string
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unified_sales_splits_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unified_sales_splits_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "unified_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_conversions: {
        Row: {
          created_at: string
          factor: number
          from_unit: Database["public"]["Enums"]["measurement_unit"]
          id: string
          to_unit: Database["public"]["Enums"]["measurement_unit"]
        }
        Insert: {
          created_at?: string
          factor: number
          from_unit: Database["public"]["Enums"]["measurement_unit"]
          id?: string
          to_unit: Database["public"]["Enums"]["measurement_unit"]
        }
        Update: {
          created_at?: string
          factor?: number
          from_unit?: Database["public"]["Enums"]["measurement_unit"]
          id?: string
          to_unit?: Database["public"]["Enums"]["measurement_unit"]
        }
        Relationships: []
      }
      user_restaurants: {
        Row: {
          created_at: string
          id: string
          restaurant_id: string
          role: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          restaurant_id: string
          role?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          restaurant_id?: string
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_restaurants_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advanced_product_search: {
        Args: {
          p_limit?: number
          p_restaurant_id: string
          p_search_term: string
          p_similarity_threshold?: number
        }
        Returns: {
          brand: string
          category: string
          combined_score: number
          current_stock: number
          id: string
          levenshtein_score: number
          match_type: string
          name: string
          receipt_item_names: string[]
          similarity_score: number
          sku: string
          uom_purchase: string
        }[]
      }
      aggregate_inventory_usage_to_daily_food_costs: {
        Args: { p_date: string; p_restaurant_id: string }
        Returns: undefined
      }
      aggregate_unified_sales_to_daily: {
        Args: { p_date: string; p_restaurant_id: string }
        Returns: undefined
      }
      apply_reconciliation_adjustment: {
        Args: { p_restaurant_id: string }
        Returns: Json
      }
      bulk_process_historical_sales: {
        Args: {
          p_end_date: string
          p_restaurant_id: string
          p_start_date: string
        }
        Returns: Json
      }
      calculate_daily_pnl: {
        Args: { p_date: string; p_restaurant_id: string }
        Returns: string
      }
      calculate_gs1_check_digit: { Args: { base13: string }; Returns: string }
      calculate_square_daily_pnl: {
        Args: { p_restaurant_id: string; p_service_date: string }
        Returns: string
      }
      categorize_bank_transaction:
        | {
            Args: {
              p_category_id: string
              p_description?: string
              p_normalized_payee?: string
              p_supplier_id?: string
              p_transaction_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_category_id: string
              p_restaurant_id: string
              p_transaction_id: string
            }
            Returns: Json
          }
      categorize_bank_transaction_split: {
        Args: {
          p_restaurant_id: string
          p_splits: Json
          p_transaction_id: string
        }
        Returns: Json
      }
      categorize_pos_sale: {
        Args: { p_category_id: string; p_sale_id: string }
        Returns: undefined
      }
      check_reconciliation_boundary: {
        Args: { p_restaurant_id: string }
        Returns: Json
      }
      check_sale_already_processed: {
        Args: {
          p_external_order_id?: string
          p_pos_item_name: string
          p_quantity_sold: number
          p_restaurant_id: string
          p_sale_date: string
        }
        Returns: boolean
      }
      cleanup_expired_invitations: { Args: never; Returns: undefined }
      cleanup_old_audit_logs: { Args: never; Returns: undefined }
      cleanup_rate_limit_logs: { Args: never; Returns: undefined }
      compute_account_balance: {
        Args: { p_account_id: string; p_as_of_date?: string }
        Returns: number
      }
      create_restaurant_with_owner:
        | {
            Args: {
              restaurant_address?: string
              restaurant_cuisine_type?: string
              restaurant_name: string
              restaurant_phone?: string
              restaurant_timezone?: string
            }
            Returns: string
          }
        | {
            Args: {
              restaurant_address?: string
              restaurant_cuisine_type?: string
              restaurant_name: string
              restaurant_phone?: string
            }
            Returns: string
          }
      daitch_mokotoff: { Args: { "": string }; Returns: string[] }
      dmetaphone: { Args: { "": string }; Returns: string }
      dmetaphone_alt: { Args: { "": string }; Returns: string }
      exclude_bank_transaction: {
        Args: { p_reason?: string; p_transaction_id: string }
        Returns: Json
      }
      find_product_by_gtin: {
        Args: { p_restaurant_id: string; p_scanned_gtin: string }
        Returns: {
          cost_per_unit: number
          current_stock: number
          gtin: string
          id: string
          name: string
        }[]
      }
      fulltext_product_search: {
        Args: {
          p_limit?: number
          p_restaurant_id: string
          p_search_term: string
        }
        Returns: {
          brand: string
          category: string
          current_stock: number
          id: string
          match_type: string
          name: string
          receipt_item_names: string[]
          similarity_score: number
          sku: string
          uom_purchase: string
        }[]
      }
      get_account_subtypes: { Args: never; Returns: Json }
      get_product_cost_per_recipe_unit: {
        Args: { product_id: string }
        Returns: number
      }
      hash_invitation_token: { Args: { token: string }; Returns: string }
      is_restaurant_owner: {
        Args: { p_restaurant_id: string; p_user_id: string }
        Returns: boolean
      }
      log_security_event: {
        Args: {
          p_details?: Json
          p_event_type: string
          p_restaurant_id?: string
          p_severity?: string
        }
        Returns: undefined
      }
      mark_as_transfer: {
        Args: { p_transaction_id_1: string; p_transaction_id_2: string }
        Returns: Json
      }
      process_inventory_deduction: {
        Args: {
          p_pos_item_name: string
          p_quantity_sold: number
          p_restaurant_id: string
          p_sale_date: string
        }
        Returns: Json
      }
      process_unified_inventory_deduction:
        | {
            Args: {
              p_pos_item_name: string
              p_quantity_sold: number
              p_restaurant_id: string
              p_restaurant_timezone?: string
              p_sale_date: string
              p_sale_time?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_external_order_id?: string
              p_pos_item_name: string
              p_quantity_sold: number
              p_restaurant_id: string
              p_restaurant_timezone?: string
              p_sale_date: string
              p_sale_time?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_external_order_id?: string
              p_pos_item_name: string
              p_quantity_sold: number
              p_restaurant_id: string
              p_restaurant_timezone?: string
              p_sale_date: string
              p_sale_time?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_external_order_id?: string
              p_pos_item_name: string
              p_quantity_sold: number
              p_restaurant_id: string
              p_sale_date: string
            }
            Returns: Json
          }
      rebuild_account_balances: {
        Args: { p_restaurant_id: string }
        Returns: number
      }
      search_products_by_name: {
        Args: { p_restaurant_id: string; p_search_term: string }
        Returns: {
          current_stock: number
          id: string
          name: string
          receipt_item_names: string[]
          sku: string
          uom_purchase: string
        }[]
      }
      set_preferred_product_supplier: {
        Args: {
          p_product_id: string
          p_product_supplier_id: string
          p_restaurant_id: string
        }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      simulate_inventory_deduction: {
        Args: {
          p_pos_item_name: string
          p_quantity_sold: number
          p_restaurant_id: string
        }
        Returns: Json
      }
      soundex: { Args: { "": string }; Returns: string }
      split_bank_transaction: {
        Args: { p_splits: Json; p_transaction_id: string }
        Returns: Json
      }
      split_pos_sale: {
        Args: { p_sale_id: string; p_splits: Json }
        Returns: undefined
      }
      suggest_supplier_for_payee: {
        Args: { p_payee_name: string; p_restaurant_id: string }
        Returns: {
          match_confidence: number
          match_type: string
          supplier_id: string
          supplier_name: string
        }[]
      }
      sync_clover_to_unified_sales: {
        Args: { p_restaurant_id: string }
        Returns: number
      }
      sync_square_to_unified_sales: {
        Args: { p_restaurant_id: string }
        Returns: number
      }
      text_soundex: { Args: { "": string }; Returns: string }
      trigger_square_periodic_sync: { Args: never; Returns: undefined }
      unaccent: { Args: { "": string }; Returns: string }
      upsert_product_supplier: {
        Args: {
          p_product_id: string
          p_quantity: number
          p_restaurant_id: string
          p_supplier_id: string
          p_unit_cost: number
        }
        Returns: undefined
      }
    }
    Enums: {
      account_subtype_enum:
        | "cash"
        | "bank"
        | "accounts_receivable"
        | "inventory"
        | "fixed_assets"
        | "other_current_assets"
        | "other_assets"
        | "accounts_payable"
        | "credit_card"
        | "loan"
        | "other_current_liabilities"
        | "long_term_liabilities"
        | "owners_equity"
        | "retained_earnings"
        | "sales"
        | "other_income"
        | "cost_of_goods_sold"
        | "operating_expenses"
        | "payroll"
        | "tax_expense"
        | "other_expenses"
        | "prepaid_expenses"
        | "accumulated_depreciation"
        | "payroll_liabilities"
        | "deferred_revenue"
        | "other_liabilities"
        | "distributions"
        | "food_sales"
        | "beverage_sales"
        | "alcohol_sales"
        | "catering_income"
        | "food_cost"
        | "beverage_cost"
        | "packaging_cost"
        | "labor"
        | "rent"
        | "utilities"
        | "marketing"
        | "insurance"
        | "repairs_maintenance"
        | "professional_fees"
      account_type_enum:
        | "asset"
        | "liability"
        | "equity"
        | "revenue"
        | "expense"
        | "cogs"
      bank_connection_status_enum:
        | "connected"
        | "disconnected"
        | "requires_reauth"
        | "error"
      measurement_unit:
        | "oz"
        | "ml"
        | "cup"
        | "tbsp"
        | "tsp"
        | "lb"
        | "kg"
        | "g"
        | "bottle"
        | "can"
        | "bag"
        | "box"
        | "piece"
        | "serving"
        | "L"
        | "gal"
        | "qt"
        | "pint"
        | "jar"
        | "container"
        | "case"
        | "package"
        | "dozen"
        | "each"
        | "unit"
        | "inch"
        | "cm"
        | "mm"
        | "ft"
        | "meter"
        | "fl oz"
      transaction_review_status:
        | "for_review"
        | "categorized"
        | "excluded"
        | "reconciled"
      transaction_status_enum: "pending" | "posted" | "reconciled" | "void"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_subtype_enum: [
        "cash",
        "bank",
        "accounts_receivable",
        "inventory",
        "fixed_assets",
        "other_current_assets",
        "other_assets",
        "accounts_payable",
        "credit_card",
        "loan",
        "other_current_liabilities",
        "long_term_liabilities",
        "owners_equity",
        "retained_earnings",
        "sales",
        "other_income",
        "cost_of_goods_sold",
        "operating_expenses",
        "payroll",
        "tax_expense",
        "other_expenses",
        "prepaid_expenses",
        "accumulated_depreciation",
        "payroll_liabilities",
        "deferred_revenue",
        "other_liabilities",
        "distributions",
        "food_sales",
        "beverage_sales",
        "alcohol_sales",
        "catering_income",
        "food_cost",
        "beverage_cost",
        "packaging_cost",
        "labor",
        "rent",
        "utilities",
        "marketing",
        "insurance",
        "repairs_maintenance",
        "professional_fees",
      ],
      account_type_enum: [
        "asset",
        "liability",
        "equity",
        "revenue",
        "expense",
        "cogs",
      ],
      bank_connection_status_enum: [
        "connected",
        "disconnected",
        "requires_reauth",
        "error",
      ],
      measurement_unit: [
        "oz",
        "ml",
        "cup",
        "tbsp",
        "tsp",
        "lb",
        "kg",
        "g",
        "bottle",
        "can",
        "bag",
        "box",
        "piece",
        "serving",
        "L",
        "gal",
        "qt",
        "pint",
        "jar",
        "container",
        "case",
        "package",
        "dozen",
        "each",
        "unit",
        "inch",
        "cm",
        "mm",
        "ft",
        "meter",
        "fl oz",
      ],
      transaction_review_status: [
        "for_review",
        "categorized",
        "excluded",
        "reconciled",
      ],
      transaction_status_enum: ["pending", "posted", "reconciled", "void"],
    },
  },
} as const
