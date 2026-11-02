"use client";

// /inbox/person/<contact id>: one person's email, WhatsApp, LinkedIn and Instagram messages as a single timeline.

import { useParams } from "next/navigation";
import { PersonView } from "@/components/person/person-view";

export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  return <PersonView personId={id} />;
}
