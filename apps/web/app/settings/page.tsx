"use client";

// On a phone this is the list of sections (drawn by the layout, which hides this page's own content). From tablet
// width up the list is always beside a section, so the first one opens straight away. It draws nothing itself, so
// there is no empty screen to flash before the redirect.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsIndex() {
  const router = useRouter();
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const go = () => { if (wide.matches) router.replace("/settings/accounts"); };
    go();
    wide.addEventListener("change", go);
    return () => wide.removeEventListener("change", go);
  }, [router]);
  return null;
}
