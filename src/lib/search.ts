export interface Searchable {
  name: string;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Case/punctuation-insensitive match: every whitespace-separated query token must be a
 * substring of the name ("grad west" matches "Graduate Life Center West"; the misspelling
 * "cassel" does not match "Cassell", by design - fuzziness is on the plan's cut list).
 */
export function matches(name: string, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const n = norm(name);
  return q.split(" ").every((t) => n.includes(t));
}

export function filterByName<T extends Searchable>(items: T[], query: string): T[] {
  return items.filter((i) => matches(i.name, query));
}
