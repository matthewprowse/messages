// Small shared helpers: re-exports cn for class names, plus withQuery.

export { cn } from "cn"

/** A path with a list's query string kept on it, so going to a page and back keeps the list as it was. */
export function withQuery(path: string, query: string) {
  return query ? `${path}?${query}` : path;
}
