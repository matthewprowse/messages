// A made-up key service for screen tests of code that seals text in the browser before it saves (New Event, New Contact,
// Edit Contact). Opt in per file. Only the app's own /api/keys is answered; every other address still meets the network
// guard. The key is random, made here, and never leaves this process.

/**
 * Answers /api/keys with a fresh random 32-byte key for the fake user, so sealing works as in the app and a test can open
 * what was written with lib/vault's open(). Call once at the top of a test file: the vault holds the key once fetched, and
 * each test file is its own process.
 */
export function fakeKeyService() {
  const guarded = globalThis.fetch;
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/keys" || url === "http://localhost:3000/api/keys") return Promise.resolve(new Response(JSON.stringify({ key }), { status: 200, headers: { "Content-Type": "application/json" } }));
    return guarded(input, init);
  }) as typeof fetch;
}
