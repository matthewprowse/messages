// The first thing every screen test loads (through setup-dom.ts): a happy-dom window on the global object, the
// Supabase swap and the network guard. It is its own module because react-dom decides at import time whether it has a
// DOM, so this must run before anything imports React.

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { installNetworkGuard } from "./network-guard";
import { redirectSupabase } from "./supabase-hook";

redirectSupabase();
// Read by modules that build addresses themselves (analytics, notes); .invalid can never resolve, and the guard stops it first.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://screen-tests.invalid";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "screen-tests-publishable-key";

GlobalRegistrator.register({
  url: "http://localhost:3000/inbox", width: 1280, height: 800,
  // No script, style or frame is ever fetched by the DOM itself.
  settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true },
});
// Tells React this is a test environment, so updates wrapped by Testing Library flush before assertions.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
installNetworkGuard();
