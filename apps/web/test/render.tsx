// renderScreen: renders one component the way the app would hold it (store, router, tooltips, optionally the signed-in
// session and the toast area), all fakes, and hands back a user-event driver and the spies to assert on.

import { mock, type Mock } from "node:test";
import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, PathParamsContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { FakeStore, fakeStore, type FakeStoreData, type StoreSpies } from "./fake-store";

/** The router's methods as spies; push and replace record where the screen navigated to. */
export type FakeRouter = { [K in keyof AppRouterInstance]: Mock<AppRouterInstance[K]> };

export function fakeRouter(): FakeRouter {
  return { push: mock.fn(() => undefined), replace: mock.fn(() => undefined), back: mock.fn(() => undefined), forward: mock.fn(() => undefined), refresh: mock.fn(() => undefined), prefetch: mock.fn(() => undefined) } as FakeRouter;
}

/** Provides useRouter, usePathname, useSearchParams and useParams from next/navigation, as the App Router does. */
export function RouterContexts({ router, path, children }: { router: FakeRouter; path: string; children: ReactNode }) {
  const url = new URL(path, "http://localhost:3000");
  return (
    <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
      <PathnameContext.Provider value={url.pathname}>
        <SearchParamsContext.Provider value={url.searchParams}>
          <PathParamsContext.Provider value={{}}>{children}</PathParamsContext.Provider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}

export interface ScreenOptions extends FakeStoreData {
  /** The page it is on, with any query ("/inbox?view=all"). */
  path?: string;
  /** Wrap in the real AuthProvider, whose session comes from the fake Supabase client (signed in by default). */
  auth?: boolean;
  /** Render Sonner's toast area, for a test that reads a toast. */
  toasts?: boolean;
}

export interface Screen extends RenderResult {
  user: ReturnType<typeof userEvent.setup>;
  store: StoreSpies;
  router: FakeRouter;
}

/** Renders ui inside the fakes. Read what it shows with `screen` queries; drive it with the returned `user`. */
export function renderScreen(ui: ReactElement, options: ScreenOptions = {}): Screen {
  const { path = "/inbox", auth = false, toasts = false, ...data } = options;
  const { value, spies } = fakeStore(data);
  const router = fakeRouter();
  const wrap = (children: ReactNode) => {
    const inner = (
      <RouterContexts router={router} path={path}>
        <FakeStore store={value}><TooltipProvider delayDuration={0}>{children}</TooltipProvider></FakeStore>
        {toasts && <Toaster />}
      </RouterContexts>
    );
    return auth ? <AuthProvider>{inner}</AuthProvider> : inner;
  };
  const user = userEvent.setup();
  const result = render(ui, { wrapper: ({ children }) => wrap(children) });
  return { ...result, user, store: spies, router };
}
