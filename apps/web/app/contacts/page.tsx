"use client";

// Contacts index: the right-hand pane with no one open (ContactsHome). Hidden on phones, where the list is the page.

import { Suspense } from "react";
import { ContactsHome } from "@/components/contacts/contacts-home";

export default function ContactsIndex() {
  return (
    <div className="hidden h-full md:block">
      <Suspense fallback={null}>
        <ContactsHome />
      </Suspense>
    </div>
  );
}
