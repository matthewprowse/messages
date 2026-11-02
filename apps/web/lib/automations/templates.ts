// The templates in the Automations gallery. Each pairs a card with the setup it turns on; the fixed parser for it lives in the AI
// worker (apps/ai/ai/automations/templates.py) and is chosen by `key`, so the conditions here only decide which emails go to it.
// More templates (website contact forms, Gumtree, Facebook Lead Ads, IOL Property) come as users ask.

import type { AutomationSpec } from "./spec";

export interface Template {
  key: "property24" | "private_property";
  name: string;
  description: string;
  spec: AutomationSpec;
}

const DO = {
  contact: true, lead: true, link: true, task: { title: "Call Back Within 5 Minutes", minutes: 5 }, draft: true, urgent: true,
} as const;

export const TEMPLATES: Template[] = [
  {
    key: "property24",
    name: "Property24 Enquiry",
    description: "A buyer enquires about one of your listings on Property24. Konva reads their name, number, email and question out of the email.",
    spec: {
      name: "Property24 Enquiry",
      when: { senders: ["property24.com"], subject: [], body: [], anywhere: ["enquiry", "inquiry", "lead", "interested in"], accounts: [] },
      read: { fields: [] },
      do: { ...DO, source: "Property24 Enquiry", task: { ...DO.task } },
    },
  },
  {
    key: "private_property",
    name: "Private Property Enquiry",
    description: "A buyer enquires about one of your listings on Private Property. Konva reads their name, number, email and question out of the email.",
    spec: {
      name: "Private Property Enquiry",
      when: { senders: ["privateproperty.co.za"], subject: [], body: [], anywhere: ["enquiry", "inquiry", "lead", "interested in"], accounts: [] },
      read: { fields: [] },
      do: { ...DO, source: "Private Property Enquiry", task: { ...DO.task } },
    },
  },
];

/** The starting point of a Custom automation: nothing set yet, and the usual fields for Gemini to read. */
export function customSpec(): AutomationSpec {
  return {
    name: "",
    when: { senders: [], subject: [], body: [], anywhere: [], accounts: [] },
    read: {
      fields: [
        { key: "name", description: "The full name of the person who wrote in." },
        { key: "email", description: "Their own email address." },
        { key: "phone", description: "Their phone number." },
        { key: "message", description: "What they asked or said, shortened." },
      ],
    },
    do: { contact: true, lead: true, source: "", link: true, task: null, draft: false, urgent: false },
  };
}

/** The template for a stored key, or undefined for a Custom automation. */
export function templateOf(key: string | null): Template | undefined {
  return TEMPLATES.find((t) => t.key === key);
}
