export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      academic_years: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          is_current: boolean
          name: string
          school_id: string
          starts_on: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          is_current?: boolean
          name: string
          school_id: string
          starts_on: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          is_current?: boolean
          name?: string
          school_id?: string
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_years_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_targets: {
        Row: {
          announcement_id: string
          class_id: string | null
          id: string
          node_id: string | null
          school_id: string
        }
        Insert: {
          announcement_id: string
          class_id?: string | null
          id?: string
          node_id?: string | null
          school_id: string
        }
        Update: {
          announcement_id?: string
          class_id?: string | null
          id?: string
          node_id?: string | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_targets_announcement_id_school_id_fkey"
            columns: ["announcement_id", "school_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "announcement_targets_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "class_required_hours"
            referencedColumns: ["class_id", "school_id"]
          },
          {
            foreignKeyName: "announcement_targets_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "announcement_targets_node_id_school_id_fkey"
            columns: ["node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "announcement_targets_node_id_school_id_fkey"
            columns: ["node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "resolved_node_subject_hours"
            referencedColumns: ["node_id", "school_id"]
          },
        ]
      }
      announcements: {
        Row: {
          author_member_id: string
          body: string
          created_at: string
          event_id: string | null
          id: string
          priority: string
          published_at: string | null
          school_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          author_member_id: string
          body: string
          created_at?: string
          event_id?: string | null
          id?: string
          priority?: string
          published_at?: string | null
          school_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          author_member_id?: string
          body?: string
          created_at?: string
          event_id?: string | null
          id?: string
          priority?: string
          published_at?: string | null
          school_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_event_id_school_id_fkey"
            columns: ["event_id", "school_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "announcements_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          class_id: string
          created_at: string
          id: string
          justification: string | null
          justified_at: string | null
          minutes_late: number | null
          recorded_by_member_id: string | null
          school_id: string
          session_date: string
          slot_id: string | null
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          id?: string
          justification?: string | null
          justified_at?: string | null
          minutes_late?: number | null
          recorded_by_member_id?: string | null
          school_id: string
          session_date: string
          slot_id?: string | null
          status: string
          student_id: string
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          id?: string
          justification?: string | null
          justified_at?: string | null
          minutes_late?: number | null
          recorded_by_member_id?: string | null
          school_id?: string
          session_date?: string
          slot_id?: string | null
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "class_required_hours"
            referencedColumns: ["class_id", "school_id"]
          },
          {
            foreignKeyName: "attendance_records_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "attendance_records_recorded_by_member_id_fkey"
            columns: ["recorded_by_member_id"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_slot_id_class_id_school_id_fkey"
            columns: ["slot_id", "class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "timetable_slots"
            referencedColumns: ["id", "class_id", "school_id"]
          },
          {
            foreignKeyName: "attendance_records_student_id_school_id_fkey"
            columns: ["student_id", "school_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "school_id"]
          },
        ]
      }
      case_messages: {
        Row: {
          author_member_id: string
          body: string
          case_id: string
          created_at: string
          id: string
          school_id: string
        }
        Insert: {
          author_member_id: string
          body: string
          case_id: string
          created_at?: string
          id?: string
          school_id: string
        }
        Update: {
          author_member_id?: string
          body?: string
          case_id?: string
          created_at?: string
          id?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_messages_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_messages_case_id_school_id_fkey"
            columns: ["case_id", "school_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id", "school_id"]
          },
        ]
      }
      cases: {
        Row: {
          created_at: string
          direction: string
          id: string
          opened_by_member_id: string
          parent_member_id: string
          parent_role: string
          resolved_at: string | null
          resolved_by_member_id: string | null
          school_id: string
          status: string
          student_id: string | null
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          direction: string
          id?: string
          opened_by_member_id: string
          parent_member_id: string
          parent_role?: string
          resolved_at?: string | null
          resolved_by_member_id?: string | null
          school_id: string
          status?: string
          student_id?: string | null
          subject: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          opened_by_member_id?: string
          parent_member_id?: string
          parent_role?: string
          resolved_at?: string | null
          resolved_by_member_id?: string | null
          school_id?: string
          status?: string
          student_id?: string | null
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_opened_by_member_id_fkey"
            columns: ["opened_by_member_id"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_parent_member_id_school_id_parent_role_fkey"
            columns: ["parent_member_id", "school_id", "parent_role"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id", "school_id", "role"]
          },
          {
            foreignKeyName: "cases_resolved_by_member_id_fkey"
            columns: ["resolved_by_member_id"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_student_id_school_id_fkey"
            columns: ["student_id", "school_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "school_id"]
          },
        ]
      }
      classes: {
        Row: {
          academic_year_id: string
          capacity: number | null
          created_at: string
          home_room_id: string | null
          id: string
          metadata: Json
          name: string
          node_id: string
          school_id: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          capacity?: number | null
          created_at?: string
          home_room_id?: string | null
          id?: string
          metadata?: Json
          name: string
          node_id: string
          school_id: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          capacity?: number | null
          created_at?: string
          home_room_id?: string | null
          id?: string
          metadata?: Json
          name?: string
          node_id?: string
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_academic_year_id_school_id_fkey"
            columns: ["academic_year_id", "school_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "classes_home_room_id_school_id_fkey"
            columns: ["home_room_id", "school_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "classes_node_id_school_id_fkey"
            columns: ["node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "classes_node_id_school_id_fkey"
            columns: ["node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "resolved_node_subject_hours"
            referencedColumns: ["node_id", "school_id"]
          },
          {
            foreignKeyName: "classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      curriculum_nodes: {
        Row: {
          code: string | null
          id: string
          kind: string
          metadata: Json
          name: string
          name_ar: string | null
          parent_id: string | null
          path: string[]
          position: number
          school_id: string
        }
        Insert: {
          code?: string | null
          id?: string
          kind: string
          metadata?: Json
          name: string
          name_ar?: string | null
          parent_id?: string | null
          path?: string[]
          position?: number
          school_id: string
        }
        Update: {
          code?: string | null
          id?: string
          kind?: string
          metadata?: Json
          name?: string
          name_ar?: string | null
          parent_id?: string | null
          path?: string[]
          position?: number
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_nodes_parent_id_school_id_fkey"
            columns: ["parent_id", "school_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "curriculum_nodes_parent_id_school_id_fkey"
            columns: ["parent_id", "school_id"]
            isOneToOne: false
            referencedRelation: "resolved_node_subject_hours"
            referencedColumns: ["node_id", "school_id"]
          },
          {
            foreignKeyName: "curriculum_nodes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      curriculum_template_hours: {
        Row: {
          id: string
          max_session_minutes: number | null
          max_sessions_per_day: number
          min_session_minutes: number | null
          node_code: string
          source: string | null
          status: string
          subject_code: string
          subject_name: string
          template_code: string
          weekly_minutes: number
        }
        Insert: {
          id?: string
          max_session_minutes?: number | null
          max_sessions_per_day?: number
          min_session_minutes?: number | null
          node_code: string
          source?: string | null
          status?: string
          subject_code: string
          subject_name: string
          template_code: string
          weekly_minutes: number
        }
        Update: {
          id?: string
          max_session_minutes?: number | null
          max_sessions_per_day?: number
          min_session_minutes?: number | null
          node_code?: string
          source?: string | null
          status?: string
          subject_code?: string
          subject_name?: string
          template_code?: string
          weekly_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_template_hours_template_code_fkey"
            columns: ["template_code"]
            isOneToOne: false
            referencedRelation: "curriculum_templates"
            referencedColumns: ["code"]
          },
        ]
      }
      curriculum_templates: {
        Row: {
          code: string
          country_code: string | null
          id: string
          name: string
          tree: Json
        }
        Insert: {
          code: string
          country_code?: string | null
          id?: string
          name: string
          tree: Json
        }
        Update: {
          code?: string
          country_code?: string | null
          id?: string
          name?: string
          tree?: Json
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          academic_year_id: string
          class_id: string
          created_at: string
          ended_on: string | null
          id: string
          school_id: string
          started_on: string | null
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          class_id: string
          created_at?: string
          ended_on?: string | null
          id?: string
          school_id: string
          started_on?: string | null
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          class_id?: string
          created_at?: string
          ended_on?: string | null
          id?: string
          school_id?: string
          started_on?: string | null
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_class_id_academic_year_id_school_id_fkey"
            columns: ["class_id", "academic_year_id", "school_id"]
            isOneToOne: false
            referencedRelation: "class_required_hours"
            referencedColumns: ["class_id", "academic_year_id", "school_id"]
          },
          {
            foreignKeyName: "enrollments_class_id_academic_year_id_school_id_fkey"
            columns: ["class_id", "academic_year_id", "school_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id", "academic_year_id", "school_id"]
          },
          {
            foreignKeyName: "enrollments_student_id_school_id_fkey"
            columns: ["student_id", "school_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "school_id"]
          },
        ]
      }
      event_targets: {
        Row: {
          class_id: string | null
          event_id: string
          id: string
          node_id: string | null
          school_id: string
        }
        Insert: {
          class_id?: string | null
          event_id: string
          id?: string
          node_id?: string | null
          school_id: string
        }
        Update: {
          class_id?: string | null
          event_id?: string
          id?: string
          node_id?: string | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_targets_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "class_required_hours"
            referencedColumns: ["class_id", "school_id"]
          },
          {
            foreignKeyName: "event_targets_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "event_targets_event_id_school_id_fkey"
            columns: ["event_id", "school_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "event_targets_node_id_school_id_fkey"
            columns: ["node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "event_targets_node_id_school_id_fkey"
            columns: ["node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "resolved_node_subject_hours"
            referencedColumns: ["node_id", "school_id"]
          },
        ]
      }
      events: {
        Row: {
          all_day: boolean
          created_at: string
          created_by_member_id: string | null
          description: string | null
          ends_at: string | null
          id: string
          kind: string
          location: string | null
          needs_preparation: boolean
          preparation_notes: string | null
          school_id: string
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          created_at?: string
          created_by_member_id?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          kind?: string
          location?: string | null
          needs_preparation?: boolean
          preparation_notes?: string | null
          school_id: string
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          created_at?: string
          created_by_member_id?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          kind?: string
          location?: string | null
          needs_preparation?: boolean
          preparation_notes?: string | null
          school_id?: string
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_installments: {
        Row: {
          academic_year_id: string
          amount_due: number
          created_at: string
          due_on: string
          fee_plan_id: string | null
          id: string
          label: string
          school_id: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          amount_due: number
          created_at?: string
          due_on: string
          fee_plan_id?: string | null
          id?: string
          label: string
          school_id: string
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          amount_due?: number
          created_at?: string
          due_on?: string
          fee_plan_id?: string | null
          id?: string
          label?: string
          school_id?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_installments_academic_year_id_school_id_fkey"
            columns: ["academic_year_id", "school_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "fee_installments_fee_plan_id_school_id_fkey"
            columns: ["fee_plan_id", "school_id"]
            isOneToOne: false
            referencedRelation: "fee_plans"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "fee_installments_student_id_school_id_fkey"
            columns: ["student_id", "school_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "school_id"]
          },
        ]
      }
      fee_plans: {
        Row: {
          academic_year_id: string
          amount: number
          created_at: string
          frequency: string
          id: string
          name: string
          node_id: string | null
          school_id: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          amount: number
          created_at?: string
          frequency: string
          id?: string
          name: string
          node_id?: string | null
          school_id: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          amount?: number
          created_at?: string
          frequency?: string
          id?: string
          name?: string
          node_id?: string | null
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_plans_academic_year_id_school_id_fkey"
            columns: ["academic_year_id", "school_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "fee_plans_node_id_school_id_fkey"
            columns: ["node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "fee_plans_node_id_school_id_fkey"
            columns: ["node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "resolved_node_subject_hours"
            referencedColumns: ["node_id", "school_id"]
          },
          {
            foreignKeyName: "fee_plans_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      homework: {
        Row: {
          assigned_on: string
          author_member_id: string
          author_role: string
          body: string
          class_id: string
          created_at: string
          due_on: string | null
          id: string
          school_id: string
          subject_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_on?: string
          author_member_id: string
          author_role?: string
          body: string
          class_id: string
          created_at?: string
          due_on?: string | null
          id?: string
          school_id: string
          subject_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_on?: string
          author_member_id?: string
          author_role?: string
          body?: string
          class_id?: string
          created_at?: string
          due_on?: string | null
          id?: string
          school_id?: string
          subject_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_author_member_id_school_id_author_role_fkey"
            columns: ["author_member_id", "school_id", "author_role"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id", "school_id", "role"]
          },
          {
            foreignKeyName: "homework_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "class_required_hours"
            referencedColumns: ["class_id", "school_id"]
          },
          {
            foreignKeyName: "homework_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "homework_subject_id_school_id_fkey"
            columns: ["subject_id", "school_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id", "school_id"]
          },
        ]
      }
      node_progressions: {
        Row: {
          from_node_id: string
          id: string
          is_default: boolean
          school_id: string
          to_node_id: string
        }
        Insert: {
          from_node_id: string
          id?: string
          is_default?: boolean
          school_id: string
          to_node_id: string
        }
        Update: {
          from_node_id?: string
          id?: string
          is_default?: boolean
          school_id?: string
          to_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_progressions_from_node_id_school_id_fkey"
            columns: ["from_node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "node_progressions_from_node_id_school_id_fkey"
            columns: ["from_node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "resolved_node_subject_hours"
            referencedColumns: ["node_id", "school_id"]
          },
          {
            foreignKeyName: "node_progressions_to_node_id_school_id_fkey"
            columns: ["to_node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "node_progressions_to_node_id_school_id_fkey"
            columns: ["to_node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "resolved_node_subject_hours"
            referencedColumns: ["node_id", "school_id"]
          },
        ]
      }
      node_subject_hours: {
        Row: {
          academic_year_id: string
          created_at: string
          id: string
          max_session_minutes: number | null
          max_sessions_per_day: number
          min_session_minutes: number | null
          node_id: string
          school_id: string
          status: string
          subject_id: string
          updated_at: string
          weekly_minutes: number
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          id?: string
          max_session_minutes?: number | null
          max_sessions_per_day?: number
          min_session_minutes?: number | null
          node_id: string
          school_id: string
          status?: string
          subject_id: string
          updated_at?: string
          weekly_minutes: number
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          id?: string
          max_session_minutes?: number | null
          max_sessions_per_day?: number
          min_session_minutes?: number | null
          node_id?: string
          school_id?: string
          status?: string
          subject_id?: string
          updated_at?: string
          weekly_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "node_subject_hours_academic_year_id_school_id_fkey"
            columns: ["academic_year_id", "school_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "node_subject_hours_node_id_school_id_fkey"
            columns: ["node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "curriculum_nodes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "node_subject_hours_node_id_school_id_fkey"
            columns: ["node_id", "school_id"]
            isOneToOne: false
            referencedRelation: "resolved_node_subject_hours"
            referencedColumns: ["node_id", "school_id"]
          },
          {
            foreignKeyName: "node_subject_hours_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_subject_hours_subject_id_school_id_fkey"
            columns: ["subject_id", "school_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id", "school_id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          body: string
          channel: string
          created_at: string
          id: string
          kind: string
          recipient_user_id: string | null
          ref_id: string | null
          school_id: string
          status: string
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          id?: string
          kind: string
          recipient_user_id?: string | null
          ref_id?: string | null
          school_id: string
          status?: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          id?: string
          kind?: string
          recipient_user_id?: string | null
          ref_id?: string | null
          school_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          announcement_id: string
          channel: string
          created_at: string
          error: string | null
          id: string
          provider_message_id: string | null
          read_at: string | null
          recipient_user_id: string
          school_id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          announcement_id: string
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          provider_message_id?: string | null
          read_at?: string | null
          recipient_user_id: string
          school_id: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          announcement_id?: string
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          provider_message_id?: string | null
          read_at?: string | null
          recipient_user_id?: string
          school_id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_announcement_id_school_id_fkey"
            columns: ["announcement_id", "school_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          installment_id: string
          method: string
          note: string | null
          paid_on: string
          recorded_by_member_id: string | null
          reference: string | null
          school_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          installment_id: string
          method?: string
          note?: string | null
          paid_on?: string
          recorded_by_member_id?: string | null
          reference?: string | null
          school_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          installment_id?: string
          method?: string
          note?: string | null
          paid_on?: string
          recorded_by_member_id?: string | null
          reference?: string | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_installment_id_school_id_fkey"
            columns: ["installment_id", "school_id"]
            isOneToOne: false
            referencedRelation: "fee_installments"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "payments_installment_id_school_id_fkey"
            columns: ["installment_id", "school_id"]
            isOneToOne: false
            referencedRelation: "installment_balances"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "payments_recorded_by_member_id_fkey"
            columns: ["recorded_by_member_id"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          capacity: number | null
          id: string
          name: string
          school_id: string
        }
        Insert: {
          capacity?: number | null
          id?: string
          name: string
          school_id: string
        }
        Update: {
          capacity?: number | null
          id?: string
          name?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_members: {
        Row: {
          created_at: string
          id: string
          role: string
          school_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          school_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          school_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_members_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      school_modules: {
        Row: {
          config: Json
          is_enabled: boolean
          module: string
          school_id: string
        }
        Insert: {
          config?: Json
          is_enabled?: boolean
          module: string
          school_id: string
        }
        Update: {
          config?: Json
          is_enabled?: boolean
          module?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_modules_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          country_code: string
          created_at: string
          currency: string
          default_locale: string
          id: string
          is_active: boolean
          name: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          currency?: string
          default_locale?: string
          id?: string
          is_active?: boolean
          name: string
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          currency?: string
          default_locale?: string
          id?: string
          is_active?: boolean
          name?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      student_guardians: {
        Row: {
          can_pick_up: boolean
          guardian_member_id: string
          guardian_role: string
          is_payer: boolean
          is_primary: boolean
          relationship: string | null
          school_id: string
          student_id: string
        }
        Insert: {
          can_pick_up?: boolean
          guardian_member_id: string
          guardian_role?: string
          is_payer?: boolean
          is_primary?: boolean
          relationship?: string | null
          school_id: string
          student_id: string
        }
        Update: {
          can_pick_up?: boolean
          guardian_member_id?: string
          guardian_role?: string
          is_payer?: boolean
          is_primary?: boolean
          relationship?: string | null
          school_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_guardians_guardian_member_id_school_id_guardian_ro_fkey"
            columns: ["guardian_member_id", "school_id", "guardian_role"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id", "school_id", "role"]
          },
          {
            foreignKeyName: "student_guardians_student_id_school_id_fkey"
            columns: ["student_id", "school_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "school_id"]
          },
        ]
      }
      students: {
        Row: {
          birth_date: string | null
          created_at: string
          external_refs: Json
          first_name: string
          gender: string | null
          id: string
          last_name: string
          member_id: string | null
          member_role: string
          metadata: Json
          school_id: string
          status: string
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          external_refs?: Json
          first_name: string
          gender?: string | null
          id?: string
          last_name: string
          member_id?: string | null
          member_role?: string
          metadata?: Json
          school_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          external_refs?: Json
          first_name?: string
          gender?: string | null
          id?: string
          last_name?: string
          member_id?: string | null
          member_role?: string
          metadata?: Json
          school_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_member_id_school_id_member_role_fkey"
            columns: ["member_id", "school_id", "member_role"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id", "school_id", "role"]
          },
          {
            foreignKeyName: "students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          code: string | null
          id: string
          name: string
          room_id: string | null
          school_id: string
        }
        Insert: {
          code?: string | null
          id?: string
          name: string
          room_id?: string | null
          school_id: string
        }
        Update: {
          code?: string | null
          id?: string
          name?: string
          room_id?: string | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_room_id_school_id_fkey"
            columns: ["room_id", "school_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_unavailability: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          kind: string
          reason: string | null
          school_id: string
          starts_at: string
          teacher_member_id: string
          teacher_role: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
          weekday: number
        }
        Insert: {
          created_at?: string
          ends_at?: string
          id?: string
          kind?: string
          reason?: string | null
          school_id: string
          starts_at?: string
          teacher_member_id: string
          teacher_role?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          weekday: number
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          kind?: string
          reason?: string | null
          school_id?: string
          starts_at?: string
          teacher_member_id?: string
          teacher_role?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "teacher_unavailability_teacher_member_id_school_id_teacher_fkey"
            columns: ["teacher_member_id", "school_id", "teacher_role"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id", "school_id", "role"]
          },
        ]
      }
      teaching_assignments: {
        Row: {
          class_id: string
          created_at: string
          id: string
          kind: string
          school_id: string
          subject_id: string | null
          teacher_member_id: string
          teacher_role: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          class_id: string
          created_at?: string
          id?: string
          kind?: string
          school_id: string
          subject_id?: string | null
          teacher_member_id: string
          teacher_role?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          class_id?: string
          created_at?: string
          id?: string
          kind?: string
          school_id?: string
          subject_id?: string | null
          teacher_member_id?: string
          teacher_role?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teaching_assignments_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "class_required_hours"
            referencedColumns: ["class_id", "school_id"]
          },
          {
            foreignKeyName: "teaching_assignments_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "teaching_assignments_subject_id_school_id_fkey"
            columns: ["subject_id", "school_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "teaching_assignments_teacher_member_id_school_id_teacher_r_fkey"
            columns: ["teacher_member_id", "school_id", "teacher_role"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id", "school_id", "role"]
          },
        ]
      }
      timetable_exceptions: {
        Row: {
          announcement_id: string | null
          class_id: string
          created_at: string
          created_by_member_id: string | null
          ends_at: string | null
          event_id: string | null
          exception_date: string
          id: string
          kind: string
          reason: string | null
          reason_code: string | null
          room_id: string | null
          school_id: string
          slot_id: string | null
          starts_at: string | null
          subject_id: string | null
          teacher_member_id: string | null
          teacher_role: string
          title: string | null
          updated_at: string
        }
        Insert: {
          announcement_id?: string | null
          class_id: string
          created_at?: string
          created_by_member_id?: string | null
          ends_at?: string | null
          event_id?: string | null
          exception_date: string
          id?: string
          kind: string
          reason?: string | null
          reason_code?: string | null
          room_id?: string | null
          school_id: string
          slot_id?: string | null
          starts_at?: string | null
          subject_id?: string | null
          teacher_member_id?: string | null
          teacher_role?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          announcement_id?: string | null
          class_id?: string
          created_at?: string
          created_by_member_id?: string | null
          ends_at?: string | null
          event_id?: string | null
          exception_date?: string
          id?: string
          kind?: string
          reason?: string | null
          reason_code?: string | null
          room_id?: string | null
          school_id?: string
          slot_id?: string | null
          starts_at?: string | null
          subject_id?: string | null
          teacher_member_id?: string | null
          teacher_role?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timetable_exceptions_announcement_id_school_id_fkey"
            columns: ["announcement_id", "school_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "timetable_exceptions_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "class_required_hours"
            referencedColumns: ["class_id", "school_id"]
          },
          {
            foreignKeyName: "timetable_exceptions_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "timetable_exceptions_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_exceptions_event_id_school_id_fkey"
            columns: ["event_id", "school_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "timetable_exceptions_room_id_school_id_fkey"
            columns: ["room_id", "school_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "timetable_exceptions_slot_id_class_id_school_id_fkey"
            columns: ["slot_id", "class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "timetable_slots"
            referencedColumns: ["id", "class_id", "school_id"]
          },
          {
            foreignKeyName: "timetable_exceptions_subject_id_school_id_fkey"
            columns: ["subject_id", "school_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "timetable_exceptions_teacher_member_id_school_id_teacher_r_fkey"
            columns: ["teacher_member_id", "school_id", "teacher_role"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id", "school_id", "role"]
          },
        ]
      }
      timetable_slots: {
        Row: {
          class_id: string
          created_at: string
          ends_at: string
          id: string
          is_locked: boolean
          room_id: string | null
          school_id: string
          starts_at: string
          subject_id: string | null
          teacher_member_id: string | null
          teacher_role: string
          title: string | null
          updated_at: string
          version_id: string
          weekday: number
        }
        Insert: {
          class_id: string
          created_at?: string
          ends_at: string
          id?: string
          is_locked?: boolean
          room_id?: string | null
          school_id: string
          starts_at: string
          subject_id?: string | null
          teacher_member_id?: string | null
          teacher_role?: string
          title?: string | null
          updated_at?: string
          version_id: string
          weekday: number
        }
        Update: {
          class_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          is_locked?: boolean
          room_id?: string | null
          school_id?: string
          starts_at?: string
          subject_id?: string | null
          teacher_member_id?: string | null
          teacher_role?: string
          title?: string | null
          updated_at?: string
          version_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "timetable_slots_room_id_school_id_fkey"
            columns: ["room_id", "school_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "timetable_slots_subject_id_school_id_fkey"
            columns: ["subject_id", "school_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "timetable_slots_teacher_member_id_school_id_teacher_role_fkey"
            columns: ["teacher_member_id", "school_id", "teacher_role"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id", "school_id", "role"]
          },
          {
            foreignKeyName: "timetable_slots_version_id_class_id_school_id_fkey"
            columns: ["version_id", "class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "timetable_versions"
            referencedColumns: ["id", "class_id", "school_id"]
          },
        ]
      }
      timetable_versions: {
        Row: {
          class_id: string
          created_at: string
          created_by_member_id: string | null
          effective_from: string
          effective_to: string | null
          id: string
          kind: string
          name: string
          published_at: string | null
          school_id: string
          status: string
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          created_by_member_id?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          kind?: string
          name: string
          published_at?: string | null
          school_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          created_by_member_id?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          kind?: string
          name?: string
          published_at?: string | null
          school_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timetable_versions_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "class_required_hours"
            referencedColumns: ["class_id", "school_id"]
          },
          {
            foreignKeyName: "timetable_versions_class_id_school_id_fkey"
            columns: ["class_id", "school_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "timetable_versions_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "school_members"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_provider_id: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          locale: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          auth_provider_id?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          locale?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          auth_provider_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          locale?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      class_required_hours: {
        Row: {
          academic_year_id: string | null
          class_id: string | null
          max_session_minutes: number | null
          max_sessions_per_day: number | null
          min_session_minutes: number | null
          school_id: string | null
          subject_id: string | null
          weekly_minutes: number | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_academic_year_id_school_id_fkey"
            columns: ["academic_year_id", "school_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_balances: {
        Row: {
          academic_year_id: string | null
          amount_due: number | null
          amount_paid: number | null
          amount_remaining: number | null
          due_on: string | null
          id: string | null
          label: string | null
          payment_status: string | null
          school_id: string | null
          student_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_installments_academic_year_id_school_id_fkey"
            columns: ["academic_year_id", "school_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id", "school_id"]
          },
          {
            foreignKeyName: "fee_installments_student_id_school_id_fkey"
            columns: ["student_id", "school_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "school_id"]
          },
        ]
      }
      resolved_node_subject_hours: {
        Row: {
          academic_year_id: string | null
          defined_on_node_id: string | null
          max_session_minutes: number | null
          max_sessions_per_day: number | null
          min_session_minutes: number | null
          node_id: string | null
          school_id: string | null
          subject_id: string | null
          weekly_minutes: number | null
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_nodes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_assignment_gaps: {
        Row: {
          class_id: string | null
          ends_at: string | null
          gap_from: string | null
          gap_to: string | null
          slot_id: string | null
          starts_at: string | null
          subject_id: string | null
          teacher_member_id: string | null
          version_id: string | null
          version_status: string | null
          weekday: number | null
        }
        Relationships: []
      }
      timetable_slot_rooms: {
        Row: {
          class_id: string | null
          room_id: string | null
          slot_id: string | null
          source: string | null
          version_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _insert_curriculum_children: {
        Args: { p_nodes: Json; p_parent_id: string; p_school_id: string }
        Returns: number
      }
      _template_hours_selection: {
        Args: {
          p_only_under: string[]
          p_school_id: string
          p_template_code: string
        }
        Returns: {
          max_session_minutes: number
          max_sessions_per_day: number
          min_session_minutes: number
          node_id: string
          status: string
          subject_code: string
          subject_name: string
          weekly_minutes: number
        }[]
      }
      apply_curriculum_template_hours: {
        Args: {
          p_academic_year_id: string
          p_only_under?: string[]
          p_school_id: string
          p_template_code: string
        }
        Returns: number
      }
      classes_under_node: {
        Args: { p_academic_year_id?: string; p_node_id: string }
        Returns: {
          class_id: string
        }[]
      }
      close_school_on: {
        Args: {
          p_date: string
          p_reason?: string
          p_reason_code?: string
          p_school_id: string
        }
        Returns: number
      }
      create_school: {
        Args: { p_name: string; p_settings?: Json; p_slug: string }
        Returns: string
      }
      fork_timetable_version: {
        Args: {
          p_class_id: string
          p_from: string
          p_kind?: string
          p_name: string
          p_to?: string
        }
        Returns: string
      }
      instantiate_curriculum_cycles: {
        Args: {
          p_cycle_codes: string[]
          p_school_id: string
          p_template_code: string
        }
        Returns: number
      }
      instantiate_curriculum_template: {
        Args: { p_school_id: string; p_template_code: string }
        Returns: number
      }
      justify_absence: {
        Args: { p_justification: string; p_record_id: string }
        Returns: undefined
      }
      publish_announcement: {
        Args: { p_announcement_id: string }
        Returns: number
      }
      publish_timetable_version: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      replace_class_teacher: {
        Args: {
          p_class_id: string
          p_from: string
          p_ignore_conflicts?: boolean
          p_new_teacher: string
          p_old_teacher: string
          p_subject_id?: string
        }
        Returns: number
      }
      roll_over_academic_year: {
        Args: {
          p_copy_classes?: boolean
          p_ends_on: string
          p_from_year_id: string
          p_name: string
          p_starts_on: string
        }
        Returns: string
      }
      room_double_bookings: {
        Args: { p_from: string; p_school_id: string; p_to: string }
        Returns: {
          class_a: string
          class_b: string
          ends_at: string
          first_date: string
          last_date: string
          occurrences: number
          room_id: string
          starts_at: string
          weekday: number
        }[]
      }
      set_current_academic_year: {
        Args: { p_year_id: string }
        Returns: undefined
      }
      teacher_day: {
        Args: { p_date: string; p_teacher_member_id: string }
        Returns: {
          class_id: string
          ends_at: string
          exception_id: string
          room_id: string
          slot_id: string
          starts_at: string
          status: string
          subject_id: string
          title: string
        }[]
      }
      teacher_replacement_conflicts: {
        Args: {
          p_class_id: string
          p_from: string
          p_new_teacher: string
          p_old_teacher: string
          p_subject_id?: string
        }
        Returns: {
          conflict: string
          detail: string
          ends_at: string
          other_class_id: string
          severity: string
          slot_id: string
          starts_at: string
          weekday: number
        }[]
      }
      teaching_assignments_on: {
        Args: { p_class_id: string; p_date: string }
        Returns: {
          class_id: string
          created_at: string
          id: string
          kind: string
          school_id: string
          subject_id: string | null
          teacher_member_id: string
          teacher_role: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "teaching_assignments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      timetable_day: {
        Args: { p_class_id: string; p_date: string }
        Returns: {
          ends_at: string
          exception_id: string
          reason: string
          reason_code: string
          room_id: string
          slot_id: string
          starts_at: string
          status: string
          subject_id: string
          teacher_member_id: string
          title: string
        }[]
      }
      timetable_on: {
        Args: { p_class_id: string; p_date: string }
        Returns: {
          class_id: string
          created_at: string
          ends_at: string
          id: string
          is_locked: boolean
          room_id: string | null
          school_id: string
          starts_at: string
          subject_id: string | null
          teacher_member_id: string | null
          teacher_role: string
          title: string | null
          updated_at: string
          version_id: string
          weekday: number
        }[]
        SetofOptions: {
          from: "*"
          to: "timetable_slots"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      timetable_version_on: {
        Args: { p_class_id: string; p_date: string }
        Returns: string
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

