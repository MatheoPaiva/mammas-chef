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
    PostgrestVersion: "14.1"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admins: {
        Row: {
          user_id: string
        }
        Insert: {
          user_id: string
        }
        Update: {
          user_id?: string
        }
        Relationships: []
      }
      app_logs: {
        Row: {
          created_at: string
          event_name: string
          event_type: string
          id: string
          metadata: Json | null
          page_url: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_name: string
          event_type: string
          id?: string
          metadata?: Json | null
          page_url?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_name?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          page_url?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      favorite_recipes: {
        Row: {
          created_at: string
          id: string
          recipe_data: Json
          recipe_title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipe_data: Json
          recipe_title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          recipe_data?: Json
          recipe_title?: string
          user_id?: string
        }
        Relationships: []
      }
      custom_recipes: {
        Row: {
          calories: number
          carbs: number
          created_at: string
          fats: number
          flavor_notes: string | null
          glucose_tip: string | null
          id: string
          ingredients: Json
          meal_type: string
          prep_time_minutes: number | null
          protein: number
          servings: number
          status: string
          steps: Json
          tags: Json
          title: string
          toddler_tip: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          calories: number
          carbs: number
          created_at?: string
          fats: number
          flavor_notes?: string | null
          glucose_tip?: string | null
          id?: string
          ingredients?: Json
          meal_type: string
          prep_time_minutes?: number | null
          protein: number
          servings: number
          status?: string
          steps?: Json
          tags?: Json
          title: string
          toddler_tip?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          calories?: number
          carbs?: number
          created_at?: string
          fats?: number
          flavor_notes?: string | null
          glucose_tip?: string | null
          id?: string
          ingredients?: Json
          meal_type?: string
          prep_time_minutes?: number | null
          protein?: number
          servings?: number
          status?: string
          steps?: Json
          tags?: Json
          title?: string
          toddler_tip?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meal_plan_days: {
        Row: {
          day_name: string
          id: string
          meal_plan_id: string
        }
        Insert: {
          day_name: string
          id?: string
          meal_plan_id: string
        }
        Update: {
          day_name?: string
          id?: string
          meal_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_plan_days_meal_plan_id_fkey"
            columns: ["meal_plan_id"]
            isOneToOne: false
            referencedRelation: "meal_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_plans: {
        Row: {
          created_at: string
          id: string
          notes: string
          pantry_items: Json
          prep_tips: Json | null
          skip_slots: Json
          start_date: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string
          pantry_items?: Json
          prep_tips?: Json | null
          skip_slots?: Json
          start_date?: string | null
          title?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string
          pantry_items?: Json
          prep_tips?: Json | null
          skip_slots?: Json
          start_date?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          allergies: string[] | null
          created_at: string
          dietary_preferences: string[] | null
          display_name: string | null
          glucose_friendly: boolean | null
          household_size: number | null
          id: string
          onboarding_complete: boolean | null
          preferred_cuisines: string[]
          toddler_friendly: boolean | null
          week_start_day: string
        }
        Insert: {
          allergies?: string[] | null
          created_at?: string
          dietary_preferences?: string[] | null
          display_name?: string | null
          glucose_friendly?: boolean | null
          household_size?: number | null
          id: string
          onboarding_complete?: boolean | null
          preferred_cuisines?: string[]
          toddler_friendly?: boolean | null
          week_start_day?: string
        }
        Update: {
          allergies?: string[] | null
          created_at?: string
          dietary_preferences?: string[] | null
          display_name?: string | null
          glucose_friendly?: boolean | null
          household_size?: number | null
          id?: string
          onboarding_complete?: boolean | null
          preferred_cuisines?: string[]
          toddler_friendly?: boolean | null
          week_start_day?: string
        }
        Relationships: []
      }
      recipe_cache: {
        Row: {
          cuisine_type: string | null
          diet_labels: Json | null
          edamam_uri: string
          fetched_at: string | null
          health_labels: Json | null
          id: string
          image_url: string | null
          ingredient_lines: Json
          meal_type: string | null
          nutrients: Json
          parsed_ingredients: Json | null
          servings: number | null
          source_url: string | null
          title: string
          total_time: number | null
        }
        Insert: {
          cuisine_type?: string | null
          diet_labels?: Json | null
          edamam_uri: string
          fetched_at?: string | null
          health_labels?: Json | null
          id?: string
          image_url?: string | null
          ingredient_lines: Json
          meal_type?: string | null
          nutrients: Json
          parsed_ingredients?: Json | null
          servings?: number | null
          source_url?: string | null
          title: string
          total_time?: number | null
        }
        Update: {
          cuisine_type?: string | null
          diet_labels?: Json | null
          edamam_uri?: string
          fetched_at?: string | null
          health_labels?: Json | null
          id?: string
          image_url?: string | null
          ingredient_lines?: Json
          meal_type?: string | null
          nutrients?: Json
          parsed_ingredients?: Json | null
          servings?: number | null
          source_url?: string | null
          title?: string
          total_time?: number | null
        }
        Relationships: []
      }
      recipes: {
        Row: {
          calories: number | null
          carbs: number | null
          caution_note: string | null
          cook_time: string | null
          day_id: string
          fats: number | null
          flavor_notes: string | null
          glucose_tip: string | null
          custom_recipe_id: string | null
          id: string
          ingredients: Json | null
          library_recipe_id: string | null
          meal_type: string
          prep_time: string | null
          protein: number | null
          servings: number | null
          source_meal_id: string | null
          status: string | null
          steps: Json | null
          storage: string | null
          tags: Json | null
          title: string
          toddler_tip: string | null
          total_time: string | null
          workflow: string | null
        }
        Insert: {
          calories?: number | null
          carbs?: number | null
          caution_note?: string | null
          cook_time?: string | null
          day_id: string
          fats?: number | null
          flavor_notes?: string | null
          glucose_tip?: string | null
          custom_recipe_id?: string | null
          id?: string
          ingredients?: Json | null
          library_recipe_id?: string | null
          meal_type: string
          prep_time?: string | null
          protein?: number | null
          servings?: number | null
          source_meal_id?: string | null
          status?: string | null
          steps?: Json | null
          storage?: string | null
          tags?: Json | null
          title: string
          toddler_tip?: string | null
          total_time?: string | null
          workflow?: string | null
        }
        Update: {
          calories?: number | null
          carbs?: number | null
          caution_note?: string | null
          cook_time?: string | null
          day_id?: string
          fats?: number | null
          flavor_notes?: string | null
          glucose_tip?: string | null
          custom_recipe_id?: string | null
          id?: string
          ingredients?: Json | null
          library_recipe_id?: string | null
          meal_type?: string
          prep_time?: string | null
          protein?: number | null
          servings?: number | null
          source_meal_id?: string | null
          status?: string | null
          steps?: Json | null
          storage?: string | null
          tags?: Json | null
          title?: string
          toddler_tip?: string | null
          total_time?: string | null
          workflow?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_custom_recipe_id_fkey"
            columns: ["custom_recipe_id"]
            isOneToOne: false
            referencedRelation: "custom_recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "meal_plan_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_library_recipe_id_fkey"
            columns: ["library_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipe_library"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_lists: {
        Row: {
          created_at: string
          id: string
          items: Json | null
          meal_plan_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          items?: Json | null
          meal_plan_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json | null
          meal_plan_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_lists_meal_plan_id_fkey"
            columns: ["meal_plan_id"]
            isOneToOne: false
            referencedRelation: "meal_plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
