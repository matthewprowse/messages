// The Guests field of the New Event dialog: a searchable list of contacts and typed addresses. On a computer it is a
// button that opens the list in a popover; on a phone the search box is always there with the list right under it,
// because a popover, the keyboard and the dialog fight over the screen. Controlled by the dialog, which keeps the
// guest list and the search text.

import { ChevronDownIcon } from "lucide-react";
import { useWide } from "@/components/calendar/page-context";
import { parseGuests } from "@/lib/new-items";
import type { Contact } from "@/lib/types";
import { ContactAvatar } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ITEM = "p-2";

// How long iOS takes to slide the keyboard up, so the field is scrolled into view once the space is known.
const KEYBOARD_SETTLE_MS = 300;

type ListProps = {
  query: string;
  guests: string[];
  setGuests: (update: (list: string[]) => string[]) => void;
  suggestions: { contact: Contact; email: string }[];
  typed: string[];
  nameOf: (email: string) => string;
  addGuests: (text: string) => void;
  onQuery: (query: string) => void;
};

/** What the list shows under the search: an Add row for typed addresses, matching contacts, then the guests so far. */
function GuestItems({ query, guests, setGuests, suggestions, typed, nameOf, addGuests, onQuery }: ListProps) {
  return (
    <>
      {typed.length > 0 && (
        <CommandGroup>
          <CommandItem value={`add ${typed.join(" ")}`} className={ITEM} onSelect={() => addGuests(typed.join(" "))}>
            <span className="min-w-0 truncate">Add {typed.join(", ")}</span>
          </CommandItem>
        </CommandGroup>
      )}
      {suggestions.length > 0 && (
        <CommandGroup heading="Contacts">
          {suggestions.map(({ contact, email }) => (
            <CommandItem key={`${contact.id} ${email}`} value={`${contact.id} ${email}`} className={ITEM} onSelect={() => { addGuests(email); onQuery(""); }}>
              <ContactAvatar contact={contact} className="size-6" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{contact.name}</span>
                <span className="truncate text-xs text-muted-foreground">{email}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {/* Picking a guest again takes them off. */}
      {guests.length > 0 && !query.trim() && (
        <CommandGroup heading="Guests">
          {guests.map((g) => (
            <CommandItem key={g} value={`guest ${g}`} data-checked className={ITEM} onSelect={() => setGuests((list) => list.filter((x) => x !== g))}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{nameOf(g)}</span>
                {nameOf(g) !== g && <span className="truncate text-xs text-muted-foreground">{g}</span>}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}

export function GuestPicker({ open, onOpenChange, query, onQuery, guests, setGuests, suggestions, typed, nameOf, label, addGuests, error, disabled }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQuery: (query: string) => void;
  guests: string[];
  setGuests: (update: (list: string[]) => string[]) => void;
  suggestions: { contact: Contact; email: string }[];
  /** Typed addresses that are not already a guest or offered as a contact. */
  typed: string[];
  nameOf: (email: string) => string;
  /** What the button says: the guests' names, or null for the placeholder. */
  label: string | null;
  addGuests: (text: string) => void;
  error: string | null;
  disabled: boolean;
}) {
  const wide = useWide();
  const list: ListProps = { query, guests, setGuests, suggestions, typed, nameOf, addGuests, onQuery };
  // A comma or semicolon ends an address, so several can be typed or pasted at once.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "," || e.key === ";") && query.trim()) { e.preventDefault(); addGuests(query); }
  };

  if (!wide) {
    const hasList = !!query.trim() || guests.length > 0;
    return (
      <div className="grid gap-2">
        <Label htmlFor="event-guests">Guests</Label>
        {/* Inline, so the Command's popover chrome comes off: no background, padding or rounding of its own. */}
        <Command shouldFilter={false} className="overflow-visible rounded-none! bg-transparent p-0 **:data-[slot=command-input-wrapper]:p-0">
          <CommandInput
            id="event-guests"
            value={query}
            onValueChange={onQuery}
            onKeyDown={onKeyDown}
            onFocus={(e) => { const field = e.currentTarget; setTimeout(() => field.scrollIntoView({ block: "start", behavior: "smooth" }), KEYBOARD_SETTLE_MS); }}
            // Tapping a contact blurs the field first, so only whole addresses are kept here; the list handles the rest.
            onBlur={() => { const parsed = parseGuests(query); if (parsed.valid.length && !parsed.invalid.length) addGuests(query); }}
            placeholder="Name or Email Address"
            aria-invalid={!!error}
            disabled={disabled}
            groupClassName="h-8!"
          />
          {hasList && (
            <CommandList className="max-h-none">
              {query.trim() && <CommandEmpty className="py-4 text-muted-foreground">No contacts found.</CommandEmpty>}
              <GuestItems {...list} />
            </CommandList>
          )}
        </Command>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor="event-guests">Guests</Label>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button id="event-guests" type="button" variant="outline" className="w-full justify-between font-normal" aria-invalid={!!error} disabled={disabled}>
            <span className={label ? "truncate" : "truncate text-muted-foreground"}>{label ?? "Name or Email Address"}</span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={onQuery} onKeyDown={onKeyDown} placeholder="Name or Email Address" groupClassName="h-8!" />
            <CommandList className="max-h-80">
              <CommandEmpty className="py-4 text-muted-foreground">{query.trim() ? "No contacts found." : "Type a Name or Email Address."}</CommandEmpty>
              <GuestItems {...list} />
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
