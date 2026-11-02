// The Guests field of the New Event dialog: a button that opens a searchable list of contacts and typed addresses.
// Controlled by the dialog, which keeps the guest list and the search text.

import { ChevronDownIcon } from "lucide-react";
import type { Contact } from "@/lib/types";
import { ContactAvatar } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ITEM = "p-2";

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
            <CommandInput
              value={query}
              onValueChange={onQuery}
              onKeyDown={(e) => {
                // A comma or semicolon ends an address, so several can be typed or pasted at once.
                if ((e.key === "," || e.key === ";") && query.trim()) { e.preventDefault(); addGuests(query); }
              }}
              placeholder="Name or Email Address"
              groupClassName="h-8!"
            />
            <CommandList className="max-h-80">
              <CommandEmpty className="py-4 text-muted-foreground">{query.trim() ? "No contacts found." : "Type a Name or Email Address."}</CommandEmpty>
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
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
