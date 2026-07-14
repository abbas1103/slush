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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          id: string
          ip: string | null
          metadata: Json | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      booking_extras: {
        Row: {
          booking_id: string
          created_at: string
          extra_id: string
          extra_tier_id: string | null
          id: string
          price_at_booking: number
          quantity: number
        }
        Insert: {
          booking_id: string
          created_at?: string
          extra_id: string
          extra_tier_id?: string | null
          id?: string
          price_at_booking: number
          quantity?: number
        }
        Update: {
          booking_id?: string
          created_at?: string
          extra_id?: string
          extra_tier_id?: string | null
          id?: string
          price_at_booking?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_extras_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_extras_extra_id_fkey"
            columns: ["extra_id"]
            isOneToOne: false
            referencedRelation: "extras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_extras_extra_tier_id_fkey"
            columns: ["extra_tier_id"]
            isOneToOne: false
            referencedRelation: "extra_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          access_needs: string | null
          created_at: string
          id: string
          insurance_choice: string | null
          insurance_details: Json | null
          reference: string
          status: Database["public"]["Enums"]["booking_status"]
          trip_code_id: string | null
          trip_id: string
          user_id: string
        }
        Insert: {
          access_needs?: string | null
          created_at?: string
          id?: string
          insurance_choice?: string | null
          insurance_details?: Json | null
          reference: string
          status?: Database["public"]["Enums"]["booking_status"]
          trip_code_id?: string | null
          trip_id: string
          user_id: string
        }
        Update: {
          access_needs?: string | null
          created_at?: string
          id?: string
          insurance_choice?: string | null
          insurance_details?: Json | null
          reference?: string
          status?: Database["public"]["Enums"]["booking_status"]
          trip_code_id?: string | null
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_trip_code_id_fkey"
            columns: ["trip_code_id"]
            isOneToOne: false
            referencedRelation: "trip_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_availability"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          booking_id: string | null
          created_at: string
          health_data_consent: boolean
          health_data_consent_at: string | null
          id: string
          marketing_opt_in: boolean
          marketing_opt_in_at: string | null
          share_access_needs_at: string | null
          share_access_needs_with_resort: boolean
          terms_accepted_at: string | null
          terms_version: string | null
          user_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          health_data_consent?: boolean
          health_data_consent_at?: string | null
          id?: string
          marketing_opt_in?: boolean
          marketing_opt_in_at?: string | null
          share_access_needs_at?: string | null
          share_access_needs_with_resort?: boolean
          terms_accepted_at?: string | null
          terms_version?: string | null
          user_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          health_data_consent?: boolean
          health_data_consent_at?: string | null
          id?: string
          marketing_opt_in?: boolean
          marketing_opt_in_at?: string | null
          share_access_needs_at?: string | null
          share_access_needs_with_resort?: boolean
          terms_accepted_at?: string | null
          terms_version?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      damage_deposits: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          id: string
          refunded_at: string | null
          status: Database["public"]["Enums"]["damage_status"]
          stripe_payment_intent_id: string | null
          stripe_refund_id: string | null
          withheld_amount: number
        }
        Insert: {
          amount?: number
          booking_id: string
          created_at?: string
          id?: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["damage_status"]
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          withheld_amount?: number
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          id?: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["damage_status"]
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          withheld_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "damage_deposits_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_contacts: {
        Row: {
          created_at: string
          full_name: string
          id: string
          phone: string
          relationship: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          phone: string
          relationship?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          phone?: string
          relationship?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      extra_tiers: {
        Row: {
          extra_id: string
          id: string
          name: string
          price: number
          sort_order: number
        }
        Insert: {
          extra_id: string
          id?: string
          name: string
          price: number
          sort_order?: number
        }
        Update: {
          extra_id?: string
          id?: string
          name?: string
          price?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "extra_tiers_extra_id_fkey"
            columns: ["extra_id"]
            isOneToOne: false
            referencedRelation: "extras"
            referencedColumns: ["id"]
          },
        ]
      }
      extras: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          has_quality_tiers: boolean
          id: string
          name: string
          price: number | null
          price_tbc: boolean
          single_select_group: string | null
          sort_order: number
          trip_id: string
          type: Database["public"]["Enums"]["extra_type"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          has_quality_tiers?: boolean
          id?: string
          name: string
          price?: number | null
          price_tbc?: boolean
          single_select_group?: string | null
          sort_order?: number
          trip_id: string
          type: Database["public"]["Enums"]["extra_type"]
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          has_quality_tiers?: boolean
          id?: string
          name?: string
          price?: number | null
          price_tbc?: boolean
          single_select_group?: string | null
          sort_order?: number
          trip_id?: string
          type?: Database["public"]["Enums"]["extra_type"]
        }
        Relationships: [
          {
            foreignKeyName: "extras_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_availability"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "extras_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      holds: {
        Row: {
          booking_id: string | null
          created_at: string
          expires_at: string
          id: string
          is_waitlist: boolean
          status: Database["public"]["Enums"]["hold_status"]
          trip_id: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          is_waitlist?: boolean
          status?: Database["public"]["Enums"]["hold_status"]
          trip_id: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          is_waitlist?: boolean
          status?: Database["public"]["Enums"]["hold_status"]
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "holds_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holds_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_availability"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "holds_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holds_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          currency: string
          id: string
          status: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          stripe_refund_id: string | null
          type: Database["public"]["Enums"]["payment_type"]
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          currency?: string
          id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          type: Database["public"]["Enums"]["payment_type"]
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          currency?: string
          id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          type?: Database["public"]["Enums"]["payment_type"]
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          id: string
          payload: Json | null
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          id: string
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          id?: string
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      trip_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          trip_id: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          trip_id: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_codes_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip_availability"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "trip_codes_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          balance_due_date: string | null
          base_inclusions: Json
          base_price: number
          capacity: number
          confirmed_count: number
          country: string
          created_at: string
          damage_deposit_amount: number
          deposit_amount: number
          description: string | null
          downpayment_amount: number
          end_date: string
          id: string
          name: string
          nights: number
          organiser: string
          resort: string
          start_date: string
          status: Database["public"]["Enums"]["trip_status"]
        }
        Insert: {
          balance_due_date?: string | null
          base_inclusions?: Json
          base_price: number
          capacity?: number
          confirmed_count?: number
          country: string
          created_at?: string
          damage_deposit_amount?: number
          deposit_amount?: number
          description?: string | null
          downpayment_amount?: number
          end_date: string
          id?: string
          name: string
          nights: number
          organiser: string
          resort: string
          start_date: string
          status?: Database["public"]["Enums"]["trip_status"]
        }
        Update: {
          balance_due_date?: string | null
          base_inclusions?: Json
          base_price?: number
          capacity?: number
          confirmed_count?: number
          country?: string
          created_at?: string
          damage_deposit_amount?: number
          deposit_amount?: number
          description?: string | null
          downpayment_amount?: number
          end_date?: string
          id?: string
          name?: string
          nights?: number
          organiser?: string
          resort?: string
          start_date?: string
          status?: Database["public"]["Enums"]["trip_status"]
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          dob: string | null
          email: string
          first_name: string | null
          home_address: Json | null
          id: string
          last_name: string | null
          nationality: string | null
          passport_number: string | null
          phone: string | null
          student_id: string | null
          title: string | null
          university_society: string | null
        }
        Insert: {
          created_at?: string
          dob?: string | null
          email: string
          first_name?: string | null
          home_address?: Json | null
          id: string
          last_name?: string | null
          nationality?: string | null
          passport_number?: string | null
          phone?: string | null
          student_id?: string | null
          title?: string | null
          university_society?: string | null
        }
        Update: {
          created_at?: string
          dob?: string | null
          email?: string
          first_name?: string | null
          home_address?: Json | null
          id?: string
          last_name?: string | null
          nationality?: string | null
          passport_number?: string | null
          phone?: string | null
          student_id?: string | null
          title?: string | null
          university_society?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      trip_availability: {
        Row: {
          active_hold_count: number | null
          capacity: number | null
          confirmed_count: number | null
          effective_full: boolean | null
          is_full: boolean | null
          trip_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_convert_booking: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      booking_balance: { Args: { p_booking_id: string }; Returns: number }
      booking_trip_paid: { Args: { p_booking_id: string }; Returns: number }
      compute_trip_cost: { Args: { p_booking_id: string }; Returns: number }
      expire_stale_holds: { Args: never; Returns: number }
      extra_is_public: { Args: { p_extra_id: string }; Returns: boolean }
      generate_booking_reference: {
        Args: { p_trip_id: string }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      is_admin_mfa: { Args: never; Returns: boolean }
      record_payment_and_finalize: {
        Args: {
          p_amount_total: number
          p_booking_id: string
          p_charge_id: string
          p_intent_id: string
          p_kind: string
        }
        Returns: Database["public"]["Enums"]["booking_status"]
      }
      redeem_trip_code: { Args: { p_code: string }; Returns: string }
      release_hold: { Args: { p_booking_id: string }; Returns: undefined }
      start_booking: {
        Args: { p_trip_code_id: string }
        Returns: {
          booking_id: string
          expires_at: string
          is_waitlist: boolean
        }[]
      }
      trip_effective_full: { Args: { p_trip_id: string }; Returns: boolean }
      trip_is_public: { Args: { p_trip_id: string }; Returns: boolean }
    }
    Enums: {
      booking_status:
        | "pending"
        | "confirmed"
        | "waitlisted"
        | "converted"
        | "cancelled"
        | "refunded"
      damage_status: "held" | "refunded" | "withheld"
      extra_type: "transport" | "equipment" | "lessons" | "event" | "other"
      hold_status: "active" | "consumed" | "released" | "expired"
      payment_status:
        | "pending"
        | "processing"
        | "succeeded"
        | "failed"
        | "canceled"
        | "refunded"
      payment_type:
        | "deposit"
        | "balance"
        | "damage_deposit_hold"
        | "damage_deposit_refund"
        | "waitlist_refund"
      trip_status: "draft" | "live" | "closed"
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
      booking_status: [
        "pending",
        "confirmed",
        "waitlisted",
        "converted",
        "cancelled",
        "refunded",
      ],
      damage_status: ["held", "refunded", "withheld"],
      extra_type: ["transport", "equipment", "lessons", "event", "other"],
      hold_status: ["active", "consumed", "released", "expired"],
      payment_status: [
        "pending",
        "processing",
        "succeeded",
        "failed",
        "canceled",
        "refunded",
      ],
      payment_type: [
        "deposit",
        "balance",
        "damage_deposit_hold",
        "damage_deposit_refund",
        "waitlist_refund",
      ],
      trip_status: ["draft", "live", "closed"],
    },
  },
} as const
