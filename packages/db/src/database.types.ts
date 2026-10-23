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
      account_credentials: {
        Row: {
          account_id: string
          ciphertext: string
          updated_at: string
        }
        Insert: {
          account_id: string
          ciphertext: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          ciphertext?: string
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
          label: string
          last_synced_at: string | null
          pairing_code: string | null
          pairing_phone: string | null
          provider: string
          qr_code: string | null
          send_address_indexes: string[] | null
          send_addresses: string[]
          status: string
          status_detail: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          address_index?: string | null
          created_at?: string
          id?: string
          label: string
          last_synced_at?: string | null
          pairing_code?: string | null
          pairing_phone?: string | null
          provider: string
          qr_code?: string | null
          send_address_indexes?: string[] | null
          send_addresses?: string[]
          status?: string
          status_detail?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          address_index?: string | null
          created_at?: string
          id?: string
          label?: string
          last_synced_at?: string | null
          pairing_code?: string | null
          pairing_phone?: string | null
          provider?: string
          qr_code?: string | null
          send_address_indexes?: string[] | null
          send_addresses?: string[]
          status?: string
          status_detail?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      attachments: {
        Row: {
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
        }
        Insert: {
          created_at?: string
          filename: string
          hidden?: boolean
          hidden_reason?: string | null
          id?: string
          kind?: string
          message_id: string
          mime_type?: string | null
          provider_attachment_id?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          filename?: string
          hidden?: boolean
          hidden_reason?: string | null
          id?: string
          kind?: string
          message_id?: string
          mime_type?: string | null
          provider_attachment_id?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      briefs: {
        Row: {
          audio: string | null
          created_at: string
          error: string | null
          for_date: string
          id: string
          script: string | null
          seconds: number | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audio?: string | null
          created_at?: string
          error?: string | null
          for_date: string
          id?: string
          script?: string | null
          seconds?: number | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          audio?: string | null
          created_at?: string
          error?: string | null
          for_date?: string
          id?: string
          script?: string | null
          seconds?: number | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calendar_events: {
        Row: {
          account_id: string
          all_day: boolean
          attendees: Json
          calendar_id: string
          ends_at: string | null
          id: string
          location: string | null
          provider_event_id: string
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
          ends_at?: string | null
          id?: string
          location?: string | null
          provider_event_id: string
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
          ends_at?: string | null
          id?: string
          location?: string | null
          provider_event_id?: string
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
          avatar_path: string | null
          avatar_source: string | null
          avatar_updated_at: string | null
          company: string | null
          created_at: string
          display_name: string
          id: string
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
          avatar_path?: string | null
          avatar_source?: string | null
          avatar_updated_at?: string | null
          company?: string | null
          created_at?: string
          display_name: string
          id?: string
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
          avatar_path?: string | null
          avatar_source?: string | null
          avatar_updated_at?: string | null
          company?: string | null
          created_at?: string
          display_name?: string
          id?: string
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
          body: string
          created_at: string
          decision: string | null
          decision_kind: string | null
          error: string | null
          id: string
          instruction: string | null
          model: string | null
          status: string
          thread_id: string
          tone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          decision?: string | null
          decision_kind?: string | null
          error?: string | null
          id?: string
          instruction?: string | null
          model?: string | null
          status?: string
          thread_id: string
          tone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          decision?: string | null
          decision_kind?: string | null
          error?: string | null
          id?: string
          instruction?: string | null
          model?: string | null
          status?: string
          thread_id?: string
          tone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
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
      mail_actions: {
        Row: {
          action: string
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
      message_ai: {
        Row: {
          category: string
          created_at: string
          junk: boolean
          message_id: string
          model: string | null
          needs_reply: boolean
          priority: string
          reply_choices: string | null
          summary: string
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          junk?: boolean
          message_id: string
          model?: string | null
          needs_reply?: boolean
          priority: string
          reply_choices?: string | null
          summary: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          junk?: boolean
          message_id?: string
          model?: string | null
          needs_reply?: boolean
          priority?: string
          reply_choices?: string | null
          summary?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_ai_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_embeddings: {
        Row: {
          created_at: string
          embedding: string | null
          message_id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          message_id: string
          sent_at: string
          user_id: string
        }
        Update: {
          created_at?: string
          embedding?: string | null
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
          user_id: string
        }
        Insert: {
          account_id: string
          body_html?: string | null
          body_marks?: string | null
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
          user_id: string
        }
        Update: {
          account_id?: string
          body_html?: string | null
          body_marks?: string | null
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
          user_id?: string
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
        ]
      }
      organizations: {
        Row: {
          avatar_path: string | null
          avatar_updated_at: string | null
          created_at: string
          domain: string
          domain_index: string | null
          id: string
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
          body: string
          created_at: string
          draft_id: string | null
          error: string | null
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
          body: string
          created_at?: string
          draft_id?: string | null
          error?: string | null
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
          body?: string
          created_at?: string
          draft_id?: string | null
          error?: string | null
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
          briefing_time: string
          created_at: string
          display_name: string | null
          important_people: string | null
          push_important: boolean
          push_urgent: boolean
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
          briefing_time?: string
          created_at?: string
          display_name?: string | null
          important_people?: string | null
          push_important?: boolean
          push_urgent?: boolean
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
          briefing_time?: string
          created_at?: string
          display_name?: string | null
          important_people?: string | null
          push_important?: boolean
          push_urgent?: boolean
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
          avatar_path: string | null
          avatar_updated_at: string | null
          category: string | null
          channel: string
          created_at: string
          group_name: string | null
          id: string
          is_group: boolean
          junk: boolean
          last_message_at: string | null
          last_message_preview: string | null
          last_sender_contact_id: string | null
          needs_reply: boolean
          pinned: boolean
          priority: string | null
          provider_thread_id: string
          provider_thread_index: string | null
          status: string
          subject: string | null
          subscription: boolean
          summary: string | null
          triage_enabled: boolean
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          avatar_path?: string | null
          avatar_updated_at?: string | null
          category?: string | null
          channel: string
          created_at?: string
          group_name?: string | null
          id?: string
          is_group?: boolean
          junk?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          last_sender_contact_id?: string | null
          needs_reply?: boolean
          pinned?: boolean
          priority?: string | null
          provider_thread_id: string
          provider_thread_index?: string | null
          status?: string
          subject?: string | null
          subscription?: boolean
          summary?: string | null
          triage_enabled?: boolean
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          avatar_path?: string | null
          avatar_updated_at?: string | null
          category?: string | null
          channel?: string
          created_at?: string
          group_name?: string | null
          id?: string
          is_group?: boolean
          junk?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          last_sender_contact_id?: string | null
          needs_reply?: boolean
          pinned?: boolean
          priority?: string | null
          provider_thread_id?: string
          provider_thread_index?: string | null
          status?: string
          subject?: string | null
          subscription?: boolean
          summary?: string | null
          triage_enabled?: boolean
          unread_count?: number
          updated_at?: string
          user_id?: string
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
      ingest_whatsapp: {
        Args: { p_account_id: string; p_msg: Json }
        Returns: Json
      }
      ingest_whatsapp_batch: {
        Args: { p_account_id: string; p_msgs: Json }
        Returns: Json
      }
      is_personal_mail_domain: { Args: { p_domain: string }; Returns: boolean }
      link_whatsapp: { Args: { p_phone?: string }; Returns: string }
      mail_domain_root: { Args: { p_domain: string }; Returns: string }
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
      request_whatsapp_link: {
        Args: { p_phone?: string; p_user: string }
        Returns: string
      }
      set_address_indexes: {
        Args: { p_rows: Json; p_table: string }
        Returns: number
      }
      similar_replies: {
        Args: {
          p_embedding: string
          p_exclude_thread?: string
          p_limit: number
          p_user: string
        }
        Returns: {
          contact_id: string
          inbound_message_id: string
          inbound_sent_at: string
          inbound_subject: string
          inbound_text: string
          reply_message_id: string
          reply_sent_at: string
          reply_text: string
          similarity: number
          thread_id: string
        }[]
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
      undo_merge: {
        Args: { p_merge: string; p_user?: string }
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
