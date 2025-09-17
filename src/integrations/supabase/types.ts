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
      daily_food_costs: {
        Row: {
          created_at: string
          date: string
          id: string
          inventory_adjustments: number
          purchases: number
          restaurant_id: string
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
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
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
      restaurants: {
        Row: {
          address: string | null
          created_at: string
          cuisine_type: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          cuisine_type?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          cuisine_type?: string | null
          id?: string
          name?: string
          phone?: string | null
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
          ip_address: unknown | null
          metadata: Json | null
          restaurant_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_address?: unknown | null
          metadata?: Json | null
          restaurant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: unknown | null
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
      calculate_daily_pnl: {
        Args: { p_date: string; p_restaurant_id: string }
        Returns: string
      }
      calculate_square_daily_pnl: {
        Args: { p_restaurant_id: string; p_service_date: string }
        Returns: string
      }
      cleanup_expired_invitations: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      cleanup_old_audit_logs: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      create_restaurant_with_owner: {
        Args: {
          restaurant_address?: string
          restaurant_cuisine_type?: string
          restaurant_name: string
          restaurant_phone?: string
        }
        Returns: string
      }
      is_restaurant_owner: {
        Args: { p_restaurant_id: string; p_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
