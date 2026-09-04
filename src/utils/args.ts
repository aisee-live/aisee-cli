/**
 * Parsing helpers for CLI option values.
 */

/**
 * Split a comma-separated option value into a list.
 *
 * Returns `undefined` rather than `[]` for an absent or empty value: several
 * backend fields treat an empty array as a meaningful instruction — an empty
 * `platforms` disables scheduled publishing, an empty analyzer group is
 * rejected outright — so "the user said nothing" must stay distinguishable
 * from "the user said none".
 */
export function splitList(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split(",").map((v) => v.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}
