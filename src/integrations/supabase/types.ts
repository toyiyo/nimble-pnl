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
      ai_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          name: string | null
          role: string
          session_id: string
          tool_call_id: string | null
          tool_calls: Json | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          name?: string | null
          role: string
          session_id: string
          tool_call_id?: string | null
          tool_calls?: Json | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          name?: string | null
          role?: string
          session_id?: string
          tool_call_id?: string | null
          tool_calls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_sessions: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          restaurant_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          restaurant_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          restaurant_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_depreciation_schedule: {
        Row: {
          accumulated_after: number
          asset_id: string
          depreciation_amount: number
          id: string
          journal_entry_id: string | null
          net_book_value: number
          period_end_date: string
          period_start_date: string
          posted_at: string
          posted_by: string | null
          restaurant_id: string
        }
        Insert: {
          accumulated_after: number
          asset_id: string
          depreciation_amount: number
          id?: string
          journal_entry_id?: string | null
          net_book_value: number
          period_end_date: string
          period_start_date: string
          posted_at?: string
          posted_by?: string | null
          restaurant_id: string
        }
        Update: {
          accumulated_after?: number
          asset_id?: string
          depreciation_amount?: number
          id?: string
          journal_entry_id?: string | null
          net_book_value?: number
          period_end_date?: string
          period_start_date?: string
          posted_at?: string
          posted_by?: string | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_depreciation_schedule_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_depreciation_schedule_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_depreciation_schedule_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_photos: {
        Row: {
          asset_id: string
          caption: string | null
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          is_primary: boolean
          mime_type: string | null
          restaurant_id: string
          storage_path: string
        }
        Insert: {
          asset_id: string
          caption?: string | null
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          is_primary?: boolean
          mime_type?: string | null
          restaurant_id: string
          storage_path: string
        }
        Update: {
          asset_id?: string
          caption?: string | null
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          is_primary?: boolean
          mime_type?: string | null
          restaurant_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_photos_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_photos_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          accumulated_depreciation: number
          accumulated_depreciation_account_id: string | null
          asset_account_id: string | null
          category: string
          created_at: string
          depreciation_expense_account_id: string | null
          description: string | null
          disposal_date: string | null
          disposal_notes: string | null
          disposal_proceeds: number | null
          id: string
          last_depreciation_date: string | null
          location_id: string | null
          name: string
          notes: string | null
          purchase_cost: number
          purchase_date: string
          quantity: number
          restaurant_id: string
          salvage_value: number
          serial_number: string | null
          status: Database["public"]["Enums"]["asset_status_enum"]
          unit_cost: number
          updated_at: string
          useful_life_months: number
        }
        Insert: {
          accumulated_depreciation?: number
          accumulated_depreciation_account_id?: string | null
          asset_account_id?: string | null
          category: string
          created_at?: string
          depreciation_expense_account_id?: string | null
          description?: string | null
          disposal_date?: string | null
          disposal_notes?: string | null
          disposal_proceeds?: number | null
          id?: string
          last_depreciation_date?: string | null
          location_id?: string | null
          name: string
          notes?: string | null
          purchase_cost: number
          purchase_date: string
          quantity?: number
          restaurant_id: string
          salvage_value?: number
          serial_number?: string | null
          status?: Database["public"]["Enums"]["asset_status_enum"]
          unit_cost: number
          updated_at?: string
          useful_life_months: number
        }
        Update: {
          accumulated_depreciation?: number
          accumulated_depreciation_account_id?: string | null
          asset_account_id?: string | null
          category?: string
          created_at?: string
          depreciation_expense_account_id?: string | null
          description?: string | null
          disposal_date?: string | null
          disposal_notes?: string | null
          disposal_proceeds?: number | null
          id?: string
          last_depreciation_date?: string | null
          location_id?: string | null
          name?: string
          notes?: string | null
          purchase_cost?: number
          purchase_date?: string
          quantity?: number
          restaurant_id?: string
          salvage_value?: number
          serial_number?: string | null
          status?: Database["public"]["Enums"]["asset_status_enum"]
          unit_cost?: number
          updated_at?: string
          useful_life_months?: number
        }
        Relationships: [
          {
            foreignKeyName: "assets_accumulated_depreciation_account_id_fkey"
            columns: ["accumulated_depreciation_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_depreciation_expense_account_id_fkey"
            columns: ["depreciation_expense_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_audit_log: {
        Row: {
          created_at: string | null
          employee_id: string | null
          event_type: string
          id: string
          metadata: Json | null
          restaurant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          employee_id?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          restaurant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          employee_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          restaurant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_audit_log_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
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
      availability_exceptions: {
        Row: {
          created_at: string | null
          date: string
          employee_id: string
          end_time: string | null
          id: string
          is_available: boolean
          reason: string | null
          restaurant_id: string
          start_time: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          employee_id: string
          end_time?: string | null
          id?: string
          is_available?: boolean
          reason?: string | null
          restaurant_id: string
          start_time?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          employee_id?: string
          end_time?: string | null
          id?: string
          is_available?: boolean
          reason?: string | null
          restaurant_id?: string
          start_time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exceptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exceptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exceptions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
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
      bank_statement_lines: {
        Row: {
          amount: number
          balance: number | null
          confidence_score: number | null
          created_at: string
          description: string
          has_validation_error: boolean | null
          id: string
          imported_transaction_id: string | null
          is_imported: boolean
          line_sequence: number
          statement_upload_id: string
          transaction_date: string
          transaction_type: string | null
          updated_at: string
          user_excluded: boolean | null
          validation_errors: Json | null
        }
        Insert: {
          amount: number
          balance?: number | null
          confidence_score?: number | null
          created_at?: string
          description: string
          has_validation_error?: boolean | null
          id?: string
          imported_transaction_id?: string | null
          is_imported?: boolean
          line_sequence: number
          statement_upload_id: string
          transaction_date: string
          transaction_type?: string | null
          updated_at?: string
          user_excluded?: boolean | null
          validation_errors?: Json | null
        }
        Update: {
          amount?: number
          balance?: number | null
          confidence_score?: number | null
          created_at?: string
          description?: string
          has_validation_error?: boolean | null
          id?: string
          imported_transaction_id?: string | null
          is_imported?: boolean
          line_sequence?: number
          statement_upload_id?: string
          transaction_date?: string
          transaction_type?: string | null
          updated_at?: string
          user_excluded?: boolean | null
          validation_errors?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_imported_transaction_id_fkey"
            columns: ["imported_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_statement_upload_id_fkey"
            columns: ["statement_upload_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_uploads: {
        Row: {
          bank_name: string | null
          created_at: string
          error_message: string | null
          failed_transaction_count: number | null
          file_name: string | null
          file_size: number | null
          id: string
          invalid_transactions: Json | null
          processed_at: string | null
          processed_by: string | null
          raw_file_url: string | null
          raw_ocr_data: Json | null
          restaurant_id: string
          statement_period_end: string | null
          statement_period_start: string | null
          status: string
          successful_transaction_count: number | null
          total_credits: number | null
          total_debits: number | null
          transaction_count: number | null
          updated_at: string
        }
        Insert: {
          bank_name?: string | null
          created_at?: string
          error_message?: string | null
          failed_transaction_count?: number | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          invalid_transactions?: Json | null
          processed_at?: string | null
          processed_by?: string | null
          raw_file_url?: string | null
          raw_ocr_data?: Json | null
          restaurant_id: string
          statement_period_end?: string | null
          statement_period_start?: string | null
          status?: string
          successful_transaction_count?: number | null
          total_credits?: number | null
          total_debits?: number | null
          transaction_count?: number | null
          updated_at?: string
        }
        Update: {
          bank_name?: string | null
          created_at?: string
          error_message?: string | null
          failed_transaction_count?: number | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          invalid_transactions?: Json | null
          processed_at?: string | null
          processed_by?: string | null
          raw_file_url?: string | null
          raw_ocr_data?: Json | null
          restaurant_id?: string
          statement_period_end?: string | null
          statement_period_start?: string | null
          status?: string
          successful_transaction_count?: number | null
          total_credits?: number | null
          total_debits?: number | null
          transaction_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_uploads_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
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
          expense_invoice_upload_id: string | null
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
          source: string | null
          statement_upload_id: string | null
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
          expense_invoice_upload_id?: string | null
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
          source?: string | null
          statement_upload_id?: string | null
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
          expense_invoice_upload_id?: string | null
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
          source?: string | null
          statement_upload_id?: string | null
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
            foreignKeyName: "bank_transactions_expense_invoice_upload_id_fkey"
            columns: ["expense_invoice_upload_id"]
            isOneToOne: false
            referencedRelation: "expense_invoice_uploads"
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
            foreignKeyName: "bank_transactions_statement_upload_id_fkey"
            columns: ["statement_upload_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_uploads"
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
      categorization_rules: {
        Row: {
          amount_max: number | null
          amount_min: number | null
          applies_to: string
          apply_count: number
          auto_apply: boolean
          category_id: string | null
          created_at: string
          description_match_type: string | null
          description_pattern: string | null
          id: string
          is_active: boolean
          is_split_rule: boolean
          item_name_match_type: string | null
          item_name_pattern: string | null
          last_applied_at: string | null
          pos_category: string | null
          priority: number
          restaurant_id: string
          rule_name: string
          split_categories: Json | null
          split_config: Json | null
          supplier_id: string | null
          transaction_type: string | null
          updated_at: string
        }
        Insert: {
          amount_max?: number | null
          amount_min?: number | null
          applies_to: string
          apply_count?: number
          auto_apply?: boolean
          category_id?: string | null
          created_at?: string
          description_match_type?: string | null
          description_pattern?: string | null
          id?: string
          is_active?: boolean
          is_split_rule?: boolean
          item_name_match_type?: string | null
          item_name_pattern?: string | null
          last_applied_at?: string | null
          pos_category?: string | null
          priority?: number
          restaurant_id: string
          rule_name: string
          split_categories?: Json | null
          split_config?: Json | null
          supplier_id?: string | null
          transaction_type?: string | null
          updated_at?: string
        }
        Update: {
          amount_max?: number | null
          amount_min?: number | null
          applies_to?: string
          apply_count?: number
          auto_apply?: boolean
          category_id?: string | null
          created_at?: string
          description_match_type?: string | null
          description_pattern?: string | null
          id?: string
          is_active?: boolean
          is_split_rule?: boolean
          item_name_match_type?: string | null
          item_name_pattern?: string | null
          last_applied_at?: string | null
          pos_category?: string | null
          priority?: number
          restaurant_id?: string
          rule_name?: string
          split_categories?: Json | null
          split_config?: Json | null
          supplier_id?: string | null
          transaction_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorization_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorization_rules_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorization_rules_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          account_code: string
          account_name: string
          account_subtype:
            | Database["public"]["Enums"]["account_subtype_enum"]
            | null
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
          account_subtype?:
            | Database["public"]["Enums"]["account_subtype_enum"]
            | null
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
          account_subtype?:
            | Database["public"]["Enums"]["account_subtype_enum"]
            | null
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
      csv_mapping_templates: {
        Row: {
          column_mappings: Json
          created_at: string | null
          csv_headers: string[]
          id: string
          restaurant_id: string
          template_name: string
          updated_at: string | null
        }
        Insert: {
          column_mappings: Json
          created_at?: string | null
          csv_headers: string[]
          id?: string
          restaurant_id: string
          template_name: string
          updated_at?: string | null
        }
        Update: {
          column_mappings?: Json
          created_at?: string | null
          csv_headers?: string[]
          id?: string
          restaurant_id?: string
          template_name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "csv_mapping_templates_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          billing_address_city: string | null
          billing_address_country: string | null
          billing_address_line1: string | null
          billing_address_line2: string | null
          billing_address_postal_code: string | null
          billing_address_state: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          restaurant_id: string
          stripe_customer_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          billing_address_city?: string | null
          billing_address_country?: string | null
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_address_postal_code?: string | null
          billing_address_state?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          restaurant_id: string
          stripe_customer_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          billing_address_city?: string | null
          billing_address_country?: string | null
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_address_postal_code?: string | null
          billing_address_state?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          restaurant_id?: string
          stripe_customer_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_restaurant_id_fkey"
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
      daily_labor_allocations: {
        Row: {
          allocated_cost: number
          compensation_type: string
          created_at: string | null
          date: string
          employee_id: string
          id: string
          notes: string | null
          restaurant_id: string
          source: string | null
          updated_at: string | null
        }
        Insert: {
          allocated_cost?: number
          compensation_type: string
          created_at?: string | null
          date: string
          employee_id: string
          id?: string
          notes?: string | null
          restaurant_id: string
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          allocated_cost?: number
          compensation_type?: string
          created_at?: string | null
          date?: string
          employee_id?: string
          id?: string
          notes?: string | null
          restaurant_id?: string
          source?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_labor_allocations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_labor_allocations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_labor_allocations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_labor_allocations_restaurant_id_fkey"
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
      employee_availability: {
        Row: {
          created_at: string | null
          day_of_week: number
          employee_id: string
          end_time: string
          id: string
          is_available: boolean
          notes: string | null
          restaurant_id: string
          start_time: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          employee_id: string
          end_time: string
          id?: string
          is_available?: boolean
          notes?: string | null
          restaurant_id: string
          start_time: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          employee_id?: string
          end_time?: string
          id?: string
          is_available?: boolean
          notes?: string | null
          restaurant_id?: string
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_availability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_availability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_availability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_availability_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_compensation_history: {
        Row: {
          amount_cents: number
          compensation_type: string
          created_at: string | null
          effective_date: string
          employee_id: string
          id: string
          pay_period_type: string | null
          restaurant_id: string
        }
        Insert: {
          amount_cents: number
          compensation_type: string
          created_at?: string | null
          effective_date: string
          employee_id: string
          id?: string
          pay_period_type?: string | null
          restaurant_id: string
        }
        Update: {
          amount_cents?: number
          compensation_type?: string
          created_at?: string | null
          effective_date?: string
          employee_id?: string
          id?: string
          pay_period_type?: string | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_compensation_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_compensation_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_compensation_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_compensation_history_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_pins: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          force_reset: boolean
          id: string
          last_used_at: string | null
          min_length: number
          pin_hash: string
          restaurant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          force_reset?: boolean
          id?: string
          last_used_at?: string | null
          min_length?: number
          pin_hash: string
          restaurant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          force_reset?: boolean
          id?: string
          last_used_at?: string | null
          min_length?: number
          pin_hash?: string
          restaurant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_pins_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_pins_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_pins_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_pins_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_tips: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          notes: string | null
          recorded_at: string
          restaurant_id: string
          shift_id: string | null
          tip_amount: number
          tip_date: string
          tip_source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          notes?: string | null
          recorded_at?: string
          restaurant_id: string
          shift_id?: string | null
          tip_amount?: number
          tip_date?: string
          tip_source: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          notes?: string | null
          recorded_at?: string
          restaurant_id?: string
          shift_id?: string | null
          tip_amount?: number
          tip_date?: string
          tip_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_tips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_tips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_tips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_tips_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_tips_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          allocate_daily: boolean | null
          compensation_type: string
          contractor_payment_amount: number | null
          contractor_payment_interval: string | null
          created_at: string | null
          daily_rate_amount: number | null
          daily_rate_reference_days: number | null
          daily_rate_reference_weekly: number | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          email: string | null
          hire_date: string | null
          hourly_rate: number
          id: string
          is_active: boolean
          last_active_date: string | null
          name: string
          notes: string | null
          pay_period_type: string | null
          phone: string | null
          position: string
          reactivated_at: string | null
          reactivated_by: string | null
          requires_time_punch: boolean | null
          restaurant_id: string
          salary_amount: number | null
          status: string
          termination_date: string | null
          tip_eligible: boolean | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          allocate_daily?: boolean | null
          compensation_type?: string
          contractor_payment_amount?: number | null
          contractor_payment_interval?: string | null
          created_at?: string | null
          daily_rate_amount?: number | null
          daily_rate_reference_days?: number | null
          daily_rate_reference_weekly?: number | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          email?: string | null
          hire_date?: string | null
          hourly_rate?: number
          id?: string
          is_active?: boolean
          last_active_date?: string | null
          name: string
          notes?: string | null
          pay_period_type?: string | null
          phone?: string | null
          position: string
          reactivated_at?: string | null
          reactivated_by?: string | null
          requires_time_punch?: boolean | null
          restaurant_id: string
          salary_amount?: number | null
          status?: string
          termination_date?: string | null
          tip_eligible?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          allocate_daily?: boolean | null
          compensation_type?: string
          contractor_payment_amount?: number | null
          contractor_payment_interval?: string | null
          created_at?: string | null
          daily_rate_amount?: number | null
          daily_rate_reference_days?: number | null
          daily_rate_reference_weekly?: number | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          email?: string | null
          hire_date?: string | null
          hourly_rate?: number
          id?: string
          is_active?: boolean
          last_active_date?: string | null
          name?: string
          notes?: string | null
          pay_period_type?: string | null
          phone?: string | null
          position?: string
          reactivated_at?: string | null
          reactivated_by?: string | null
          requires_time_punch?: boolean | null
          restaurant_id?: string
          salary_amount?: number | null
          status?: string
          termination_date?: string | null
          tip_eligible?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_restaurant_id_fkey"
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
      expense_invoice_uploads: {
        Row: {
          created_at: string
          due_date: string | null
          error_message: string | null
          field_confidence: Json | null
          file_name: string | null
          file_size: number | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          pending_outflow_id: string | null
          processed_at: string | null
          processed_by: string | null
          raw_file_url: string | null
          raw_ocr_data: Json | null
          restaurant_id: string
          status: string
          total_amount: number | null
          updated_at: string
          vendor_name: string | null
        }
        Insert: {
          created_at?: string
          due_date?: string | null
          error_message?: string | null
          field_confidence?: Json | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          pending_outflow_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          raw_file_url?: string | null
          raw_ocr_data?: Json | null
          restaurant_id: string
          status?: string
          total_amount?: number | null
          updated_at?: string
          vendor_name?: string | null
        }
        Update: {
          created_at?: string
          due_date?: string | null
          error_message?: string | null
          field_confidence?: Json | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          pending_outflow_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          raw_file_url?: string | null
          raw_ocr_data?: Json | null
          restaurant_id?: string
          status?: string
          total_amount?: number | null
          updated_at?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_invoice_uploads_pending_outflow_id_fkey"
            columns: ["pending_outflow_id"]
            isOneToOne: false
            referencedRelation: "pending_outflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_invoice_uploads_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
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
      inventory_locations: {
        Row: {
          created_at: string
          id: string
          name: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locations_restaurant_id_fkey"
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
          transaction_date: string | null
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
          transaction_date?: string | null
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
          transaction_date?: string | null
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
          employee_id: string | null
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
          employee_id?: string | null
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
          employee_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "invitations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          metadata: Json | null
          quantity: number
          stripe_invoice_item_id: string | null
          tax_behavior: string | null
          tax_rate: number | null
          unit_amount: number
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          metadata?: Json | null
          quantity?: number
          stripe_invoice_item_id?: string | null
          tax_behavior?: string | null
          tax_rate?: number | null
          unit_amount: number
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          metadata?: Json | null
          quantity?: number
          stripe_invoice_item_id?: string | null
          tax_behavior?: string | null
          tax_rate?: number | null
          unit_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          failure_message: string | null
          id: string
          invoice_id: string
          payment_method_type: string | null
          status: string
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          failure_message?: string | null
          id?: string
          invoice_id: string
          payment_method_type?: string | null
          status: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          failure_message?: string | null
          id?: string
          invoice_id?: string
          payment_method_type?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_due: number
          amount_paid: number
          amount_remaining: number
          application_fee_amount: number | null
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string
          description: string | null
          due_date: string | null
          footer: string | null
          hosted_invoice_url: string | null
          id: string
          invoice_date: string
          invoice_number: string | null
          invoice_pdf_url: string | null
          memo: string | null
          paid_at: string | null
          pass_fees_to_customer: boolean
          restaurant_id: string
          status: string
          stripe_fee_amount: number | null
          stripe_fee_description: string | null
          stripe_invoice_id: string | null
          subtotal: number
          tax: number
          total: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_due?: number
          amount_paid?: number
          amount_remaining?: number
          application_fee_amount?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id: string
          description?: string | null
          due_date?: string | null
          footer?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          memo?: string | null
          paid_at?: string | null
          pass_fees_to_customer?: boolean
          restaurant_id: string
          status?: string
          stripe_fee_amount?: number | null
          stripe_fee_description?: string | null
          stripe_invoice_id?: string | null
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          amount_remaining?: number
          application_fee_amount?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string
          description?: string | null
          due_date?: string | null
          footer?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          memo?: string | null
          paid_at?: string | null
          pass_fees_to_customer?: boolean
          restaurant_id?: string
          status?: string
          stripe_fee_amount?: number | null
          stripe_fee_description?: string | null
          stripe_invoice_id?: string | null
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
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
      kiosk_service_accounts: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          id: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kiosk_service_accounts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_pins: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          manager_user_id: string
          min_length: number
          pin_hash: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          manager_user_id: string
          min_length?: number
          pin_hash: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          manager_user_id?: string
          min_length?: number
          pin_hash?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_pins_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          created_at: string | null
          id: string
          invoice_overdue_days: number | null
          notify_compensation_changed: boolean | null
          notify_employee_activated: boolean | null
          notify_employee_deactivated: boolean | null
          notify_employee_reactivated: boolean | null
          notify_invoice_created: boolean | null
          notify_invoice_overdue: boolean | null
          notify_invoice_paid: boolean | null
          notify_invoice_sent: boolean | null
          notify_manual_payment: boolean | null
          notify_missed_punch_out: boolean | null
          notify_payroll_finalized: boolean | null
          notify_pin_reset: boolean | null
          notify_production_run_completed: boolean | null
          notify_production_variance: boolean | null
          notify_shift_created: boolean | null
          notify_shift_deleted: boolean | null
          notify_shift_modified: boolean | null
          notify_shift_reminder: boolean | null
          notify_time_off_approved: boolean
          notify_time_off_rejected: boolean
          notify_time_off_request: boolean
          notify_timecard_edited: boolean | null
          notify_tip_dispute_resolved: boolean | null
          notify_tip_dispute_submitted: boolean | null
          notify_tip_split_approved: boolean | null
          notify_tip_split_created: boolean | null
          production_variance_threshold: number | null
          restaurant_id: string
          shift_reminder_hours: number | null
          time_off_notify_employee: boolean
          time_off_notify_managers: boolean
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_overdue_days?: number | null
          notify_compensation_changed?: boolean | null
          notify_employee_activated?: boolean | null
          notify_employee_deactivated?: boolean | null
          notify_employee_reactivated?: boolean | null
          notify_invoice_created?: boolean | null
          notify_invoice_overdue?: boolean | null
          notify_invoice_paid?: boolean | null
          notify_invoice_sent?: boolean | null
          notify_manual_payment?: boolean | null
          notify_missed_punch_out?: boolean | null
          notify_payroll_finalized?: boolean | null
          notify_pin_reset?: boolean | null
          notify_production_run_completed?: boolean | null
          notify_production_variance?: boolean | null
          notify_shift_created?: boolean | null
          notify_shift_deleted?: boolean | null
          notify_shift_modified?: boolean | null
          notify_shift_reminder?: boolean | null
          notify_time_off_approved?: boolean
          notify_time_off_rejected?: boolean
          notify_time_off_request?: boolean
          notify_timecard_edited?: boolean | null
          notify_tip_dispute_resolved?: boolean | null
          notify_tip_dispute_submitted?: boolean | null
          notify_tip_split_approved?: boolean | null
          notify_tip_split_created?: boolean | null
          production_variance_threshold?: number | null
          restaurant_id: string
          shift_reminder_hours?: number | null
          time_off_notify_employee?: boolean
          time_off_notify_managers?: boolean
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_overdue_days?: number | null
          notify_compensation_changed?: boolean | null
          notify_employee_activated?: boolean | null
          notify_employee_deactivated?: boolean | null
          notify_employee_reactivated?: boolean | null
          notify_invoice_created?: boolean | null
          notify_invoice_overdue?: boolean | null
          notify_invoice_paid?: boolean | null
          notify_invoice_sent?: boolean | null
          notify_manual_payment?: boolean | null
          notify_missed_punch_out?: boolean | null
          notify_payroll_finalized?: boolean | null
          notify_pin_reset?: boolean | null
          notify_production_run_completed?: boolean | null
          notify_production_variance?: boolean | null
          notify_shift_created?: boolean | null
          notify_shift_deleted?: boolean | null
          notify_shift_modified?: boolean | null
          notify_shift_reminder?: boolean | null
          notify_time_off_approved?: boolean
          notify_time_off_rejected?: boolean
          notify_time_off_request?: boolean
          notify_timecard_edited?: boolean | null
          notify_tip_dispute_resolved?: boolean | null
          notify_tip_dispute_submitted?: boolean | null
          notify_tip_split_approved?: boolean | null
          notify_tip_split_created?: boolean | null
          production_variance_threshold?: number | null
          restaurant_id?: string
          shift_reminder_hours?: number | null
          time_off_notify_employee?: boolean
          time_off_notify_managers?: boolean
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_outflows: {
        Row: {
          amount: number
          category_id: string | null
          cleared_at: string | null
          created_at: string
          due_date: string | null
          id: string
          issue_date: string
          linked_bank_transaction_id: string | null
          notes: string | null
          payment_method: string
          reference_number: string | null
          restaurant_id: string
          status: string
          updated_at: string
          vendor_name: string
          voided_at: string | null
          voided_reason: string | null
        }
        Insert: {
          amount: number
          category_id?: string | null
          cleared_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          issue_date: string
          linked_bank_transaction_id?: string | null
          notes?: string | null
          payment_method: string
          reference_number?: string | null
          restaurant_id: string
          status?: string
          updated_at?: string
          vendor_name: string
          voided_at?: string | null
          voided_reason?: string | null
        }
        Update: {
          amount?: number
          category_id?: string | null
          cleared_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          issue_date?: string
          linked_bank_transaction_id?: string | null
          notes?: string | null
          payment_method?: string
          reference_number?: string | null
          restaurant_id?: string
          status?: string
          updated_at?: string
          vendor_name?: string
          voided_at?: string | null
          voided_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_outflows_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_outflows_linked_bank_transaction_id_fkey"
            columns: ["linked_bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_outflows_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      po_number_counters: {
        Row: {
          counter: number
          created_at: string
          restaurant_id: string
          updated_at: string
          year: number
        }
        Insert: {
          counter?: number
          created_at?: string
          restaurant_id: string
          updated_at?: string
          year: number
        }
        Update: {
          counter?: number
          created_at?: string
          restaurant_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
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
      prep_recipe_ingredients: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          prep_recipe_id: string
          product_id: string
          quantity: number
          sort_order: number | null
          unit: Database["public"]["Enums"]["measurement_unit"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          prep_recipe_id: string
          product_id: string
          quantity: number
          sort_order?: number | null
          unit: Database["public"]["Enums"]["measurement_unit"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          prep_recipe_id?: string
          product_id?: string
          quantity?: number
          sort_order?: number | null
          unit?: Database["public"]["Enums"]["measurement_unit"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prep_recipe_ingredients_prep_recipe_id_fkey"
            columns: ["prep_recipe_id"]
            isOneToOne: false
            referencedRelation: "prep_recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_recipe_ingredients_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      prep_recipes: {
        Row: {
          created_at: string
          created_by: string | null
          default_yield: number
          default_yield_unit: Database["public"]["Enums"]["measurement_unit"]
          description: string | null
          id: string
          name: string
          output_product_id: string | null
          prep_time_minutes: number | null
          recipe_id: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_yield?: number
          default_yield_unit?: Database["public"]["Enums"]["measurement_unit"]
          description?: string | null
          id?: string
          name: string
          output_product_id?: string | null
          prep_time_minutes?: number | null
          recipe_id?: string | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_yield?: number
          default_yield_unit?: Database["public"]["Enums"]["measurement_unit"]
          description?: string | null
          id?: string
          name?: string
          output_product_id?: string | null
          prep_time_minutes?: number | null
          recipe_id?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prep_recipes_output_product_id_fkey"
            columns: ["output_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_recipes_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prep_recipes_restaurant_id_fkey"
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
      production_run_ingredients: {
        Row: {
          actual_quantity: number | null
          created_at: string
          expected_quantity: number | null
          id: string
          product_id: string
          production_run_id: string
          total_cost_snapshot: number | null
          unit: Database["public"]["Enums"]["measurement_unit"] | null
          unit_cost_snapshot: number | null
          updated_at: string
          variance_percent: number | null
        }
        Insert: {
          actual_quantity?: number | null
          created_at?: string
          expected_quantity?: number | null
          id?: string
          product_id: string
          production_run_id: string
          total_cost_snapshot?: number | null
          unit?: Database["public"]["Enums"]["measurement_unit"] | null
          unit_cost_snapshot?: number | null
          updated_at?: string
          variance_percent?: number | null
        }
        Update: {
          actual_quantity?: number | null
          created_at?: string
          expected_quantity?: number | null
          id?: string
          product_id?: string
          production_run_id?: string
          total_cost_snapshot?: number | null
          unit?: Database["public"]["Enums"]["measurement_unit"] | null
          unit_cost_snapshot?: number | null
          updated_at?: string
          variance_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "production_run_ingredients_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_run_ingredients_production_run_id_fkey"
            columns: ["production_run_id"]
            isOneToOne: false
            referencedRelation: "production_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      production_runs: {
        Row: {
          actual_total_cost: number | null
          actual_yield: number | null
          actual_yield_unit:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          completed_at: string | null
          cost_per_unit: number | null
          created_at: string
          created_by: string | null
          expected_total_cost: number | null
          id: string
          notes: string | null
          prep_recipe_id: string
          prepared_by: string | null
          restaurant_id: string
          scheduled_for: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["production_run_status"]
          target_yield: number | null
          target_yield_unit:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          updated_at: string
          variance_percent: number | null
        }
        Insert: {
          actual_total_cost?: number | null
          actual_yield?: number | null
          actual_yield_unit?:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          completed_at?: string | null
          cost_per_unit?: number | null
          created_at?: string
          created_by?: string | null
          expected_total_cost?: number | null
          id?: string
          notes?: string | null
          prep_recipe_id: string
          prepared_by?: string | null
          restaurant_id: string
          scheduled_for?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["production_run_status"]
          target_yield?: number | null
          target_yield_unit?:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          updated_at?: string
          variance_percent?: number | null
        }
        Update: {
          actual_total_cost?: number | null
          actual_yield?: number | null
          actual_yield_unit?:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          completed_at?: string | null
          cost_per_unit?: number | null
          created_at?: string
          created_by?: string | null
          expected_total_cost?: number | null
          id?: string
          notes?: string | null
          prep_recipe_id?: string
          prepared_by?: string | null
          restaurant_id?: string
          scheduled_for?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["production_run_status"]
          target_yield?: number | null
          target_yield_unit?:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          updated_at?: string
          variance_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "production_runs_prep_recipe_id_fkey"
            columns: ["prep_recipe_id"]
            isOneToOne: false
            referencedRelation: "prep_recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_runs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
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
      purchase_order_lines: {
        Row: {
          created_at: string
          id: string
          item_name: string
          line_total: number
          notes: string | null
          product_id: string
          purchase_order_id: string
          quantity: number
          received_quantity: number | null
          sku: string | null
          supplier_id: string | null
          unit_cost: number
          unit_label: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_name: string
          line_total?: number
          notes?: string | null
          product_id: string
          purchase_order_id: string
          quantity?: number
          received_quantity?: number | null
          sku?: string | null
          supplier_id?: string | null
          unit_cost?: number
          unit_label?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_name?: string
          line_total?: number
          notes?: string | null
          product_id?: string
          purchase_order_id?: string
          quantity?: number
          received_quantity?: number | null
          sku?: string | null
          supplier_id?: string | null
          unit_cost?: number
          unit_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          budget: number | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          notes: string | null
          po_number: string | null
          restaurant_id: string
          sent_at: string | null
          status: string
          supplier_id: string | null
          total: number
          updated_at: string
        }
        Insert: {
          budget?: number | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          po_number?: string | null
          restaurant_id: string
          sent_at?: string | null
          status?: string
          supplier_id?: string | null
          total?: number
          updated_at?: string
        }
        Update: {
          budget?: number | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          po_number?: string | null
          restaurant_id?: string
          sent_at?: string | null
          status?: string
          supplier_id?: string | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
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
          purchase_date: string | null
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
          purchase_date?: string | null
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
          purchase_date?: string | null
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
          package_type: string | null
          parsed_name: string | null
          parsed_price: number | null
          parsed_quantity: number | null
          parsed_sku: string | null
          parsed_unit: string | null
          raw_text: string
          receipt_id: string
          size_unit: string | null
          size_value: number | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          line_sequence?: number | null
          mapping_status?: string
          matched_product_id?: string | null
          package_type?: string | null
          parsed_name?: string | null
          parsed_price?: number | null
          parsed_quantity?: number | null
          parsed_sku?: string | null
          parsed_unit?: string | null
          raw_text: string
          receipt_id: string
          size_unit?: string | null
          size_value?: number | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          line_sequence?: number | null
          mapping_status?: string
          matched_product_id?: string | null
          package_type?: string | null
          parsed_name?: string | null
          parsed_price?: number | null
          parsed_quantity?: number | null
          parsed_sku?: string | null
          parsed_unit?: string | null
          raw_text?: string
          receipt_id?: string
          size_unit?: string | null
          size_value?: number | null
          unit_price?: number | null
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
      reconciliation_item_finds: {
        Row: {
          created_at: string
          found_at: string
          found_by: string | null
          id: string
          location: string | null
          notes: string | null
          quantity: number
          reconciliation_item_id: string
        }
        Insert: {
          created_at?: string
          found_at?: string
          found_by?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          quantity: number
          reconciliation_item_id: string
        }
        Update: {
          created_at?: string
          found_at?: string
          found_by?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          quantity?: number
          reconciliation_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_item_finds_reconciliation_item_id_fkey"
            columns: ["reconciliation_item_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_items"
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
      restaurant_operating_costs: {
        Row: {
          averaging_months: number | null
          category: string
          cost_type: string
          created_at: string
          display_order: number | null
          entry_type: string
          id: string
          is_active: boolean | null
          is_auto_calculated: boolean | null
          manual_override: boolean | null
          monthly_value: number | null
          name: string
          percentage_value: number | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          averaging_months?: number | null
          category: string
          cost_type: string
          created_at?: string
          display_order?: number | null
          entry_type?: string
          id?: string
          is_active?: boolean | null
          is_auto_calculated?: boolean | null
          manual_override?: boolean | null
          monthly_value?: number | null
          name: string
          percentage_value?: number | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          averaging_months?: number | null
          category?: string
          cost_type?: string
          created_at?: string
          display_order?: number | null
          entry_type?: string
          id?: string
          is_active?: boolean | null
          is_auto_calculated?: boolean | null
          manual_override?: boolean | null
          monthly_value?: number | null
          name?: string
          percentage_value?: number | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_operating_costs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          address: string | null
          capitalize_threshold_cents: number | null
          created_at: string
          cuisine_type: string | null
          grandfathered_until: string | null
          id: string
          name: string
          phone: string | null
          stripe_customer_id: string | null
          stripe_subscription_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_cancel_at: string | null
          subscription_ends_at: string | null
          subscription_period: string
          subscription_status: string
          subscription_tier: string
          timezone: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          capitalize_threshold_cents?: number | null
          created_at?: string
          cuisine_type?: string | null
          grandfathered_until?: string | null
          id?: string
          name: string
          phone?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_cancel_at?: string | null
          subscription_ends_at?: string | null
          subscription_period?: string
          subscription_status?: string
          subscription_tier?: string
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          capitalize_threshold_cents?: number | null
          created_at?: string
          cuisine_type?: string | null
          grandfathered_until?: string | null
          id?: string
          name?: string
          phone?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_cancel_at?: string | null
          subscription_ends_at?: string | null
          subscription_period?: string
          subscription_status?: string
          subscription_tier?: string
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rule_application_log: {
        Row: {
          applied_at: string
          category_id: string
          created_at: string
          error_message: string | null
          id: string
          pos_sale_id: string | null
          restaurant_id: string
          result: string
          rule_id: string
          transaction_id: string | null
        }
        Insert: {
          applied_at?: string
          category_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          pos_sale_id?: string | null
          restaurant_id: string
          result: string
          rule_id: string
          transaction_id?: string | null
        }
        Update: {
          applied_at?: string
          category_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          pos_sale_id?: string | null
          restaurant_id?: string
          result?: string
          rule_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rule_application_log_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_application_log_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_application_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "categorization_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_change_logs: {
        Row: {
          after_data: Json | null
          before_data: Json | null
          change_type: string
          changed_at: string
          changed_by: string
          created_at: string | null
          employee_id: string | null
          id: string
          reason: string | null
          restaurant_id: string
          shift_id: string | null
        }
        Insert: {
          after_data?: Json | null
          before_data?: Json | null
          change_type: string
          changed_at?: string
          changed_by: string
          created_at?: string | null
          employee_id?: string | null
          id?: string
          reason?: string | null
          restaurant_id: string
          shift_id?: string | null
        }
        Update: {
          after_data?: Json | null
          before_data?: Json | null
          change_type?: string
          changed_at?: string
          changed_by?: string
          created_at?: string | null
          employee_id?: string | null
          id?: string
          reason?: string | null
          restaurant_id?: string
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_change_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_change_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_change_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_change_logs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_change_logs_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_publications: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          notification_sent: boolean
          published_at: string
          published_by: string
          restaurant_id: string
          shift_count: number
          week_end_date: string
          week_start_date: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          notification_sent?: boolean
          published_at?: string
          published_by: string
          restaurant_id: string
          shift_count?: number
          week_end_date: string
          week_start_date: string
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          notification_sent?: boolean
          published_at?: string
          published_by?: string
          restaurant_id?: string
          shift_count?: number
          week_end_date?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_publications_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
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
      shift_templates: {
        Row: {
          break_duration: number | null
          created_at: string | null
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean | null
          name: string
          position: string
          restaurant_id: string
          start_time: string
          updated_at: string | null
        }
        Insert: {
          break_duration?: number | null
          created_at?: string | null
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean | null
          name: string
          position: string
          restaurant_id: string
          start_time: string
          updated_at?: string | null
        }
        Update: {
          break_duration?: number | null
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean | null
          name?: string
          position?: string
          restaurant_id?: string
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_templates_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_trades: {
        Row: {
          accepted_by_employee_id: string | null
          created_at: string | null
          id: string
          manager_note: string | null
          offered_by_employee_id: string
          offered_shift_id: string
          reason: string | null
          requested_shift_id: string | null
          restaurant_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          target_employee_id: string | null
          updated_at: string | null
        }
        Insert: {
          accepted_by_employee_id?: string | null
          created_at?: string | null
          id?: string
          manager_note?: string | null
          offered_by_employee_id: string
          offered_shift_id: string
          reason?: string | null
          requested_shift_id?: string | null
          restaurant_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_employee_id?: string | null
          updated_at?: string | null
        }
        Update: {
          accepted_by_employee_id?: string | null
          created_at?: string | null
          id?: string
          manager_note?: string | null
          offered_by_employee_id?: string
          offered_shift_id?: string
          reason?: string | null
          requested_shift_id?: string | null
          restaurant_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_employee_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_trades_accepted_by_employee_id_fkey"
            columns: ["accepted_by_employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_accepted_by_employee_id_fkey"
            columns: ["accepted_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_accepted_by_employee_id_fkey"
            columns: ["accepted_by_employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_offered_by_employee_id_fkey"
            columns: ["offered_by_employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_offered_by_employee_id_fkey"
            columns: ["offered_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_offered_by_employee_id_fkey"
            columns: ["offered_by_employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_offered_shift_id_fkey"
            columns: ["offered_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_requested_shift_id_fkey"
            columns: ["requested_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_target_employee_id_fkey"
            columns: ["target_employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_target_employee_id_fkey"
            columns: ["target_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_target_employee_id_fkey"
            columns: ["target_employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      shift4_charges: {
        Row: {
          amount: number
          captured: boolean
          charge_id: string
          created_at: string
          created_at_ts: number
          created_time: string
          currency: string
          description: string | null
          id: string
          merchant_id: string
          raw_json: Json | null
          refunded: boolean
          restaurant_id: string
          service_date: string | null
          service_time: string | null
          status: string
          synced_at: string
          tip_amount: number | null
          updated_at: string
        }
        Insert: {
          amount: number
          captured?: boolean
          charge_id: string
          created_at?: string
          created_at_ts: number
          created_time: string
          currency?: string
          description?: string | null
          id?: string
          merchant_id: string
          raw_json?: Json | null
          refunded?: boolean
          restaurant_id: string
          service_date?: string | null
          service_time?: string | null
          status: string
          synced_at?: string
          tip_amount?: number | null
          updated_at?: string
        }
        Update: {
          amount?: number
          captured?: boolean
          charge_id?: string
          created_at?: string
          created_at_ts?: number
          created_time?: string
          currency?: string
          description?: string | null
          id?: string
          merchant_id?: string
          raw_json?: Json | null
          refunded?: boolean
          restaurant_id?: string
          service_date?: string | null
          service_time?: string | null
          status?: string
          synced_at?: string
          tip_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift4_charges_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      shift4_connections: {
        Row: {
          connected_at: string
          connection_status: string | null
          created_at: string
          email: string | null
          environment: string
          id: string
          initial_sync_done: boolean | null
          is_active: boolean | null
          last_error: string | null
          last_error_at: string | null
          last_sync_at: string | null
          last_sync_time: string | null
          lighthouse_location_ids: Json | null
          lighthouse_token: string | null
          lighthouse_token_expires_at: string | null
          merchant_id: string
          password: string | null
          restaurant_id: string
          secret_key: string | null
          sync_cursor: number | null
          updated_at: string
        }
        Insert: {
          connected_at?: string
          connection_status?: string | null
          created_at?: string
          email?: string | null
          environment?: string
          id?: string
          initial_sync_done?: boolean | null
          is_active?: boolean | null
          last_error?: string | null
          last_error_at?: string | null
          last_sync_at?: string | null
          last_sync_time?: string | null
          lighthouse_location_ids?: Json | null
          lighthouse_token?: string | null
          lighthouse_token_expires_at?: string | null
          merchant_id: string
          password?: string | null
          restaurant_id: string
          secret_key?: string | null
          sync_cursor?: number | null
          updated_at?: string
        }
        Update: {
          connected_at?: string
          connection_status?: string | null
          created_at?: string
          email?: string | null
          environment?: string
          id?: string
          initial_sync_done?: boolean | null
          is_active?: boolean | null
          last_error?: string | null
          last_error_at?: string | null
          last_sync_at?: string | null
          last_sync_time?: string | null
          lighthouse_location_ids?: Json | null
          lighthouse_token?: string | null
          lighthouse_token_expires_at?: string | null
          merchant_id?: string
          password?: string | null
          restaurant_id?: string
          secret_key?: string | null
          sync_cursor?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift4_connections_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      shift4_refunds: {
        Row: {
          amount: number
          charge_id: string
          created_at: string
          created_at_ts: number
          created_time: string
          currency: string
          id: string
          merchant_id: string
          raw_json: Json | null
          reason: string | null
          refund_id: string
          restaurant_id: string
          service_date: string | null
          status: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          amount: number
          charge_id: string
          created_at?: string
          created_at_ts: number
          created_time: string
          currency?: string
          id?: string
          merchant_id: string
          raw_json?: Json | null
          reason?: string | null
          refund_id: string
          restaurant_id: string
          service_date?: string | null
          status: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          charge_id?: string
          created_at?: string
          created_at_ts?: number
          created_time?: string
          currency?: string
          id?: string
          merchant_id?: string
          raw_json?: Json | null
          reason?: string | null
          refund_id?: string
          restaurant_id?: string
          service_date?: string | null
          status?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift4_refunds_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      shift4_webhook_events: {
        Row: {
          created_at: string
          event_id: string
          event_type: string
          id: string
          object_id: string
          processed: boolean
          processed_at: string | null
          raw_json: Json
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          event_type: string
          id?: string
          object_id: string
          processed?: boolean
          processed_at?: string | null
          raw_json: Json
          restaurant_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          object_id?: string
          processed?: boolean
          processed_at?: string | null
          raw_json?: Json
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift4_webhook_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          break_duration: number | null
          created_at: string | null
          employee_id: string
          end_time: string
          id: string
          is_published: boolean
          is_recurring: boolean | null
          locked: boolean
          notes: string | null
          position: string
          published_at: string | null
          published_by: string | null
          recurrence_parent_id: string | null
          recurrence_pattern: Json | null
          restaurant_id: string
          start_time: string
          status: string
          updated_at: string | null
        }
        Insert: {
          break_duration?: number | null
          created_at?: string | null
          employee_id: string
          end_time: string
          id?: string
          is_published?: boolean
          is_recurring?: boolean | null
          locked?: boolean
          notes?: string | null
          position: string
          published_at?: string | null
          published_by?: string | null
          recurrence_parent_id?: string | null
          recurrence_pattern?: Json | null
          restaurant_id: string
          start_time: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          break_duration?: number | null
          created_at?: string | null
          employee_id?: string
          end_time?: string
          id?: string
          is_published?: boolean
          is_recurring?: boolean | null
          locked?: boolean
          notes?: string | null
          position?: string
          published_at?: string | null
          published_by?: string | null
          recurrence_parent_id?: string | null
          recurrence_pattern?: Json | null
          restaurant_id?: string
          start_time?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_restaurant_id_fkey"
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
      stripe_connected_accounts: {
        Row: {
          account_type: string
          charges_enabled: boolean
          created_at: string
          details_submitted: boolean
          id: string
          onboarding_complete: boolean
          payouts_enabled: boolean
          restaurant_id: string
          stripe_account_id: string
          updated_at: string
        }
        Insert: {
          account_type: string
          charges_enabled?: boolean
          created_at?: string
          details_submitted?: boolean
          id?: string
          onboarding_complete?: boolean
          payouts_enabled?: boolean
          restaurant_id: string
          stripe_account_id: string
          updated_at?: string
        }
        Update: {
          account_type?: string
          charges_enabled?: boolean
          created_at?: string
          details_submitted?: boolean
          id?: string
          onboarding_complete?: boolean
          payouts_enabled?: boolean
          restaurant_id?: string
          stripe_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_connected_accounts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
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
      time_off_requests: {
        Row: {
          created_at: string | null
          employee_id: string
          end_date: string
          id: string
          reason: string | null
          requested_at: string | null
          restaurant_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          end_date: string
          id?: string
          reason?: string | null
          requested_at?: string | null
          restaurant_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          end_date?: string
          id?: string
          reason?: string | null
          requested_at?: string | null
          restaurant_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_off_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      time_punches: {
        Row: {
          created_at: string | null
          created_by: string | null
          device_info: string | null
          employee_id: string
          id: string
          location: Json | null
          modified_by: string | null
          notes: string | null
          photo_path: string | null
          punch_time: string
          punch_type: string
          restaurant_id: string
          shift_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          device_info?: string | null
          employee_id: string
          id?: string
          location?: Json | null
          modified_by?: string | null
          notes?: string | null
          photo_path?: string | null
          punch_time?: string
          punch_type: string
          restaurant_id: string
          shift_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          device_info?: string | null
          employee_id?: string
          id?: string
          location?: Json | null
          modified_by?: string | null
          notes?: string | null
          photo_path?: string | null
          punch_time?: string
          punch_type?: string
          restaurant_id?: string
          shift_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_punches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punches_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_disputes: {
        Row: {
          created_at: string | null
          dispute_type: string | null
          employee_id: string
          id: string
          message: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          restaurant_id: string
          status: string
          tip_split_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          dispute_type?: string | null
          employee_id: string
          id?: string
          message?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          restaurant_id: string
          status?: string
          tip_split_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          dispute_type?: string | null
          employee_id?: string
          id?: string
          message?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          restaurant_id?: string
          status?: string
          tip_split_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_disputes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_disputes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_disputes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_disputes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_disputes_tip_split_id_fkey"
            columns: ["tip_split_id"]
            isOneToOne: false
            referencedRelation: "tip_splits"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_pool_settings: {
        Row: {
          active: boolean | null
          created_at: string | null
          created_by: string | null
          enabled_employee_ids: string[] | null
          id: string
          restaurant_id: string
          role_weights: Json | null
          share_method: string | null
          split_cadence: string | null
          tip_source: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          created_by?: string | null
          enabled_employee_ids?: string[] | null
          id?: string
          restaurant_id: string
          role_weights?: Json | null
          share_method?: string | null
          split_cadence?: string | null
          tip_source?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          created_by?: string | null
          enabled_employee_ids?: string[] | null
          id?: string
          restaurant_id?: string
          role_weights?: Json | null
          share_method?: string | null
          split_cadence?: string | null
          tip_source?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_pool_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_split_audit: {
        Row: {
          action: string
          changed_at: string | null
          changed_by: string | null
          changes: Json | null
          id: string
          reason: string | null
          split_reference: string
          tip_split_id: string | null
        }
        Insert: {
          action: string
          changed_at?: string | null
          changed_by?: string | null
          changes?: Json | null
          id?: string
          reason?: string | null
          split_reference: string
          tip_split_id?: string | null
        }
        Update: {
          action?: string
          changed_at?: string | null
          changed_by?: string | null
          changes?: Json | null
          id?: string
          reason?: string | null
          split_reference?: string
          tip_split_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_split_audit_tip_split_id_fkey"
            columns: ["tip_split_id"]
            isOneToOne: false
            referencedRelation: "tip_splits"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_split_items: {
        Row: {
          amount: number
          created_at: string | null
          employee_id: string
          hours_worked: number | null
          id: string
          manually_edited: boolean | null
          role: string | null
          role_weight: number | null
          tip_split_id: string
        }
        Insert: {
          amount?: number
          created_at?: string | null
          employee_id: string
          hours_worked?: number | null
          id?: string
          manually_edited?: boolean | null
          role?: string | null
          role_weight?: number | null
          tip_split_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          employee_id?: string
          hours_worked?: number | null
          id?: string
          manually_edited?: boolean | null
          role?: string | null
          role_weight?: number | null
          tip_split_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_split_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "active_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_split_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_split_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "inactive_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_split_items_tip_split_id_fkey"
            columns: ["tip_split_id"]
            isOneToOne: false
            referencedRelation: "tip_splits"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_splits: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          restaurant_id: string
          share_method: string | null
          split_date: string
          status: string
          tip_source: string | null
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          restaurant_id: string
          share_method?: string | null
          split_date: string
          status?: string
          tip_source?: string | null
          total_amount?: number
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          restaurant_id?: string
          share_method?: string | null
          split_date?: string
          status?: string
          tip_source?: string | null
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_splits_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      toast_connections: {
        Row: {
          access_token_encrypted: string | null
          client_id: string
          client_secret_encrypted: string
          connection_status: string | null
          created_at: string
          id: string
          initial_sync_done: boolean | null
          is_active: boolean | null
          last_error: string | null
          last_error_at: string | null
          last_sync_time: string | null
          restaurant_id: string
          sync_cursor: number | null
          sync_page: number | null
          toast_restaurant_guid: string
          token_expires_at: string | null
          token_fetched_at: string | null
          updated_at: string
          webhook_active: boolean | null
          webhook_secret_encrypted: string | null
          webhook_subscription_guid: string | null
        }
        Insert: {
          access_token_encrypted?: string | null
          client_id: string
          client_secret_encrypted: string
          connection_status?: string | null
          created_at?: string
          id?: string
          initial_sync_done?: boolean | null
          is_active?: boolean | null
          last_error?: string | null
          last_error_at?: string | null
          last_sync_time?: string | null
          restaurant_id: string
          sync_cursor?: number | null
          sync_page?: number | null
          toast_restaurant_guid: string
          token_expires_at?: string | null
          token_fetched_at?: string | null
          updated_at?: string
          webhook_active?: boolean | null
          webhook_secret_encrypted?: string | null
          webhook_subscription_guid?: string | null
        }
        Update: {
          access_token_encrypted?: string | null
          client_id?: string
          client_secret_encrypted?: string
          connection_status?: string | null
          created_at?: string
          id?: string
          initial_sync_done?: boolean | null
          is_active?: boolean | null
          last_error?: string | null
          last_error_at?: string | null
          last_sync_time?: string | null
          restaurant_id?: string
          sync_cursor?: number | null
          sync_page?: number | null
          toast_restaurant_guid?: string
          token_expires_at?: string | null
          token_fetched_at?: string | null
          updated_at?: string
          webhook_active?: boolean | null
          webhook_secret_encrypted?: string | null
          webhook_subscription_guid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "toast_connections_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      toast_menu_items: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          item_name: string
          price: number | null
          raw_json: Json | null
          restaurant_id: string
          synced_at: string
          toast_item_guid: string
          toast_restaurant_guid: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          item_name: string
          price?: number | null
          raw_json?: Json | null
          restaurant_id: string
          synced_at?: string
          toast_item_guid: string
          toast_restaurant_guid: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          item_name?: string
          price?: number | null
          raw_json?: Json | null
          restaurant_id?: string
          synced_at?: string
          toast_item_guid?: string
          toast_restaurant_guid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "toast_menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      toast_order_items: {
        Row: {
          created_at: string
          id: string
          item_name: string
          menu_category: string | null
          modifiers: Json | null
          quantity: number
          raw_json: Json | null
          restaurant_id: string
          synced_at: string
          toast_item_guid: string
          toast_order_guid: string
          toast_order_id: string | null
          total_price: number | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_name: string
          menu_category?: string | null
          modifiers?: Json | null
          quantity?: number
          raw_json?: Json | null
          restaurant_id: string
          synced_at?: string
          toast_item_guid: string
          toast_order_guid: string
          toast_order_id?: string | null
          total_price?: number | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          item_name?: string
          menu_category?: string | null
          modifiers?: Json | null
          quantity?: number
          raw_json?: Json | null
          restaurant_id?: string
          synced_at?: string
          toast_item_guid?: string
          toast_order_guid?: string
          toast_order_id?: string | null
          total_price?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "toast_order_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toast_order_items_toast_order_id_fkey"
            columns: ["toast_order_id"]
            isOneToOne: false
            referencedRelation: "toast_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      toast_orders: {
        Row: {
          created_at: string
          dining_option: string | null
          discount_amount: number | null
          id: string
          order_date: string
          order_number: string | null
          order_time: string | null
          payment_status: string | null
          raw_json: Json | null
          restaurant_id: string
          service_charge_amount: number | null
          subtotal_amount: number | null
          synced_at: string
          tax_amount: number | null
          tip_amount: number | null
          toast_order_guid: string
          toast_restaurant_guid: string
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dining_option?: string | null
          discount_amount?: number | null
          id?: string
          order_date: string
          order_number?: string | null
          order_time?: string | null
          payment_status?: string | null
          raw_json?: Json | null
          restaurant_id: string
          service_charge_amount?: number | null
          subtotal_amount?: number | null
          synced_at?: string
          tax_amount?: number | null
          tip_amount?: number | null
          toast_order_guid: string
          toast_restaurant_guid: string
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dining_option?: string | null
          discount_amount?: number | null
          id?: string
          order_date?: string
          order_number?: string | null
          order_time?: string | null
          payment_status?: string | null
          raw_json?: Json | null
          restaurant_id?: string
          service_charge_amount?: number | null
          subtotal_amount?: number | null
          synced_at?: string
          tax_amount?: number | null
          tip_amount?: number | null
          toast_order_guid?: string
          toast_restaurant_guid?: string
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "toast_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      toast_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          payment_date: string | null
          payment_status: string | null
          payment_type: string | null
          raw_json: Json | null
          restaurant_id: string
          synced_at: string
          tip_amount: number | null
          toast_order_guid: string
          toast_payment_guid: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          payment_date?: string | null
          payment_status?: string | null
          payment_type?: string | null
          raw_json?: Json | null
          restaurant_id: string
          synced_at?: string
          tip_amount?: number | null
          toast_order_guid: string
          toast_payment_guid: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          payment_date?: string | null
          payment_status?: string | null
          payment_type?: string | null
          raw_json?: Json | null
          restaurant_id?: string
          synced_at?: string
          tip_amount?: number | null
          toast_order_guid?: string
          toast_payment_guid?: string
        }
        Relationships: [
          {
            foreignKeyName: "toast_payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      toast_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          id: string
          processed_at: string
          raw_json: Json | null
          restaurant_id: string
        }
        Insert: {
          event_id: string
          event_type: string
          id?: string
          processed_at?: string
          raw_json?: Json | null
          restaurant_id: string
        }
        Update: {
          event_id?: string
          event_type?: string
          id?: string
          processed_at?: string
          raw_json?: Json | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "toast_webhook_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
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
          adjustment_type: string | null
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
          adjustment_type?: string | null
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
          adjustment_type?: string | null
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
            foreignKeyName: "fk_parent_sale"
            columns: ["parent_sale_id"]
            isOneToOne: false
            referencedRelation: "unified_sales"
            referencedColumns: ["id"]
          },
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
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          sale_id: string
        }
        Insert: {
          amount: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          sale_id: string
        }
        Update: {
          amount?: number
          category_id?: string | null
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
      active_employees: {
        Row: {
          allocate_daily: boolean | null
          compensation_type: string | null
          contractor_payment_amount: number | null
          contractor_payment_interval: string | null
          created_at: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          email: string | null
          hire_date: string | null
          hourly_rate: number | null
          id: string | null
          is_active: boolean | null
          last_active_date: string | null
          name: string | null
          notes: string | null
          pay_period_type: string | null
          phone: string | null
          position: string | null
          reactivated_at: string | null
          reactivated_by: string | null
          requires_time_punch: boolean | null
          restaurant_id: string | null
          salary_amount: number | null
          status: string | null
          termination_date: string | null
          tip_eligible: boolean | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          allocate_daily?: boolean | null
          compensation_type?: string | null
          contractor_payment_amount?: number | null
          contractor_payment_interval?: string | null
          created_at?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          email?: string | null
          hire_date?: string | null
          hourly_rate?: number | null
          id?: string | null
          is_active?: boolean | null
          last_active_date?: string | null
          name?: string | null
          notes?: string | null
          pay_period_type?: string | null
          phone?: string | null
          position?: string | null
          reactivated_at?: string | null
          reactivated_by?: string | null
          requires_time_punch?: boolean | null
          restaurant_id?: string | null
          salary_amount?: number | null
          status?: string | null
          termination_date?: string | null
          tip_eligible?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          allocate_daily?: boolean | null
          compensation_type?: string | null
          contractor_payment_amount?: number | null
          contractor_payment_interval?: string | null
          created_at?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          email?: string | null
          hire_date?: string | null
          hourly_rate?: number | null
          id?: string | null
          is_active?: boolean | null
          last_active_date?: string | null
          name?: string | null
          notes?: string | null
          pay_period_type?: string | null
          phone?: string | null
          position?: string | null
          reactivated_at?: string | null
          reactivated_by?: string | null
          requires_time_punch?: boolean | null
          restaurant_id?: string | null
          salary_amount?: number | null
          status?: string | null
          termination_date?: string | null
          tip_eligible?: boolean | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inactive_employees: {
        Row: {
          allocate_daily: boolean | null
          compensation_type: string | null
          contractor_payment_amount: number | null
          contractor_payment_interval: string | null
          created_at: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivated_by_email: string | null
          deactivation_reason: string | null
          email: string | null
          hire_date: string | null
          hourly_rate: number | null
          id: string | null
          is_active: boolean | null
          last_active_date: string | null
          name: string | null
          notes: string | null
          pay_period_type: string | null
          phone: string | null
          position: string | null
          reactivated_at: string | null
          reactivated_by: string | null
          reactivated_by_email: string | null
          requires_time_punch: boolean | null
          restaurant_id: string | null
          salary_amount: number | null
          status: string | null
          termination_date: string | null
          tip_eligible: boolean | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_shift_trade: {
        Args: { p_accepting_employee_id: string; p_trade_id: string }
        Returns: Json
      }
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
      apply_rules_to_bank_transactions: {
        Args: { p_batch_limit?: number; p_restaurant_id: string }
        Returns: {
          applied_count: number
          total_count: number
        }[]
      }
      apply_rules_to_bank_transactions_debug: {
        Args: { p_batch_limit?: number; p_restaurant_id: string }
        Returns: {
          amount: number
          description: string
          error_detail: string
          is_split_rule: boolean
          rule_found: boolean
          rule_name: string
          split_categories_raw: Json
          split_message: string
          split_success: boolean
          splits_converted: Json
          transaction_id: string
        }[]
      }
      apply_rules_to_pos_sales: {
        Args: { p_batch_limit?: number; p_restaurant_id: string }
        Returns: {
          applied_count: number
          total_count: number
        }[]
      }
      apply_rules_to_pos_sales_debug: {
        Args: { p_batch_limit?: number; p_restaurant_id: string }
        Returns: {
          error_detail: string
          is_split_rule: boolean
          item_name: string
          rule_found: boolean
          rule_name: string
          sale_id: string
          split_categories_raw: Json
          split_message: string
          split_success: boolean
          splits_converted: Json
        }[]
      }
      apply_split_rule_to_bank_transaction: {
        Args: {
          p_rule_id: string
          p_transaction_amount: number
          p_transaction_id: string
        }
        Returns: undefined
      }
      apply_split_rule_to_pos_sale: {
        Args: { p_rule_id: string; p_sale_amount: number; p_sale_id: string }
        Returns: undefined
      }
      approve_shift_trade: {
        Args: {
          p_manager_note?: string
          p_manager_user_id: string
          p_trade_id: string
        }
        Returns: Json
      }
      archive_old_ai_chat_sessions: {
        Args: { p_restaurant_id: string; p_user_id: string }
        Returns: number
      }
      bulk_delete_bank_transactions: {
        Args: { p_restaurant_id: string; p_transaction_ids: string[] }
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
      calculate_asset_depreciation: {
        Args: {
          p_asset_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: {
          depreciation_amount: number
          is_fully_depreciated: boolean
          monthly_depreciation: number
          months_in_period: number
          net_book_value: number
          new_accumulated: number
        }[]
      }
      calculate_daily_pnl: {
        Args: { p_date: string; p_restaurant_id: string }
        Returns: string
      }
      calculate_gs1_check_digit: { Args: { base13: string }; Returns: string }
      calculate_inventory_impact_for_product: {
        Args: {
          p_product_id: string
          p_recipe_quantity: number
          p_recipe_unit: string
          p_restaurant_id: string
        }
        Returns: number
      }
      calculate_square_daily_pnl: {
        Args: { p_restaurant_id: string; p_service_date: string }
        Returns: string
      }
      calculate_worked_hours: {
        Args: {
          p_employee_id: string
          p_end_date: string
          p_start_date: string
        }
        Returns: {
          break_hours: number
          regular_hours: number
          total_hours: number
        }[]
      }
      cancel_shift_trade: {
        Args: { p_employee_id: string; p_trade_id: string }
        Returns: Json
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
      check_availability_conflict: {
        Args: {
          p_employee_id: string
          p_end_time: string
          p_restaurant_id: string
          p_start_time: string
        }
        Returns: {
          conflict_type: string
          has_conflict: boolean
          message: string
        }[]
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
      check_timeoff_conflict: {
        Args: {
          p_employee_id: string
          p_end_time: string
          p_start_time: string
        }
        Returns: {
          end_date: string
          has_conflict: boolean
          start_date: string
          status: string
          time_off_id: string
        }[]
      }
      cleanup_expired_invitations: { Args: never; Returns: undefined }
      cleanup_old_audit_logs: { Args: never; Returns: undefined }
      cleanup_rate_limit_logs: { Args: never; Returns: undefined }
      complete_production_run: {
        Args: {
          p_actual_yield: number
          p_actual_yield_unit: Database["public"]["Enums"]["measurement_unit"]
          p_ingredients?: Json
          p_run_id: string
        }
        Returns: {
          actual_total_cost: number | null
          actual_yield: number | null
          actual_yield_unit:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          completed_at: string | null
          cost_per_unit: number | null
          created_at: string
          created_by: string | null
          expected_total_cost: number | null
          id: string
          notes: string | null
          prep_recipe_id: string
          prepared_by: string | null
          restaurant_id: string
          scheduled_for: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["production_run_status"]
          target_yield: number | null
          target_yield_unit:
            | Database["public"]["Enums"]["measurement_unit"]
            | null
          updated_at: string
          variance_percent: number | null
        }
        SetofOptions: {
          from: "*"
          to: "production_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      compute_account_balance: {
        Args: { p_account_id: string; p_as_of_date?: string }
        Returns: number
      }
      create_restaurant_with_owner: {
        Args: {
          restaurant_address?: string
          restaurant_cuisine_type?: string
          restaurant_name: string
          restaurant_phone?: string
          restaurant_timezone?: string
        }
        Returns: string
      }
      daitch_mokotoff: { Args: { "": string }; Returns: string[] }
      deactivate_employee: {
        Args: {
          p_deactivated_by: string
          p_employee_id: string
          p_reason?: string
          p_remove_from_future_shifts?: boolean
          p_termination_date?: string
        }
        Returns: {
          allocate_daily: boolean | null
          compensation_type: string
          contractor_payment_amount: number | null
          contractor_payment_interval: string | null
          created_at: string | null
          daily_rate_amount: number | null
          daily_rate_reference_days: number | null
          daily_rate_reference_weekly: number | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          email: string | null
          hire_date: string | null
          hourly_rate: number
          id: string
          is_active: boolean
          last_active_date: string | null
          name: string
          notes: string | null
          pay_period_type: string | null
          phone: string | null
          position: string
          reactivated_at: string | null
          reactivated_by: string | null
          requires_time_punch: boolean | null
          restaurant_id: string
          salary_amount: number | null
          status: string
          termination_date: string | null
          tip_eligible: boolean | null
          updated_at: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "employees"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_bank_transaction: {
        Args: { p_restaurant_id: string; p_transaction_id: string }
        Returns: Json
      }
      dmetaphone: { Args: { "": string }; Returns: string }
      dmetaphone_alt: { Args: { "": string }; Returns: string }
      exclude_bank_transaction: {
        Args: { p_reason?: string; p_transaction_id: string }
        Returns: Json
      }
      find_matching_rules_for_bank_transaction: {
        Args: { p_restaurant_id: string; p_transaction: Json }
        Returns: {
          category_id: string
          is_split_rule: boolean
          priority: number
          rule_id: string
          rule_name: string
          split_categories: Json
        }[]
      }
      find_matching_rules_for_pos_sale: {
        Args: { p_restaurant_id: string; p_sale: Json }
        Returns: {
          category_id: string
          is_split_rule: boolean
          priority: number
          rule_id: string
          rule_name: string
          split_categories: Json
        }[]
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
      generate_po_number: { Args: { p_restaurant_id: string }; Returns: string }
      get_account_subtypes: { Args: never; Returns: Json }
      get_current_employee_id: {
        Args: { p_restaurant_id: string }
        Returns: string
      }
      get_effective_subscription_tier: {
        Args: { p_restaurant_id: string }
        Returns: string
      }
      get_employee_punch_status: {
        Args: { p_employee_id: string }
        Returns: {
          is_clocked_in: boolean
          last_punch_time: string
          last_punch_type: string
          on_break: boolean
        }[]
      }
      get_monthly_sales_metrics: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_restaurant_id: string
        }
        Returns: {
          discounts: number
          gross_revenue: number
          other_liabilities: number
          period: string
          sales_tax: number
          tips: number
        }[]
      }
      get_owner_restaurant_count: {
        Args: { p_user_id?: string }
        Returns: number
      }
      get_pass_through_totals: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_restaurant_id: string
        }
        Returns: {
          adjustment_type: string
          total_amount: number
          transaction_count: number
        }[]
      }
      get_product_cost_per_recipe_unit: {
        Args: { product_id: string }
        Returns: number
      }
      get_revenue_by_account: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_restaurant_id: string
        }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          account_subtype: string
          account_type: string
          is_categorized: boolean
          total_amount: number
          transaction_count: number
        }[]
      }
      get_uncovered_bank_patterns: {
        Args: { p_limit?: number; p_restaurant_id: string }
        Returns: {
          amount_range: string
          category_code: string
          category_name: string
          date_range: string
          description: string
          merchant_name: string
          normalized_payee: string
          occurrence_count: number
          typical_amount: number
        }[]
      }
      get_uncovered_pos_patterns: {
        Args: { p_limit?: number; p_restaurant_id: string }
        Returns: {
          category_code: string
          category_name: string
          date_range: string
          item_name: string
          occurrence_count: number
          pos_category: string
          typical_price: number
        }[]
      }
      get_unified_sales_totals: {
        Args: {
          p_end_date?: string
          p_restaurant_id: string
          p_search_term?: string
          p_start_date?: string
        }
        Returns: {
          collected_at_pos: number
          discounts: number
          pass_through_amount: number
          revenue: number
          total_count: number
          unique_items: number
        }[]
      }
      get_users_by_ids: {
        Args: { user_ids: string[] }
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      get_volume_discount_percent: {
        Args: { p_location_count: number }
        Returns: number
      }
      has_subscription_feature: {
        Args: { p_feature: string; p_restaurant_id: string }
        Returns: boolean
      }
      hash_invitation_token: { Args: { token: string }; Returns: string }
      is_restaurant_owner: {
        Args: { p_restaurant_id: string; p_user_id: string }
        Returns: boolean
      }
      link_employee_to_user: {
        Args: { p_employee_id: string; p_user_id: string }
        Returns: {
          employee_email: string
          employee_name: string
          message: string
          success: boolean
        }[]
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
      mark_stale_pending_outflows: { Args: never; Returns: undefined }
      matches_bank_transaction_rule: {
        Args: { p_rule_id: string; p_transaction: Json }
        Returns: boolean
      }
      matches_pos_sale_rule: {
        Args: { p_rule_id: string; p_sale: Json }
        Returns: boolean
      }
      post_asset_depreciation: {
        Args: {
          p_asset_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: string
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
      process_unified_inventory_deduction: {
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
      publish_schedule: {
        Args: {
          p_notes?: string
          p_restaurant_id: string
          p_week_end: string
          p_week_start: string
        }
        Returns: string
      }
      reactivate_employee: {
        Args: {
          p_employee_id: string
          p_new_hourly_rate?: number
          p_reactivated_by: string
        }
        Returns: {
          allocate_daily: boolean | null
          compensation_type: string
          contractor_payment_amount: number | null
          contractor_payment_interval: string | null
          created_at: string | null
          daily_rate_amount: number | null
          daily_rate_reference_days: number | null
          daily_rate_reference_weekly: number | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          email: string | null
          hire_date: string | null
          hourly_rate: number
          id: string
          is_active: boolean
          last_active_date: string | null
          name: string
          notes: string | null
          pay_period_type: string | null
          phone: string | null
          position: string
          reactivated_at: string | null
          reactivated_by: string | null
          requires_time_punch: boolean | null
          restaurant_id: string
          salary_amount: number | null
          status: string
          termination_date: string | null
          tip_eligible: boolean | null
          updated_at: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "employees"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rebuild_account_balances: {
        Args: { p_restaurant_id: string }
        Returns: number
      }
      reject_shift_trade: {
        Args: {
          p_manager_note?: string
          p_manager_user_id: string
          p_trade_id: string
        }
        Returns: Json
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
      soundex: { Args: { "": string }; Returns: string }
      split_asset: {
        Args: {
          p_asset_id: string
          p_restaurant_id: string
          p_split_quantity: number
        }
        Returns: string
      }
      split_bank_transaction: {
        Args: { p_splits: Json; p_transaction_id: string }
        Returns: Json
      }
      split_pos_sale: {
        Args: { p_sale_id: string; p_splits: Json }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      suggest_pending_outflow_matches: {
        Args: { p_pending_outflow_id?: string; p_restaurant_id: string }
        Returns: {
          amount_delta: number
          bank_transaction_id: string
          date_delta: number
          match_score: number
          payee_similarity: string
          pending_outflow_id: string
        }[]
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
      sync_all_shift4_to_unified_sales: {
        Args: never
        Returns: {
          restaurant_id: string
          rows_synced: number
        }[]
      }
      sync_all_toast_to_unified_sales: {
        Args: never
        Returns: {
          orders_synced: number
          restaurant_id: string
        }[]
      }
      sync_clover_to_unified_sales: {
        Args: { p_restaurant_id: string }
        Returns: number
      }
      sync_shift4_to_unified_sales: {
        Args: { p_restaurant_id: string }
        Returns: number
      }
      sync_square_to_unified_sales: {
        Args: { p_restaurant_id: string }
        Returns: number
      }
      sync_toast_to_unified_sales:
        | { Args: { p_restaurant_id: string }; Returns: number }
        | {
            Args: {
              p_end_date: string
              p_restaurant_id: string
              p_start_date: string
            }
            Returns: number
          }
      text_soundex: { Args: { "": string }; Returns: string }
      toast_sync_financial_breakdown: {
        Args: { p_order_guid: string; p_restaurant_id: string }
        Returns: number
      }
      trigger_square_periodic_sync: { Args: never; Returns: undefined }
      unaccent: { Args: { "": string }; Returns: string }
      unpublish_schedule: {
        Args: {
          p_reason?: string
          p_restaurant_id: string
          p_week_end: string
          p_week_start: string
        }
        Returns: number
      }
      update_prep_recipe_ingredients: {
        Args: { p_ingredients?: Json; p_prep_recipe_id: string }
        Returns: undefined
      }
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
      user_has_capability: {
        Args: { p_capability: string; p_restaurant_id: string }
        Returns: boolean
      }
      user_has_role: {
        Args: { p_restaurant_id: string; p_roles: string[] }
        Returns: boolean
      }
      user_is_collaborator: {
        Args: { p_restaurant_id: string }
        Returns: boolean
      }
      user_is_internal_team: {
        Args: { p_restaurant_id: string }
        Returns: boolean
      }
      validate_split_config: {
        Args: { p_split_config: Json }
        Returns: boolean
      }
      verify_employee_can_login: {
        Args: { p_user_id?: string }
        Returns: {
          can_login: boolean
          employee_id: string
          employee_name: string
          is_active: boolean
          reason: string
        }[]
      }
      verify_employee_pin: {
        Args: { p_pin: string; p_restaurant_id: string }
        Returns: {
          employee_id: string
          employee_name: string
          is_valid: boolean
          reason: string
        }[]
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
        | "depreciation"
      account_type_enum:
        | "asset"
        | "liability"
        | "equity"
        | "revenue"
        | "expense"
        | "cogs"
      asset_status_enum: "active" | "disposed" | "fully_depreciated"
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
      production_run_status:
        | "planned"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "draft"
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
        "depreciation",
      ],
      account_type_enum: [
        "asset",
        "liability",
        "equity",
        "revenue",
        "expense",
        "cogs",
      ],
      asset_status_enum: ["active", "disposed", "fully_depreciated"],
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
      production_run_status: [
        "planned",
        "in_progress",
        "completed",
        "cancelled",
        "draft",
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
