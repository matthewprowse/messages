"use client";

// The contact form fields shared by New Contact and Edit Contact: a multi-value input, the hook that holds and checks
// the values, and the field set itself. Re-exported from components/contact-list.tsx.

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { checkContactFields } from "@/lib/contacts";
import { defaultCountryCode } from "@/lib/new-items";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A few lines of the same kind (addresses or numbers), with Add and Remove. */
export function MultiInput({ id, label, addLabel, values, errors, onChange, disabled, type }: {
  id: string;
  label: string;
  addLabel: string;
  values: string[];
  errors: (string | null)[];
  onChange: (values: string[]) => void;
  disabled: boolean;
  type: "email" | "tel";
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${id}-0`}>{label}</Label>
      {values.map((v, i) => (
        <div key={i} className="grid gap-1">
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-${i}`}
              type={type}
              value={v}
              onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
              maxLength={254}
              disabled={disabled}
              aria-invalid={!!errors[i]}
            />
            {values.length > 1 && (
              <Button type="button" variant="ghost" size="icon" aria-label="Remove" disabled={disabled} onClick={() => onChange(values.filter((_, j) => j !== i))}>
                <X />
              </Button>
            )}
            {/* A plus at the end of the last one adds another line. */}
            {i === values.length - 1 && (
              <Button type="button" variant="secondary" size="icon" aria-label={addLabel} title={addLabel} disabled={disabled || !v.trim()} onClick={() => onChange([...values, ""])}>
                <Plus />
              </Button>
            )}
          </div>
          {errors[i] && <p className="text-xs text-destructive">{errors[i]}</p>}
        </div>
      ))}
    </div>
  );
}

/** What New Contact and Edit Contact share: the same fields, held and checked the same way. */
export function useContactFields(initial: { name?: string; company?: string; role?: string; relationship?: string }, onChange?: () => void) {
  const { accounts } = useApp();
  const country = useMemo(() => defaultCountryCode(accounts), [accounts]);
  const [values, setValues] = useState({
    name: initial.name ?? "",
    company: initial.company ?? "",
    role: initial.role ?? "",
    relationship: initial.relationship ?? "",
  });
  const [emails, setEmailsState] = useState([""]);
  const [phones, setPhonesState] = useState([""]);
  const checks = checkContactFields({ name: values.name, emails, phones }, country);
  return {
    values,
    set: (key: keyof typeof values) => (value: string) => {
      setValues((v) => ({ ...v, [key]: value }));
      onChange?.();
    },
    emails,
    setEmails: (v: string[]) => {
      setEmailsState(v);
      onChange?.();
    },
    phones,
    setPhones: (v: string[]) => {
      setPhonesState(v);
      onChange?.();
    },
    ...checks,
  };
}

/** Name, addresses, numbers, company, role and relationship, in that order, for both forms. */
export function ContactFields({ idPrefix, fields, tried, disabled, editing = false, existing }: {
  idPrefix: string;
  fields: ReturnType<typeof useContactFields>;
  tried: boolean;
  disabled: boolean;
  /** Edit adds to the addresses and numbers already on file, which `existing` lists. */
  editing?: boolean;
  existing?: React.ReactNode;
}) {
  const { values, set } = fields;
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input id={`${idPrefix}-name`} value={values.name} onChange={(e) => set("name")(e.target.value)} maxLength={120} disabled={disabled} aria-invalid={tried && !!fields.nameError} autoFocus />
        {tried && fields.nameError && <p className="text-xs text-destructive">{fields.nameError}</p>}
      </div>
      {existing}
      <MultiInput
        id={`${idPrefix}-email`}
        label={editing ? "Add Email Address" : "Email Addresses"}
        addLabel={editing ? "Add Another Email" : "Add Email Address"}
        type="email"
        values={fields.emails}
        errors={tried ? fields.emailErrors : []}
        onChange={fields.setEmails}
        disabled={disabled}
      />
      <MultiInput
        id={`${idPrefix}-phone`}
        label={editing ? "Add Phone Number" : "Phone Numbers"}
        addLabel={editing ? "Add Another Number" : "Add Phone Number"}
        type="tel"
        values={fields.phones}
        errors={tried ? fields.phoneErrors : []}
        onChange={fields.setPhones}
        disabled={disabled}
      />
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-company`}>Company</Label>
        <Input id={`${idPrefix}-company`} value={values.company} onChange={(e) => set("company")(e.target.value)} maxLength={120} disabled={disabled} placeholder="Optional" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-role`}>Role</Label>
        <Input id={`${idPrefix}-role`} value={values.role} onChange={(e) => set("role")(e.target.value)} maxLength={120} disabled={disabled} placeholder="Optional" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-relationship`}>Relationship</Label>
        <Input id={`${idPrefix}-relationship`} value={values.relationship} onChange={(e) => set("relationship")(e.target.value)} maxLength={60} disabled={disabled} placeholder="Client, colleague, family" />
      </div>
    </>
  );
}
