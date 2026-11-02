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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_budget: {
        Row: { id: boolean; monthly_usd: number; shares: Json; weekly_pct: number; weekly_features: string[]; setup_usd: number; setup_days: number; regen_per_hour: number; auto_drafts_per_day: number; summaries_per_day: number; flag_multiple: number; flag_day_usd: number; updated_at: string }
        Insert: { id?: boolean; monthly_usd?: number; shares?: Json; weekly_pct?: number; weekly_features?: string[]; setup_usd?: number; setup_days?: number; regen_per_hour?: number; auto_drafts_per_day?: number; summaries_per_day?: number; flag_multiple?: number; flag_day_usd?: number; updated_at?: string }
        Update: { id?: boolean; monthly_usd?: number; shares?: Json; weekly_pct?: number; weekly_features?: string[]; setup_usd?: number; setup_days?: number; regen_per_hour?: number; auto_drafts_per_day?: number; summaries_per_day?: number; flag_multiple?: number; flag_day_usd?: number; updated_at?: string }
        Relationships: []
      }
      ai_status: {
        Row: { id: boolean; billing_paused_since: string | null; billing_checked_at: string | null; updated_at: string }
        Insert: { id?: boolean; billing_paused_since?: string | null; billing_checked_at?: string | null; updated_at?: string }
        Update: { id?: boolean; billing_paused_since?: string | null; billing_checked_at?: string | null; updated_at?: string }
        Relationships: []
      }
      analytics_daily: {
        Row: {
          day: string
          n: number
          name: string
          users: number
        }
        Insert: {
          day: string
          n: number
          name: string
          users: number
        }
        Update: {
          day?: string
          n?: number
          name?: string
          users?: number
        }
        Relationships: []
      }
      analytics_dropped: {
        Row: { day: string; n: number }
        Insert: { day: string; n: number }
        Update: { day?: string; n?: number }
        Relationships: []
      }
      analytics_events: {
        Row: {
          app_version: string | null
          at: string
          id: number
          name: string
          props: Json
          screen: string | null
          session: string | null
          size: string | null
          user_hash: string
        }
        Insert: {
          app_version?: string | null
          at?: string
          id?: never
          name: string
          props?: Json
          screen?: string | null
          session?: string | null
          size?: string | null
          user_hash: string
        }
        Update: {
          app_version?: string | null
          at?: string
          id?: never
          name?: string
          props?: Json
          screen?: string | null
          session?: string | null
          size?: string | null
          user_hash?: string
        }
        Relationships: []
      }
      analytics_user_day: {
        Row: { user_hash: string; day: string; events: number; active_events: number; sessions: number; opens: number; valued: number; drafts_sent: number; replies: number; triaged: number; junk_cleared: number; errors: number; ai_calls: number; ai_cost_micro: number; size: string | null }
        Insert: { user_hash: string; day: string; events: number; active_events: number; sessions: number; opens: number; valued: number; drafts_sent: number; replies: number; triaged: number; junk_cleared: number; errors: number; ai_calls: number; ai_cost_micro: number; size?: string | null }
        Update: { user_hash?: string; day?: string; events?: number; active_events?: number; sessions?: number; opens?: number; valued?: number; drafts_sent?: number; replies?: number; triaged?: number; junk_cleared?: number; errors?: number; ai_calls?: number; ai_cost_micro?: number; size?: string | null }
        Relationships: []
      }
      analytics_user_first: {
        Row: { user_hash: string; name: string; first_at: string }
        Insert: { user_hash: string; name: string; first_at: string }
        Update: { user_hash?: string; name?: string; first_at?: string }
        Relationships: []
      }
      analytics_rate: {
        Row: {
          n: number
          user_hash: string
          window_start: string
        }
        Insert: {
          n: number
          user_hash: string
          window_start: string
        }
        Update: {
          n?: number
          user_hash?: string
          window_start?: string
        }
        Relationships: []
      }
      account_credentials: {
        Row: {
          account_id: string
          ciphertext: string
          refreshed: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          ciphertext: string
          refreshed?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          ciphertext?: string
          refreshed?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_credentials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          address: string
          address_index: string | null
          created_at: string
          id: string
          inbox_name: string | null
          label: string
          last_synced_at: string | null
          pairing_code: string | null
          pairing_phone: string | null
          provider: string
          qr_code: string | null
          send_address_indexes: string[] | null
          send_addresses: string[]
          nickname: string | null
          status: string
          status_detail: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          address: string
          address_index?: string | null
          created_at?: string
          id?: string
          inbox_name?: string | null
          label: string
          last_synced_at?: string | null
          pairing_code?: string | null
          pairing_phone?: string | null
          provider: string
          qr_code?: string | null
          send_address_indexes?: string[] | null
          send_addresses?: string[]
          nickname?: string | null
          status?: string
          status_detail?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          address?: string
          address_index?: string | null
          created_at?: string
          id?: string
          inbox_name?: string | null
          label?: string
          last_synced_at?: string | null
          pairing_code?: string | null
          pairing_phone?: string | null
          provider?: string
          qr_code?: string | null
          send_address_indexes?: string[] | null
          send_addresses?: string[]
          nickname?: string | null
          status?: string
          status_detail?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      address_book_cards: {
        Row: {
          account_id: string
          card_key: string
          email_indexes: string[] | null
          emails: string[]
          id: string
          name: string | null
          phone_indexes: string[] | null
          phones: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          card_key: string
          email_indexes?: string[] | null
          emails?: string[]
          id?: string
          name?: string | null
          phone_indexes?: string[] | null
          phones?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          card_key?: string
          email_indexes?: string[] | null
          emails?: string[]
          id?: string
          name?: string | null
          phone_indexes?: string[] | null
          phones?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "address_book_cards_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          account_id: string | null
          cached_tokens: number
          cost_usd: number
          created_at: string
          feature: string
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          provider: string
          setup: boolean
          thread_id: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          cached_tokens?: number
          cost_usd?: number
          created_at?: string
          feature: string
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          provider?: string
          setup?: boolean
          thread_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          cached_tokens?: number
          cost_usd?: number
          created_at?: string
          feature?: string
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          provider?: string
          setup?: boolean
          thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      attachment_fetch_requests: {
        Row: {
          attachment_id: string
          claimed_at: string | null
          created_at: string
          error: string | null
          user_id: string
        }
        Insert: {
          attachment_id: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          user_id: string
        }
        Update: {
          attachment_id?: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachment_fetch_requests_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: true
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          content_hash: string | null
          created_at: string
          file_ext: string | null
          filename: string
          hidden: boolean
          hidden_reason: string | null
          id: string
          is_sticker: boolean
          keep_hint: boolean
          kind: string
          message_id: string
          mime_type: string | null
          not_kept: string | null
          provider_attachment_id: string | null
          sealed: boolean
          sent_at: string | null
          size_bytes: number | null
          storage_path: string | null
          team_key_version: number | null
          team_path: string | null
          thumb_path: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          file_ext?: string | null
          filename: string
          hidden?: boolean
          hidden_reason?: string | null
          id?: string
          is_sticker?: boolean
          keep_hint?: boolean
          kind?: string
          message_id: string
          mime_type?: string | null
          not_kept?: string | null
          provider_attachment_id?: string | null
          sealed?: boolean
          sent_at?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          team_key_version?: number | null
          team_path?: string | null
          thumb_path?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          file_ext?: string | null
          filename?: string
          hidden?: boolean
          hidden_reason?: string | null
          id?: string
          is_sticker?: boolean
          keep_hint?: boolean
          kind?: string
          message_id?: string
          mime_type?: string | null
          not_kept?: string | null
          provider_attachment_id?: string | null
          sealed?: boolean
          sent_at?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          team_key_version?: number | null
          team_path?: string | null
          thumb_path?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_parts: {
        Row: {
          audio: string | null
          audio_path: string | null
          brief_id: string
          seconds: number | null
          seq: number
          user_id: string
        }
        Insert: {
          audio?: string | null
          audio_path?: string | null
          brief_id: string
          seconds?: number | null
          seq: number
          user_id: string
        }
        Update: {
          audio?: string | null
          audio_path?: string | null
          brief_id?: string
          seconds?: number | null
          seq?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_parts_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_requests: {
        Row: {
          brief_id: string | null
          id: number
          requested_at: string
          user_id: string
        }
        Insert: {
          brief_id?: string | null
          id?: never
          requested_at?: string
          user_id: string
        }
        Update: {
          brief_id?: string | null
          id?: never
          requested_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_requests_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      briefs: {
        Row: {
          created_at: string
          error: string | null
          for_date: string
          id: string
          parts: number | null
          script: string | null
          seconds: number | null
          status: string
          updated_at: string
          user_id: string
          voice: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          for_date: string
          id?: string
          parts?: number | null
          script?: string | null
          seconds?: number | null
          status?: string
          updated_at?: string
          user_id?: string
          voice?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          for_date?: string
          id?: string
          parts?: number | null
          script?: string | null
          seconds?: number | null
          status?: string
          updated_at?: string
          user_id?: string
          voice?: string | null
        }
        Relationships: []
      }
      bulk_reads: {
        Row: {
          claimed_at: string | null
          created_at: string
          error: string | null
          message_id: string
          user_id: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          message_id: string
          user_id?: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_deletes: {
        Row: {
          account_id: string
          created_at: string
          done_at: string | null
          error: string | null
          event_id: string | null
          id: string
          scope: string
          status: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          done_at?: string | null
          error?: string | null
          event_id?: string | null
          id?: string
          scope?: string
          status?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          done_at?: string | null
          error?: string | null
          event_id?: string | null
          id?: string
          scope?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_deletes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_deletes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          account_id: string
          all_day: boolean
          attendees: Json
          calendar_id: string
          calendar_name: string | null
          conference_url: string | null
          description: string | null
          ends_at: string | null
          id: string
          location: string | null
          provider_event_id: string
          recurrence: string | null
          resource_url: string | null
          series_id: string | null
          starts_at: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          all_day?: boolean
          attendees?: Json
          calendar_id: string
          calendar_name?: string | null
          conference_url?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          location?: string | null
          provider_event_id: string
          recurrence?: string | null
          resource_url?: string | null
          series_id?: string | null
          starts_at: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          all_day?: boolean
          attendees?: Json
          calendar_id?: string
          calendar_name?: string | null
          conference_url?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          location?: string | null
          provider_event_id?: string
          recurrence?: string | null
          resource_url?: string | null
          series_id?: string | null
          starts_at?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_outbox: {
        Row: {
          account_id: string
          add_meet: boolean
          all_day: boolean
          attendees: string[]
          calendar_id: string
          created_at: string
          description: string | null
          done_at: string | null
          ends_at: string
          error: string | null
          html_link: string | null
          id: string
          location: string | null
          provider_event_id: string | null
          recurrence: string | null
          send_invites: boolean
          starts_at: string
          status: string
          time_zone: string
          title: string
          user_id: string
        }
        Insert: {
          account_id: string
          add_meet?: boolean
          all_day?: boolean
          attendees?: string[]
          calendar_id?: string
          created_at?: string
          description?: string | null
          done_at?: string | null
          ends_at: string
          error?: string | null
          html_link?: string | null
          id?: string
          location?: string | null
          provider_event_id?: string | null
          recurrence?: string | null
          send_invites?: boolean
          starts_at: string
          status?: string
          time_zone: string
          title: string
          user_id?: string
        }
        Update: {
          account_id?: string
          add_meet?: boolean
          all_day?: boolean
          attendees?: string[]
          calendar_id?: string
          created_at?: string
          description?: string | null
          done_at?: string | null
          ends_at?: string
          error?: string | null
          html_link?: string | null
          id?: string
          location?: string | null
          provider_event_id?: string | null
          recurrence?: string | null
          send_invites?: boolean
          starts_at?: string
          status?: string
          time_zone?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_outbox_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_updates: {
        Row: {
          account_id: string
          all_day: boolean | null
          attendees: string[] | null
          created_at: string
          description: string | null
          done_at: string | null
          ends_at: string | null
          error: string | null
          event_id: string | null
          id: string
          kind: string
          location: string | null
          recurrence: string | null
          response: string | null
          scope: string
          send_invites: boolean
          starts_at: string | null
          status: string
          time_zone: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          all_day?: boolean | null
          attendees?: string[] | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          ends_at?: string | null
          error?: string | null
          event_id?: string | null
          id?: string
          kind: string
          location?: string | null
          recurrence?: string | null
          response?: string | null
          scope?: string
          send_invites?: boolean
          starts_at?: string | null
          status?: string
          time_zone?: string | null
          title?: string | null
          user_id?: string
        }
        Update: {
          account_id?: string
          all_day?: boolean | null
          attendees?: string[] | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          ends_at?: string | null
          error?: string | null
          event_id?: string | null
          id?: string
          kind?: string
          location?: string | null
          recurrence?: string | null
          response?: string | null
          scope?: string
          send_invites?: boolean
          starts_at?: string | null
          status?: string
          time_zone?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_updates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_updates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      company_logos: {
        Row: {
          candidates: Json
          changed_at: string | null
          checked_at: string | null
          created_at: string
          domain: string
          excluded: string[]
          gemini_calls: number
          gemini_cost_usd: number
          manual: boolean
          name: string
          path: string | null
          pick: number | null
          rejected: Json
          review_cleared_at: string | null
          round: number
          search_urls: string[]
          sheet_path: string | null
          source: string | null
          status: string
          updated_at: string
          url: string | null
          verdict: string | null
        }
        Insert: {
          candidates?: Json
          changed_at?: string | null
          checked_at?: string | null
          created_at?: string
          domain: string
          excluded?: string[]
          gemini_calls?: number
          gemini_cost_usd?: number
          manual?: boolean
          name: string
          path?: string | null
          pick?: number | null
          rejected?: Json
          review_cleared_at?: string | null
          round?: number
          search_urls?: string[]
          sheet_path?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          url?: string | null
          verdict?: string | null
        }
        Update: {
          candidates?: Json
          changed_at?: string | null
          checked_at?: string | null
          created_at?: string
          domain?: string
          excluded?: string[]
          gemini_calls?: number
          gemini_cost_usd?: number
          manual?: boolean
          name?: string
          path?: string | null
          pick?: number | null
          rejected?: Json
          review_cleared_at?: string | null
          round?: number
          search_urls?: string[]
          sheet_path?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          url?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      compliance_export_chats: {
        Row: {
          export_id: string
          thread_id: string
        }
        Insert: {
          export_id: string
          thread_id: string
        }
        Update: {
          export_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_export_chats_export_id_fkey"
            columns: ["export_id"]
            isOneToOne: false
            referencedRelation: "compliance_exports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_export_chats_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_exports: {
        Row: {
          chats: number
          client_label: string
          finished_at: string | null
          id: string
          messages: number | null
          started_at: string
          user_id: string
          workspace_contact_id: string | null
          workspace_id: string
        }
        Insert: {
          chats?: number
          client_label: string
          finished_at?: string | null
          id?: string
          messages?: number | null
          started_at?: string
          user_id: string
          workspace_contact_id?: string | null
          workspace_id: string
        }
        Update: {
          chats?: number
          client_label?: string
          finished_at?: string | null
          id?: string
          messages?: number | null
          started_at?: string
          user_id?: string
          workspace_contact_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_exports_workspace_contact_id_fkey"
            columns: ["workspace_contact_id"]
            isOneToOne: false
            referencedRelation: "workspace_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_exports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_opens: {
        Row: {
          id: number
          opened_at: string
          thread_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: number
          opened_at?: string
          thread_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: number
          opened_at?: string
          thread_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_opens_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_opens_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_identities: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          kind: string
          source: string
          user_id: string
          value: string
          value_index: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          kind: string
          source?: string
          user_id: string
          value: string
          value_index?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          kind?: string
          source?: string
          user_id?: string
          value?: string
          value_index?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_identities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_merges: {
        Row: {
          automatic: boolean
          created_at: string
          id: string
          kept_contact_id: string
          merged_contact_id: string
          merged_snapshot: Json
          moved: Json
          reason: string
          undone_at: string | null
          user_id: string
        }
        Insert: {
          automatic?: boolean
          created_at?: string
          id?: string
          kept_contact_id: string
          merged_contact_id: string
          merged_snapshot: Json
          moved: Json
          reason: string
          undone_at?: string | null
          user_id: string
        }
        Update: {
          automatic?: boolean
          created_at?: string
          id?: string
          kept_contact_id?: string
          merged_contact_id?: string
          merged_snapshot?: Json
          moved?: Json
          reason?: string
          undone_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      contact_suggestions: {
        Row: {
          contact_a: string
          contact_b: string
          created_at: string
          decided_at: string | null
          evidence: Json
          id: string
          reason: string
          score: number
          status: string
          user_id: string
        }
        Insert: {
          contact_a: string
          contact_b: string
          created_at?: string
          decided_at?: string | null
          evidence?: Json
          id?: string
          reason: string
          score?: number
          status?: string
          user_id: string
        }
        Update: {
          contact_a?: string
          contact_b?: string
          created_at?: string
          decided_at?: string | null
          evidence?: Json
          id?: string
          reason?: string
          score?: number
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          ai_summary: string | null
          hidden: boolean
          kind_override: string | null
          avatar_path: string | null
          avatar_source: string | null
          avatar_updated_at: string | null
          company: string | null
          created_at: string
          display_name: string
          id: string
          name_locked: boolean
          organization_id: string | null
          relationship: string | null
          role: string | null
          style_note: string | null
          style_updated_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          hidden?: boolean
          kind_override?: string | null
          avatar_path?: string | null
          avatar_source?: string | null
          avatar_updated_at?: string | null
          company?: string | null
          created_at?: string
          display_name: string
          id?: string
          name_locked?: boolean
          organization_id?: string | null
          relationship?: string | null
          role?: string | null
          style_note?: string | null
          style_updated_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          hidden?: boolean
          kind_override?: string | null
          avatar_path?: string | null
          avatar_source?: string | null
          avatar_updated_at?: string | null
          company?: string | null
          created_at?: string
          display_name?: string
          id?: string
          name_locked?: boolean
          organization_id?: string | null
          relationship?: string | null
          role?: string | null
          style_note?: string | null
          style_updated_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_outcomes: {
        Row: {
          contact_id: string | null
          created_at: string
          draft_body: string
          draft_id: string | null
          edit_ratio: number | null
          id: string
          sent_body: string
          thread_id: string
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          draft_body: string
          draft_id?: string | null
          edit_ratio?: number | null
          id?: string
          sent_body: string
          thread_id: string
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          draft_body?: string
          draft_id?: string | null
          edit_ratio?: number | null
          id?: string
          sent_body?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_outcomes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_outcomes_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_outcomes_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      drafts: {
        Row: {
          account_id: string | null
          audio_path: string | null
          auto: boolean
          body: string
          contact_id: string | null
          created_at: string
          decision: string | null
          decision_kind: string | null
          error: string | null
          for_message_id: string | null
          id: string
          instruction: string | null
          model: string | null
          source: string | null
          status: string
          subject: string | null
          thread_id: string | null
          tone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          audio_path?: string | null
          auto?: boolean
          body?: string
          contact_id?: string | null
          created_at?: string
          decision?: string | null
          decision_kind?: string | null
          error?: string | null
          for_message_id?: string | null
          id?: string
          instruction?: string | null
          model?: string | null
          source?: string | null
          status?: string
          subject?: string | null
          thread_id?: string | null
          tone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          audio_path?: string | null
          auto?: boolean
          body?: string
          contact_id?: string | null
          created_at?: string
          decision?: string | null
          decision_kind?: string | null
          error?: string | null
          for_message_id?: string | null
          id?: string
          instruction?: string | null
          model?: string | null
          source?: string | null
          status?: string
          subject?: string | null
          thread_id?: string | null
          tone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drafts_for_message_id_fkey"
            columns: ["for_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_originals: {
        Row: {
          created_at: string
          error: string | null
          html: string | null
          id: string
          message_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          html?: string | null
          id?: string
          message_id: string
          status?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          html?: string | null
          id?: string
          message_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_originals_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          created_at: string
          id: string
          message_id: string | null
          thread_id: string
          user_id: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id?: string | null
          thread_id: string
          user_id: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string | null
          thread_id?: string
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          checked_at: string
          expects_reply: boolean
          message_id: string
          thread_id: string
          user_id: string
        }
        Insert: {
          checked_at?: string
          expects_reply: boolean
          message_id: string
          thread_id: string
          user_id: string
        }
        Update: {
          checked_at?: string
          expects_reply?: boolean
          message_id?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: []
      }
      instagram_sign_ins: {
        Row: {
          account_id: string
          attempts: number
          code: string | null
          created_at: string
          method: string | null
          step: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          attempts?: number
          code?: string | null
          created_at?: string
          method?: string | null
          step: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          attempts?: number
          code?: string | null
          created_at?: string
          method?: string | null
          step?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_sign_ins_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_actions: {
        Row: {
          action: string
          claimed_at: string | null
          created_at: string
          done_at: string | null
          emoji: string | null
          error: string | null
          id: string
          message_id: string | null
          status: string
          thread_id: string
          user_id: string
        }
        Insert: {
          action: string
          claimed_at?: string | null
          created_at?: string
          done_at?: string | null
          emoji?: string | null
          error?: string | null
          id?: string
          message_id?: string | null
          status?: string
          thread_id: string
          user_id?: string
        }
        Update: {
          action?: string
          claimed_at?: string | null
          created_at?: string
          done_at?: string | null
          emoji?: string | null
          error?: string | null
          id?: string
          message_id?: string | null
          status?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_actions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_actions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_participants: {
        Row: {
          address: string | null
          contact_id: string | null
          id: string
          is_self: boolean
          meeting_id: string
          name: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          contact_id?: string | null
          id?: string
          is_self?: boolean
          meeting_id: string
          name?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          contact_id?: string | null
          id?: string
          is_self?: boolean
          meeting_id?: string
          name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_participants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          account_id: string
          action_items: string | null
          calendar_event_id: string | null
          created_at: string
          ended_at: string | null
          error: string | null
          id: string
          platform: string
          provider_meeting_id: string
          provider_meta: Json
          started_at: string
          status: string
          summary: string | null
          title: string | null
          transcript: string | null
          transcript_source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          action_items?: string | null
          calendar_event_id?: string | null
          created_at?: string
          ended_at?: string | null
          error?: string | null
          id?: string
          platform: string
          provider_meeting_id: string
          provider_meta?: Json
          started_at: string
          status?: string
          summary?: string | null
          title?: string | null
          transcript?: string | null
          transcript_source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          action_items?: string | null
          calendar_event_id?: string | null
          created_at?: string
          ended_at?: string | null
          error?: string | null
          id?: string
          platform?: string
          provider_meeting_id?: string
          provider_meta?: Json
          started_at?: string
          status?: string
          summary?: string | null
          title?: string | null
          transcript?: string | null
          transcript_source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_calendar_event_id_fkey"
            columns: ["calendar_event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      message_ai: {
        Row: {
          bulk_read: string | null
          category: string
          created_at: string
          junk: boolean
          message_id: string
          model: string | null
          needs_reply: boolean
          priority: string
          prompt_version: string | null
          reply_choices: string | null
          summary: string
          traits: Json | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          bulk_read?: string | null
          category: string
          created_at?: string
          junk?: boolean
          message_id: string
          model?: string | null
          needs_reply?: boolean
          priority: string
          prompt_version?: string | null
          reply_choices?: string | null
          summary: string
          traits?: Json | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          bulk_read?: string | null
          category?: string
          created_at?: string
          junk?: boolean
          message_id?: string
          model?: string | null
          needs_reply?: boolean
          priority?: string
          prompt_version?: string | null
          reply_choices?: string | null
          summary?: string
          traits?: Json | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_ai_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_ai_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      message_embeddings: {
        Row: {
          created_at: string
          embedding_data: string | null
          message_id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          embedding_data?: string | null
          message_id: string
          sent_at: string
          user_id: string
        }
        Update: {
          created_at?: string
          embedding_data?: string | null
          message_id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_embeddings_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          account_id: string
          body_html: string | null
          body_marks: string | null
          body_shrunk_at: string | null
          body_text: string | null
          created_at: string
          direction: string
          has_original: boolean
          id: string
          in_reply_to: string | null
          is_bulk: boolean
          is_read: boolean
          list_unsubscribe: string | null
          list_unsubscribe_post: boolean
          offers_unsubscribe: boolean
          preview: string | null
          provider_message_id: string
          provider_meta: Json
          reference_ids: string[]
          sender_address: string | null
          sender_contact_id: string | null
          sender_index: string | null
          sent_at: string
          subject: string | null
          subject_kept: boolean
          thread_id: string
          to_addresses: string[]
          to_indexes: string[] | null
          transcript: string | null
          transcript_status: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id: string
          body_html?: string | null
          body_marks?: string | null
          body_shrunk_at?: string | null
          body_text?: string | null
          created_at?: string
          direction: string
          has_original?: boolean
          id?: string
          in_reply_to?: string | null
          is_bulk?: boolean
          is_read?: boolean
          list_unsubscribe?: string | null
          list_unsubscribe_post?: boolean
          offers_unsubscribe?: boolean
          preview?: string | null
          provider_message_id: string
          provider_meta?: Json
          reference_ids?: string[]
          sender_address?: string | null
          sender_contact_id?: string | null
          sender_index?: string | null
          sent_at: string
          subject?: string | null
          subject_kept?: boolean
          thread_id: string
          to_addresses?: string[]
          to_indexes?: string[] | null
          transcript?: string | null
          transcript_status?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string
          body_html?: string | null
          body_marks?: string | null
          body_shrunk_at?: string | null
          body_text?: string | null
          created_at?: string
          direction?: string
          has_original?: boolean
          id?: string
          in_reply_to?: string | null
          is_bulk?: boolean
          is_read?: boolean
          list_unsubscribe?: string | null
          list_unsubscribe_post?: boolean
          offers_unsubscribe?: boolean
          preview?: string | null
          provider_message_id?: string
          provider_meta?: Json
          reference_ids?: string[]
          sender_address?: string | null
          sender_contact_id?: string | null
          sender_index?: string | null
          sent_at?: string
          subject?: string | null
          subject_kept?: boolean
          thread_id?: string
          to_addresses?: string[]
          to_indexes?: string[] | null
          transcript?: string | null
          transcript_status?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_contact_id_fkey"
            columns: ["sender_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      note_attachments: {
        Row: {
          created_at: string
          id: string
          mime_type: string
          name: string
          note_id: string
          size_bytes: number
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime_type: string
          name: string
          note_id: string
          size_bytes: number
          storage_path: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          mime_type?: string
          name?: string
          note_id?: string
          size_bytes?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_attachments_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          created_at: string
          excerpt: string | null
          id: string
          pinned: boolean
          title: string
          updated_at: string
          use_in_drafts: boolean
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          excerpt?: string | null
          id?: string
          pinned?: boolean
          title?: string
          updated_at?: string
          use_in_drafts?: boolean
          user_id?: string
        }
        Update: {
          body?: string
          created_at?: string
          excerpt?: string | null
          id?: string
          pinned?: boolean
          title?: string
          updated_at?: string
          use_in_drafts?: boolean
          user_id?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          avatar_path: string | null
          avatar_updated_at: string | null
          created_at: string
          domain: string
          domain_index: string | null
          id: string
          logo_path: string | null
          name: string
          summary: string | null
          summary_updated_at: string | null
          user_id: string
        }
        Insert: {
          avatar_path?: string | null
          avatar_updated_at?: string | null
          created_at?: string
          domain: string
          domain_index?: string | null
          id?: string
          logo_path?: string | null
          name: string
          summary?: string | null
          summary_updated_at?: string | null
          user_id: string
        }
        Update: {
          avatar_path?: string | null
          avatar_updated_at?: string | null
          created_at?: string
          domain?: string
          domain_index?: string | null
          id?: string
          logo_path?: string | null
          name?: string
          summary?: string | null
          summary_updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      outbox: {
        Row: {
          account_id: string | null
          attachment_count: number
          bcc_addresses: string[]
          body: string
          cc_addresses: string[]
          created_at: string
          draft_id: string | null
          error: string | null
          for_thread_id: string | null
          from_address: string | null
          id: string
          provider_message_id: string | null
          reply_to_message_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
          thread_id: string | null
          to_addresses: string[]
          user_id: string
        }
        Insert: {
          account_id?: string | null
          attachment_count?: number
          bcc_addresses?: string[]
          body: string
          cc_addresses?: string[]
          created_at?: string
          draft_id?: string | null
          error?: string | null
          for_thread_id?: string | null
          from_address?: string | null
          id?: string
          provider_message_id?: string | null
          reply_to_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          thread_id?: string | null
          to_addresses?: string[]
          user_id?: string
        }
        Update: {
          account_id?: string | null
          attachment_count?: number
          bcc_addresses?: string[]
          body?: string
          cc_addresses?: string[]
          created_at?: string
          draft_id?: string | null
          error?: string | null
          for_thread_id?: string | null
          from_address?: string | null
          id?: string
          provider_message_id?: string | null
          reply_to_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          thread_id?: string | null
          to_addresses?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbox_for_thread_id_fkey"
            columns: ["for_thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_attachments: {
        Row: {
          created_at: string | null
          filename: string
          id: string
          mime_type: string
          outbox_id: string
          position: number
          size_bytes: number
          storage_path: string
          user_id: string
          voice_note: boolean
        }
        Insert: {
          created_at?: string | null
          filename: string
          id?: string
          mime_type: string
          outbox_id: string
          position?: number
          size_bytes: number
          storage_path: string
          user_id?: string
          voice_note?: boolean
        }
        Update: {
          created_at?: string | null
          filename?: string
          id?: string
          mime_type?: string
          outbox_id?: string
          position?: number
          size_bytes?: number
          storage_path?: string
          user_id?: string
          voice_note?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "outbox_attachments_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_rules: {
        Row: {
          created_at: string
          id: string
          kind: string
          target: string
          target_index: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          target: string
          target_index?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          target?: string
          target_index?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          about: string | null
          auto_draft_top: boolean
          avatar_path: string | null
          brief_speed: number
          brief_voice: string
          briefing_time: string
          created_at: string
          display_name: string | null
          important_people: string | null
          push_important: boolean
          push_urgent: boolean
          share_usage: boolean
          language: string | null
          quiet_end: string
          quiet_start: string
          timezone: string
          updated_at: string
          user_id: string
          voice_learned_at: string | null
          voice_learned_outbound: number
          whatsapp_read_receipts: boolean
        }
        Insert: {
          about?: string | null
          auto_draft_top?: boolean
          avatar_path?: string | null
          brief_speed?: number
          brief_voice?: string
          briefing_time?: string
          created_at?: string
          display_name?: string | null
          important_people?: string | null
          push_important?: boolean
          push_urgent?: boolean
          share_usage?: boolean
          language?: string | null
          quiet_end?: string
          quiet_start?: string
          timezone?: string
          updated_at?: string
          user_id: string
          voice_learned_at?: string | null
          voice_learned_outbound?: number
          whatsapp_read_receipts?: boolean
        }
        Update: {
          about?: string | null
          auto_draft_top?: boolean
          avatar_path?: string | null
          brief_speed?: number
          brief_voice?: string
          briefing_time?: string
          created_at?: string
          display_name?: string | null
          important_people?: string | null
          push_important?: boolean
          push_urgent?: boolean
          share_usage?: boolean
          language?: string | null
          quiet_end?: string
          quiet_start?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          voice_learned_at?: string | null
          voice_learned_outbound?: number
          whatsapp_read_receipts?: boolean
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      share_jobs: {
        Row: {
          attempts: number
          created_at: string
          direction: string
          error: string | null
          finished_at: string | null
          follow_up: boolean
          id: string
          share_from: string | null
          started_at: string | null
          status: string
          thread_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          direction: string
          error?: string | null
          finished_at?: string | null
          follow_up?: boolean
          id?: string
          share_from?: string | null
          started_at?: string | null
          status?: string
          thread_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          direction?: string
          error?: string | null
          finished_at?: string | null
          follow_up?: boolean
          id?: string
          share_from?: string | null
          started_at?: string | null
          status?: string
          thread_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_jobs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      style_rules: {
        Row: {
          contact_id: string | null
          created_at: string
          disabled_reason: string | null
          enabled: boolean
          id: string
          relationship: string | null
          rule: string
          scope: string
          source: string
          support_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          disabled_reason?: string | null
          enabled?: boolean
          id?: string
          relationship?: string | null
          rule: string
          scope: string
          source?: string
          support_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          disabled_reason?: string | null
          enabled?: boolean
          id?: string
          relationship?: string | null
          rule?: string
          scope?: string
          source?: string
          support_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "style_rules_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_state: {
        Row: {
          account_id: string
          history_id: string | null
          last_uid: number | null
          scope: string
          sync_token: string | null
          uid_validity: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          history_id?: string | null
          last_uid?: number | null
          scope: string
          sync_token?: string | null
          uid_validity?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          history_id?: string | null
          last_uid?: number | null
          scope?: string
          sync_token?: string | null
          uid_validity?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_state_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      task_updates: {
        Row: {
          account_id: string | null
          action: string
          created_at: string
          due_all_day: boolean
          due_at: string | null
          error: string | null
          id: string
          notes: string | null
          priority: number | null
          status: string
          task_id: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          action: string
          created_at?: string
          due_all_day?: boolean
          due_at?: string | null
          error?: string | null
          id?: string
          notes?: string | null
          priority?: number | null
          status?: string
          task_id?: string | null
          title?: string | null
          user_id?: string
        }
        Update: {
          account_id?: string | null
          action?: string
          created_at?: string
          due_all_day?: boolean
          due_at?: string | null
          error?: string | null
          id?: string
          notes?: string | null
          priority?: number | null
          status?: string
          task_id?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_updates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_updates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          account_id: string
          completed_at: string | null
          contact_id: string | null
          created_at: string
          due_all_day: boolean
          due_at: string | null
          id: string
          list_id: string
          list_name: string | null
          notes: string | null
          priority: number | null
          provider_meta: Json
          provider_task_id: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          due_all_day?: boolean
          due_at?: string | null
          id?: string
          list_id: string
          list_name?: string | null
          notes?: string | null
          priority?: number | null
          provider_meta?: Json
          provider_task_id: string
          status?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          due_all_day?: boolean
          due_at?: string | null
          id?: string
          list_id?: string
          list_name?: string | null
          notes?: string | null
          priority?: number | null
          provider_meta?: Json
          provider_task_id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      team_keys: {
        Row: {
          created_at: string
          key_version: number
          retired_at: string | null
          workspace_id: string
          wrapped_by: string
          wrapped_key: string
        }
        Insert: {
          created_at?: string
          key_version?: number
          retired_at?: string | null
          workspace_id: string
          wrapped_by: string
          wrapped_key: string
        }
        Update: {
          created_at?: string
          key_version?: number
          retired_at?: string | null
          workspace_id?: string
          wrapped_by?: string
          wrapped_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_assignments: {
        Row: {
          assigned_by: string | null
          assignee_id: string
          created_at: string
          thread_id: string
          workspace_id: string
        }
        Insert: {
          assigned_by?: string | null
          assignee_id: string
          created_at?: string
          thread_id: string
          workspace_id: string
        }
        Update: {
          assigned_by?: string | null
          assignee_id?: string
          created_at?: string
          thread_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_assignments_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_notes: {
        Row: {
          body: string
          created_at: string
          id: string
          thread_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          thread_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          thread_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_notes_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_participants: {
        Row: {
          contact_id: string
          thread_id: string
          user_id: string
        }
        Insert: {
          contact_id: string
          thread_id: string
          user_id: string
        }
        Update: {
          contact_id?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_participants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_participants_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      threads: {
        Row: {
          account_id: string
          answered_at: string | null
          avatar_path: string | null
          avatar_updated_at: string | null
          category: string | null
          channel: string
          created_at: string
          group_name: string | null
          id: string
          is_group: boolean
          junk: boolean
          last_from_me: boolean
          last_message_at: string | null
          last_message_preview: string | null
          last_sender_contact_id: string | null
          needs_reply: boolean
          pinned: boolean
          priority: string | null
          provider_thread_id: string
          provider_thread_index: string | null
          share_from: string | null
          share_label: string | null
          share_match: string | null
          share_opt_out: boolean
          share_suggestion: string | null
          shared_at: string | null
          shared_by: string | null
          status: string
          subject: string | null
          subscription: boolean
          summary: string | null
          triage_enabled: boolean
          unread_count: number
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id: string
          answered_at?: string | null
          avatar_path?: string | null
          avatar_updated_at?: string | null
          category?: string | null
          channel: string
          created_at?: string
          group_name?: string | null
          id?: string
          is_group?: boolean
          junk?: boolean
          last_from_me?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          last_sender_contact_id?: string | null
          needs_reply?: boolean
          pinned?: boolean
          priority?: string | null
          provider_thread_id: string
          provider_thread_index?: string | null
          share_from?: string | null
          share_label?: string | null
          share_match?: string | null
          share_opt_out?: boolean
          share_suggestion?: string | null
          shared_at?: string | null
          shared_by?: string | null
          status?: string
          subject?: string | null
          subscription?: boolean
          summary?: string | null
          triage_enabled?: boolean
          unread_count?: number
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string
          answered_at?: string | null
          avatar_path?: string | null
          avatar_updated_at?: string | null
          category?: string | null
          channel?: string
          created_at?: string
          group_name?: string | null
          id?: string
          is_group?: boolean
          junk?: boolean
          last_from_me?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          last_sender_contact_id?: string | null
          needs_reply?: boolean
          pinned?: boolean
          priority?: string | null
          provider_thread_id?: string
          provider_thread_index?: string | null
          share_from?: string | null
          share_label?: string | null
          share_match?: string | null
          share_opt_out?: boolean
          share_suggestion?: string | null
          shared_at?: string | null
          shared_by?: string | null
          status?: string
          subject?: string | null
          subscription?: boolean
          summary?: string | null
          triage_enabled?: boolean
          unread_count?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "threads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_last_sender_contact_id_fkey"
            columns: ["last_sender_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      unsubscribes: {
        Row: {
          account_id: string
          created_at: string
          done_at: string | null
          error: string | null
          id: string
          manual_url: string | null
          method: string | null
          sender_address: string
          sender_index: string | null
          status: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          done_at?: string | null
          error?: string | null
          id?: string
          manual_url?: string | null
          method?: string | null
          sender_address: string
          sender_index?: string | null
          status?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          done_at?: string | null
          error?: string | null
          id?: string
          manual_url?: string | null
          method?: string | null
          sender_address?: string
          sender_index?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unsubscribes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      updates: {
        Row: {
          changes: Json
          created_at: string
          id: string
          published: boolean
          released_on: string
          summary: string | null
          title: string
          updated_at: string
          version: string | null
        }
        Insert: {
          changes?: Json
          created_at?: string
          id?: string
          published?: boolean
          released_on?: string
          summary?: string | null
          title: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          changes?: Json
          created_at?: string
          id?: string
          published?: boolean
          released_on?: string
          summary?: string | null
          title?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      user_keys: {
        Row: {
          created_at: string
          user_id: string
          wrapped_by: string
          wrapped_key: string
        }
        Insert: {
          created_at?: string
          user_id: string
          wrapped_by: string
          wrapped_key: string
        }
        Update: {
          created_at?: string
          user_id?: string
          wrapped_by?: string
          wrapped_key?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          company: string | null
          created_at: string
          decided_at: string | null
          email: string
          id: string
          kind: string
          status: string
          team_size: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          decided_at?: string | null
          email: string
          id?: string
          kind: string
          status?: string
          team_size?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string
          decided_at?: string | null
          email?: string
          id?: string
          kind?: string
          status?: string
          team_size?: string | null
        }
        Relationships: []
      }
      worker_leases: {
        Row: {
          expires_at: string
          holder: string
          name: string
        }
        Insert: {
          expires_at: string
          holder: string
          name: string
        }
        Update: {
          expires_at?: string
          holder?: string
          name?: string
        }
        Relationships: []
      }
      workspace_activity: {
        Row: {
          chats_moved_back: number
          chats_shared: number
          user_id: string
          week: string
          workspace_id: string
        }
        Insert: {
          chats_moved_back?: number
          chats_shared?: number
          user_id: string
          week: string
          workspace_id: string
        }
        Update: {
          chats_moved_back?: number
          chats_shared?: number
          user_id?: string
          week?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_activity_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_client_exclusions: {
        Row: {
          created_at: string
          kind: string
          removed_by: string | null
          value_index: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          kind: string
          removed_by?: string | null
          value_index: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          removed_by?: string | null
          value_index?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_client_exclusions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_companies: {
        Row: {
          created_at: string
          domain_index: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          domain_index: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          domain_index?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_companies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_contact_agents: {
        Row: {
          left_team: boolean
          since: string
          user_id: string
          workspace_contact_id: string
          workspace_id: string
        }
        Insert: {
          left_team?: boolean
          since?: string
          user_id: string
          workspace_contact_id: string
          workspace_id: string
        }
        Update: {
          left_team?: boolean
          since?: string
          user_id?: string
          workspace_contact_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_contact_agents_workspace_contact_id_workspace_id_fkey"
            columns: ["workspace_contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      workspace_contact_identities: {
        Row: {
          created_at: string
          kind: string
          value: string
          value_index: string
          workspace_contact_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          kind: string
          value: string
          value_index: string
          workspace_contact_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          value?: string
          value_index?: string
          workspace_contact_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_contact_identities_workspace_contact_id_workspace_id_fkey"
            columns: ["workspace_contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      workspace_contact_threads: {
        Row: {
          linked_at: string
          thread_id: string
          workspace_contact_id: string
          workspace_id: string
        }
        Insert: {
          linked_at?: string
          thread_id: string
          workspace_contact_id: string
          workspace_id: string
        }
        Update: {
          linked_at?: string
          thread_id?: string
          workspace_contact_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_contact_threads_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_contact_threads_workspace_contact_id_workspace_id_fkey"
            columns: ["workspace_contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      workspace_contacts: {
        Row: {
          company_domain_index: string | null
          company_name: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          company_domain_index?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company_domain_index?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_cover: {
        Row: {
          absent_id: string
          cover_id: string
          created_at: string
          created_by: string | null
          ended_at: string | null
          ended_by: string | null
          ends_at: string
          id: string
          starts_at: string
          workspace_id: string
        }
        Insert: {
          absent_id: string
          cover_id: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          ended_by?: string | null
          ends_at: string
          id?: string
          starts_at: string
          workspace_id: string
        }
        Update: {
          absent_id?: string
          cover_id?: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          ended_by?: string | null
          ends_at?: string
          id?: string
          starts_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_cover_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_inbox_access: {
        Row: {
          account_id: string
          added_by: string | null
          created_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          account_id: string
          added_by?: string | null
          created_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          account_id?: string
          added_by?: string | null
          created_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_inbox_access_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_inbox_access_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          role: string
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          role: string
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          role?: string
          token_hash?: string
          workspace_id?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          allow_cover_reply: boolean
          created_at: string
          joined_at: string | null
          left_at: string | null
          role: string
          status: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          allow_cover_reply?: boolean
          created_at?: string
          joined_at?: string | null
          left_at?: string | null
          role: string
          status: string
          user_id: string
          workspace_id: string
        }
        Update: {
          allow_cover_reply?: boolean
          created_at?: string
          joined_at?: string | null
          left_at?: string | null
          role?: string
          status?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      workspace_voice_items: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          position: number
          slot: string | null
          title: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          position?: number
          slot?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          position?: number
          slot?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_voice_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string | null
          seats: number
          strict_sharing: boolean
          updated_at: string
          waitlist_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id?: string | null
          seats?: number
          strict_sharing?: boolean
          updated_at?: string
          waitlist_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string | null
          seats?: number
          strict_sharing?: boolean
          updated_at?: string
          waitlist_id?: string | null
        }
        Relationships: []
      }
      whatsapp_auth_keys: {
        Row: {
          account_id: string
          ciphertext: string
          key_id: string
          key_type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          ciphertext: string
          key_id: string
          key_type: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          ciphertext?: string
          key_id?: string
          key_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_auth_keys_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_examples: {
        Row: {
          body: string
          created_at: string
          id: string
          situation: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          situation: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          situation?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      storage_usage: {
        Row: {
          bytes: number | null
          files: number | null
          kind: string | null
          user_id: string | null
        }
        Relationships: []
      }
      ai_usage_summary: {
        Row: {
          account_id: string | null
          calls: number | null
          cost_usd: number | null
          feature: string | null
          input_tokens: number | null
          model: string | null
          month: string | null
          output_tokens: number | null
          provider: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      set_attachment_hidden: { Args: { p_ids: string[]; p_hidden: boolean }; Returns: number }
      my_ai_allowance: { Args: never; Returns: Json }
      my_workspace_id: { Args: never; Returns: string }
      my_workspace_role: { Args: never; Returns: string }
      create_workspace: {
        Args: { p_name: string; p_owner_email: string; p_seats: number; p_waitlist_id?: string }
        Returns: Json
      }
      reissue_owner_invite: { Args: { p_workspace: string }; Returns: string }
      invite_member: { Args: { p_email: string; p_role: string }; Returns: string }
      revoke_invite: { Args: { p_invite: string }; Returns: undefined }
      invite_preview: { Args: { p_token: string }; Returns: Json }
      accept_invite: { Args: { p_token: string }; Returns: string }
      remove_member: { Args: { p_user: string }; Returns: undefined }
      set_member_role: { Args: { p_role: string; p_user: string }; Returns: undefined }
      set_strict_sharing: { Args: { p_strict: boolean }; Returns: undefined }
      set_seats: { Args: { p_seats: number; p_workspace: string }; Returns: undefined }
      workspace_members_list: {
        Args: never
        Returns: {
          user_id: string | null
          invite_id: string | null
          email: string | null
          display_name: string | null
          role: string
          status: string
          joined_at: string | null
          left_at: string | null
          expires_at: string | null
        }[]
      }
      admin_workspaces: {
        Args: never
        Returns: {
          id: string
          name: string
          seats: number
          strict_sharing: boolean
          waitlist_id: string | null
          owner_email: string | null
          invited_email: string | null
          members: number
          created_at: string
        }[]
      }
      my_team_storage: { Args: never; Returns: Json }
      team_storage_for: { Args: { p_user: string }; Returns: Json }
      can_read_thread: { Args: { p_thread: string; p_workspace: string }; Returns: boolean }
      can_read_message: { Args: { p_message: string; p_workspace: string }; Returns: boolean }
      mark_thread_work: { Args: { p_share_from?: string | null; p_thread: string }; Returns: undefined }
      mark_thread_personal: { Args: { p_thread: string }; Returns: undefined }
      queue_thread_share: {
        Args: { p_by: string; p_share_from: string | null; p_thread: string; p_user: string; p_workspace: string }
        Returns: undefined
      }
      assign_thread: { Args: { p_assignee: string; p_thread: string }; Returns: undefined }
      unassign_thread: { Args: { p_assignee: string; p_thread: string }; Returns: undefined }
      work_chats: {
        Args: { p_filter?: string; p_limit?: number; p_offset?: number }
        Returns: {
          thread_id: string
          agent_id: string
          agent_name: string | null
          agent_left: boolean
          share_label: string | null
          channel: string
          shared_by: string
          inbox_name: string | null
          shared_at: string
          last_message_at: string | null
          awaiting_reply: boolean
          assignee_ids: string[]
          total_count: number
        }[]
      }
      work_chat_counts: { Args: never; Returns: Json }
      my_shared_chats: {
        Args: never
        Returns: {
          thread_id: string
          share_label: string | null
          channel: string
          shared_at: string
          shared_by: string
          share_from: string | null
          last_message_at: string | null
          state: string
          assignees: Json
          compliance_opens: Json
        }[]
      }
      my_assigned_chats: {
        Args: never
        Returns: {
          thread_id: string
          agent_id: string
          agent_name: string | null
          agent_left: boolean
          share_label: string | null
          preview: string | null
          channel: string
          shared_by: string
          inbox_name: string | null
          last_message_at: string | null
          awaiting_reply: boolean
          assigned_at: string
          assignees: Json
          cover_until: string | null
        }[]
      }
      my_shared_inboxes: {
        Args: never
        Returns: {
          account_id: string
          inbox_name: string
          provider: string
          status: string
          connected_by: string
          connected_by_name: string | null
          has_access: boolean
          awaiting: number
          access: Json
        }[]
      }
      shared_inbox_chats: {
        Args: { p_account: string; p_before?: string | null; p_limit?: number }
        Returns: {
          thread_id: string
          share_label: string | null
          preview: string | null
          channel: string
          last_message_at: string | null
          awaiting_reply: boolean
          assignees: Json
        }[]
      }
      shared_chat_info: { Args: { p_thread: string }; Returns: Json }
      assign_inbox_chat: { Args: { p_assignee: string | null; p_thread: string }; Returns: undefined }
      assign_agent_chats: { Args: { p_agent: string; p_assignee: string }; Returns: number }
      share_account: { Args: { p_account: string; p_name: string }; Returns: number }
      set_inbox_access: { Args: { p_account: string; p_users: string[] }; Returns: undefined }
      add_thread_note: { Args: { p_body: string; p_thread: string }; Returns: string }
      delete_thread_note: { Args: { p_note: string }; Returns: undefined }
      log_compliance_open: { Args: { p_thread: string }; Returns: undefined }
      can_open_thread: { Args: { p_thread: string }; Returns: boolean }
      is_assignee: { Args: { p_thread: string }; Returns: boolean }
      user_can_reply_in_inbox: { Args: { p_thread: string; p_user: string }; Returns: boolean }
      team_response_stats: {
        Args: never
        Returns: {
          user_id: string | null
          name: string | null
          role: string | null
          active: boolean
          unanswered_7d: number
          unanswered_30d: number
          answered_7d: number
          answered_30d: number
          median_reply_7d: number | null
          median_reply_30d: number | null
        }[]
      }
      team_moved_back: {
        Args: never
        Returns: {
          week: string
          user_id: string
          name: string | null
          chats_shared: number
          chats_moved_back: number
        }[]
      }
      upsert_workspace_contact: {
        Args: { p_agent: string; p_company_domain_index: string | null; p_company_name: string | null; p_identities: Json; p_name: string; p_workspace: string }
        Returns: string | null
      }
      apply_team_rule: { Args: { p_match: string; p_thread: string }; Returns: string | null }
      suggest_work_chats: { Args: { p_since: string; p_user: string }; Returns: number }
      dismiss_share_suggestion: { Args: { p_thread: string }; Returns: undefined }
      accept_share_suggestions: { Args: { p_share_from?: string | null; p_threads: string[] }; Returns: number }
      team_clients: {
        Args: never
        Returns: {
          id: string
          name: string
          company_name: string | null
          agents: Json
        }[]
      }
      company_voice_for_draft: { Args: { p_thread: string; p_user: string }; Returns: Json }
      save_voice_item: {
        Args: { p_body: string; p_id: string | null; p_kind: string; p_slot: string | null; p_title: string | null }
        Returns: string
      }
      delete_voice_item: { Args: { p_id: string }; Returns: undefined }
      set_allow_cover_reply: { Args: { p_allow: boolean }; Returns: undefined }
      i_cover: { Args: { p_absent: string; p_workspace: string }; Returns: boolean }
      set_cover: { Args: { p_absent: string; p_cover: string; p_ends: string; p_starts: string }; Returns: string }
      end_cover: { Args: { p_id: string }; Returns: undefined }
      link_thread_clients: { Args: { p_indexes: string[]; p_thread: string; p_workspace: string }; Returns: number }
      rename_team_client: { Args: { p_client: string; p_name: string }; Returns: undefined }
      set_team_client_company: { Args: { p_client: string; p_company_name: string | null; p_domain_index?: string | null }; Returns: undefined }
      set_team_client_agent: { Args: { p_agent: string; p_client: string }; Returns: undefined }
      merge_team_clients: { Args: { p_keep: string; p_remove: string }; Returns: string }
      remove_team_client: { Args: { p_client: string }; Returns: number }
      remove_team_company: { Args: { p_domain_index: string }; Returns: undefined }
      begin_client_export: { Args: { p_client: string; p_label: string }; Returns: Json }
      export_chat_messages: {
        Args: { p_after_id?: string | null; p_after_sent?: string | null; p_export: string; p_limit?: number; p_thread: string }
        Returns: {
          id: string
          sent_at: string
          direction: string
          sender_address: string | null
          to_addresses: string[]
          subject: string | null
          body_text: string | null
          body_html: string | null
          transcript: string | null
          quoted_text: string | null
          files: Json
        }[]
      }
      export_chat_notes: {
        Args: { p_export: string; p_thread: string }
        Returns: { id: string; user_name: string | null; body: string; created_at: string }[]
      }
      finish_client_export: { Args: { p_export: string; p_messages: number }; Returns: undefined }
      compliance_export_log: {
        Args: never
        Returns: {
          id: string
          user_id: string
          user_name: string | null
          client_label: string
          chats: number
          messages: number | null
          started_at: string
          finished_at: string | null
        }[]
      }
      my_exported_chats: { Args: never; Returns: { thread_id: string; exported_on: string }[] }
      team_key_rotation_due: {
        Args: { p_workspace: string }
        Returns: boolean
      }
      team_keys_to_reseal: {
        Args: never
        Returns: {
          workspace_id: string
          current_version: number
        }[]
      }
      claim_share_job: {
        Args: never
        Returns: {
          attempts: number
          created_at: string
          direction: string
          error: string | null
          finished_at: string | null
          follow_up: boolean
          id: string
          share_from: string | null
          started_at: string | null
          status: string
          thread_id: string
          user_id: string
          workspace_id: string
        }[]
      }
      share_pending_messages: {
        Args: { p_after?: string | null; p_direction: string; p_limit: number; p_thread: string }
        Returns: {
          account_id: string
          body_html: string | null
          body_marks: string | null
          body_text: string | null
          created_at: string
          direction: string
          has_original: boolean
          id: string
          in_reply_to: string | null
          is_bulk: boolean
          is_read: boolean
          list_unsubscribe: string | null
          list_unsubscribe_post: boolean
          offers_unsubscribe: boolean
          preview: string | null
          provider_message_id: string
          provider_meta: Json
          reference_ids: string[]
          sender_address: string | null
          sender_contact_id: string | null
          sender_index: string | null
          sent_at: string
          subject: string | null
          subject_kept: boolean
          thread_id: string
          to_addresses: string[]
          to_indexes: string[] | null
          transcript: string | null
          transcript_status: string | null
          user_id: string
          workspace_id: string | null
        }[]
      }
      share_pending_message_ai: {
        Args: { p_after?: string | null; p_direction: string; p_limit: number; p_thread: string }
        Returns: {
          bulk_read: string | null
          category: string
          created_at: string
          junk: boolean
          message_id: string
          model: string | null
          needs_reply: boolean
          priority: string
          prompt_version: string | null
          reply_choices: string | null
          summary: string
          traits: Json | null
          user_id: string
          workspace_id: string | null
        }[]
      }
      share_pending_attachments: {
        Args: { p_after?: string | null; p_direction: string; p_limit: number; p_thread: string }
        Returns: {
          created_at: string
          filename: string
          hidden: boolean
          hidden_reason: string | null
          id: string
          kind: string
          message_id: string
          mime_type: string | null
          provider_attachment_id: string | null
          size_bytes: number | null
          storage_path: string | null
          user_id: string
          workspace_id: string | null
        }[]
      }
      share_write: { Args: { p_rows: Json; p_table: string; p_thread: string; p_workspace: string | null }; Returns: number }
      queue_share_followup: { Args: { p_thread: string }; Returns: undefined }
      bump_workspace_activity: { Args: { p_moved_back: number; p_shared: number; p_user: string; p_workspace: string }; Returns: undefined }
      ai_usage_by_user: {
        Args: never
        Returns: {
          user_id: string
          email: string | null
          accounts: string[]
          month_usd: number
          week_usd: number
          day_usd: number
          setup_usd: number
          calls: number
          month_pct: number
          by_feature: Json
          flag: string | null
          team_name: string | null
          team_seats: number
          paused: string[]
        }[]
      }
      ai_allowance_for: { Args: { p_user: string }; Returns: Json }
      ai_setup_state: { Args: { p_user: string }; Returns: Json }
      storage_flags: {
        Args: never
        Returns: {
          reason: string
          top_chat_bytes: number
          total_bytes: number
          user_id: string
          week_bytes: number
        }[]
      }
      analytics_summary: {
        Args: { p_exclude?: boolean; p_from: string; p_to: string }
        Returns: Json
      }
      analytics_health: {
        Args: { p_exclude?: boolean; p_to: string }
        Returns: Json
      }
      analytics_owner_id: { Args: never; Returns: string }
      analytics_record: {
        Args: {
          p_events: Json
          p_user: string
        }
        Returns: undefined
      }
      track: {
        Args: {
          p_events: Json
          p_screen: string
          p_session: string
          p_size: string
          p_version: string
        }
        Returns: undefined
      }
      attachment_is_junk: {
        Args: {
          p_direction: string
          p_filename: string
          p_kind: string
          p_subject: string
          p_thread_category: string
          p_thread_junk: boolean
        }
        Returns: boolean
      }
      attachment_looks_kept: {
        Args: { p_filename: string; p_subject: string }
        Returns: boolean
      }
      calendar_attendees_valid: {
        Args: { p_attendees: string[] }
        Returns: boolean
      }
      confirm_unsubscribe: { Args: { p_id: string }; Returns: undefined }
      contact_merge_caller: { Args: { p_user: string }; Returns: string }
      contact_summaries: {
        Args: never
        Returns: {
          contact_id: string
          conversation_count: number
          last_at: string
        }[]
      }
      company_summaries: {
        Args: never
        Returns: {
          addresses: number
          conversations: number
          domain: string
          id: string
          last_at: string
          logo_path: string
          name: string
          people: number
          summary: string
        }[]
      }
      company_logo_choose: {
        Args: { p_domain: string; p_n: number }
        Returns: undefined
      }
      company_logo_reject: {
        Args: { p_domain: string; p_n?: number }
        Returns: undefined
      }
      contact_name_is_placeholder: {
        Args: { p_name: string }
        Returns: boolean
      }
      create_contact: {
        Args: {
          p_company: string
          p_identities: Json
          p_name: string
          p_organization?: Json
        }
        Returns: string
      }
      delete_contact: { Args: { p_contact: string }; Returns: undefined }
      embedded_message_count: { Args: never; Returns: number }
      google_chat_contact: {
        Args: { p_account_id: string; p_person: Json; p_user: string }
        Returns: string
      }
      import_address_book_cards: {
        Args: { p_cards: Json; p_user: string }
        Returns: Json
      }
      ingest_email: {
        Args: { p_account_id: string; p_mail: Json }
        Returns: Json
      }
      ingest_email_batch: {
        Args: { p_account_id: string; p_mails: Json }
        Returns: Json
      }
      ingest_google_chat: {
        Args: { p_account_id: string; p_msg: Json }
        Returns: Json
      }
      ingest_instagram: {
        Args: { p_account_id: string; p_msg: Json }
        Returns: Json
      }
      ingest_instagram_batch: {
        Args: { p_account_id: string; p_msgs: Json }
        Returns: Json
      }
      ingest_linkedin: {
        Args: { p_account_id: string; p_msg: Json }
        Returns: Json
      }
      ingest_teams: {
        Args: { p_account_id: string; p_msg: Json }
        Returns: Json
      }
      ingest_whatsapp: {
        Args: { p_account_id: string; p_msg: Json }
        Returns: Json
      }
      ingest_whatsapp_batch: {
        Args: { p_account_id: string; p_msgs: Json }
        Returns: Json
      }
      ingest_zoom_chat: {
        Args: { p_account_id: string; p_msg: Json }
        Returns: Json
      }
      instagram_contact: {
        Args: { p_person: Json; p_user: string }
        Returns: string
      }
      is_analytics_owner: { Args: never; Returns: boolean }
      is_personal_mail_domain: { Args: { p_domain: string }; Returns: boolean }
      link_whatsapp: { Args: { p_phone?: string }; Returns: string }
      linkedin_contact: {
        Args: { p_create?: boolean; p_person: Json; p_user: string }
        Returns: string
      }
      mail_domain_root: { Args: { p_domain: string }; Returns: string }
      mark_seen_up_to: {
        Args: { p_account_id: string; p_seen_at: string; p_thread_index?: string; p_thread_provider_id: string }
        Returns: number
      }
      merge_contacts: {
        Args: {
          p_automatic?: boolean
          p_keep: string
          p_merge: string
          p_reason: string
          p_user?: string
        }
        Returns: string
      }
      organization_for_address: {
        Args: { p_address: string; p_user: string }
        Returns: string
      }
      organization_for_index: {
        Args: { p_company: Json; p_user: string }
        Returns: string
      }
      organization_name_for_domain: {
        Args: { p_domain: string }
        Returns: string
      }
      refresh_attachment_junk: {
        Args: { p_thread_id: string }
        Returns: undefined
      }
      refresh_thread: {
        Args: { p_resurface?: boolean; p_thread_id: string }
        Returns: undefined
      }
      refresh_thread_last_sender: {
        Args: { p_thread_id: string }
        Returns: undefined
      }
      request_auto_draft: {
        Args: { p_thread: string }
        Returns: string
      }
      request_whatsapp_link: {
        Args: { p_phone?: string; p_user: string }
        Returns: string
      }
      set_address_indexes: {
        Args: { p_rows: Json; p_table: string }
        Returns: number
      }
      split_contact: {
        Args: {
          p_chat_indexes?: string[]
          p_contact: string
          p_identity_ids: string[]
          p_name: string
          p_organization?: Json
          p_user?: string
        }
        Returns: string
      }
      teams_contact: {
        Args: { p_person: Json; p_user: string }
        Returns: string
      }
      teams_mark_read: {
        Args: { p_account_id: string; p_chat_index: string; p_until: string }
        Returns: number
      }
      undo_merge: {
        Args: { p_merge: string; p_user?: string }
        Returns: undefined
      }
      update_contact: {
        Args: {
          p_add?: Json
          p_company: string
          p_contact: string
          p_name: string
          p_relationship: string
          p_remove?: string[]
          p_role: string
        }
        Returns: undefined
      }
      whatsapp_contact: {
        Args: { p_create?: boolean; p_person: Json; p_user: string }
        Returns: string
      }
      whatsapp_contact_names: {
        Args: { p_account_id: string; p_people: Json }
        Returns: number
      }
      whatsapp_map_lid: {
        Args: {
          p_account_id: string
          p_lid_chat_index?: string
          p_lid_index?: string
          p_lid_jid: string
          p_phone: string
          p_phone_index?: string
          p_pn_chat_index?: string
          p_pn_jid: string
        }
        Returns: undefined
      }
      whatsapp_mark_read: {
        Args: {
          p_account_id: string
          p_chat_indexes?: string[]
          p_chat_jids: string[]
        }
        Returns: number
      }
      whatsapp_message_status: {
        Args: {
          p_account_id: string
          p_provider_message_id: string
          p_status: string
        }
        Returns: boolean
      }
      whatsapp_react: {
        Args: {
          p_account_id: string
          p_emoji: string
          p_provider_message_id: string
          p_reactor?: string
          p_sender: string
        }
        Returns: boolean
      }
      whatsapp_set_receipt: {
        Args: { p_account_id: string; p_message_ids: string[]; p_state: string }
        Returns: undefined
      }
      whatsapp_update_message: {
        Args: {
          p_account_id: string
          p_body: string
          p_meta?: Json
          p_preview: string
          p_provider_message_id: string
        }
        Returns: boolean
      }
      zoom_chat_contact: {
        Args: { p_person: Json; p_user: string }
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
  public: {
    Enums: {},
  },
} as const
