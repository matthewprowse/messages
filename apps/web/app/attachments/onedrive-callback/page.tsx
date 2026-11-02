"use client";

// Where Microsoft sends the popup after the OneDrive sign-in (lib/cloud-pick/onedrive.ts). It hands the code to the
// page that opened it, on this origin only, and leaves the popup open for the picker. It shows nothing else.

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function Callback() {
  const params = useSearchParams();
  useEffect(() => {
    if (!window.opener) return;
    window.opener.postMessage({ type: "konva-onedrive-code", code: params.get("code") ?? undefined, state: params.get("state") ?? undefined, error: params.get("error") ?? undefined }, window.location.origin);
  }, [params]);
  return <p role="status" className="p-6 text-sm text-muted-foreground">Connecting to OneDrive</p>;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Callback />
    </Suspense>
  );
}
