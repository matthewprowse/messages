"use client";

// The Relationship field of New Contact and Edit Contact: a pick from Client, Prospect, Colleague, Supplier, Personal and
// Other, or Custom for anything else (typed in a box that appears). Stock shadcn Select and Input.

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { canonicalRelationship, isStandardRelationship, MAX_RELATIONSHIP, RELATIONSHIPS } from "@/lib/relationships";

// Select items cannot be empty strings, so "not set" and "custom" have values of their own.
const NONE = "__none";
const CUSTOM = "__custom";

export function RelationshipPicker({ id, value, onChange, disabled }: { id: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  // A value that is not in the set (typed before, or from an import) opens as Custom, so it is never lost.
  const [custom, setCustom] = useState(!!value.trim() && !isStandardRelationship(value));
  const selected = custom ? CUSTOM : value.trim() ? canonicalRelationship(value) : NONE;
  return (
    <div className="grid gap-2">
      <Select
        value={selected}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === CUSTOM) {
            setCustom(true);
            if (isStandardRelationship(value)) onChange("");
            return;
          }
          setCustom(false);
          onChange(next === NONE ? "" : next);
        }}
      >
        <SelectTrigger id={id} className="w-full"><SelectValue placeholder="Not Set" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not Set</SelectItem>
          {RELATIONSHIPS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          <SelectItem value={CUSTOM}>Custom</SelectItem>
        </SelectContent>
      </Select>
      {custom && <Input aria-label="Custom Relationship" value={value} onChange={(e) => onChange(e.target.value)} maxLength={MAX_RELATIONSHIP} disabled={disabled} placeholder="For example, Neighbour" autoFocus={!value} />}
    </div>
  );
}
