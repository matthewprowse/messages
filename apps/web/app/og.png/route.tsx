// The picture link previews show for the marketing pages (WhatsApp, LinkedIn, iMessage): the Konva mark and the
// headline on the app's light background. A fixed address (/og.png), so every page's metadata can name it.

import { ImageResponse } from "next/og";

export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#ffffff", color: "#0a0a0a" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40, fontWeight: 600 }}>
        <svg width="76" height="48" viewBox="0 0 191 120" fill="#0a0a0a" aria-hidden><path d="M38.5 0H90L0 120V51.3ZM140 0H191L152.5 51.5H101.5ZM51.5 51.5H102.5L153 120H102Z" /></svg>
        Konva
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05, maxWidth: 900 }}>Every Client Conversation, in One Place</div>
        <div style={{ fontSize: 32, color: "#737373" }}>WhatsApp, email, LinkedIn and Instagram, sorted by client.</div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
