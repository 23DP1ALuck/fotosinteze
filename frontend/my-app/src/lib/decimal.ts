/** Accept an ungrouped decimal comma; leave ambiguous/grouped values for validation to reject. */
export function normalizeDecimal(value: string): string {
  return value.trim().replace(/^([+-]?\d*),(\d{1,2})$/, '$1.$2')
}
