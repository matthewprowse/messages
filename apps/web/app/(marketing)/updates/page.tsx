// Updates: the public changelog. Every entry the owner publishes from Admin (public.updates) shows here, newest first,
// with its date and version beside it and its changes under New, Improved and Fixed. Drafts never leave the database.

import type { Metadata } from "next";
import { pageMeta } from "@/components/marketing/page-meta";
import { PageIntro, Section } from "@/components/marketing/section";
import { ClosingCta } from "@/components/marketing/closing-cta";
import { JsonLd, breadcrumbData } from "@/components/marketing/json-ld";
import { Badge } from "@/components/ui/badge";
import { loadPublicUpdates } from "@/lib/server/published-updates";
import { dayLabel } from "@/lib/updates-model";
import { groupChanges, type ReaderUpdate } from "@/lib/updates-seen";

const DESCRIPTION = "Everything new in Konva: new features, improvements and fixes to the client inbox for South African professionals, newest first.";

export const metadata: Metadata = pageMeta({ title: "Updates", description: DESCRIPTION, path: "/updates" });

/** A link-safe anchor for an entry: its version where it has one ("v0.0.20" becomes "v0-0-20"), otherwise its id. */
const anchor = (u: ReaderUpdate) => (u.version ? u.version.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : u.id);

function Entry({ update }: { update: ReaderUpdate }) {
  const id = anchor(update);
  return (
    <article id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-20 gap-4 md:grid-cols-[11rem_1fr] md:gap-12">
      {/* The date stays beside the entry while it scrolls past on wider screens. */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground md:sticky md:top-20 md:flex-col md:items-start md:self-start">
        <a href={`#${id}`} className="hover:text-foreground"><time dateTime={update.releasedOn}>{dayLabel(update.releasedOn)}</time></a>
        {update.version && <Badge variant="secondary">{update.version}</Badge>}
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">{update.title}</h2>
          {update.summary && <p className="text-base leading-7 text-muted-foreground text-pretty">{update.summary}</p>}
        </div>
        {groupChanges(update.changes).map((g) => (
          <section key={g.kind} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{g.label}</h3>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-6 text-muted-foreground marker:text-muted-foreground/60">
              {g.items.map((text, i) => <li key={i}>{text}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}

export default async function UpdatesPage() {
  const updates = await loadPublicUpdates();
  return (
    <>
      <JsonLd data={[breadcrumbData("Updates", "/updates")]} />
      <Section first className="pb-0 md:pb-0">
        <PageIntro title="Updates" lead="New features, improvements and fixes in Konva, newest first." />
      </Section>
      <Section>
        {updates.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">The first update is on its way.</p>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-20 md:gap-28">
            {updates.map((u) => <Entry key={u.id} update={u} />)}
          </div>
        )}
      </Section>
      <ClosingCta />
    </>
  );
}
