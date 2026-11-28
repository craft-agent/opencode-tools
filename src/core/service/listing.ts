import { MAX_ID, MAX_LISTED, MAX_LIST_CHARS } from "./schemas"

/**
 * The entries a result keeps of a list, in order: while there are fewer than
 * `MAX_LISTED` and what they take as JSON stays within `MAX_LIST_CHARS`. It
 * stops at the first entry that does not fit, so what is kept is a prefix.
 */
export function listed<T>(entries: readonly T[]): { kept: T[]; truncated: boolean } {
  const kept: T[] = []
  let size = 0
  for (const entry of entries) {
    size += JSON.stringify(entry).length
    if (kept.length >= MAX_LISTED || size > MAX_LIST_CHARS) break
    kept.push(entry)
  }
  return { kept, truncated: kept.length < entries.length }
}

/** Whether an id is short enough for a result to keep: a cut id could not be used in a later call. */
export function idFits(id: string): boolean {
  return id.length <= MAX_ID || [...id].length <= MAX_ID
}
