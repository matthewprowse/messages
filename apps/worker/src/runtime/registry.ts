// The provider name to connector map: which class runs an account of each provider. Adding a provider means adding it here.

import type { AccountRow } from "../db";
import { LinkedInConnector } from "../connectors/linkedin";
import { ICloudConnector } from "../connectors/icloud";
import { ImapConnector } from "../connectors/imap";
import { IMAP_SERVICE } from "../connectors/mail-service";
import { GmailConnector } from "../connectors/gmail";
import { GoogleCalendarConnector } from "../connectors/google-calendar";
import { WhatsAppConnector } from "../connectors/whatsapp";
import { OutlookConnector } from "../connectors/outlook";
import { OutlookCalendarConnector } from "../connectors/outlook-calendar";
import { ICloudCalendarConnector } from "../connectors/icloud-calendar";
import { GoogleTasksConnector } from "../connectors/google-tasks";
import { MicrosoftTodoConnector } from "../connectors/microsoft-todo";
import { ICloudRemindersConnector } from "../connectors/icloud-reminders";
import { TeamsConnector } from "../connectors/teams";
import { GoogleMeetConnector } from "../connectors/google-meet";
import { ZoomConnector } from "../connectors/zoom";
import type { Connector } from "./state";

export const CONNECTORS: Record<string, (account: AccountRow) => Connector> = {
  icloud: (account) => new ICloudConnector(account),
  imap: (account) => new ImapConnector(account, IMAP_SERVICE),
  gmail: (account) => new GmailConnector(account),
  google_calendar: (account) => new GoogleCalendarConnector(account),
  whatsapp: (account) => new WhatsAppConnector(account),
  outlook: (account) => new OutlookConnector(account),
  outlook_calendar: (account) => new OutlookCalendarConnector(account),
  icloud_calendar: (account) => new ICloudCalendarConnector(account),
  google_tasks: (account) => new GoogleTasksConnector(account),
  microsoft_todo: (account) => new MicrosoftTodoConnector(account),
  // Hands task changes to the AI worker's Reminders connector, which syncs the account (connectors/icloud-reminders.ts).
  icloud_reminders: (account) => new ICloudRemindersConnector(account),
  teams: (account) => new TeamsConnector(account),
  google_meet: (account) => new GoogleMeetConnector(account),
  zoom: (account) => new ZoomConnector(account),
  linkedin: (account) => new LinkedInConnector(account),
};
