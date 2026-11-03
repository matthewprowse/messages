"use client";

// Settings with nothing chosen. On a phone the layout shows the list and hides this; from tablet up Profile opens beside the
// list (its row is lit), so there is no empty pane and no redirect to flash through.

import ProfilePage from "./profile/page";

export default function SettingsIndex() {
  return <ProfilePage />;
}
