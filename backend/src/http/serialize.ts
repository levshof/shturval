/** Convert a Prisma Decimal | number | null/undefined to a plain number | null. */
export function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  return Number(v as { toString(): string });
}

/** Same as num() but returns 0 instead of null. */
export function num0(v: unknown): number {
  return num(v) ?? 0;
}

/** Date → "YYYY-MM-DD" (UTC date part) for API responses, or null. */
export function dateOnly(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}
