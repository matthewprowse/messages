// Web app manifest, so Konva can be installed as a standalone app from the browser: icons (plain and maskable), the
// launcher shortcuts, and the share sheet entry that opens a New Email with the shared text.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Konva",
    short_name: "Konva",
    description: "One inbox for email and WhatsApp.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#f7f6f3",
    theme_color: "#f7f6f3",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      { name: "New Email", short_name: "New Email", url: "/new-email", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Summary", short_name: "Summary", url: "/summary", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
    // Text only: a shared file needs a POST handler that stores it first, which waits for the attachment upload path.
    share_target: { action: "/new-email", method: "GET", enctype: "application/x-www-form-urlencoded", params: { title: "subject", text: "body", url: "url" } },
  } as MetadataRoute.Manifest;
}
