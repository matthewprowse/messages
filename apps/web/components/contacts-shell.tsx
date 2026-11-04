"use client";

// The two-column frame of the Contacts section: the list on the left, the open contact or company beside it. Also the context for company renames.

import { createContext, Suspense } from "react";
import { usePathname } from "next/navigation";
import type { ContactSummary } from "@/lib/contacts";
import type { CompanySummary } from "@/lib/organizations";
import { ContactList } from "@/components/contact-list";
import { cn } from "@/lib/utils";

/** Tells the list that a company was renamed on its page. */
export const CompaniesContext = createContext<(id: string, name: string) => void>(() => {});

// Same split as the Conversations page: list a third wide, the open contact or company beside it on the grey, with no
// line between them. On phones one shows at a time.
export function ContactsShell({
  contacts,
  companies,
  children,
}: {
  contacts: ContactSummary[] | null | undefined;
  companies: CompanySummary[] | null | undefined;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isDetail = /^\/contacts\/(companies\/[^/]+|(?!companies$)[^/]+)/.test(pathname);
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("h-full w-full shrink-0 flex-col md:flex md:w-80 md:border-r lg:w-1/3", isDetail ? "hidden" : "flex")}>
        <Suspense fallback={null}>
          <ContactList contacts={contacts} companies={companies} />
        </Suspense>
      </aside>
      <section className={cn("h-full w-full min-w-0 shrink-0 flex-col bg-muted/50 md:flex md:flex-1", isDetail ? "flex" : "hidden")}>{children}</section>
    </div>
  );
}
