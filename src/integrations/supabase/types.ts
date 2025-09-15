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
      cleanup_expired_invitations: {
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
