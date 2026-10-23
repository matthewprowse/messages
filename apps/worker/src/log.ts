// Structured, content-free logging. Never pass message bodies, subjects, addresses or credentials here:
// log IDs, counts and error codes only.
type Fields = Record<string, string | number | boolean | null | undefined>;

function write(level: "info" | "warn" | "error", msg: string, fields?: Fields) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};

/** A safe one-line description of an error: its code and class, never its message (which can echo content). */
export function errorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; responseStatus?: unknown; name?: unknown };
    return String(e.code ?? e.responseStatus ?? e.name ?? "unknown");
  }
  return "unknown";
}
